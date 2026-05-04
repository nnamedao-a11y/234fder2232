"""
vin_service.py — clean LIVE-FIRST VIN lookup with SEARCH → PAGE fallback.

Architecture (no DB, no accumulation, no scheduler):

    VIN ──► CACHE (5 min TTL)
              │ miss
              ▼
            SEARCH FLOW                  ←─ fast: BidMotors /live-auction/search
              │ JSON redirect_url        →   detail page parse
              │ ok    → return {source:"SEARCH"}
              │ fail
              ▼
            PAGE FLOW                    ←─ slow: scan first N catalog pages
              │ scan ≤ 3 pages × 12 cards
              │ match by VIN tail in URL
              │ ok    → return {source:"PAGE"}
              │ fail
              ▼
            NOT_FOUND

Two independent code paths. If BidMotors flips JSON shape → PAGE still works.
If they change card HTML → SEARCH still works. Site can break partially —
service stays alive.

Usage:
    from vin_service import get_car_by_vin
    res = await get_car_by_vin("WAUSPBFF7HA146992")
    # → {"found": True, "source": "SEARCH", "data": {...}}
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

# Reuse the heavy detail parser already battle-tested in bitmotors_scraper
# (handles Bulgarian/English labels, scope-locks "popular cars" carousel,
# Copart/IAAI/KAR image extraction, lot/auction/seller normalization).
try:
    from bitmotors_scraper import parse_detail_page as _legacy_parse_detail
except Exception:
    _legacy_parse_detail = None  # type: ignore

logger = logging.getLogger("vin_service")

BASE = "https://bidmotors.bg"
SEARCH_URL = f"{BASE}/en/live-auction/search"
CATALOGUE_URL = f"{BASE}/en/catalogue"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
}

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.I)
LOT_RE = re.compile(r"^\d{4,10}$")

# ─────────────────────────────────────────────────────────────────
# Tiny async-safe TTL cache (5 min default, 2048 max)
# ─────────────────────────────────────────────────────────────────
class TTLCache:
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
                victim = next(iter(self._store))
                self._store.pop(victim, None)
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


cache = TTLCache(ttl=300, max_size=2048)


# ─────────────────────────────────────────────────────────────────
# Circuit Breaker — protects the request from waiting on a flapping
# upstream. Per-source (SEARCH, PAGE).
#
# States:
#   CLOSED     — calls flow normally, errors are counted
#   OPEN       — fast-fail: skip the call, raise CircuitOpenError
#   HALF_OPEN  — single trial call allowed; on success → CLOSED,
#                on failure → OPEN for another cooldown
#
# Trip rule: 5 consecutive errors → OPEN for 5 min.
# Timeouts and connect-errors count as errors. Successful CLOSED
# calls reset the consecutive-error counter.
# ─────────────────────────────────────────────────────────────────
class CircuitOpenError(Exception):
    """Raised when a call is short-circuited by an OPEN breaker."""


class CircuitBreaker:
    def __init__(self, name: str, fail_threshold: int = 5, cooldown_sec: int = 300):
        self.name = name
        self.fail_threshold = fail_threshold
        self.cooldown_sec = cooldown_sec
        self._consec_errors = 0
        self._state = "CLOSED"  # CLOSED | OPEN | HALF_OPEN
        self._opened_at: Optional[float] = None
        self._lock = asyncio.Lock()
        # Lifetime counters (for /circuit endpoint)
        self.total_calls = 0
        self.total_failures = 0
        self.total_successes = 0
        self.total_short_circuits = 0
        self.total_trips = 0

    async def before_call(self) -> None:
        """Raise CircuitOpenError if the call must be skipped right now."""
        async with self._lock:
            if self._state == "OPEN":
                # Check if cooldown elapsed → flip to HALF_OPEN
                if self._opened_at and (time.time() - self._opened_at) >= self.cooldown_sec:
                    self._state = "HALF_OPEN"
                    logger.info(f"[circuit:{self.name}] cooldown elapsed → HALF_OPEN")
                else:
                    self.total_short_circuits += 1
                    raise CircuitOpenError(
                        f"Circuit '{self.name}' is OPEN "
                        f"(retry in {self._remaining_cooldown():.0f}s)"
                    )
            self.total_calls += 1

    async def on_success(self) -> None:
        async with self._lock:
            self._consec_errors = 0
            self.total_successes += 1
            if self._state in ("OPEN", "HALF_OPEN"):
                logger.info(f"[circuit:{self.name}] HALF_OPEN trial succeeded → CLOSED")
                self._state = "CLOSED"
                self._opened_at = None

    async def on_failure(self) -> None:
        async with self._lock:
            self._consec_errors += 1
            self.total_failures += 1
            if self._state == "HALF_OPEN":
                # Trial failed → re-open
                self._state = "OPEN"
                self._opened_at = time.time()
                self.total_trips += 1
                logger.warning(f"[circuit:{self.name}] HALF_OPEN trial failed → OPEN ({self.cooldown_sec}s)")
                return
            if self._consec_errors >= self.fail_threshold and self._state == "CLOSED":
                self._state = "OPEN"
                self._opened_at = time.time()
                self.total_trips += 1
                logger.warning(
                    f"[circuit:{self.name}] {self._consec_errors} consecutive failures "
                    f"→ OPEN for {self.cooldown_sec}s"
                )

    def _remaining_cooldown(self) -> float:
        if not self._opened_at:
            return 0.0
        return max(0.0, self.cooldown_sec - (time.time() - self._opened_at))

    def stats(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "state": self._state,
            "consecutive_errors": self._consec_errors,
            "fail_threshold": self.fail_threshold,
            "cooldown_sec": self.cooldown_sec,
            "remaining_cooldown_sec": round(self._remaining_cooldown(), 1) if self._state == "OPEN" else 0.0,
            "opened_at": self._opened_at,
            "total_calls": self.total_calls,
            "total_failures": self.total_failures,
            "total_successes": self.total_successes,
            "total_short_circuits": self.total_short_circuits,
            "total_trips": self.total_trips,
        }

    async def reset(self) -> None:
        async with self._lock:
            self._state = "CLOSED"
            self._consec_errors = 0
            self._opened_at = None


# Two breakers — independent (SEARCH can be tripped while PAGE works fine)
search_breaker = CircuitBreaker("bitmotors_search", fail_threshold=5, cooldown_sec=300)
page_breaker = CircuitBreaker("bitmotors_page", fail_threshold=5, cooldown_sec=300)


def get_circuit_stats() -> Dict[str, Any]:
    s = {
        "bitmotors_search": search_breaker.stats(),
        "bitmotors_page": page_breaker.stats(),
    }
    # Normalise `is_open` flag so external consumers (Ops Guardian, UI)
    # don't need to know the internal tri-state ("CLOSED"/"OPEN"/"HALF_OPEN").
    for v in s.values():
        v["is_open"] = (v.get("state") == "OPEN")
    return s


async def reset_circuits() -> None:
    await search_breaker.reset()
    await page_breaker.reset()


def force_half_open_breaker(name: str) -> bool:
    """Ops-Guardian hook: flip a stuck OPEN breaker to HALF_OPEN so the next
    call will attempt a real request. Safe no-op if the breaker is already
    CLOSED/HALF_OPEN or the name is unknown."""
    target = {"bitmotors_search": search_breaker, "bitmotors_page": page_breaker}.get(name)
    if target is None:
        return False
    # Breaker's _lock is asyncio.Lock — this is a sync helper, so we mutate
    # the trivial flag directly. Worst case two ticks see HALF_OPEN in a row,
    # which is harmless (just one extra probe).
    if target._state == "OPEN":
        target._state = "HALF_OPEN"
        logger.info(f"[circuit:{name}] forced OPEN → HALF_OPEN by ops guardian")
        return True
    return False


# ─────────────────────────────────────────────────────────────────
# Shared HTTP client (single connection pool)
# ─────────────────────────────────────────────────────────────────
_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            headers=HEADERS,
            timeout=httpx.Timeout(8.0, connect=4.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


async def close_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    _client = None


async def _fetch(url: str, params: Optional[Dict[str, Any]] = None,
                 retries: int = 1, timeout: float = 8.0) -> Optional[httpx.Response]:
    """GET with one polite retry on transient errors."""
    client = await get_client()
    last_err = None
    for attempt in range(retries + 1):
        try:
            r = await client.get(url, params=params, timeout=timeout)
            if r.status_code in (429, 503):
                last_err = RuntimeError(f"HTTP {r.status_code}")
                await asyncio.sleep(0.6 * (attempt + 1))
                continue
            r.raise_for_status()
            return r
        except (httpx.TimeoutException, httpx.HTTPError, httpx.NetworkError) as e:
            last_err = e
            if attempt < retries:
                await asyncio.sleep(0.4)
                continue
    if last_err:
        logger.debug(f"[fetch] {url} failed after {retries+1} attempts: {last_err}")
    return None


# ─────────────────────────────────────────────────────────────────
# VIN normalization
# ─────────────────────────────────────────────────────────────────
def normalize_vin(vin: str) -> str:
    return (vin or "").strip().upper().replace(" ", "").replace("-", "")


def is_valid_vin(vin: str) -> bool:
    return bool(VIN_RE.fullmatch(vin or ""))


def is_lot_number(value: str) -> bool:
    return bool(LOT_RE.fullmatch(value or ""))


def _vin_from_url(url: str) -> Optional[str]:
    """BidMotors slugs end with the VIN (lowercase, no dashes).
    Example: /en/bmw-x5-2018-5uxkt0c58j0w01664 → 5UXKT0C58J0W01664
    """
    if not url:
        return None
    seg = url.rstrip("/").split("/")[-1]
    clean = seg.replace("-", "").upper()
    if len(clean) >= 17:
        candidate = clean[-17:]
        if VIN_RE.fullmatch(candidate):
            return candidate
    return None


# ─────────────────────────────────────────────────────────────────
# Detail page parser — production-grade (BidMotors current HTML)
# ─────────────────────────────────────────────────────────────────
# Real BidMotors DOM uses:
#   <span class="car-details__label">Lot number:</span>
#   <span class="car-details__value">44564909</span>          (next sibling)
# Fields confirmed live (April 2026):
#   Lot number, Auction date, Car Brand, Car Model, VIN Number,
#   Year, Mileage (km/mi), Keys, Gearbox, Engine type, Fuel type,
#   Drive, Damage, Condition, Location, Seller, Seller name,
#   Documents for sale
# Auction provider logo: /assets/live-auction/{iaai|copart|kar}-...
# Photos:                  vis.iaai.com, copart.com, ...
# ─────────────────────────────────────────────────────────────────
_NUMERIC_RE = re.compile(r"[\d,.\u00A0]+")


def _to_float(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    m = _NUMERIC_RE.search(s.replace("\u00A0", " "))
    if not m:
        return None
    cleaned = m.group(0).replace(",", "").replace(" ", "").replace("\u00A0", "")
    try:
        v = float(cleaned)
        return v
    except Exception:
        return None


def _to_int(s: Optional[str]) -> Optional[int]:
    v = _to_float(s)
    if v is None:
        return None
    try:
        return int(v)
    except Exception:
        return None


def _split_odometer(text: Optional[str]) -> Tuple[Optional[int], Optional[str]]:
    """
    "166916 km"  → (166916, "km")
    "103,717 mi" → (103717, "mi")
    "184246"     → (184246, None)
    """
    if not text:
        return None, None
    val = _to_int(text)
    t = text.lower()
    unit = None
    if re.search(r"\bmi(les)?\b", t):
        unit = "mi"
    elif re.search(r"\bkm\b", t):
        unit = "km"
    return val, unit


def _clean_title(raw: Optional[str]) -> Tuple[Optional[str], Optional[int], Optional[str], Optional[str], Optional[str]]:
    """
    "VIN: 5UXKT0C58J0W01664 BMW X5 Edrive xDrive40E Iperformance"
        → cleaned_title="2018 BMW X5 Edrive xDrive40E Iperformance"  (year filled in by caller)
        → year=None, make="BMW", model="X5", trim="Edrive xDrive40E Iperformance"

    The function returns (cleaned_title, year, make, model, trim).
    Year is best-effort from the title string only — real year usually
    comes from the "Year" car-details field, so caller may override.
    """
    if not raw:
        return None, None, None, None, None
    t = raw.replace("VIN:", " ").replace("vin:", " ")
    t = VIN_RE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return None, None, None, None, None
    parts = t.split()
    year: Optional[int] = None
    if parts and re.fullmatch(r"(19|20)\d{2}", parts[0]):
        year = int(parts[0])
        parts = parts[1:]
    make: Optional[str] = parts[0] if parts else None
    model: Optional[str] = parts[1] if len(parts) > 1 else None
    trim: Optional[str] = " ".join(parts[2:]) if len(parts) > 2 else None
    cleaned_title = " ".join((str(year) if year else "", make or "", model or "", trim or "")).strip() or None
    return cleaned_title, year, make, model, trim


def _detect_auction_provider(soup: BeautifulSoup) -> Optional[str]:
    """Find auction-provider logo in the live-auction asset path."""
    for img in soup.select("img"):
        src = (img.get("src") or img.get("data-src") or "").lower()
        if "/assets/live-auction/" in src:
            for prov in ("copart", "iaai", "kar", "manheim"):
                if prov in src:
                    return prov.upper() if prov in ("iaai", "kar") else prov.title()
    return None


# Real auction CDN domains we trust as legitimate vehicle photos
_PHOTO_HOST_PATTERNS = (
    "vis.iaai.com",
    "vis-resizer.iaai.com",
    "g.copart.com",
    "cs.copart.com",
    "vis.copart.com",
    "i.copart.com",
    "static.copart.com",
    "copart-images",
    "/storage/",      # bidmotors local CDN
    "/uploads/",      # bidmotors local CDN
    "kar-cdn",
    "manheim",
)


def _is_real_photo(src: str) -> bool:
    if not src:
        return False
    s = src.lower()
    if "logo" in s or "icon" in s or "/header/" in s or "facebook.com/tr" in s:
        return False
    if s.startswith("data:"):
        return False
    return any(p in s for p in _PHOTO_HOST_PATTERNS)


def _normalize_url(src: str) -> str:
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return BASE + src
    return src


def parse_detail(html: str, url: str) -> Dict[str, Any]:
    """Parse a BidMotors detail page → normalized clean dict.

    All free-text labels read from `.car-details__label` and their immediate
    sibling `.car-details__value`. Title is split into year/make/model/trim.
    Images filtered to real auction photos only (Copart/IAAI/Storage).
    """
    soup = BeautifulSoup(html, "html.parser")

    # ── 1. RAW TITLE & SPLIT ────────────────────────────────────────
    h1 = soup.select_one("h1")
    raw_title = h1.get_text(" ", strip=True) if h1 else None
    cleaned_title, year_from_title, make, model, trim = _clean_title(raw_title)

    # ── 2. KEY-VALUE PAIRS via car-details__label/value siblings ────
    fields: Dict[str, str] = {}
    for lbl in soup.select(".car-details__label"):
        label = lbl.get_text(" ", strip=True).rstrip(":").strip().lower()
        value: Optional[str] = None
        nxt = lbl.find_next_sibling()
        if nxt:
            value = nxt.get_text(" ", strip=True)
        if not value:
            parent = lbl.parent
            if parent:
                cand = parent.get_text(" ", strip=True)
                cand = cand.replace(lbl.get_text(" ", strip=True), "", 1).strip()
                if cand:
                    value = cand
        if label and value:
            fields[label] = value

    # Some BidMotors listings still use `.car-info__label` (older layout) —
    # fall back to that pattern as well.
    if not fields:
        for lbl in soup.select(".car-info__label"):
            label = lbl.get_text(" ", strip=True).rstrip(":").strip().lower()
            nxt = lbl.find_next_sibling()
            if nxt:
                fields[label] = nxt.get_text(" ", strip=True)

    def F(*keys: str) -> Optional[str]:
        for k in keys:
            v = fields.get(k.lower())
            if v:
                return v
        return None

    # ── 3. STRUCTURED FIELDS ────────────────────────────────────────
    vin = F("vin number", "vin") or _extract_vin_from_text(soup.get_text(" ", strip=True))
    if vin:
        vin = vin.upper()

    # Year: prefer car-details "Year" over title parse
    year_str = F("year")
    year = _to_int(year_str) if year_str else year_from_title

    # Brand/model: prefer car-details fields
    make = F("car brand", "brand", "make") or make
    model = F("car model", "model") or model

    # Mileage / odometer
    mileage_text = F("mileage", "odometer")
    odometer, odometer_unit = _split_odometer(mileage_text)
    if not odometer_unit and mileage_text:
        # Fallback: detect mi/km in raw text
        if "mi" in mileage_text.lower():
            odometer_unit = "mi"
        elif "km" in mileage_text.lower():
            odometer_unit = "km"

    location = F("location")
    damage_primary = F("damage", "primary damage")
    damage_secondary = F("secondary damage")
    fuel_type = F("fuel type", "fuel")
    transmission = F("gearbox", "transmission")
    drivetrain = F("drive", "drivetrain")
    engine = F("engine type", "engine")
    keys = F("keys")
    condition = F("condition")
    seller = F("seller")
    seller_name = F("seller name")
    title_status = F("documents for sale", "title status", "title")
    sale_date = F("auction date", "sale date")
    lot_number = F("lot number", "lot")
    color = F("color", "exterior color")
    body_style = F("body style", "body type")

    # ── 4. AUCTION PROVIDER ──────────────────────────────────────────
    auction_name = F("auction") or _detect_auction_provider(soup)

    # ── 5. CLEAN TITLE (rebuild from authoritative fields) ──────────
    final_title = " ".join(
        [str(year) if year else "", make or "", model or "", trim or ""]
    ).strip() or cleaned_title or raw_title

    # ── 6. PHOTOS — only real auction photos, deduplicated ─────────
    images: List[str] = []
    seen_image_keys: set = set()
    for img in soup.select("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not _is_real_photo(src):
            continue
        normalized = _normalize_url(src)
        # Dedup key: strip width/height params so HD + thumbnail of the
        # same photo collapse. Falls back to the path if no key found.
        key = None
        m = re.search(r"imageKeys?=([^&]+)", normalized)
        if m:
            key = m.group(1)
        else:
            key = re.split(r"[?&]", normalized)[0]
        if key in seen_image_keys:
            continue
        seen_image_keys.add(key)
        images.append(normalized)
    images = images[:30]

    # ── 7. PRICE / CURRENT BID (BidMotors hides these — best-effort) ─
    # Their detail page generally doesn't expose a final $ price, but we
    # try anyway in case the layout adds one.
    price = None
    current_bid = None
    for el in soup.find_all(string=re.compile(r"\$\s*\d")):
        n = _to_float(el)
        if n is not None:
            txt_lower = (el.parent.get_text(" ", strip=True) or "").lower() if el.parent else ""
            if "bid" in txt_lower and current_bid is None:
                current_bid = n
            elif price is None:
                price = n

    return {
        # Identity
        "vin": vin,
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "title": final_title,
        "raw_title": raw_title,

        # Auction
        "lot_number": lot_number,
        "auction_name": auction_name,
        "sale_date": sale_date,
        "seller": seller,
        "seller_name": seller_name,

        # Condition & damage
        "condition": condition,
        "damage_primary": damage_primary,
        "damage_secondary": damage_secondary,
        "title_status": title_status,
        "keys": keys,

        # Specs
        "odometer": odometer,
        "odometer_unit": odometer_unit,
        "location": location,
        "fuel_type": fuel_type,
        "transmission": transmission,
        "drivetrain": drivetrain,
        "engine": engine,
        "color": color,
        "body_style": body_style,

        # Pricing (best-effort; BidMotors hides these by default)
        "price": price,
        "current_bid": current_bid,

        # Media & link
        "images": images,
        "image_count": len(images),
        "url": url,
        "source_url": url,
        "source": "bidmotors",
    }


def _extract_vin_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    m = VIN_RE.search(text.upper())
    return m.group(0) if m else None


# ─────────────────────────────────────────────────────────────────
# 1. SEARCH FLOW (fast: ~300-900 ms)
# ─────────────────────────────────────────────────────────────────
async def search_flow(query: str) -> Optional[Dict[str, Any]]:
    """Hit BidMotors search endpoint → JSON redirect → detail page parse.

    Returns parsed detail card on success, None if no redirect or empty.
    Raises only on hard exceptions caught by caller's try/except.
    """
    r = await _fetch(SEARCH_URL, params={"query": query}, retries=1, timeout=5.0)
    if r is None or r.status_code != 200:
        return None

    try:
        data = r.json()
    except Exception:
        # Server returned HTML instead of JSON → no redirect available
        return None

    redir = (data or {}).get("redirect_url") or (data or {}).get("redirectUrl")
    if not redir:
        return None

    url = redir if redir.startswith("http") else BASE + redir
    page = await _fetch(url, retries=1, timeout=8.0)
    if page is None or page.status_code != 200:
        return None

    parsed = parse_detail(page.text, url)
    # Make sure VIN from query wins if URL slug parse failed
    if not parsed.get("vin") and is_valid_vin(query):
        parsed["vin"] = query
    return parsed


# ─────────────────────────────────────────────────────────────────
# 2. PAGE FLOW (fallback: ~2-6 sec; bounded)
# ─────────────────────────────────────────────────────────────────
PAGE_FLOW_MAX_PAGES = 3       # stay polite
PAGE_FLOW_MAX_LINKS = 24      # per page
PAGE_FLOW_PARALLELISM = 4     # detail page fetches in parallel


async def page_flow(query: str) -> Optional[Dict[str, Any]]:
    """Bounded fallback: scan first PAGE_FLOW_MAX_PAGES of `?query=` filtered catalog,
    visit each card's detail page (parallel), return the one whose VIN matches.

    Note: the catalog page itself does NOT show VINs in HTML, but the detail
    URL slug ends with the VIN. We exploit that to filter cheaply BEFORE
    fetching detail pages — only pages whose slug VIN matches our query
    are fetched.
    """
    query_upper = query.upper()
    is_vin_q = is_valid_vin(query_upper)

    for page_num in range(1, PAGE_FLOW_MAX_PAGES + 1):
        r = await _fetch(
            CATALOGUE_URL,
            params={"query": query, "page": page_num},
            retries=1,
            timeout=8.0,
        )
        if r is None or r.status_code != 200:
            continue

        soup = BeautifulSoup(r.text, "html.parser")

        # Collect detail URLs from car-card anchors (or fallback to all /en/* links)
        hrefs: List[str] = []
        for a in soup.select("article.car-card a.car-card__wrapper, article.car-card a"):
            href = a.get("href") or ""
            if href.startswith("/en/") and href not in hrefs:
                hrefs.append(href)
        if not hrefs:
            for a in soup.select("a"):
                href = a.get("href") or ""
                if (href.startswith("/en/") and "/catalogue" not in href
                        and "/live-auction" not in href and href not in hrefs):
                    hrefs.append(href)
        hrefs = hrefs[:PAGE_FLOW_MAX_LINKS]

        # Cheap pre-filter: keep only links whose slug-VIN equals our query
        candidates: List[str] = []
        if is_vin_q:
            for h in hrefs:
                v = _vin_from_url(h)
                if v == query_upper:
                    candidates.append(h)
            # If no slug-match found AND we're on a filtered query page,
            # still try the first few links — VIN may not be in slug.
            if not candidates:
                candidates = hrefs[:6]
        else:
            # LOT or free-text: can't pre-filter; just take top N
            candidates = hrefs[:8]

        # Fetch detail pages in parallel
        sem = asyncio.Semaphore(PAGE_FLOW_PARALLELISM)

        async def _try_one(href: str) -> Optional[Dict[str, Any]]:
            url = BASE + href
            # Filter out non-detail pages (sections / brand landing / etc.)
            # BidMotors detail URLs always have multi-segment slug ending in
            # the VIN (or close to). Reject if the path ends with `?` or
            # contains generic landing markers.
            if "?" in href and "section=" in href:
                return None
            if href.startswith("/en/cars-in-stock/"):
                return None
            async with sem:
                page = await _fetch(url, retries=0, timeout=6.0)
                if page is None or page.status_code != 200:
                    return None
                parsed = parse_detail(page.text, url)
                if not parsed or not parsed.get("vin"):
                    return None
                # VIN match check (strict)
                if is_vin_q and parsed.get("vin", "").upper() != query_upper:
                    return None
                # LOT match check
                if not is_vin_q and is_lot_number(query) and parsed.get("lot_number") != query:
                    return None
                return parsed

        for hit in await asyncio.gather(*[_try_one(h) for h in candidates], return_exceptions=False):
            if hit:
                return hit

    return None


# ─────────────────────────────────────────────────────────────────
# 3. PUBLIC ENTRY POINT — SEARCH → PAGE → NOT_FOUND
# ─────────────────────────────────────────────────────────────────
SEARCH_TIMEOUT = 5.0
PAGE_TIMEOUT = 10.0


async def get_car_by_vin(vin_or_query: str, db=None) -> Dict[str, Any]:
    """Main lookup. Returns:
        {"found": True,  "source": "SEARCH"|"WESTMOTORS"|"LEMON"|"PAGE"|"CACHE", "data": {...}}
        {"found": False, "source": "NOT_FOUND"|"INVALID"}

    Routing (Phase IV-2):
        if input is digits-only (LOT):
            CACHE → Lemon LOT INDEX → BitMotors SEARCH → WestMotors INDEX → BitMotors PAGE
        if input is 17-char VIN:
            CACHE → BitMotors SEARCH → WestMotors INDEX → Lemon VIN INDEX → BitMotors PAGE
    """
    raw = (vin_or_query or "").strip()
    query = normalize_vin(raw)
    if not query:
        return {"found": False, "source": "INVALID", "error": "empty_query"}
    if not is_valid_vin(query) and not is_lot_number(query):
        return {"found": False, "source": "INVALID",
                "error": "not_a_vin_or_lot",
                "hint": "Use /api/public/search/{query} for partial / free-text searches."}

    # 0) Cache (5 min)
    cached = await cache.get(query)
    if cached:
        cached_with_flag = dict(cached)
        cached_with_flag.setdefault("is_live", is_live(cached))
        return {"found": True, "source": "CACHE", "data": cached_with_flag}

    is_lot_only = is_lot_number(query) and not is_valid_vin(query)

    # ═════════════════════════════════════════════════════════════
    # LOT-only routing — Lemon FIRST (it's the only source that
    # publicly exposes auction lot numbers in its detail pages).
    # ═════════════════════════════════════════════════════════════
    if is_lot_only and db is not None:
        try:
            from lemon_scraper import lookup_by_lot as lemon_by_lot
            lm = await asyncio.wait_for(lemon_by_lot(db, query), timeout=3.6)
            if lm:
                lm["is_live"] = is_live(lm)
                await cache.set(query, lm)
                return {"found": True, "source": "LEMON", "data": lm}
        except asyncio.TimeoutError:
            logger.info(f"[get_car_by_vin] LEMON-LOT timeout for {query}")
        except Exception as e:
            logger.debug(f"[get_car_by_vin] LEMON-LOT err for {query}: {e}")

    # 1) BitMotors SEARCH (primary live)
    try:
        await search_breaker.before_call()
        try:
            res = await asyncio.wait_for(search_flow(query), timeout=SEARCH_TIMEOUT)
            if res:
                await search_breaker.on_success()
                res["is_live"] = is_live(res)
                await cache.set(query, res)
                return {"found": True, "source": "SEARCH", "data": res}
            # No exception, no result → treat as success (legitimate not-found)
            await search_breaker.on_success()
        except asyncio.TimeoutError:
            await search_breaker.on_failure()
            logger.info(f"[get_car_by_vin] SEARCH timeout for {query}")
        except Exception as e:
            await search_breaker.on_failure()
            logger.warning(f"[get_car_by_vin] SEARCH error for {query}: {e}")
    except CircuitOpenError as e:
        logger.info(f"[get_car_by_vin] SEARCH circuit-open for {query}: {e}")

    # 2) WestMotors INDEX fallback (Phase IV) — VIN only
    if db is not None and is_valid_vin(query):
        try:
            from westmotors_scraper import lookup_vin_in_index as wm_lookup
            wm_res = await asyncio.wait_for(wm_lookup(db, query), timeout=3.6)
            if wm_res:
                wm_res["is_live"] = is_live(wm_res)
                await cache.set(query, wm_res)
                return {"found": True, "source": "WESTMOTORS", "data": wm_res}
        except asyncio.TimeoutError:
            logger.info(f"[get_car_by_vin] WESTMOTORS hard-timeout for {query}")
        except Exception as e:
            logger.debug(f"[get_car_by_vin] WESTMOTORS lookup error for {query}: {e}")

    # 3) Lemon INDEX fallback (Phase IV-2) — VIN flow only here;
    # LOT was already tried at the top.
    if db is not None and is_valid_vin(query):
        try:
            from lemon_scraper import lookup_by_vin as lemon_by_vin
            lm = await asyncio.wait_for(lemon_by_vin(db, query), timeout=3.6)
            if lm:
                lm["is_live"] = is_live(lm)
                await cache.set(query, lm)
                return {"found": True, "source": "LEMON", "data": lm}
        except asyncio.TimeoutError:
            logger.info(f"[get_car_by_vin] LEMON timeout for {query}")
        except Exception as e:
            logger.debug(f"[get_car_by_vin] LEMON lookup err for {query}: {e}")

    # ═════════════════════════════════════════════════════════════
    # Phase V — Multi-Source Resolver tier (HTTP + Extension)
    #
    # 4) AuctionAuto.org (httpx, no Cloudflare, health-gated)
    # 4b) Observation cache (push warming hit — instant)
    # 5) Extension layer (poctra / carsfromwest / autoauctionhistory
    #    / salvagebid — all behind Cloudflare; only fired when at
    #    least one online extension client is registered for the
    #    capability and source is not flagged degraded)
    # 6) BitMotors PAGE scan (slow safety net)
    # ═════════════════════════════════════════════════════════════
    if is_valid_vin(query):
        # 4a) Observation cache — instant if extension already pushed
        try:
            from multisource_resolver import lookup_observation as _obs_lookup
            obs = _obs_lookup(query)
            if obs:
                obs["is_live"] = is_live(obs)
                primary_src = (obs.get("source") or "EXT_OBSERVATION").upper()
                await cache.set(query, obs)
                return {
                    "found": True,
                    "source": primary_src + "_CACHED",
                    "data": obs,
                }
        except Exception as e:
            logger.debug(f"[get_car_by_vin] observation lookup err for {query}: {e}")

        # 4b) AuctionAuto — fast httpx, ~1.5s, with health gate
        try:
            from multisource_resolver import auctionauto_lookup_gated as _aa_lookup
            aa = await asyncio.wait_for(_aa_lookup(query), timeout=4.0)
            if aa:
                aa["is_live"] = is_live(aa)
                await cache.set(query, aa)
                return {"found": True, "source": "AUCTIONAUTO", "data": aa}
        except asyncio.TimeoutError:
            logger.info(f"[get_car_by_vin] AUCTIONAUTO timeout for {query}")
        except Exception as e:
            logger.debug(f"[get_car_by_vin] AUCTIONAUTO err for {query}: {e}")

        # 5) Extension layer — only fired if a client is online + healthy
        try:
            from multisource_resolver import extension_lookup_gated as _ext_lookup
            ext = await asyncio.wait_for(_ext_lookup(query, timeout=4.0), timeout=5.0)
            if ext:
                ext["is_live"] = is_live(ext)
                primary_src = (ext.get("source") or "EXTENSION").upper()
                if primary_src not in {"POCTRA", "CARSFROMWEST",
                                       "AUTOAUCTIONHISTORY", "SALVAGEBID"}:
                    primary_src = "EXTENSION"
                await cache.set(query, ext)
                return {"found": True, "source": primary_src, "data": ext}
        except asyncio.TimeoutError:
            logger.info(f"[get_car_by_vin] EXTENSION timeout for {query}")
        except Exception as e:
            logger.debug(f"[get_car_by_vin] EXTENSION err for {query}: {e}")

    # 6) PAGE fallback (BitMotors slow scan)
    try:
        await page_breaker.before_call()
        try:
            res = await asyncio.wait_for(page_flow(query), timeout=PAGE_TIMEOUT)
            if res:
                await page_breaker.on_success()
                res["is_live"] = is_live(res)
                await cache.set(query, res)
                return {"found": True, "source": "PAGE", "data": res}
            await page_breaker.on_success()
        except asyncio.TimeoutError:
            await page_breaker.on_failure()
            logger.info(f"[get_car_by_vin] PAGE timeout for {query}")
        except Exception as e:
            await page_breaker.on_failure()
            logger.warning(f"[get_car_by_vin] PAGE error for {query}: {e}")
    except CircuitOpenError as e:
        logger.info(f"[get_car_by_vin] PAGE circuit-open for {query}: {e}")

    # 7) Not found
    return {"found": False, "source": "NOT_FOUND"}


# ─────────────────────────────────────────────────────────────────
# Health & ops helpers
# ─────────────────────────────────────────────────────────────────
def get_cache_stats() -> Dict[str, Any]:
    return cache.stats()


async def clear_cache() -> None:
    await cache.clear()


# ─────────────────────────────────────────────────────────────────
# is_live(data) — distinguishes a currently-biddable lot from a
# historical sold record. Used by the public API to label results
# 🟢 LIVE vs ⚫ SOLD (UX-critical: customer must not place bids on
# a car that was sold years ago).
# ─────────────────────────────────────────────────────────────────
_LIVE_STATUSES = {"active", "live", "running", "buy_now", "preview", "preliminary", "open"}
_SOLD_STATUSES = {"sold", "closed", "ended", "cancelled", "withdrawn"}


def is_live(data: Optional[Dict[str, Any]]) -> bool:
    """True if the record describes a currently-biddable / unsold lot.

    Heuristics (in order):
      1. explicit sale_status / status field → match against known sets
      2. presence of sale_date in the past   → SOLD (False)
      3. presence of "archived" flag         → SOLD (False)
      4. has current_bid / buy_now / next_auction_date → LIVE (True)
      5. default → LIVE (we err on the live side; the UI can still
         show a soft "freshness" indicator).
    """
    if not data:
        return False

    # 1) Explicit status
    for key in ("sale_status", "lot_status", "status", "auction_status"):
        v = (data.get(key) or "").strip().lower()
        if v in _SOLD_STATUSES:
            return False
        if v in _LIVE_STATUSES:
            return True

    # 2) archived flag (set by our incremental syncs when last_seen is stale)
    if data.get("archived") is True:
        return False
    if data.get("_archived") is True:
        return False

    # 3) sale_date in the past → SOLD
    sd = data.get("sale_date") or data.get("sold_at") or data.get("purchaseDate")
    if sd:
        try:
            from datetime import datetime, timezone
            # Try several parsable formats
            for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d.%m.%Y", "%m/%d/%Y"):
                try:
                    dt = datetime.strptime(str(sd)[:19], fmt)
                    if dt < datetime.now() - __import__("datetime").timedelta(days=1):
                        return False
                    break
                except ValueError:
                    continue
        except Exception:
            pass

    # 4) Active-bid signals
    if any(data.get(k) for k in ("current_bid", "buy_now_price", "next_auction_date", "auction_date_next")):
        return True

    # Default: treat as live (unknown). Conservative for stat.vin which
    # mostly returns historical-only data.
    return True


# ─────────────────────────────────────────────────────────────────
# Stat.vin parallel enrichment — JIT only, never blocks the LIVE
# chain. Safe to fire-and-forget in parallel with get_car_by_vin.
# ─────────────────────────────────────────────────────────────────
async def enrich_with_history(vin: str) -> Optional[Dict[str, Any]]:
    """Fetch sold-history & price intelligence from stat.vin (JIT, 3.5s budget).

    Designed to be called in parallel with get_car_by_vin via asyncio.gather.
    Returns None on miss / timeout / error — never raises.
    """
    if not vin or not is_valid_vin((vin or "").strip().upper()):
        return None
    try:
        from statvin_scraper import enrich_with_statvin
        return await enrich_with_statvin(vin.strip().upper())
    except Exception as e:
        logger.debug(f"[enrich_with_history] {vin}: {e}")
        return None


# Public re-export — let server.py import is_live + enrich_with_history
# without reaching back into module internals.
__all__ = [
    "get_car_by_vin",
    "get_cache_stats",
    "clear_cache",
    "is_live",
    "enrich_with_history",
    "normalize_vin",
    "is_valid_vin",
    "is_lot_number",
    # Circuit breaker
    "get_circuit_stats",
    "reset_circuits",
    "CircuitOpenError",
    "search_breaker",
    "page_breaker",
]
