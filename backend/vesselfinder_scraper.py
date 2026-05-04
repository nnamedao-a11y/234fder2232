"""
VesselFinder Scraper - cookie-based live tracking.

Architecture:
  Manager logs into VesselFinder → Chrome extension syncs cookies to CRM →
  Backend uses those cookies to hit VesselFinder's map endpoints →
  Extract vessel by MMSI/IMO/name → update shipment → Socket.IO push to frontend.

Key endpoints on VesselFinder (internal, may change):
  - https://www.vesselfinder.com/api/pub/mp2?bbox=<int>,<int>,<int>,<int>&zoom=8&mmsi=0&ref=<rand>
  - https://www.vesselfinder.com/api/pub/sfl?bbox=<int>,<int>,<int>,<int>&zoom=8&mmsi=0&ref=<rand>

  bbox coords are integers: Math.floor(coord_deg * 600_000).
  Both endpoints return `application/octet-stream` (ArrayBuffer) — not JSON.
  See ``parse_vf_mp2_binary`` below for the binary record layout.

  Legacy (2023) paths ``/mp2``, ``/sfl``, ``/refresh`` now return 404.

This module is intentionally tolerant to response format changes.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("vesselfinder_scraper")


# ═══════════════════════════════════════════════════════════════════
# Cookie helpers
# ═══════════════════════════════════════════════════════════════════
def build_cookie_header(cookies: List[Dict[str, Any]]) -> str:
    parts = []
    for c in cookies or []:
        name = (c or {}).get("name")
        value = (c or {}).get("value")
        if name and value is not None:
            parts.append(f"{name}={value}")
    return "; ".join(parts)


async def get_active_vesselfinder_session(db) -> Optional[Dict[str, Any]]:
    return await db.vesselfinder_sessions.find_one({
        "provider": "vesselfinder",
        "isActive": True,
    })


# ═══════════════════════════════════════════════════════════════════
# Geo helpers
# ═══════════════════════════════════════════════════════════════════
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def route_to_bbox(route: List[Dict[str, Any]], pad_deg: float = 3.0) -> Optional[str]:
    """
    Build a padded bbox string around the shipment route.
    Format: 'min_lng,min_lat,max_lng,max_lat' (matches VesselFinder mp2 convention).
    Clamps to valid lat/lng ranges.
    """
    if not route:
        return None
    lats: List[float] = []
    lngs: List[float] = []
    for p in route:
        try:
            # Accept either {"lat":.., "lng":..} dict or [lat, lng] list/tuple.
            if isinstance(p, dict):
                lats.append(float(p.get("lat")))
                lngs.append(float(p.get("lng")))
            elif isinstance(p, (list, tuple)) and len(p) >= 2:
                lats.append(float(p[0]))
                lngs.append(float(p[1]))
            else:
                continue
        except (TypeError, ValueError):
            continue
    if not lats or not lngs:
        return None
    min_lat = _clamp(min(lats) - pad_deg, -85.0, 85.0)
    max_lat = _clamp(max(lats) + pad_deg, -85.0, 85.0)
    min_lng = _clamp(min(lngs) - pad_deg, -180.0, 180.0)
    max_lng = _clamp(max(lngs) + pad_deg, -180.0, 180.0)
    return f"{min_lng:.4f},{min_lat:.4f},{max_lng:.4f},{max_lat:.4f}"


# ═══════════════════════════════════════════════════════════════════
# VF expects bbox coords as integers — Math.floor(coord * 600_000).
# Used for /api/pub/mp2 and /api/pub/sfl calls (2026+).
# ═══════════════════════════════════════════════════════════════════
VF_COORD_SCALE = 600_000


def bbox_to_vf_int_str(bbox: Optional[str]) -> Optional[str]:
    """
    Convert float bbox 'min_lng,min_lat,max_lng,max_lat' (our CRM format) into
    the integer-scaled string VesselFinder's /api/pub/mp2 + /api/pub/sfl accept.
    Pass-through if the caller already supplied scaled ints.
    """
    if not bbox:
        return None
    parts = [p.strip() for p in str(bbox).split(",")]
    if len(parts) != 4:
        return None
    try:
        nums = [float(p) for p in parts]
    except (TypeError, ValueError):
        return None
    # Already integer-scaled? (magnitudes >> any real coord degree)
    if all(abs(n) > 1000 for n in nums):
        return ",".join(str(int(n)) for n in nums)
    return ",".join(str(int(math.floor(n * VF_COORD_SCALE))) for n in nums)



# ═══════════════════════════════════════════════════════════════════
# Vessel normalizer / extractor — resilient to payload variations
# ═══════════════════════════════════════════════════════════════════
def _first(item: Dict[str, Any], keys: List[str]):
    for k in keys:
        if k in item and item[k] not in (None, "", "-"):
            return item[k]
    return None


def normalize_vessel_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    lat = _first(item, ["lat", "LAT", "latitude", "y", "Latitude"])
    lng = _first(item, ["lon", "lng", "LON", "LNG", "longitude", "x", "Longitude"])
    mmsi = _first(item, ["mmsi", "MMSI", "id", "ship_id", "shipid"])
    imo = _first(item, ["imo", "IMO"])
    name = _first(item, ["name", "NAME", "shipname", "vessel_name", "vesselName", "vname"])
    speed = _first(item, ["speed", "SPEED", "sog", "SOG"])
    course = _first(item, ["course", "COURSE", "cog", "COG", "heading", "HDG"])
    ts = _first(item, ["timestamp", "TIMESTAMP", "lastUpdate", "last_update", "t"])
    if lat is None or lng is None:
        return None
    try:
        return {
            "name": str(name).strip() if name else None,
            "mmsi": str(mmsi).strip() if mmsi else None,
            "imo": str(imo).strip() if imo else None,
            "lat": float(lat),
            "lng": float(lng),
            "speed": float(speed) if speed not in (None, "", "-") else None,
            "course": float(course) if course not in (None, "", "-") else None,
            "timestamp": ts,
        }
    except Exception:
        return None


def _walk_and_collect(payload: Any, out: List[Dict[str, Any]], depth: int = 0) -> None:
    """Recursively walk nested lists/dicts, collecting normalized vessel items."""
    if depth > 5 or payload is None:
        return
    if isinstance(payload, list):
        for it in payload:
            norm = normalize_vessel_item(it)
            if norm:
                out.append(norm)
            elif isinstance(it, (list, dict)):
                _walk_and_collect(it, out, depth + 1)
    elif isinstance(payload, dict):
        # direct try
        norm = normalize_vessel_item(payload)
        if norm:
            out.append(norm)
        # recurse into known container keys
        for k in ("vessels", "data", "items", "objects", "features", "ships", "list", "result", "results"):
            val = payload.get(k)
            if isinstance(val, (list, dict)):
                _walk_and_collect(val, out, depth + 1)


def extract_vessels_from_payload(payload: Any) -> List[Dict[str, Any]]:
    """
    Main extractor. Three strategies, tried in order:
      1. BINARY — detect /api/pub/mp2 ArrayBuffer responses (VF 2026 format) and
         decode them directly. Produces canonical mmsi/lat/lng/name/cog/sog.
      2. DETERMINISTIC — strict JSON parser (placeholder until we see a real sample).
      3. FALLBACK — best-effort recursive walk over arbitrary JSON.

    ``payload`` may be:
      * ``bytes`` / ``bytearray`` — raw binary buffer
      * ``dict`` with key ``"format" == "binary-b64"`` and ``"data"`` base64 string
        (that's what the Chrome extension forwards now)
      * any JSON-like structure (dict / list)
    """
    # 1) Binary — direct bytes
    if isinstance(payload, (bytes, bytearray)):
        vessels = parse_vf_mp2_binary(bytes(payload))
        if vessels:
            return vessels

    # 1b) Binary — wrapped as {format: 'binary-b64', data: '<base64>'}
    if isinstance(payload, dict) and payload.get("format") == "binary-b64":
        import base64
        try:
            raw = base64.b64decode(payload.get("data") or "")
            vessels = parse_vf_mp2_binary(raw)
            if vessels:
                return vessels
        except Exception as e:
            logger.warning(f"[VF-SCRAPER] binary-b64 decode failed: {e}")

    try:
        det = extract_vessels_deterministic(payload)
        if det:
            return det
    except Exception as e:  # never let the hot parser kill the worker
        logger.debug(f"[VF-SCRAPER] deterministic parser raised: {e}")
    out: List[Dict[str, Any]] = []
    _walk_and_collect(payload, out)
    seen = set()
    unique: List[Dict[str, Any]] = []
    for v in out:
        key = (v.get("mmsi") or "") + "|" + (v.get("imo") or "") + "|" + (v.get("name") or "")
        if key in seen:
            continue
        seen.add(key)
        unique.append(v)
    return unique


# ═══════════════════════════════════════════════════════════════════
# VF /api/pub/mp2 binary format decoder
# ═══════════════════════════════════════════════════════════════════
# The response is an ArrayBuffer decoded client-side by VesselFinder's own
# web-worker (vfmap/map.js, fn drawShipsOnMapBinary).
#
# Layout (big-endian; VF uses DataView.getInt*):
#   [0]          u8  magic / version marker (observed 0x43 = 'C')
#   [1..2]       u16 header_size (Y)  — number of bytes after position 2 that
#                                       form the header before records start.
#   If Y >= 8:
#     [4..7]     i32 mcb flag bits (p1|p2|p3|p4|p7 features)
#     [8..11]    i32 totalShips (only when mcb.p7 is set)
#   Records start at offset I = 4 + Y.
#
#   Each record:
#     i16  w                (bit-packed: color|icon|size|flags)
#     i32  mmsi
#     i32  lat_scaled       (lat  = lat_scaled / 600_000)
#     i32  lng_scaled       (lng  = lng_scaled / 600_000)
#     [if R=mmsi==lastSelectedMMSI → 6 extra bytes: i16 cog*10, i16 sog*10, 2 pad]
#     i8   type / sub-type
#     i8   name_len
#     name bytes             (utf-8, length = name_len)
#     [if R → i32 timestamp]
#     [if zoom>=13 → extra 5 int16 extended fields]
#
# We don't need cog/sog/timestamp for matching, so we implement a conservative
# decoder that reads the minimum fields required to extract {mmsi, lat, lng,
# name}. When records look malformed we stop and return what we have so far —
# this is defensive because VF occasionally alters the per-record tail.
# ═══════════════════════════════════════════════════════════════════

import struct as _struct


def _read_i16(buf: bytes, off: int) -> int:
    return _struct.unpack_from(">h", buf, off)[0]


def _read_u16(buf: bytes, off: int) -> int:
    return _struct.unpack_from(">H", buf, off)[0]


def _read_i32(buf: bytes, off: int) -> int:
    return _struct.unpack_from(">i", buf, off)[0]


def _read_u32(buf: bytes, off: int) -> int:
    return _struct.unpack_from(">I", buf, off)[0]


def parse_vf_mp2_binary(buf: bytes) -> List[Dict[str, Any]]:
    """
    Decode a VesselFinder /api/pub/mp2 binary response into a list of vessels.
    Returns [] on malformed / empty payloads (≤ 12 bytes is the "no ships in
    bbox" response).
    """
    if not buf or len(buf) < 12:
        return []

    try:
        header_size = _read_u16(buf, 1)  # Y — bytes after position 2
    except _struct.error:
        return []

    # header spans [0 .. 4+header_size); records start at I
    I = 4 + header_size
    P = len(buf)
    if I >= P:
        return []

    # `lt` = selected mmsi (written at I-4 by the server when a ship is selected)
    try:
        lt = _read_i32(buf, I - 4)
    except _struct.error:
        lt = 0

    # Zoom is not carried in the payload, so the extended "b" branch isn't
    # reliably detectable. We conservatively assume b=False (zoom < 13). If a
    # server route ever needs the extended fields, set expanded=True.
    expanded = False
    vessels: List[Dict[str, Any]] = []

    while I < P:
        try:
            if I + 2 > P:
                break
            w = _read_i16(buf, I); I += 2
            if I + 4 > P: break
            mmsi = _read_u32(buf, I); I += 4
            if I + 4 > P: break
            lat_scaled = _read_i32(buf, I); I += 4
            if I + 4 > P: break
            lng_scaled = _read_i32(buf, I); I += 4

            is_selected = (mmsi == (lt & 0xFFFFFFFF)) or (mmsi == lt)
            cog = None
            sog = None
            if is_selected:
                # selected: extra 6 bytes (cog, sog, pad)
                if I + 6 > P: break
                cog = _read_i16(buf, I) / 10.0; I += 2
                sog = _read_i16(buf, I) / 10.0; I += 2
                I += 2  # padding / unused
            # type byte
            if I + 1 > P: break
            _type_byte = buf[I]; I += 1
            # name length + bytes
            if I + 1 > P: break
            name_len = buf[I]; I += 1
            if name_len > 64:  # VF names are <= 20 chars; guard against desync
                break
            if I + name_len > P: break
            try:
                name = buf[I:I + name_len].decode("utf-8", errors="replace").strip()
            except Exception:
                name = ""
            I += name_len
            # selected → i32 timestamp
            timestamp = None
            if is_selected:
                if I + 4 > P: break
                timestamp = _read_u32(buf, I); I += 4
            # extended (zoom≥13) block — skip 10 bytes if present
            if expanded:
                if I + 10 > P: break
                I += 10

            if mmsi <= 0:
                continue
            vessels.append({
                "name": name or str(mmsi),
                "mmsi": str(mmsi),
                "imo": None,
                "lat": lat_scaled / VF_COORD_SCALE,
                "lng": lng_scaled / VF_COORD_SCALE,
                "speed": sog,
                "course": cog,
                "timestamp": timestamp,
            })
        except Exception as e:
            logger.debug(f"[VF-BIN] record decode aborted at offset {I}: {e}")
            break

    return vessels


def extract_vessels_deterministic(payload: Any) -> List[Dict[str, Any]]:
    """
    PLACEHOLDER for a strict, fast, zero-recursion parser.

    Once the real mp2/sfl response is captured in DevTools, replace this body
    with a direct field access, e.g.:

        return [
            {
                "mmsi": str(it["mmsi"]),
                "imo":  str(it.get("imo") or "") or None,
                "name": it.get("name"),
                "lat":  float(it["lat"]),
                "lng":  float(it["lon"]),
                "speed":  float(it["sog"]) if it.get("sog") is not None else None,
                "course": float(it["cog"]) if it.get("cog") is not None else None,
                "timestamp": it.get("t"),
            }
            for it in payload["vessels"]
        ]

    Until then this returns [] and the recursive fallback handles the payload.
    """
    return []


def find_matching_vessel(
    vessels: List[Dict[str, Any]], target: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    t_mmsi = str(target.get("mmsi") or "").strip() or None
    t_imo = str(target.get("imo") or "").strip() or None
    t_name = (target.get("name") or "").strip().lower() or None
    # Priority: MMSI > IMO > exact name > contains name
    if t_mmsi:
        for v in vessels:
            if v.get("mmsi") and str(v["mmsi"]).strip() == t_mmsi:
                return v
    if t_imo:
        for v in vessels:
            if v.get("imo") and str(v["imo"]).strip() == t_imo:
                return v
    if t_name:
        for v in vessels:
            if v.get("name") and v["name"].strip().lower() == t_name:
                return v
        for v in vessels:
            if v.get("name") and t_name in v["name"].strip().lower():
                return v
    return None


# ═══════════════════════════════════════════════════════════════════
# VesselFinder HTTP client
# ═══════════════════════════════════════════════════════════════════
class VesselFinderClient:
    BASE_URL = "https://www.vesselfinder.com"

    def __init__(self, cookies: List[Dict[str, Any]], user_agent: str):
        self.cookies = cookies or []
        self.user_agent = (
            user_agent
            or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )

    def _headers(self) -> Dict[str, str]:
        return {
            "User-Agent": self.user_agent,
            "Accept": "application/octet-stream, application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"{self.BASE_URL}/",
            "Origin": self.BASE_URL,
            "Cookie": build_cookie_header(self.cookies),
        }

    async def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.BASE_URL}{path}"
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0),
                follow_redirects=True,
                headers=self._headers(),
            ) as client:
                res = await client.get(url, params=params)
                content_type = res.headers.get("content-type", "")
                # Binary (application/octet-stream) — VF 2026 /api/pub/mp2+sfl.
                if (
                    "octet-stream" in content_type
                    or content_type.startswith("application/binary")
                ):
                    raw = res.content or b""
                    return {
                        "ok": res.status_code == 200,
                        "status_code": res.status_code,
                        "data": raw,                # bytes → parsed by extract_vessels_from_payload
                        "url": str(res.url),
                        "content_type": content_type,
                        "is_binary": True,
                        "size": len(raw),
                    }
                text = res.text or ""
                parsed: Any
                if "json" in content_type or text.strip().startswith(("{", "[")):
                    try:
                        parsed = res.json()
                    except Exception:
                        parsed = text
                else:
                    parsed = text
                return {
                    "ok": res.status_code == 200,
                    "status_code": res.status_code,
                    "data": parsed,
                    "url": str(res.url),
                    "content_type": content_type,
                }
        except Exception as e:
            logger.warning(f"[VF-SCRAPER] GET {path} failed: {e}")
            return {"ok": False, "status_code": 0, "data": None, "error": str(e)[:200], "url": url}

    async def get_mp2(self, bbox: str, zoom: int = 8) -> Dict[str, Any]:
        """VesselFinder map vessels-on-map endpoint (binary ArrayBuffer)."""
        int_bbox = bbox_to_vf_int_str(bbox)
        if not int_bbox:
            return {"ok": False, "status_code": 0, "data": None, "error": "invalid_bbox"}
        import random
        params = {
            "bbox": int_bbox,
            "zoom": zoom,
            "mmsi": 0,
            "ref": random.randint(0, 99999),
        }
        return await self._get("/api/pub/mp2", params)

    async def get_sfl(self, bbox: str, zoom: int = 8) -> Dict[str, Any]:
        """VesselFinder map satellite-fleet-list endpoint (binary ArrayBuffer)."""
        int_bbox = bbox_to_vf_int_str(bbox)
        if not int_bbox:
            return {"ok": False, "status_code": 0, "data": None, "error": "invalid_bbox"}
        import random
        params = {
            "bbox": int_bbox,
            "zoom": zoom,
            "mmsi": 0,
            "ref": random.randint(0, 99999),
        }
        return await self._get("/api/pub/sfl", params)

    async def get_refresh(self) -> Dict[str, Any]:
        """Legacy endpoint — kept for backwards compatibility (often 404 now)."""
        return await self._get("/refresh")

    async def ping(self) -> Dict[str, Any]:
        """
        Lightweight check that the session is alive. Uses the live /api/pub/mp2
        endpoint with a tiny equatorial bbox — returns 200 with a few bytes of
        binary data when the cookies are accepted, 401/403 or HTML otherwise.
        """
        # Small bbox near (0,0) — will return minimal binary on success.
        res = await self.get_mp2("-1,-1,1,1")
        ok = res.get("ok")
        data = res.get("data")
        is_bin = bool(res.get("is_binary"))
        # Detect login-gated HTML response
        if isinstance(data, str) and ("<html" in data.lower() or "login" in data.lower()):
            ok = False
        snippet: Optional[str]
        if is_bin and isinstance(data, (bytes, bytearray)):
            snippet = data[:32].hex()
        else:
            snippet = (str(data) or "")[:200] if data else None
        return {
            "ok": bool(ok),
            "status_code": res.get("status_code"),
            "content_type": res.get("content_type"),
            "snippet": snippet,
        }


# ═══════════════════════════════════════════════════════════════════
# High-level: fetch position for a shipment
# ═══════════════════════════════════════════════════════════════════
# TTL cache — don't hit VesselFinder more than once per VF_CACHE_TTL_SEC for
# the same vessel key. Protects against rate-limit + saves CPU.
VF_CACHE_TTL_SEC = 60

# Anti-spam: per-vessel-key debounce across all concurrent tracking calls.
# Independent of the (success-only) TTL cache above — this covers failure bursts
# too. In-memory is fine for a single worker; if we shard the worker later we
# can move this to Redis.
VF_REQUEST_COOLDOWN_SEC = 30
_last_request_at: Dict[str, datetime] = {}

# Session health thresholds
VF_FAILS_TO_EXPIRE = 5          # consecutive failures without any success
VF_DEGRADED_SUCCESS_RATE = 0.3  # below this (on ≥10 attempts) → degraded


async def fetch_vessel_position_scraper(
    db, shipment: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Try to find vessel position using stored VesselFinder cookies and shipment's
    vessel descriptor (mmsi/imo/name) + route bbox.

    Pipeline:
      1) TTL cache (60s) — if fresh, return cached position (no network).
      2) mp2 — PRIMARY. If match found → DONE (90%+ cases).
      3) sfl — secondary fallback.
      4) refresh — last-resort fallback.
      5) deterministic parser → recursive fallback.

    Returns normalized position dict or None (caller falls back to simulate).
    """
    shipment_id = shipment.get("id")
    session = await get_active_vesselfinder_session(db)
    # NOTE: VF's /api/pub/mp2 and /api/pub/sfl are publicly readable from most
    # IPs — they do NOT require an authenticated session. We only need session
    # cookies if the hosting IP gets rate-limited. So we continue even without
    # a session; the anonymous path uses the default browser-like headers.
    cookies = session.get("cookies", []) if session else []
    user_agent = session.get("userAgent", "") if session else ""
    session_mode = "authenticated" if session and cookies else "anonymous"

    vessel_target = shipment.get("vessel") or {}
    mmsi = (vessel_target.get("mmsi") or "").strip() or None
    imo = (vessel_target.get("imo") or "").strip() or None
    name = (vessel_target.get("name") or "").strip() or None
    if not (mmsi or imo or name):
        return None

    # ── 1) TTL cache short-circuit
    cache_key = imo or (f"mmsi-{mmsi}" if mmsi else f"name-{name}")
    now = datetime.now(timezone.utc)
    try:
        cached = await db.vessel_positions.find_one({"imo": cache_key})
        if cached and cached.get("fetched_at"):
            fetched_at = cached["fetched_at"]
            if isinstance(fetched_at, datetime):
                if fetched_at.tzinfo is None:
                    fetched_at = fetched_at.replace(tzinfo=timezone.utc)
                age = (now - fetched_at).total_seconds()
                if age < VF_CACHE_TTL_SEC and cached.get("source", "").startswith("vesselfinder"):
                    return {
                        "imo": cached.get("imo"),
                        "mmsi": cached.get("mmsi"),
                        "lat": cached["lat"],
                        "lng": cached["lng"],
                        "speed": cached.get("speed"),
                        "course": cached.get("course"),
                        "timestamp": cached.get("timestamp"),
                        "fetched_at": fetched_at,
                        "source": "vesselfinder_scraper_cache",
                    }
    except Exception as e:
        logger.warning(f"[VF-SCRAPER] cache read failed: {e}")

    # ── 1b) Anti-spam debounce — same vessel key, <30s since last HTTP attempt.
    # Returns None (caller falls back to interpolate/simulate) without touching VF.
    last_req = _last_request_at.get(cache_key)
    if last_req and (now - last_req).total_seconds() < VF_REQUEST_COOLDOWN_SEC:
        logger.debug(
            f"[VF-SCRAPER] debounced shipment={shipment_id} key={cache_key} "
            f"age={(now - last_req).total_seconds():.1f}s"
        )
        return None
    _last_request_at[cache_key] = now

    route = shipment.get("route") or []
    if not route:
        origin = shipment.get("origin") or {}
        dest = shipment.get("destination") or {}
        if origin.get("lat") is not None and dest.get("lat") is not None:
            route = [origin, dest]
    bbox = route_to_bbox(route, pad_deg=5.0) if route else None

    client = VesselFinderClient(
        cookies=cookies,
        user_agent=user_agent,
    )
    target = {"mmsi": mmsi, "imo": imo, "name": name}

    async def _try_endpoint(method, *args, label: str) -> Optional[Dict[str, Any]]:
        res = await method(*args)
        if not (res.get("ok") and res.get("data")):
            return None
        vessels = extract_vessels_from_payload(res["data"])
        if not vessels:
            return None
        m = find_matching_vessel(vessels, target)
        if m:
            logger.info(
                f"[VF-SCRAPER] hit via {label} for shipment={shipment_id} "
                f"({len(vessels)} vessels in payload)"
            )
        return m

    match: Optional[Dict[str, Any]] = None

    # ── 2) mp2 — primary (hot path; ~90% of cases stop here)
    if bbox:
        match = await _try_endpoint(client.get_mp2, bbox, label="mp2")

    # ── 3) sfl — secondary
    if not match and bbox:
        match = await _try_endpoint(client.get_sfl, bbox, label="sfl")

    # ── 3b) Focused retries — VF's mp2 throttles big-bbox requests and can
    # silently drop vessels that aren't in the "primary" density tier. For
    # trans-oceanic routes (e.g. Brunswick GA → Bremerhaven) the full bbox
    # returns 3000+ vessels but the target ship may be skipped.
    # Solution: retry with TIGHT bboxes around key points: destination first
    # (ships usually approaching), then origin, then each intermediate route
    # waypoint (the great-circle midpoint often intersects busy lanes).
    if not match:
        focal_points: List[Dict[str, Any]] = []
        dest = shipment.get("destination") or {}
        origin = shipment.get("origin") or {}
        # priority: destination → route waypoints (approach→mid→depart) → origin
        ordered: List[Dict[str, Any]] = []
        if isinstance(dest, dict) and dest.get("lat") is not None:
            ordered.append(dest)
        # Route waypoints, reverse order (closest to destination first)
        route_pts = shipment.get("route") or []
        if isinstance(route_pts, list):
            # skip endpoints (already covered by origin/dest)
            middle = route_pts[1:-1] if len(route_pts) > 2 else []
            for p in reversed(middle):
                if isinstance(p, dict) and p.get("lat") is not None:
                    ordered.append(p)
        if isinstance(origin, dict) and origin.get("lat") is not None:
            ordered.append(origin)

        for pt in ordered:
            # Zoom escalation: VF's mp2 filters by zoom tier. For wide focal
            # retries we start at zoom=7 (wide density tier — includes all
            # classes of vessels) and escalate to 10 → 12 if the target isn't
            # in the returned set.
            for z in (7, 10):
                tight = (
                    f"{pt['lng']-10:.4f},{pt['lat']-10:.4f},"
                    f"{pt['lng']+10:.4f},{pt['lat']+10:.4f}"
                )
                logger.info(
                    f"[VF-SCRAPER] focused retry zoom={z} around {pt.get('name') or (pt.get('lat'), pt.get('lng'))} bbox={tight}"
                )
                match = await _try_endpoint(
                    lambda b: client.get_mp2(b, zoom=z),
                    tight,
                    label=f"mp2-focused-z{z}:{pt.get('name') or 'wp'}",
                )
                if match:
                    break
            if match:
                break

    # ── 4) refresh — last resort (legacy, typically 404)
    if not match:
        match = await _try_endpoint(client.get_refresh, label="refresh")

    if not match:
        logger.warning(
            f"[VF SCRAPER FAILED] shipment={shipment_id} "
            f"target={{mmsi={mmsi}, imo={imo}, name={name}}} bbox={bbox} "
            f"mode={session_mode} session_synced_at={session.get('syncedAt') if session else None}"
        )
        # track failures in DB for health dashboard (only if we have a session
        # record to update — don't spam the collection in anonymous mode)
        if session:
            try:
                await db.vesselfinder_sessions.update_one(
                    {"provider": "vesselfinder"},
                    {
                        "$inc": {"failCount": 1, "consecutiveFails": 1},
                        "$set": {"lastFailAt": now, "lastFailShipment": shipment_id},
                    },
                )
            except Exception:
                pass
        return None
    now = datetime.now(timezone.utc)
    position = {
        "imo": match.get("imo") or imo,
        "mmsi": match.get("mmsi") or mmsi,
        "lat": match["lat"],
        "lng": match["lng"],
        "speed": match.get("speed"),
        "course": match.get("course"),
        "timestamp": match.get("timestamp"),
        "fetched_at": now,
        "source": "vesselfinder_scraper",
    }

    # cache into vessel_positions (same schema as existing fetch_vessel_position)
    try:
        key_imo = str(match.get("imo") or imo or f"mmsi-{match.get('mmsi') or mmsi}")
        await db.vessel_positions.update_one(
            {"imo": key_imo}, {"$set": {**position, "imo": key_imo}}, upsert=True
        )
        if session:
            await db.vesselfinder_sessions.update_one(
                {"provider": "vesselfinder"},
                {
                    "$inc": {"successCount": 1},
                    "$set": {
                        "lastSuccessAt": now,
                        "lastSuccessShipment": shipment_id,
                        "consecutiveFails": 0,  # reset on any success
                    },
                },
            )
    except Exception as e:
        logger.warning(f"[VF-SCRAPER] cache write failed: {e}")
    logger.info(f"[VF-SCRAPER] SUCCESS shipment={shipment_id} mode={session_mode} "
                f"match_mmsi={match.get('mmsi')} lat={match['lat']:.3f} lng={match['lng']:.3f}")
    return position


# ═══════════════════════════════════════════════════════════════════
# Session analytics helpers
# ═══════════════════════════════════════════════════════════════════
def session_to_public_status(session: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not session:
        return {
            "connected": False,
            "provider": "vesselfinder",
            "syncedAt": None,
            "cookiesCount": 0,
            "pageUrl": None,
            "userAgent": None,
            "sessionStatus": "not_connected",
            "sessionMessage": "Сессия не синхронизирована. Менеджер должен нажать «Sync» в расширении.",
        }
    succ = int(session.get("successCount") or 0)
    fail = int(session.get("failCount") or 0)
    vf_ok = int(session.get("vfFetchOkCount") or 0)
    consecutive = int(session.get("consecutiveFails") or 0)
    total = succ + fail
    rate = (succ / total) if total else None
    # "Honest" VF health: how often VF endpoint returned vessels successfully
    # (regardless of whether OUR target was in bbox). This is the real
    # indicator of cookie validity & extension-to-VF connectivity.
    vf_health_total = succ + vf_ok + fail
    vf_health_rate = ((succ + vf_ok) / vf_health_total) if vf_health_total else None

    # Derived status:
    #   expired   — consecutive failures ≥ threshold AND VF fetch also failing
    #               (if VF fetch works but match fails, cookies are FINE)
    #   paused    — heartbeat older than 5 min (manager closed Chrome)
    #   degraded  — significant volume but low VF fetch success rate
    #   healthy   — otherwise
    status = "healthy"
    message = "Сессия активна, скрапер работает штатно."
    hb = session.get("lastHeartbeatAt")
    hb_age_sec = None
    if isinstance(hb, datetime):
        from datetime import datetime as _dt, timezone as _tz
        if hb.tzinfo is None:
            hb = hb.replace(tzinfo=_tz.utc)
        hb_age_sec = (_dt.now(_tz.utc) - hb).total_seconds()

    # If VF recently returned data (last 10 min), cookies CANNOT be expired —
    # this overrides the consecutive-fails check which only reflects match failures.
    last_vf_ok = session.get("lastVfFetchOkAt")
    vf_ok_fresh = False
    if isinstance(last_vf_ok, datetime):
        from datetime import datetime as _dt, timezone as _tz
        if last_vf_ok.tzinfo is None:
            last_vf_ok = last_vf_ok.replace(tzinfo=_tz.utc)
        age = (_dt.now(_tz.utc) - last_vf_ok).total_seconds()
        vf_ok_fresh = age < 600

    if consecutive >= VF_FAILS_TO_EXPIRE and not vf_ok_fresh:
        status = "expired"
        message = (
            f"Подряд {consecutive} неудач — cookies, скорее всего, протухли. "
            "Менеджер, нажми «Sync» в расширении «BIBI Vessel Sync»."
        )
    elif hb_age_sec is not None and hb_age_sec > 300:
        status = "paused"
        message = (
            f"Менеджер оффлайн (последний heartbeat {int(hb_age_sec // 60)} мин назад). "
            "Трекинг приостановлен до момента, пока менеджер снова откроет Chrome с расширением."
        )
    elif vf_ok_fresh and succ == 0:
        # VF отвечает, но ни один НАШ корабль не найден в bbox'е
        status = "degraded"
        message = (
            f"VesselFinder отвечает данные ({vf_ok} удачных запросов), но наши целевые "
            "корабли не попали в bbox-окна. Проверь IMO/MMSI у shipments."
        )
    elif total >= 10 and rate is not None and rate < VF_DEGRADED_SUCCESS_RATE and not vf_ok_fresh:
        status = "degraded"
        message = (
            f"Success rate {rate:.0%} на {total} попытках — возможны проблемы "
            "с bbox/судном/откликом VesselFinder."
        )

    return {
        "connected": True,
        "provider": "vesselfinder",
        "syncedAt": session.get("syncedAt"),
        "updatedAt": session.get("updatedAt"),
        "cookiesCount": len(session.get("cookies", [])),
        "pageUrl": session.get("pageUrl"),
        "userAgent": session.get("userAgent"),
        "successCount": succ,
        "failCount": fail,
        "vfFetchOkCount": vf_ok,
        "vfHealthRate": round(vf_health_rate, 3) if vf_health_rate is not None else None,
        "lastVfFetchOkAt": session.get("lastVfFetchOkAt"),
        "consecutiveFails": consecutive,
        "lastSuccessAt": session.get("lastSuccessAt"),
        "lastFailAt": session.get("lastFailAt"),
        "lastFailShipment": session.get("lastFailShipment"),
        "lastFailReason": session.get("lastFailReason"),
        "lastHeartbeatAt": session.get("lastHeartbeatAt"),
        "heartbeatAgeSec": int(hb_age_sec) if hb_age_sec is not None else None,
        "extensionVersion": session.get("extensionVersion"),
        "sessionStatus": status,
        "sessionMessage": message,
    }
