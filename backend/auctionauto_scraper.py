"""
auctionauto.org — production-ready VIN lookup via httpx.

No Cloudflare challenge on the listing endpoint, so a plain HTTP GET
with a browser-shaped User-Agent is sufficient.  We keep the request
shape minimal and avoid advertising brotli (httpx cannot decode it
without an extra dep, and AA serves brotli when offered).

Endpoint shape:
    GET https://auctionauto.org/auction/cars?search=<VIN>

Reliable match marker:
    `alt="<VIN>..."` on the gallery image inside the matching lot card.
    Without this marker the response is a generic "popular cars"
    landing — we treat that as a miss.

Returned dict (all fields optional except `vin` and `source`):
    {
        "source": "AUCTIONAUTO",
        "vin": str,
        "lot": Optional[str],
        "url": Optional[str],
        "title": Optional[str],
        "year": Optional[int],
        "make": Optional[str],
        "model": Optional[str],
        "current_bid_usd": Optional[int],
        "buy_now_usd": Optional[int],
        "odometer_km": Optional[int],
        "engine_l": Optional[float],
        "fuel": Optional[str],
        "images": List[str],
        "image_count": int,
        "fetched_at": int,        # epoch seconds
    }

The module exposes a single coroutine ``lookup_vin(vin)`` and a
``get_health()`` helper that publishes circuit-breaker stats.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("auctionauto")

BASE_URL = "https://auctionauto.org"
SEARCH_PATH = "/auction/cars"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    # Intentionally omit "br" from Accept-Encoding — httpx does not
    # decode brotli without an extra dep.
}

DEFAULT_TIMEOUT = 6.0  # AA's listing endpoint typically responds in ~1.5s

_VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
_LOT_TRAILING_RE = re.compile(r"-(\d{6,})(?:[/?#]|$)")
_TITLE_RE = re.compile(r"\s*(19|20)\d{2}\s+([A-Z][A-Z0-9-]+)\s+(.+)$")
_ODO_RE = re.compile(r"([\d.,]+)\s*Km\b", re.I)
_ENGINE_RE = re.compile(r",\s*([\d.]+)\s*,\s*(Gas|Diesel|Hybrid|Electric)", re.I)
_FUEL_RE = re.compile(r"\b(Gas|Diesel|Hybrid|Electric)\b")
_BID_RE = re.compile(r"Current\s+bid[:\s]*\$?\s*([\d,]+)", re.I)
_BUYNOW_RE = re.compile(r"Buy\s+now[:\s]*\$?\s*([\d,]+)", re.I)


# ─────────────────────────────────────────────────────────────────
# Shared HTTP client
# ─────────────────────────────────────────────────────────────────
_client: Optional[httpx.AsyncClient] = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        async with _client_lock:
            if _client is None or _client.is_closed:
                _client = httpx.AsyncClient(
                    headers=HEADERS,
                    timeout=httpx.Timeout(DEFAULT_TIMEOUT, connect=3.0),
                    follow_redirects=True,
                    limits=httpx.Limits(
                        max_connections=10,
                        max_keepalive_connections=5,
                    ),
                )
    return _client


async def close_client() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    _client = None


# ─────────────────────────────────────────────────────────────────
# Lightweight metrics — exposed via get_health()
# ─────────────────────────────────────────────────────────────────
class _Metrics:
    def __init__(self) -> None:
        self.total_calls = 0
        self.hits = 0
        self.misses = 0
        self.errors = 0
        self.consecutive_errors = 0
        self.last_error: Optional[str] = None
        self.last_error_at: Optional[float] = None
        self.last_success_at: Optional[float] = None
        self.latencies_ms: List[float] = []  # rolling window of last 50

    def on_success(self, hit: bool, latency_ms: float) -> None:
        self.total_calls += 1
        self.consecutive_errors = 0
        self.last_success_at = time.time()
        if hit:
            self.hits += 1
        else:
            self.misses += 1
        self._push_latency(latency_ms)

    def on_error(self, exc: BaseException, latency_ms: float) -> None:
        self.total_calls += 1
        self.errors += 1
        self.consecutive_errors += 1
        self.last_error = f"{type(exc).__name__}: {exc}"[:200]
        self.last_error_at = time.time()
        self._push_latency(latency_ms)

    def _push_latency(self, ms: float) -> None:
        self.latencies_ms.append(ms)
        if len(self.latencies_ms) > 50:
            self.latencies_ms.pop(0)

    def snapshot(self) -> Dict[str, Any]:
        sample = sorted(self.latencies_ms)
        n = len(sample)
        if n:
            p50 = sample[n // 2]
            p95 = sample[max(0, int(n * 0.95) - 1)]
        else:
            p50 = p95 = 0
        hit_ratio = round(self.hits / self.total_calls, 3) if self.total_calls else 0.0
        return {
            "total_calls": self.total_calls,
            "hits": self.hits,
            "misses": self.misses,
            "errors": self.errors,
            "consecutive_errors": self.consecutive_errors,
            "hit_ratio": hit_ratio,
            "latency_p50_ms": int(p50),
            "latency_p95_ms": int(p95),
            "sample_size": n,
            "last_error": self.last_error,
            "last_error_at": self.last_error_at,
            "last_success_at": self.last_success_at,
        }


_metrics = _Metrics()


# ─────────────────────────────────────────────────────────────────
# Circuit breaker — stop hammering AA after a streak of failures.
# ─────────────────────────────────────────────────────────────────
class _Circuit:
    def __init__(self, fail_threshold: int = 5, cooldown_sec: int = 300):
        self.fail_threshold = fail_threshold
        self.cooldown_sec = cooldown_sec
        self.opened_at: Optional[float] = None

    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        if (time.time() - self.opened_at) > self.cooldown_sec:
            # half-open: allow one trial
            self.opened_at = None
            return False
        return True

    def trip(self) -> None:
        self.opened_at = time.time()
        logger.warning("[auctionauto] circuit OPEN for %ds", self.cooldown_sec)

    def reset(self) -> None:
        self.opened_at = None


_circuit = _Circuit()


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────
async def lookup_vin(vin: str, *, timeout: float = DEFAULT_TIMEOUT) -> Optional[Dict[str, Any]]:
    """Look up ``vin`` on auctionauto.org.  Returns parsed dict or None.

    Returns ``None`` when:
      * VIN format is invalid
      * the listing has no card matching this VIN
      * the upstream errored (recorded in metrics)
      * the circuit is open
    """
    if not vin:
        return None
    vin = vin.strip().upper()
    if not _VIN_RE.match(vin):
        return None

    if _circuit.is_open():
        logger.debug("[auctionauto] circuit open — skip %s", vin)
        return None

    client = await _get_client()
    t0 = time.time()
    try:
        r = await client.get(
            BASE_URL + SEARCH_PATH,
            params={"search": vin},
            timeout=timeout,
        )
        latency_ms = (time.time() - t0) * 1000
        if r.status_code != 200:
            _metrics.on_error(
                RuntimeError(f"HTTP {r.status_code}"), latency_ms
            )
            if _metrics.consecutive_errors >= _circuit.fail_threshold:
                _circuit.trip()
            return None
        parsed = _parse_listing(r.text, vin)
        _metrics.on_success(hit=parsed is not None, latency_ms=latency_ms)
        return parsed
    except (httpx.HTTPError, httpx.TimeoutException, asyncio.TimeoutError) as e:
        latency_ms = (time.time() - t0) * 1000
        _metrics.on_error(e, latency_ms)
        if _metrics.consecutive_errors >= _circuit.fail_threshold:
            _circuit.trip()
        logger.info("[auctionauto] %s lookup error: %s", vin, e)
        return None


def get_health() -> Dict[str, Any]:
    snap = _metrics.snapshot()
    snap["circuit_open"] = _circuit.is_open()
    snap["circuit_opened_at"] = _circuit.opened_at
    snap["name"] = "auctionauto"
    snap["base_url"] = BASE_URL
    return snap


async def reset_circuit() -> None:
    _circuit.reset()


# ─────────────────────────────────────────────────────────────────
# Parsing
# ─────────────────────────────────────────────────────────────────
def _parse_listing(html: str, vin: str) -> Optional[Dict[str, Any]]:
    if f'alt="{vin}' not in html:
        return None

    soup = BeautifulSoup(html, "lxml")
    img = soup.find("img", alt=re.compile(rf"^{re.escape(vin)}\b"))
    if not img:
        return None

    card = img.find_parent(class_=re.compile(r"lot-card|listing-card-wrapper"))
    if not card:
        card = img.find_parent(["article"]) or img.find_parent("div")
    if not card:
        return None

    text = card.get_text(" ", strip=True)

    # ─── title + lot URL ─────────────────────────────────────────
    title: str = ""
    lot_url: Optional[str] = None
    for a in card.select('a[href*="/auction/lot/"]'):
        t = a.get_text(" ", strip=True)
        if t and t.lower() != "view all":
            title = t
            href = a.get("href") or ""
            lot_url = (BASE_URL + href) if href.startswith("/") else href
            break

    # ─── year / make / model from title ──────────────────────────
    year: Optional[int] = None
    make: Optional[str] = None
    model: Optional[str] = None
    m = _TITLE_RE.match(title)
    if m:
        try:
            year = int(title.split()[0])
        except (ValueError, IndexError):
            year = None
        make = m.group(2).title()
        model = m.group(3).split(",")[0].strip().title()

    # ─── lot # from the URL slug ────────────────────────────────
    lot_no: Optional[str] = None
    if lot_url:
        lm = _LOT_TRAILING_RE.search(lot_url)
        if lm:
            lot_no = lm.group(1)

    # ─── prices ─────────────────────────────────────────────────
    current_bid: Optional[int] = None
    buy_now: Optional[int] = None
    cb = _BID_RE.search(text)
    if cb:
        try:
            current_bid = int(cb.group(1).replace(",", ""))
        except ValueError:
            pass
    bn = _BUYNOW_RE.search(text)
    if bn:
        try:
            buy_now = int(bn.group(1).replace(",", ""))
        except ValueError:
            pass

    # ─── photos (CDN behind /_ipx/ proxy) ───────────────────────
    images: List[str] = []
    for im in card.select("img[src]"):
        src = im.get("src") or ""
        m_cdn = re.search(r"https?://[^\"' )]+", src)
        if m_cdn:
            url = m_cdn.group(0).rstrip('&"\'')
            if url not in images:
                images.append(url)

    # ─── odometer (km) ──────────────────────────────────────────
    odometer_km: Optional[int] = None
    om = _ODO_RE.search(text)
    if om:
        raw = om.group(1).replace(".", "").replace(",", "").replace(" ", "")
        if raw.isdigit():
            odometer_km = int(raw)

    # ─── engine / fuel ──────────────────────────────────────────
    engine_l: Optional[float] = None
    em = _ENGINE_RE.search(text)
    if em:
        try:
            engine_l = float(em.group(1))
        except ValueError:
            pass

    fuel: Optional[str] = None
    fm = _FUEL_RE.search(text)
    if fm:
        fuel = fm.group(1)

    return {
        "source": "AUCTIONAUTO",
        "vin": vin,
        "lot": lot_no,
        "url": lot_url,
        "title": title or None,
        "year": year,
        "make": make,
        "model": model,
        "current_bid_usd": current_bid,
        "buy_now_usd": buy_now,
        "odometer_km": odometer_km,
        "engine_l": engine_l,
        "fuel": fuel,
        "images": images[:20],
        "image_count": len(images),
        "fetched_at": int(time.time()),
    }
