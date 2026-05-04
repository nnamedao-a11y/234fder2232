"""
statvin_scraper.py — JIT enrichment from stat.vin (no DB, no sync, no scheduler).

PURPOSE
═══════
Stat.vin holds 10M+ historical Copart/IAAI sold-auction records with:
  - Final sale price (UNIQUE — none of our other sources have this)
  - Sale date
  - Damage classification
  - Photo gallery (10-50+ webp on cdnXX.stat.vin)
  - AVG-price benchmarks (statistical price chart data)

We do NOT index / sync / accumulate — that would be a pointless 10M-record
mirror. Instead: when a customer queries a VIN we already have a LIVE
answer for (BitMotors / WM / Lemon), we ALSO fire one parallel HTTP GET
to https://stat.vin/cars/<VIN> with a 3 s budget and attach the
"history" block to the response if it succeeds.

If stat.vin is slow / down → user gets the LIVE result anyway, no delay.
That is the whole point of "LIVE > fallback > history".

ARCHITECTURE
════════════
                                ┌──────────────┐
    LIVE search returns ────►  │  enrich_with │
    (BitMotors/WM/Lemon)       │   _statvin   │── 3s budget
                                └──────┬───────┘
                                       │ async, non-blocking
                                       ▼
                          GET https://stat.vin/cars/<VIN>
                          parse JSON-LD + visible HTML
                          → {sale_price, sale_date, photos, damage, ...}
                                       │
                                       ▼
                          response.history = {...}

PUBLIC API
══════════
    fetch_statvin(vin: str, *, timeout: float = 3.0) -> Optional[dict]
    enrich_with_statvin(vin: str) -> Optional[dict]   (alias, never raises)
    get_latency_stats() -> dict
    get_cache_stats() -> dict
    clear_cache() -> None
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("statvin")

BASE = "https://stat.vin"
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$", re.I)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
                  "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                  "Version/17.0 Safari/605.1.15",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
}

# Hard ceilings — never let stat.vin slow down our response
DEFAULT_TIMEOUT = 3.0     # client-level
HARD_TIMEOUT = 3.5        # outer asyncio wait_for ceiling
CONNECT_TIMEOUT = 1.5

# ─────────────────────────────────────────────────────────────────
# In-process TTL cache (5 min, LRU 2048) — protects stat.vin and
# avoids re-parsing the same VIN twice during a session.
# ─────────────────────────────────────────────────────────────────
class _TTLCache:
    def __init__(self, ttl: int = 300, max_size: int = 2048):
        self.ttl = ttl
        self.max_size = max_size
        self._store: Dict[str, Tuple[float, Any]] = {}
        self._lock = asyncio.Lock()
        self.hits = 0
        self.misses = 0

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._store.get(key)
            if not entry:
                self.misses += 1
                return None
            ts, val = entry
            if time.time() - ts > self.ttl:
                self._store.pop(key, None)
                self.misses += 1
                return None
            self.hits += 1
            return val

    async def set(self, key: str, val: Any) -> None:
        async with self._lock:
            if len(self._store) >= self.max_size:
                # Evict oldest
                oldest = min(self._store.items(), key=lambda kv: kv[1][0])[0]
                self._store.pop(oldest, None)
            self._store[key] = (time.time(), val)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()

    def stats(self) -> Dict[str, Any]:
        total = self.hits + self.misses
        return {
            "size": len(self._store),
            "max_size": self.max_size,
            "ttl_seconds": self.ttl,
            "hits": self.hits,
            "misses": self.misses,
            "hit_ratio": round(self.hits / total, 3) if total else 0.0,
        }


_cache = _TTLCache(ttl=300, max_size=2048)

# ─────────────────────────────────────────────────────────────────
# Latency telemetry (rolling buffer of 500 samples)
# ─────────────────────────────────────────────────────────────────
_LAT_BUF = deque(maxlen=500)
_COUNTERS = {
    "lookups_total": 0,
    "hits": 0,
    "misses": 0,
    "errors": 0,
    "timeouts": 0,
    "cache_hits": 0,
}


def _record_latency(ms: int) -> None:
    _LAT_BUF.append(ms)


def get_latency_stats() -> Dict[str, Any]:
    samples = sorted(_LAT_BUF)
    n = len(samples)
    p50 = samples[int(n * 0.5)] if n else 0
    p95 = samples[int(n * 0.95)] if n else 0
    return {
        **_COUNTERS,
        "p50_ms": p50,
        "p95_ms": p95,
        "sample_size": n,
    }


def get_cache_stats() -> Dict[str, Any]:
    return _cache.stats()


async def clear_cache() -> None:
    await _cache.clear()


# ─────────────────────────────────────────────────────────────────
# JSON-LD extraction — Schema.org Vehicle block on stat.vin
# ─────────────────────────────────────────────────────────────────
_JSON_LD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def _extract_jsonld_vehicle(html: str) -> Optional[Dict[str, Any]]:
    """Return the Schema.org Vehicle dict if present, else None."""
    for raw in _JSON_LD_RE.findall(html):
        try:
            obj = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        # Could be a single object or a list
        candidates = obj if isinstance(obj, list) else [obj]
        for c in candidates:
            if isinstance(c, dict) and c.get("@type") in ("Vehicle", "Product", "Car"):
                return c
    return None


# ─────────────────────────────────────────────────────────────────
# Visible HTML extraction — labels (Lot, Auction, Damage, Sale price)
# ─────────────────────────────────────────────────────────────────
_LABEL_PATTERNS = {
    "lot":         r"Lot:\s*</[a-z]+>\s*<[^>]+>\s*(\d{6,12})",
    "lot_alt":     r">Lot:\s*</[^>]+>\s*<[^>]+>\s*(\d{6,12})",
    "lot_simple":  r">\s*Lot[:\s]+(\d{6,12})\s*<",
    # Auction is "COPART" / "IAAI" / "CANADA" — restrict to known names + word-end
    "auction":     r">\s*Auction:\s*</?[^>]*>?\s*(COPART|IAAI|CANADA|COPART\s+CANADA|IAAI\s+CANADA)(?=\s*<)",
    "location":    r">\s*Location:\s*</?[^>]*>?\s*([A-Z][A-Za-z0-9\.\-,\s\(\)]{2,80})\s*<",
    "damage":      r">\s*Damage:\s*</?[^>]*>?\s*([^<]{2,60})<",
    "keys":        r">\s*Keys:\s*</?[^>]*>?\s*(YES|NO|N/A)\s*<",
    "title":       r">\s*Title:\s*</?[^>]*>?\s*([^<]{2,60})<",
    # Engine — stop before " VIN" / " HP" / "<" (so we don't swallow the next field)
    "engine":      r">\s*Engine:\s*</?[^>]*>?\s*([^<\n]{2,60}?)(?:\s+VIN\b|\s*<)",
    "fuel":        r">\s*Fuel:\s*</?[^>]*>?\s*([A-Za-z\s]{2,30}?)\s*<",
    "drive":       r">\s*Drive\s+line:\s*</?[^>]*>?\s*([^<\n]{2,40}?)\s*<",
    "transmission":r">\s*Transmission:\s*</?[^>]*>?\s*([^<\n]{2,30}?)\s*<",
    "color":       r">\s*Color:\s*</?[^>]*>?\s*([^<\n]{2,30}?)\s*<",
    "odometer":    r">\s*Odometer[^:]{0,15}:\s*</?[^>]*>?\s*([^<\n]{1,30}?)\s*<",
    "seller":      r">\s*Seller:\s*</?[^>]*>?\s*([^<\n]{2,80}?)\s*<",
}


def _visible_field(html: str, key: str) -> Optional[str]:
    """Try several regex variants to extract a label-value pair."""
    keys_to_try = [key]
    if key == "lot":
        keys_to_try = ["lot", "lot_alt", "lot_simple"]
    for k in keys_to_try:
        pat = _LABEL_PATTERNS.get(k)
        if not pat:
            continue
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            v = m.group(1).strip()
            if v and v.lower() not in ("n/a", "none", "-", "—"):
                return v
    return None


# ─────────────────────────────────────────────────────────────────
# BeautifulSoup-based extractor — more robust than naked regex.
# Stat.vin renders detail fields in a list of <div class="d-flex">
# rows, each with two children: a label span and a value span.
# We collect them all in one pass.
# ─────────────────────────────────────────────────────────────────
def _bs_extract_kv(soup: BeautifulSoup) -> Dict[str, str]:
    """Walk the visible card rows and harvest every label→value pair."""
    out: Dict[str, str] = {}

    # Strategy 1 — flex rows with two text children
    for row in soup.select("div.d-flex"):
        text = row.get_text(" ", strip=True)
        if ":" not in text or len(text) > 200:
            continue
        # Split on the FIRST ':' only
        try:
            label, value = text.split(":", 1)
        except ValueError:
            continue
        label = label.strip().lower()
        value = re.sub(r"\s+", " ", value).strip()
        if not label or not value or value.lower() in ("n/a", "none", "-", "—"):
            continue
        # Drop cases where "value" is actually another label tail
        if len(label) > 30 or len(value) > 200:
            continue
        out[label] = value

    return out


def _from_bs(bs_data: Dict[str, str], *keys: str) -> Optional[str]:
    """Look up first matching key (case-insensitive)."""
    for k in keys:
        v = bs_data.get(k.lower())
        if v:
            return v
    return None


# ─────────────────────────────────────────────────────────────────
# Sale price + sale date — embedded in description text & meta
# Example: "was sold on 07.07.2021 at COPART auction, lot 20811667,
#           with FRONT END damage. It was purchased for $4,750.00 USD"
# ─────────────────────────────────────────────────────────────────
_SALE_DATE_RE = re.compile(
    r'sold\s+on\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})',
    re.IGNORECASE,
)
_SALE_PRICE_RE = re.compile(
    r'(?:purchased\s+for|sold\s+for|final\s+(?:bid|price)[:\s]+)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)',
    re.IGNORECASE,
)
_PURCHASE_DATE_RE = re.compile(
    r'"purchaseDate"\s*:\s*"([^"]+)"',
)


def _extract_sale_info(html: str, jsonld: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    info: Dict[str, Any] = {}
    # Sale date — prefer JSON-LD purchaseDate, fall back to description regex
    if jsonld and jsonld.get("purchaseDate"):
        info["purchase_date"] = jsonld["purchaseDate"]
    m = _SALE_DATE_RE.search(html)
    if m:
        info["sale_date"] = m.group(1)
    # Sale price — try JSON-LD offers, then description
    if jsonld:
        offers = jsonld.get("offers") or {}
        if isinstance(offers, dict) and offers.get("price"):
            info["sale_price_usd"] = str(offers["price"])
    if "sale_price_usd" not in info:
        m = _SALE_PRICE_RE.search(html)
        if m:
            try:
                info["sale_price_usd"] = float(m.group(1).replace(",", ""))
            except ValueError:
                info["sale_price_usd"] = m.group(1)
    return info


# ─────────────────────────────────────────────────────────────────
# Photo extraction
# ─────────────────────────────────────────────────────────────────
_PHOTO_RE = re.compile(
    r'(https://cdn\d+\.stat\.vin/[^\s"\'<>]+\.(?:webp|jpg|jpeg|png))',
    re.IGNORECASE,
)
# IAAI direct CDN (sometimes embedded as resizer URLs)
_IAAI_RE = re.compile(
    r'(https://vis\.iaai\.com/resizer\?[^\s"\'<>]+)',
    re.IGNORECASE,
)


def _extract_photos(html: str) -> List[str]:
    photos = list(dict.fromkeys(_PHOTO_RE.findall(html)))
    iaai = list(dict.fromkeys(_IAAI_RE.findall(html)))
    # de-duplicate: prefer cdnXX.stat.vin, append IAAI as extras
    return photos + [u for u in iaai if u not in photos]


# ─────────────────────────────────────────────────────────────────
# Main parser — turns one detail-page HTML into a normalized dict
# ─────────────────────────────────────────────────────────────────
def parse_detail_html(html: str, vin: str, url: str) -> Optional[Dict[str, Any]]:
    """Return a clean dict if we found enough useful data, else None."""
    if not html or len(html) < 5000:  # sanity
        return None

    jsonld = _extract_jsonld_vehicle(html)

    # H1 — sometimes contains trim/engine even when JSON-LD doesn't
    h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL | re.IGNORECASE)
    h1_text = ""
    if h1_match:
        h1_text = re.sub(r'<[^>]+>', ' ', h1_match.group(1))
        h1_text = re.sub(r'\s+', ' ', h1_text).strip()

    # BeautifulSoup-based key/value harvest (Lot, Auction, Location, Damage, ...)
    try:
        soup = BeautifulSoup(html, "html.parser")
        bs_kv = _bs_extract_kv(soup)
    except Exception:
        bs_kv = {}

    sale = _extract_sale_info(html, jsonld)

    # JSON-LD fields (most reliable)
    jl_make = (jsonld or {}).get("manufacturer") or ((jsonld or {}).get("brand") or {}).get("name")
    jl_model = (jsonld or {}).get("model")
    jl_year = (jsonld or {}).get("productionDate") or (jsonld or {}).get("vehicleModelDate")
    jl_color = (jsonld or {}).get("color")
    jl_engine = ((jsonld or {}).get("vehicleEngine") or {}).get("engineType")
    jl_fuel = ((jsonld or {}).get("vehicleEngine") or {}).get("fuelType")
    jl_transmission = (jsonld or {}).get("vehicleTransmission")
    jl_damage = (jsonld or {}).get("knownVehicleDamages")

    # Engine cleanup — stat.vin sometimes appends " VIN" / " HP" trailing
    if jl_engine:
        jl_engine = re.sub(r"\s+VIN\b.*$", "", jl_engine).strip()

    data: Dict[str, Any] = {
        "vin": vin.upper(),
        "source": "STATVIN",
        "source_url": url,
        "title": h1_text or None,
        # Core identification — JSON-LD primary, BS fallback
        "make": jl_make or _from_bs(bs_kv, "Make", "Производитель"),
        "model": jl_model or _from_bs(bs_kv, "Model", "Модель"),
        "year": jl_year or _from_bs(bs_kv, "Year", "Production date", "Год"),
        "color": jl_color or _from_bs(bs_kv, "Color", "Цвет"),
        # Engine / drivetrain
        "engine": jl_engine or _from_bs(bs_kv, "Engine", "Двигатель"),
        "fuel_type": jl_fuel or _from_bs(bs_kv, "Fuel", "Fuel type", "Топливо"),
        "transmission": jl_transmission or _from_bs(bs_kv, "Transmission", "КПП"),
        # Damage
        "damage_primary": jl_damage or _from_bs(bs_kv, "Damage", "Primary damage", "Повреждение"),
        # Auction meta
        "lot_number": _from_bs(bs_kv, "Lot", "Lot #", "Номер лота"),
        "auction_name": _from_bs(bs_kv, "Auction", "Аукцион"),
        "location": _from_bs(bs_kv, "Location", "Локация"),
        "keys": _from_bs(bs_kv, "Keys", "Ключи"),
        "title_status": _from_bs(bs_kv, "Title", "Status"),
        "drivetrain": _from_bs(bs_kv, "Drive line", "Drive", "Привод"),
        "odometer": _from_bs(bs_kv, "Odometer, mi", "Odometer", "Mileage", "Пробег"),
        "seller": _from_bs(bs_kv, "Seller", "Seller Name", "Продавец"),
        "body_style": _from_bs(bs_kv, "Body Style", "Body"),
        "cylinders": _from_bs(bs_kv, "Cylinders"),
        # Photos
        "image_urls": _extract_photos(html),
        # Sale history (the unique value — only stat.vin has this)
        "sale_date": sale.get("sale_date"),
        "purchase_date_iso": sale.get("purchase_date"),
        "sale_price_usd": sale.get("sale_price_usd"),
        # Convenience flags for UI
        "has_history": bool(sale.get("sale_date") or sale.get("sale_price_usd")),
    }

    # Light backfill from H1 if make/model missing
    if not data["make"] and h1_text:
        m = re.match(r"\s*([A-Z\-]+)\s+([A-Z0-9\-/ ]+?)\s+(\d{4})", h1_text)
        if m:
            data["make"], data["model"], data["year"] = m.group(1), m.group(2).strip(), m.group(3)

    # Engine fallback (e.g. "5.0L V-8" embedded in H1)
    if not data["engine"] and h1_text:
        m = re.search(r"(\d\.\d?L\s*[A-Z\-]?\d{1,2}\s*\w*)", h1_text)
        if m:
            data["engine"] = m.group(1).strip()

    # Filter "Auction" text-noise — keep only known names
    if data.get("auction_name"):
        an = data["auction_name"].upper()
        if an not in ("COPART", "IAAI", "COPART CANADA", "IAAI CANADA"):
            # Try to find a known token in the value
            for known in ("COPART CANADA", "IAAI CANADA", "COPART", "IAAI"):
                if known in an:
                    data["auction_name"] = known
                    break
            else:
                data["auction_name"] = None

    # Require at least one of {make, photos, sale_price_usd} to be useful
    useful = bool(
        data["make"]
        or data["image_urls"]
        or data["sale_price_usd"]
        or data["damage_primary"]
    )
    if not useful:
        return None

    return data


# ─────────────────────────────────────────────────────────────────
# Public entry point — single VIN, no DB, no retry, hard timeout
# ─────────────────────────────────────────────────────────────────
async def fetch_statvin(vin: str, *, timeout: float = DEFAULT_TIMEOUT) -> Optional[Dict[str, Any]]:
    """Fetch + parse stat.vin for a single VIN. Cached 5 min.

    Returns a normalized dict, or None on error / no data / timeout.
    Never raises.
    """
    if not vin:
        return None
    vin_clean = vin.strip().upper()
    if not VIN_RE.match(vin_clean):
        return None

    # Cache lookup
    cached = await _cache.get(vin_clean)
    if cached is not None:
        _COUNTERS["cache_hits"] += 1
        # cached can be {"_miss": True} → translate back to None
        return None if cached.get("_miss") else cached

    _COUNTERS["lookups_total"] += 1
    started = time.time()
    url = f"{BASE}/cars/{vin_clean}"

    try:
        async def _do():
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout, connect=CONNECT_TIMEOUT),
                follow_redirects=True,
                headers=HEADERS,
                http2=False,
            ) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                return resp.text

        html = await asyncio.wait_for(_do(), timeout=HARD_TIMEOUT)
    except asyncio.TimeoutError:
        _COUNTERS["timeouts"] += 1
        await _cache.set(vin_clean, {"_miss": True})
        logger.info(f"[statvin] timeout for {vin_clean}")
        return None
    except Exception as e:
        _COUNTERS["errors"] += 1
        await _cache.set(vin_clean, {"_miss": True})
        logger.debug(f"[statvin] error for {vin_clean}: {e}")
        return None

    elapsed_ms = int((time.time() - started) * 1000)
    _record_latency(elapsed_ms)

    if not html:
        _COUNTERS["misses"] += 1
        await _cache.set(vin_clean, {"_miss": True})
        return None

    parsed = parse_detail_html(html, vin_clean, url)
    if not parsed:
        _COUNTERS["misses"] += 1
        await _cache.set(vin_clean, {"_miss": True})
        return None

    parsed["response_time_ms"] = elapsed_ms
    _COUNTERS["hits"] += 1
    await _cache.set(vin_clean, parsed)
    return parsed


# Friendly alias used from server.py so callers can read the intent.
async def enrich_with_statvin(vin: str) -> Optional[Dict[str, Any]]:
    """Non-throwing enrichment helper used in parallel with the LIVE chain.

    Always returns either a dict or None. Never raises, never blocks
    longer than HARD_TIMEOUT (~3.5 s).
    """
    try:
        return await fetch_statvin(vin)
    except Exception as e:
        logger.debug(f"[statvin] enrich failed for {vin}: {e}")
        return None


__all__ = [
    "fetch_statvin",
    "enrich_with_statvin",
    "parse_detail_html",
    "get_latency_stats",
    "get_cache_stats",
    "clear_cache",
]
