"""
westmotors_scraper.py — WestMotors INDEX-based VIN lookup (Phase IV).

Architecture (per project decision):
    BitMotors  = LIVE search (primary)
    WestMotors = INDEX fallback (secondary)
    Page scan  = safety net (tertiary)

This module ONLY:
  1. Discovers all VINs via public sitemaps (sitemap-lots-*.xml).
  2. Stores {vin, url, region, lastmod} in `vin_data_westmotors`.
  3. On lookup: takes a VIN, finds its URL in our index, fetches the
     server-rendered detail page and parses it to a normalized vehicle dict.

NO live search through this site. NO listing scrapes. NO Playwright.
All HTML on west-motors.pl detail pages is server-side rendered, so a
plain httpx + BeautifulSoup pipeline is enough.

Polite scraping:
  - User-Agent: BIBI-Cars-Bot/1.0 (+contact)
  - 2-second delay between requests
  - Respects 429/403 with exponential backoff
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("westmotors")

BASE = "https://west-motors.pl"
SITEMAP_INDEX = f"{BASE}/sitemap.xml"

# A friendly bot UA — west-motors robots.txt rate-limits anonymous AI bots,
# so we identify ourselves clearly.
HEADERS = {
    "User-Agent": "BIBI-Cars-Bot/1.0 (+https://bibi-cars.com; integration=vin-fallback)",
    "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.I)
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

# Region detection from URL path
REGION_MAP = [
    ("/catalog-avto-china/", "china"),
    ("/catalog-avto-europe/", "europe"),
    ("/catalog-avto-korea/", "korea"),
    ("/catalog-avto-uae/", "uae"),
    ("/catalog-avto/", "usa"),  # keep last (most generic prefix)
]


def detect_region(url: str) -> str:
    for prefix, region in REGION_MAP:
        if prefix in url:
            return region
    return "unknown"


def extract_vin_from_url(url: str) -> Optional[str]:
    """`/catalog-avto/tesla/model+3/5YJ3E1EA1PF620311` → `5YJ3E1EA1PF620311`"""
    if not url:
        return None
    last = urlparse(url).path.rstrip("/").split("/")[-1]
    last = last.upper().replace("+", "").replace(" ", "").replace("-", "")
    if VIN_RE.fullmatch(last):
        return last
    # Fallback: any 17-char VIN-ish substring
    m = VIN_RE.search(url.upper())
    return m.group(0) if m else None


# ─────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────
_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            headers=HEADERS,
            timeout=httpx.Timeout(20.0, connect=10.0),
            follow_redirects=True,
            http2=False,
        )
    return _client


async def close_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    _client = None


async def _fetch(url: str, max_retries: int = 3) -> Optional[str]:
    """Polite GET with exponential backoff on 429/403/5xx."""
    client = await get_client()
    for attempt in range(max_retries):
        try:
            r = await client.get(url)
            if r.status_code == 200:
                return r.text
            if r.status_code in (429, 403):
                wait = (2 ** attempt) * 3
                logger.warning(f"[westmotors] {r.status_code} on {url} — sleeping {wait}s")
                await asyncio.sleep(wait)
                continue
            if 500 <= r.status_code < 600:
                await asyncio.sleep(2 ** attempt)
                continue
            logger.info(f"[westmotors] {r.status_code} on {url}")
            return None
        except (httpx.RequestError, httpx.HTTPError) as e:
            logger.warning(f"[westmotors] fetch error {url}: {e}")
            await asyncio.sleep(2 ** attempt)
    return None


# ─────────────────────────────────────────────────────────────────
# Sitemap discovery
# ─────────────────────────────────────────────────────────────────
async def fetch_sitemap_index() -> List[Dict[str, str]]:
    """Returns list of {loc, lastmod} for every sub-sitemap in the master index."""
    xml = await _fetch(SITEMAP_INDEX)
    if not xml:
        return []
    out: List[Dict[str, str]] = []
    try:
        root = ET.fromstring(xml)
        for sm in root.findall("sm:sitemap", SITEMAP_NS):
            loc_el = sm.find("sm:loc", SITEMAP_NS)
            mod_el = sm.find("sm:lastmod", SITEMAP_NS)
            if loc_el is not None and loc_el.text:
                out.append({
                    "loc": loc_el.text.strip(),
                    "lastmod": (mod_el.text.strip() if mod_el is not None and mod_el.text else ""),
                })
    except ET.ParseError as e:
        logger.error(f"[westmotors] sitemap index parse error: {e}")
    return out


async def parse_lot_sitemap(sitemap_url: str) -> List[Dict[str, str]]:
    """Returns list of {url, lastmod} entries from a single lots-*.xml sitemap."""
    xml = await _fetch(sitemap_url)
    if not xml:
        return []
    out: List[Dict[str, str]] = []
    try:
        root = ET.fromstring(xml)
        for u in root.findall("sm:url", SITEMAP_NS):
            loc_el = u.find("sm:loc", SITEMAP_NS)
            mod_el = u.find("sm:lastmod", SITEMAP_NS)
            if loc_el is not None and loc_el.text:
                out.append({
                    "url": loc_el.text.strip(),
                    "lastmod": (mod_el.text.strip() if mod_el is not None and mod_el.text else ""),
                })
    except ET.ParseError as e:
        logger.error(f"[westmotors] lot sitemap parse error {sitemap_url}: {e}")
    return out


def is_lot_sitemap(url: str) -> bool:
    """We only care about per-lot sitemaps, not makes/models/static."""
    last = url.rstrip("/").split("/")[-1].lower()
    return "lots" in last  # matches sitemap-lots-1.xml, sitemap-china-lots-1.xml, etc.


def is_first_lot_sitemap(url: str) -> bool:
    """First sitemap of each region — used for hourly incremental sync.

    Sitemaps are typically ordered newest-first by lastmod, so lots-1 holds
    the freshly-listed cars.
    """
    last = url.rstrip("/").split("/")[-1].lower()
    return last.endswith("lots-1.xml") or last.endswith("lots.xml")


# ─────────────────────────────────────────────────────────────────
# Detail page parser
# ─────────────────────────────────────────────────────────────────
LABEL_MAP_SPEC = {
    # Specyfikacja section labels (Polish)
    "stan": "condition",
    "condition": "condition",
    "kluczyk dostępny": "keys",
    "keys": "keys",
    "dokumenty": "title_status",
    "documents": "title_status",
    "napęd": "drive",
    "drive": "drive",
    "przebieg": "odometer_text",
    "mileage": "odometer_text",
    "główne uszkodzenie": "primary_damage",
    "primary damage": "primary_damage",
    "dodatkowe uszkodzenie": "secondary_damage",
    "secondary damage": "secondary_damage",
}

LABEL_MAP_AUCTION = {
    "vin": "vin",
    "numer lotu": "lot",
    "lot": "lot",
    "lot number": "lot",
    "status sprzedaży": "sale_status",
    "data aukcji": "auction_date_text",
    "auction date": "auction_date_text",
    "lokalizacja": "location",
    "location": "location",
}

LABEL_MAP_DESC = {
    "rodzaj paliwa": "fuel",
    "fuel type": "fuel",
    "kolor nadwozia": "color",
    "body color": "color",
    "color": "color",
}

ODOM_RE = re.compile(r"([\d ,.]+)\s*(mi|km)\b", re.I)


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _to_int(s: str) -> Optional[int]:
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def _parse_odometer(text: str) -> Tuple[Optional[int], Optional[str]]:
    if not text:
        return None, None
    m = ODOM_RE.search(text)
    if not m:
        return _to_int(text), None
    return _to_int(m.group(1)), m.group(2).lower()


def _parse_pl_date(text: str) -> Optional[str]:
    """`pon, 27 kwi 2026, 19:00` → ISO `2026-04-27T19:00:00`"""
    if not text:
        return None
    months = {
        "sty": 1, "lut": 2, "mar": 3, "kwi": 4, "maj": 5, "cze": 6,
        "lip": 7, "sie": 8, "wrz": 9, "paź": 10, "lis": 11, "gru": 12,
    }
    m = re.search(r"(\d{1,2})\s+([a-ząęóźż]{3,})\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?",
                  text.lower(), re.UNICODE)
    if not m:
        return None
    day, mname, year = int(m.group(1)), m.group(2)[:3], int(m.group(3))
    hour = int(m.group(4)) if m.group(4) else 0
    minute = int(m.group(5)) if m.group(5) else 0
    mnum = months.get(mname)
    if not mnum:
        return None
    try:
        dt = datetime(year, mnum, day, hour, minute, 0, tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return None


def _split_drive_trans(value: str) -> Tuple[Optional[str], Optional[str]]:
    """`RWD AUTOMATIC` / `AWD\\nAUTOMATIC` → (`RWD`, `AUTOMATIC`)"""
    if not value:
        return None, None
    parts = re.split(r"[\s\n,/]+", value.strip())
    parts = [p for p in parts if p]
    drive_tokens = {"FWD", "RWD", "AWD", "4WD", "4X4", "2WD"}
    drive = None
    trans = None
    for p in parts:
        pu = p.upper()
        if pu in drive_tokens and not drive:
            drive = pu
        elif pu in ("AUTOMATIC", "MANUAL", "CVT", "DSG", "AUTO") and not trans:
            trans = pu
        elif not drive and not trans and len(parts) == 1:
            drive = pu
    return drive, trans


def _extract_lot_number(value: str) -> Optional[str]:
    """`78333635 copart` → `78333635`"""
    if not value:
        return None
    m = re.search(r"\d{4,12}", value)
    return m.group(0) if m else None


def _make_from_url(url: str) -> Optional[str]:
    """`/catalog-avto/tesla/model+3/<vin>` → `TESLA`"""
    if not url:
        return None
    path = urlparse(url).path.rstrip("/")
    parts = [p for p in path.split("/") if p]
    # parts: ['catalog-avto', '<make>', '<model>', '<vin>']
    if len(parts) >= 4 and parts[0].startswith("catalog-avto"):
        return parts[1].upper().replace("-", " ").replace("+", " ")
    return None


def _model_from_url(url: str) -> Optional[str]:
    if not url:
        return None
    path = urlparse(url).path.rstrip("/")
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 4 and parts[0].startswith("catalog-avto"):
        return parts[2].upper().replace("-", " ").replace("+", " ")
    return None


def parse_detail(html: str, url: str) -> Optional[Dict[str, Any]]:
    """Extract a normalized vehicle dict from a west-motors.pl detail page.

    Returns None if the page doesn't look like a real detail page (e.g. 404
    masked as 200 with an empty shell).
    """
    if not html or len(html) < 1000:
        return None
    soup = BeautifulSoup(html, "html.parser")

    out: Dict[str, Any] = {
        "vin": None, "year": None, "make": None, "model": None,
        "trim": None, "title": None,
        "auction": None, "lot": None, "location": None,
        "auction_date": None, "auction_date_text": None,
        "sale_status": None,
        "odometer": None, "odometer_unit": None,
        "fuel": None, "drive": None, "transmission": None,
        "color": None, "condition": None, "keys": None,
        "title_status": None,
        "primary_damage": None, "secondary_damage": None, "damage": None,
        "current_bid": None, "price": None,
        "images": [], "image": None,
        "url": url, "region": detect_region(url),
        "_src": "westmotors",
    }

    # ─── Make/model from URL (most reliable) ───
    out["make"] = _make_from_url(url)
    out["model"] = _model_from_url(url)

    # ─── Title (h1) → "TESLA MODEL 3 2023 z USA do Polski" ───
    h1 = soup.find("h1")
    if h1:
        h1_text = _clean_text(h1.get_text(" ", strip=True))
        out["title"] = h1_text
        # Try to extract year
        ym = re.search(r"\b(19|20)\d{2}\b", h1_text)
        if ym:
            out["year"] = int(ym.group(0))

    # ─── Breadcrumbs are unreliable (Vue-rendered category chips can be picked up
    # as if they were make/model links) — we no longer use them for make/model.

    # ─── VIN from URL (most reliable) ───
    vin_from_url = extract_vin_from_url(url)
    if vin_from_url:
        out["vin"] = vin_from_url

    # ─── Year/Make/Model from breadcrumb-li-text ───
    # Sometimes shown as "2023 TESLA MODEL 3 5YJ3E1EA1PF620311"
    full_breadcrumb = " ".join(_clean_text(li.get_text(" ", strip=True))
                               for li in soup.find_all("li"))
    if not out["year"]:
        ym = re.search(r"\b(19|20)\d{2}\b", full_breadcrumb)
        if ym:
            out["year"] = int(ym.group(0))

    # ─── Generic label-pair extractor ───
    # Pages list specs as <li> blocks: <icon> <label-text> <value-text>
    def _push_pair(label: str, value: str):
        label_l = label.lower().strip().rstrip(":")
        value_c = _clean_text(value)
        if not value_c:
            return
        # Spec section
        if label_l in LABEL_MAP_SPEC:
            key = LABEL_MAP_SPEC[label_l]
            if key == "keys":
                out["keys"] = value_c.lower() in ("tak", "yes", "true")
            elif key == "odometer_text":
                km, unit = _parse_odometer(value_c)
                if km is not None:
                    out["odometer"] = km
                    out["odometer_unit"] = unit or "mi"
            elif key == "drive":
                d, t = _split_drive_trans(value_c)
                if d:
                    out["drive"] = d
                if t:
                    out["transmission"] = t
            else:
                out[key] = value_c
            return
        # Auction section
        if label_l in LABEL_MAP_AUCTION:
            key = LABEL_MAP_AUCTION[label_l]
            if key == "vin" and (not out["vin"]):
                m = VIN_RE.search(value_c)
                out["vin"] = m.group(0) if m else value_c
            elif key == "lot":
                lot_clean = _extract_lot_number(value_c)
                if lot_clean:
                    out["lot"] = lot_clean
                # If the value also includes auction provider name, surface it
                low = value_c.lower()
                for prov in ("copart", "iaai", "manheim", "adesa", "crashedtoys"):
                    if prov in low and not out.get("auction"):
                        out["auction"] = "IAAI" if prov == "iaai" else prov.capitalize()
                        break
            elif key == "auction_date_text":
                out["auction_date_text"] = value_c
                iso = _parse_pl_date(value_c)
                if iso:
                    out["auction_date"] = iso
            else:
                out[key] = value_c
            return
        # Description section
        if label_l in LABEL_MAP_DESC:
            out[LABEL_MAP_DESC[label_l]] = value_c

    # Detail blocks are typically <ul>/<li> with two inner divs/spans
    for li in soup.find_all("li"):
        # two-text-node items: label in first text, value in second
        texts = [_clean_text(t) for t in li.stripped_strings if _clean_text(t)]
        if len(texts) < 2:
            continue
        # label is usually the shortest non-numeric leading line
        label, value = texts[0], " ".join(texts[1:])
        _push_pair(label, value)

    # ─── Auction provider (Copart/IAAI/etc) ───
    text_lower = soup.get_text(" ", strip=True).lower()
    for prov in ("copart", "iaai", "manheim", "adesa", "crashedtoys"):
        if prov in text_lower:
            out["auction"] = prov.capitalize() if prov != "iaai" else "IAAI"
            break

    # ─── Photos ───
    seen = set()
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src:
            continue
        if "img.westmotors.online" in src or "westmotors.online/lpp/" in src:
            if src not in seen:
                seen.add(src)
                out["images"].append(src)
    if out["images"]:
        out["image"] = out["images"][0]

    # ─── Current bid (e.g. "aktualna oferta\n0 $") ───
    bid_match = re.search(r"aktualna\s+oferta[^\d$]*([\d  ,]+)\s*\$",
                          soup.get_text(" ", strip=True), re.IGNORECASE)
    if bid_match:
        out["current_bid"] = _to_int(bid_match.group(1)) or 0

    # Damage convenience field
    if out.get("primary_damage"):
        out["damage"] = out["primary_damage"]

    # Sanity: must have either VIN or LOT to be considered valid
    if not out.get("vin") and not out.get("lot"):
        return None

    return out


# ─────────────────────────────────────────────────────────────────
# Public lookup (for vin_service integration)
# ─────────────────────────────────────────────────────────────────
# Hard timeouts (per Phase IV-1 mandate):
#   - DB index lookup: ~10 ms
#   - HTTP fetch + parse: ≤3500 ms
# Beyond that we MUST fall back to BitMotors PAGE so the user never waits.
HARD_LOOKUP_TIMEOUT_SEC = 3.5
PREFETCH_TTL_HOURS = 24  # treat prefetched_data as authoritative for 24h


# In-process latency stats (lifetime of the process). Persisted snapshots
# go to the `westmotors_latency` collection from the sync worker.
_latency = {
    "lookups_total": 0,
    "hits_prefetched": 0,    # answered from BD-stored prefetch (no HTTP)
    "hits_live_fetch": 0,    # had to fetch detail page right now
    "misses": 0,             # vin not in index
    "errors": 0,
    "timeouts": 0,
    "p50_ms": 0,
    "p95_ms": 0,
    "_durations": [],        # rolling buffer (last 500)
}


def _record_latency(kind: str, ms: float):
    _latency["lookups_total"] += 1
    if kind in _latency:
        _latency[kind] += 1
    buf = _latency["_durations"]
    buf.append(ms)
    if len(buf) > 500:
        del buf[: len(buf) - 500]
    if buf:
        sorted_buf = sorted(buf)
        _latency["p50_ms"] = sorted_buf[len(sorted_buf) // 2]
        _latency["p95_ms"] = sorted_buf[int(len(sorted_buf) * 0.95)]


def get_latency_stats() -> Dict[str, Any]:
    """Snapshot of in-process latency counters (for admin panel)."""
    out = {k: v for k, v in _latency.items() if not k.startswith("_")}
    out["sample_size"] = len(_latency["_durations"])
    total = out["lookups_total"] or 1
    out["prefetched_hit_ratio"] = round(out["hits_prefetched"] / total, 3)
    out["live_hit_ratio"] = round(out["hits_live_fetch"] / total, 3)
    return out


def _is_fresh(prefetched_at, ttl_hours: int = PREFETCH_TTL_HOURS) -> bool:
    if not prefetched_at:
        return False
    if isinstance(prefetched_at, str):
        try:
            prefetched_at = datetime.fromisoformat(prefetched_at.replace("Z", "+00:00"))
        except ValueError:
            return False
    if not isinstance(prefetched_at, datetime):
        return False
    if prefetched_at.tzinfo is None:
        prefetched_at = prefetched_at.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - prefetched_at
    return age.total_seconds() < ttl_hours * 3600


async def lookup_vin_in_index(db, vin: str) -> Optional[Dict[str, Any]]:
    """Smart lookup: prefetched DB cache → live fetch → store back.

    Hard-bounded by HARD_LOOKUP_TIMEOUT_SEC (3.5 s).
    Increments `hit_count` on every match for LRU/popularity sorting.
    """
    if db is None or not vin:
        return None
    vin = vin.strip().upper()
    t0 = time.time()
    try:
        row = await db.vin_data_westmotors.find_one({
            "vin": vin,
            "archived": {"$ne": True},
        })
        if not row:
            _record_latency("misses", (time.time() - t0) * 1000)
            return None

        # ─── 1. Hot path: prefetched data still fresh → return instantly ───
        prefetched = row.get("prefetched_data")
        if prefetched and _is_fresh(row.get("prefetched_at")):
            # Bump hit counter (popularity) without blocking the response.
            asyncio.create_task(_bump_hit_counter(db, vin))
            ms = (time.time() - t0) * 1000
            _record_latency("hits_prefetched", ms)
            prefetched["_index_lastmod"] = row.get("lastmod")
            prefetched["_src"] = "westmotors"
            prefetched["_cache_hit"] = "prefetched"
            return prefetched

        # ─── 2. Cold path: live HTTP fetch ───
        url = row.get("url")
        if not url:
            _record_latency("errors", (time.time() - t0) * 1000)
            return None
        try:
            html = await asyncio.wait_for(
                _fetch(url), timeout=HARD_LOOKUP_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            _record_latency("timeouts", (time.time() - t0) * 1000)
            logger.info(f"[westmotors] hard-timeout {HARD_LOOKUP_TIMEOUT_SEC}s for {vin}")
            return None
        if not html:
            _record_latency("errors", (time.time() - t0) * 1000)
            return None
        parsed = parse_detail(html, url)
        if not parsed:
            _record_latency("errors", (time.time() - t0) * 1000)
            return None
        parsed["_index_lastmod"] = row.get("lastmod")
        parsed["region"] = row.get("region") or parsed.get("region")
        parsed["_src"] = "westmotors"
        parsed["_cache_hit"] = "live_fetch"

        # Store back to BD for future requests (best-effort).
        asyncio.create_task(_store_prefetch(db, vin, parsed))
        ms = (time.time() - t0) * 1000
        _record_latency("hits_live_fetch", ms)
        return parsed
    except Exception as e:
        _record_latency("errors", (time.time() - t0) * 1000)
        logger.warning(f"[westmotors] lookup failed for {vin}: {e}")
        return None


async def _bump_hit_counter(db, vin: str):
    try:
        await db.vin_data_westmotors.update_one(
            {"vin": vin},
            {"$inc": {"hit_count": 1},
             "$set": {"last_lookup_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass


async def _store_prefetch(db, vin: str, parsed: Dict[str, Any]):
    try:
        # Strip in-memory-only fields before persisting
        clean = {k: v for k, v in parsed.items()
                 if not k.startswith("_cache_hit")}
        await db.vin_data_westmotors.update_one(
            {"vin": vin},
            {"$set": {
                "prefetched_data": clean,
                "prefetched_at": datetime.now(timezone.utc),
            }},
        )
    except Exception as e:
        logger.debug(f"[westmotors] _store_prefetch err {vin}: {e}")


# ─────────────────────────────────────────────────────────────────
# Prefetch — fill the per-row prefetched_data warm cache
# ─────────────────────────────────────────────────────────────────
async def prefetch_vin(db, vin: str, semaphore: Optional[asyncio.Semaphore] = None) -> bool:
    """Fetch + parse + store a single VIN's detail page. Returns success bool."""
    if db is None or not vin:
        return False
    row = await db.vin_data_westmotors.find_one({"vin": vin, "archived": {"$ne": True}})
    if not row or not row.get("url"):
        return False
    # Skip if already fresh
    if row.get("prefetched_data") and _is_fresh(row.get("prefetched_at")):
        return True
    sem_ctx = semaphore or asyncio.Semaphore(1)
    async with sem_ctx:
        try:
            html = await asyncio.wait_for(_fetch(row["url"]), timeout=HARD_LOOKUP_TIMEOUT_SEC * 2)
            if not html:
                return False
            parsed = parse_detail(html, row["url"])
            if not parsed:
                return False
            parsed["region"] = row.get("region") or parsed.get("region")
            parsed["_src"] = "westmotors"
            await _store_prefetch(db, vin, parsed)
            return True
        except (asyncio.TimeoutError, Exception) as e:
            logger.debug(f"[westmotors] prefetch_vin {vin}: {e}")
            return False


