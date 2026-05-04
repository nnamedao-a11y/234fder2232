"""
lemon_scraper.py — Lemon-Cars (lemon-cars.by) INDEX-based source.

Architecture (per project decision, Phase IV-2):
    BitMotors  = LIVE search (primary)
    WestMotors = quick INDEX fallback (Phase IV)
    Lemon-Cars = heavy INDEX with VIN+LOT (Phase IV-2)
    Page scan  = safety net

Lemon-Cars specifics:
  - 166k URLs across 6 sitemap chunks (USA + China + Europe).
  - Bitrix CMS, fully server-side rendered HTML — plain httpx + bs4.
  - VIN is NOT in URL — it's embedded in the description text.
  - Lot number IS shown openly: `Номер лота: 48928366 Copart`.
  - URL contains a numeric `lemon_id` (e.g. /catalog/usa/...-8521681-p/).

Strategy: HYBRID LAZY INDEX
  Stage 1 (fast):  sitemap → URL queue with {lemon_id, url, region, lastmod}
  Stage 2 (lazy):  background worker parses URLs ordered by lastmod desc
  Stage 3 (just-in-time): on lookup miss, parse THAT specific URL right now.

This module only does:
  - Sitemap discovery
  - HTML fetch + parse_detail
  - In-DB lookup helpers (by_vin, by_lot, by_lemon_id)
  - Latency telemetry (mirrors westmotors_scraper)
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

logger = logging.getLogger("lemon")

BASE = "https://lemon-cars.by"
SITEMAP_INDEX = f"{BASE}/sitemap.xml"

# Polite, identifiable bot UA (Bitrix is friendly to crawlers).
HEADERS = {
    "User-Agent": "BIBI-Cars-Bot/1.0 (+https://bibi-cars.com; integration=vin-fallback)",
    "Accept-Language": "ru,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

# URL pattern: /catalog/<region>/<year>-<make>-<model>-<spec>-<id>-p/
LEMON_URL_RE = re.compile(
    r"/catalog/(?P<region>usa|china|europe)/(?P<slug>[^/]+?)-(?P<id>\d+)-p/?$",
    re.IGNORECASE,
)

# Hard-bounds (mirror Phase IV-1)
HARD_LOOKUP_TIMEOUT_SEC = 3.5
PREFETCH_TTL_HOURS = 24


# ─────────────────────────────────────────────────────────────────
# HTTP client
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
    client = await get_client()
    for attempt in range(max_retries):
        try:
            r = await client.get(url)
            if r.status_code == 200:
                return r.text
            if r.status_code in (429, 403):
                wait = (2 ** attempt) * 3
                logger.warning(f"[lemon] {r.status_code} on {url} — sleeping {wait}s")
                await asyncio.sleep(wait)
                continue
            if 500 <= r.status_code < 600:
                await asyncio.sleep(2 ** attempt)
                continue
            return None
        except (httpx.RequestError, httpx.HTTPError) as e:
            logger.warning(f"[lemon] fetch error {url}: {e}")
            await asyncio.sleep(2 ** attempt)
    return None


# ─────────────────────────────────────────────────────────────────
# URL parsing
# ─────────────────────────────────────────────────────────────────
def parse_lemon_url(url: str) -> Optional[Dict[str, Any]]:
    """`/catalog/usa/2026-toyota-camry-se-8521681-p/` → {region, slug, id}"""
    if not url:
        return None
    m = LEMON_URL_RE.search(urlparse(url).path)
    if not m:
        return None
    return {
        "region": m.group("region").lower(),
        "slug": m.group("slug"),
        "lemon_id": int(m.group("id")),
    }


# ─────────────────────────────────────────────────────────────────
# Sitemap discovery
# ─────────────────────────────────────────────────────────────────
async def fetch_sitemap_index() -> List[Dict[str, str]]:
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
        logger.error(f"[lemon] sitemap index parse: {e}")
    return out


async def parse_url_sitemap(sitemap_url: str) -> List[Dict[str, str]]:
    """Parses a single sitemap-iblock-1.partN.xml, returns [{url, lastmod}, ...]."""
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
        logger.error(f"[lemon] url sitemap parse {sitemap_url}: {e}")
    return out


def is_lot_sitemap(loc: str) -> bool:
    """Only iblock-1 partN sitemaps contain car detail URLs."""
    last = loc.rstrip("/").split("/")[-1].lower()
    return "iblock-1" in last and last.endswith(".xml")


def is_first_lot_sitemap(loc: str) -> bool:
    last = loc.rstrip("/").split("/")[-1].lower()
    return last in ("sitemap-iblock-1.xml", "sitemap-iblock-1.part1.xml")


# ─────────────────────────────────────────────────────────────────
# Detail page parser
# ─────────────────────────────────────────────────────────────────
def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _to_int(s: str) -> Optional[int]:
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def _to_float(s: str) -> Optional[float]:
    if not s:
        return None
    s = re.sub(r"[^\d.,]", "", s).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# Map "Дата торгов" `04.05.2026 21:00` → ISO
_DATE_RE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?")


def _parse_ru_date(text: str) -> Optional[str]:
    if not text:
        return None
    m = _DATE_RE.search(text)
    if not m:
        return None
    try:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        h = int(m.group(4) or 0)
        mi = int(m.group(5) or 0)
        return datetime(y, mo, d, h, mi, 0, tzinfo=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None


# Auction provider hint
_AUCTIONS = ("copart", "iaai", "manheim", "adesa", "crashedtoys")


def parse_detail(html: str, url: str) -> Optional[Dict[str, Any]]:
    """Extract a normalized vehicle dict from a lemon-cars.by detail page.

    Returns None if the page is not a real detail page.
    """
    if not html or len(html) < 1000:
        return None
    soup = BeautifulSoup(html, "html.parser")

    out: Dict[str, Any] = {
        "vin": None, "lot": None, "auction": None,
        "lemon_id": None, "url": url, "region": None,
        "title": None, "year": None, "make": None, "model": None,
        "trim": None,
        "engine_volume": None,           # liters
        "odometer": None, "odometer_unit": "km",
        "color": None,
        "auction_date": None, "auction_date_text": None,
        "current_bid_usd": None,
        "images": [], "image": None,
        "description": None,             # human-written summary
        "ai_description": None,          # SEO-template generated review (optional UI)
        "_src": "lemon",
    }

    parts = parse_lemon_url(url)
    if parts:
        out["region"] = parts["region"]
        out["lemon_id"] = parts["lemon_id"]

    # ─── Title (h1) ───
    h1 = soup.find("h1")
    if h1:
        out["title"] = _clean(h1.get_text(" ", strip=True))

    # Get full text once for regex hunting
    full_text = soup.get_text(" ", strip=True)

    # ─── VIN — embedded in description prose ───
    vin_match = re.search(
        r"VIN[\-\s]*(?:номер|number|number)?[:\s]*([A-HJ-NPR-Z0-9]{17})",
        full_text, re.IGNORECASE,
    )
    if vin_match:
        out["vin"] = vin_match.group(1).upper()
    else:
        # Fallback: any 17-char VIN-shaped token in body text
        any_vin = VIN_RE.search(full_text.upper())
        if any_vin:
            out["vin"] = any_vin.group(1)

    # ─── Lot + auction ─── e.g. "Номер лота: 48928366 Copart"
    lot_match = re.search(
        r"Номер лота[:\s]+(\d{4,12})\s+([A-Za-zА-Яа-я]+)",
        full_text,
    )
    if lot_match:
        out["lot"] = lot_match.group(1)
        prov = lot_match.group(2).lower()
        # Russian → English
        if "copart" in prov:
            out["auction"] = "Copart"
        elif "iaai" in prov or "иааи" in prov or "ai" in prov:
            out["auction"] = "IAAI"
        else:
            out["auction"] = lot_match.group(2).strip().title()
    else:
        # Sometimes there's a direct copart.com link
        copart_link = soup.find("a", href=re.compile(r"copart\.com.*lot/\d+"))
        if copart_link:
            href = copart_link.get("href") or ""
            m2 = re.search(r"/lot/(\d+)", href)
            if m2:
                out["lot"] = m2.group(1)
                out["auction"] = "Copart"

    # If still no auction, try to detect it in body text
    if not out["auction"]:
        low = full_text.lower()
        for prov in _AUCTIONS:
            if prov in low:
                out["auction"] = "IAAI" if prov == "iaai" else prov.capitalize()
                break

    # ─── Дата торгов ───
    bid_date_match = re.search(
        r"Дата торгов\s+(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)",
        full_text,
    )
    if bid_date_match:
        out["auction_date_text"] = bid_date_match.group(1).strip()
        out["auction_date"] = _parse_ru_date(out["auction_date_text"])

    # ─── Год выпуска ───
    year_match = re.search(r"Год выпуска\s+(\d{4})", full_text)
    if year_match:
        out["year"] = int(year_match.group(1))

    # ─── Марка / Модель ───
    make_match = re.search(r"Марка\s+([A-ZА-ЯЁ][A-ZА-ЯЁ0-9 \-]+?)\s+(?:Модель|Пробег|Год|$)",
                           full_text)
    if make_match:
        out["make"] = make_match.group(1).strip()
    model_match = re.search(r"Модель\s+([A-ZА-ЯЁ][A-ZА-ЯЁ0-9 \-]+?)\s+(?:Пробег|Объем|$)",
                            full_text)
    if model_match:
        out["model"] = model_match.group(1).strip()

    # If still missing — derive from H1 title (more reliable for trim)
    if out["title"] and (not out["make"] or not out["model"]):
        # Title format: "2026 TOYOTA CAMRY SE"
        ts = out["title"].split()
        if len(ts) >= 3 and ts[0].isdigit():
            if not out["year"]:
                try:
                    out["year"] = int(ts[0])
                except ValueError:
                    pass
            if not out["make"]:
                out["make"] = ts[1]
            if not out["model"]:
                out["model"] = " ".join(ts[2:])

    # ─── Пробег, км ───
    miles_match = re.search(r"Пробег,\s*(км|mi|mile|миль)\s+([\d ,.]+)", full_text)
    if miles_match:
        out["odometer"] = _to_int(miles_match.group(2))
        unit = miles_match.group(1).lower()
        out["odometer_unit"] = "km" if unit == "км" else "mi"

    # ─── Объем двигателя ───
    eng_match = re.search(r"Объем двигателя\s+([\d.,]+)", full_text)
    if eng_match:
        out["engine_volume"] = _to_float(eng_match.group(1))

    # ─── Текущая ставка ───
    bid_match = re.search(r"Текущая ставка\s*\$?\s*([\d  ,]+)", full_text)
    if bid_match:
        out["current_bid_usd"] = _to_int(bid_match.group(1))

    # ─── Photos (CDN: lemon-cars.by/upload/Sh/imageCache/ + /upload/iblock/) ───
    seen = set()
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src:
            continue
        if "/upload/" not in src:
            continue
        # filter known UI graphics
        if any(skip in src for skip in (
                "/local/assets/", "/bitrix/", "neay4", "kzym1el30u",
                "h8k0v8suk", "azq5q9o1", "ce0/wcgdb", "cf5/l8hxb",
                "343/e3ljw", "e09/6ewf6")):
            continue
        if src not in seen:
            seen.add(src)
            out["images"].append(src)
    if out["images"]:
        out["image"] = out["images"][0]

    # ─── Description (human paragraph) ───
    # Bitrix renders the operator-written intro inside the catalog item content;
    # the AI block is under "Важное про <car> ...". Both useful for SEO.
    desc_h = None
    for h in soup.find_all(["h2", "h3", "div"]):
        t = _clean(h.get_text())
        if t.lower().startswith("описание"):
            desc_h = h
            break
    if desc_h:
        # Collect the next 3 sibling paragraphs as the description.
        chunks: List[str] = []
        node = desc_h
        for _ in range(8):
            node = node.find_next_sibling()
            if node is None:
                break
            txt = _clean(node.get_text(" ", strip=True))
            if txt and len(txt) > 40:
                chunks.append(txt)
            if len(chunks) >= 3:
                break
        if chunks:
            out["description"] = " ".join(chunks)[:2000]

    # AI/SEO block: heading "Важное про ..."
    for h in soup.find_all(["h2", "h3"]):
        t = _clean(h.get_text())
        if t.lower().startswith("важное про"):
            # Collect the next paragraph
            sib = h.find_next_sibling()
            if sib:
                out["ai_description"] = _clean(sib.get_text(" ", strip=True))[:3000]
            break

    # ─── Color sometimes leaks into description, e.g. "Этот Серый автомобиль" ───
    color_match = re.search(
        r"Этот\s+(Белый|Серый|Чёрный|Черный|Красный|Синий|Зелёный|Желтый|Жёлтый|Оранжевый|Серебристый|Серебряный|Коричневый|Бежевый|Бордовый|Фиолетовый|Голубой)",
        full_text, re.IGNORECASE,
    )
    if color_match:
        out["color"] = color_match.group(1).strip()

    # ─── Sanity ───
    if not (out["vin"] or out["lot"] or out["lemon_id"]):
        return None
    return out


# ─────────────────────────────────────────────────────────────────
# Latency telemetry (mirrors westmotors_scraper)
# ─────────────────────────────────────────────────────────────────
_latency = {
    "lookups_total": 0, "hits_prefetched": 0, "hits_live_fetch": 0,
    "hits_jit_parsed": 0, "misses": 0, "errors": 0, "timeouts": 0,
    "p50_ms": 0, "p95_ms": 0, "_durations": [],
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
        sb = sorted(buf)
        _latency["p50_ms"] = sb[len(sb) // 2]
        _latency["p95_ms"] = sb[int(len(sb) * 0.95)]


def get_latency_stats() -> Dict[str, Any]:
    out = {k: v for k, v in _latency.items() if not k.startswith("_")}
    out["sample_size"] = len(_latency["_durations"])
    total = out["lookups_total"] or 1
    out["prefetched_hit_ratio"] = round(out["hits_prefetched"] / total, 3)
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
    return (datetime.now(timezone.utc) - prefetched_at).total_seconds() < ttl_hours * 3600


# ─────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────
COLL = "vin_data_lemon"


async def _bump_hit_counter(db, lemon_id: int):
    try:
        await db[COLL].update_one(
            {"lemon_id": lemon_id},
            {"$inc": {"hit_count": 1},
             "$set": {"last_lookup_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass


async def _store_parsed(db, lemon_id: int, parsed: Dict[str, Any]):
    """Persist parsed_data + indexed VIN/LOT into the row."""
    try:
        clean = {k: v for k, v in parsed.items() if not k.startswith("_cache_hit")}
        upd = {
            "parsed_data": clean,
            "parsed_at": datetime.now(timezone.utc),
            "parse_failed_count": 0,
        }
        # Hoist VIN + LOT to the top level for indexed lookup
        if parsed.get("vin"):
            upd["vin"] = parsed["vin"]
        if parsed.get("lot"):
            upd["lot"] = parsed["lot"]
        if parsed.get("auction"):
            upd["auction"] = parsed["auction"]
        await db[COLL].update_one(
            {"lemon_id": lemon_id},
            {"$set": upd},
        )
    except Exception as e:
        logger.debug(f"[lemon] _store_parsed err id={lemon_id}: {e}")


async def _mark_parse_failed(db, lemon_id: int):
    try:
        await db[COLL].update_one(
            {"lemon_id": lemon_id},
            {"$inc": {"parse_failed_count": 1},
             "$set": {"parsed_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────
# JIT parse (just-in-time)
# ─────────────────────────────────────────────────────────────────
async def jit_parse_url(db, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse one URL on demand; persist; return normalized dict."""
    url = row.get("url")
    lemon_id = row.get("lemon_id")
    if not url or not lemon_id:
        return None
    try:
        html = await asyncio.wait_for(_fetch(url), timeout=HARD_LOOKUP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        return None
    if not html:
        await _mark_parse_failed(db, lemon_id)
        return None
    parsed = parse_detail(html, url)
    if not parsed:
        await _mark_parse_failed(db, lemon_id)
        return None
    parsed["region"] = row.get("region") or parsed.get("region")
    await _store_parsed(db, lemon_id, parsed)
    return parsed


# ─────────────────────────────────────────────────────────────────
# Public lookups
# ─────────────────────────────────────────────────────────────────
async def lookup_by_vin(db, vin: str) -> Optional[Dict[str, Any]]:
    """Look up a VIN. Hot path: parsed_data fresh → return.
    Cold path: do nothing here (we can't lookup unparsed VINs because
    VIN isn't in the URL — Lemon's index is *eager-built* by the worker).
    """
    if db is None or not vin:
        return None
    vin = vin.strip().upper()
    t0 = time.time()
    try:
        row = await db[COLL].find_one({
            "vin": vin,
            "archived": {"$ne": True},
        })
        if not row:
            _record_latency("misses", (time.time() - t0) * 1000)
            return None
        return await _hydrate_row(db, row, t0)
    except Exception as e:
        _record_latency("errors", (time.time() - t0) * 1000)
        logger.warning(f"[lemon] lookup_by_vin {vin}: {e}")
        return None


async def lookup_by_lot(db, lot: str) -> Optional[Dict[str, Any]]:
    """Look up by aucton lot number — Lemon's strongest card."""
    if db is None or not lot:
        return None
    lot = str(lot).strip()
    t0 = time.time()
    try:
        row = await db[COLL].find_one({
            "lot": lot,
            "archived": {"$ne": True},
        })
        if not row:
            _record_latency("misses", (time.time() - t0) * 1000)
            return None
        return await _hydrate_row(db, row, t0)
    except Exception as e:
        _record_latency("errors", (time.time() - t0) * 1000)
        logger.warning(f"[lemon] lookup_by_lot {lot}: {e}")
        return None


async def _hydrate_row(db, row: Dict[str, Any], t0: float) -> Optional[Dict[str, Any]]:
    """Return parsed_data if fresh, else re-fetch (JIT) and store back."""
    pd = row.get("parsed_data")
    if pd and _is_fresh(row.get("parsed_at")):
        # Background hit-counter bump
        if row.get("lemon_id"):
            asyncio.create_task(_bump_hit_counter(db, row["lemon_id"]))
        ms = (time.time() - t0) * 1000
        _record_latency("hits_prefetched", ms)
        pd["_src"] = "lemon"
        pd["_cache_hit"] = "prefetched"
        return pd

    # Stale or missing parsed_data → JIT
    parsed = await jit_parse_url(db, row)
    if parsed:
        ms = (time.time() - t0) * 1000
        _record_latency("hits_jit_parsed", ms)
        parsed["_src"] = "lemon"
        parsed["_cache_hit"] = "jit_parsed"
        return parsed
    _record_latency("errors", (time.time() - t0) * 1000)
    return None