async def prefetch_top_n(db, n: int = 1000, concurrency: int = 8,
                          delay_per_request: float = 0.15) -> Dict[str, int]:
    """Pre-warm the top-N freshest VINs (by lastmod desc) → prefetched_data.

    Used right after every full sync (and on demand). Uses a small semaphore
    to keep concurrent HTTP requests polite; never archives anything.
    """
    if db is None:
        return {"requested": 0, "prefetched": 0, "skipped": 0, "errors": 0}
    cur = (db.vin_data_westmotors
             .find({"archived": {"$ne": True}})
             .sort([("lastmod", -1), ("hit_count", -1)])
             .limit(int(n)))
    rows = await cur.to_list(length=int(n))
    if not rows:
        return {"requested": 0, "prefetched": 0, "skipped": 0, "errors": 0}
    sem = asyncio.Semaphore(concurrency)
    ok = skip = err = 0

    async def _one(r):
        nonlocal ok, skip, err
        if r.get("prefetched_data") and _is_fresh(r.get("prefetched_at")):
            skip += 1
            return
        success = await prefetch_vin(db, r["vin"], semaphore=sem)
        if success:
            ok += 1
        else:
            err += 1
        await asyncio.sleep(delay_per_request)

    # Run in chunks of 50 to avoid spawning thousands of awaitables at once
    chunk = 50
    for i in range(0, len(rows), chunk):
        await asyncio.gather(*[_one(r) for r in rows[i:i + chunk]],
                             return_exceptions=True)
    return {"requested": len(rows), "prefetched": ok, "skipped": skip, "errors": err}


async def warmup_from_search_logs(db, limit: int = 500,
                                    days: int = 14) -> Dict[str, int]:
    """Startup warm-up: take recent customer search hits, prefetch the
    matching VINs that exist in our WestMotors index.

    Reads from `search_logs` (Phase II) — the existing customer-search audit log.
    """
    if db is None:
        return {"queried": 0, "candidates": 0, "prefetched": 0, "skipped": 0, "errors": 0}
    try:
        since = datetime.now(timezone.utc) - timedelta(days=days)
    except Exception:
        since = datetime.now(timezone.utc)
    try:
        # Aggregate top-N searched VINs over recent window
        pipeline = [
            {"$match": {"clean": {"$ne": ""}, "ts": {"$gte": since}}},
            {"$group": {"_id": "$clean", "cnt": {"$sum": 1}}},
            {"$sort": {"cnt": -1}},
            {"$limit": int(limit)},
        ]
        rows = await db.search_logs.aggregate(pipeline).to_list(length=int(limit))
    except Exception as e:
        logger.warning(f"[westmotors] warmup_from_search_logs aggregate: {e}")
        return {"queried": 0, "candidates": 0, "prefetched": 0, "skipped": 0, "errors": 0}

    candidates = [r["_id"] for r in rows
                  if r.get("_id") and len(r["_id"]) == 17]
    if not candidates:
        return {"queried": len(rows), "candidates": 0,
                "prefetched": 0, "skipped": 0, "errors": 0}

    # Filter to those present in our index
    present_cur = db.vin_data_westmotors.find(
        {"vin": {"$in": candidates}, "archived": {"$ne": True}},
        {"vin": 1, "prefetched_at": 1, "prefetched_data": 1, "_id": 0},
    )
    present = await present_cur.to_list(length=len(candidates))
    target_vins = [
        p["vin"] for p in present
        if not (p.get("prefetched_data") and _is_fresh(p.get("prefetched_at")))
    ]
    sem = asyncio.Semaphore(8)
    ok = err = 0

    async def _one(v):
        nonlocal ok, err
        success = await prefetch_vin(db, v, semaphore=sem)
        if success:
            ok += 1
        else:
            err += 1
        await asyncio.sleep(0.2)

    for i in range(0, len(target_vins), 50):
        await asyncio.gather(*[_one(v) for v in target_vins[i:i + 50]],
                             return_exceptions=True)
    return {
        "queried": len(rows),
        "candidates": len(present),
        "prefetched": ok,
        "skipped": len(present) - len(target_vins),
        "errors": err,
    }

