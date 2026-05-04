"""
Multi-Source Resolver — Phase 2.

Wraps the existing chain in ``vin_service.get_car_by_vin`` with the
additional sources requested in the architecture brief:

   CACHE
   → BitMotors SEARCH       (in vin_service)
   → WestMotors INDEX       (in vin_service)
   → Lemon INDEX            (in vin_service)
   → AuctionAuto HTTP       (this module)
   → Extension layer        (this module — async push from Chrome ext)
   → BitMotors PAGE         (in vin_service)
   → NOT_FOUND

The extension layer is asynchronous: the backend hands the VIN to a
pending-jobs queue (``_ext_queue``).  The browser extension polls
``GET /api/ext/jobs`` (or receives push via the existing v3 channel)
and uploads its parsed payload to ``POST /api/ext/push``.  That push
populates ``_ext_results`` indexed by request_id; the resolver waits
up to ``EXT_WAIT_SEC`` for the first arrival, then merges everything
that came back.

Public functions:
    enqueue_extension_job(vin) -> request_id
    take_pending_job() -> (request_id, vin) | None
    push_extension_result(request_id, payload)
    wait_for_extension_results(request_id, timeout) -> List[dict]
    extension_lookup(vin, timeout) -> Optional[dict]
    merge_results(items) -> dict
    get_health_snapshot() -> dict
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger("multisource")

EXT_WAIT_SEC = 4.0           # max seconds to wait for any extension reply
EXT_RESULT_TTL = 300         # results cleaned up after 5 min
EXT_QUEUE_TTL = 60           # pending job TTL

# Phase 8.1 — multi-client registry
CLIENT_ONLINE_WINDOW = 90      # seconds since last heartbeat to count as online
CLIENT_REGISTRY_TTL = 86400    # drop client entirely after 24h of silence

# Phase 9.1 — silent-death detection
CLIENT_RATE_WINDOW = 600       # rolling window (sec) for success-rate calc
CLIENT_RATE_MIN_SAMPLE = 5     # don't enforce gate before N jobs in window
CLIENT_MIN_SUCCESS_RATE = 0.3  # below this a client is "unhealthy"

# Phase 9.2 — silent data drift
SOURCE_DRIFT_WINDOW = 50       # rolling window of validations per source
SOURCE_DRIFT_MIN_SAMPLE = 8    # don't flag drift before this many results
SOURCE_DRIFT_MAX_INVALID = 0.6 # >60% invalid → mark source as drifting

# Phase 8.2 — event-driven observation cache (push warming)
OBSERVATION_TTL = 1800         # 30 minutes
OBSERVATION_MAX = 10000

# Phase 8.3 — health-based routing
MAX_P95_MS_DEFAULT = 2500      # skip a source whose P95 > this
HEALTH_GATE_MIN_SAMPLE = 5     # only enforce after N observations

# Sources we know we need to try via the extension. Order = priority
# inside the extension fan-out (the resolver still merges all replies).
EXTENSION_SOURCES = ("poctra", "carsfromwest", "autoauctionhistory", "salvagebid")

# ─────────────────────────────────────────────────────────────────
# Internal state
# ─────────────────────────────────────────────────────────────────
# Pending jobs the extension will pull / be notified about.
# Each entry: (request_id, vin, expected_sources, created_at)
_ext_queue: Deque[Tuple[str, str, Tuple[str, ...], float]] = deque()
# Results pushed back from content scripts, indexed by request_id.
# Each: { source: { ...payload..., received_at: float } }
_ext_results: Dict[str, Dict[str, Dict[str, Any]]] = {}
# Per-request_id event used for resolver wakeup.
_ext_events: Dict[str, asyncio.Event] = {}
# Queue lock
_lock = asyncio.Lock()

# ─────────────────────────────────────────────────────────────────
# Lightweight metrics for /api/multisource/health
# ─────────────────────────────────────────────────────────────────
_metrics: Dict[str, Dict[str, Any]] = {
    src: {
        "calls": 0,
        "hits": 0,
        "errors": 0,
        "latencies_ms": [],
        "last_error": None,
        "last_success_at": None,
    }
    for src in EXTENSION_SOURCES + ("auctionauto",)
}


def _record(src: str, *, hit: bool = False, error: Optional[str] = None,
            latency_ms: Optional[float] = None) -> None:
    m = _metrics.setdefault(src, {
        "calls": 0, "hits": 0, "errors": 0,
        "latencies_ms": [], "last_error": None, "last_success_at": None,
    })
    m["calls"] += 1
    if hit:
        m["hits"] += 1
        m["last_success_at"] = time.time()
    if error:
        m["errors"] += 1
        m["last_error"] = error[:200]
    if latency_ms is not None:
        m["latencies_ms"].append(float(latency_ms))
        if len(m["latencies_ms"]) > 50:
            m["latencies_ms"].pop(0)


# ═════════════════════════════════════════════════════════════════
# AuctionAuto httpx wrapper
# ═════════════════════════════════════════════════════════════════
async def auctionauto_lookup(vin: str) -> Optional[Dict[str, Any]]:
    """Wrap auctionauto_scraper.lookup_vin with metrics."""
    try:
        from auctionauto_scraper import lookup_vin as _lookup
    except Exception as e:
        logger.error("[multisource] auctionauto module not available: %s", e)
        _record("auctionauto", error=str(e))
        return None

    t0 = time.time()
    try:
        res = await _lookup(vin)
        latency = (time.time() - t0) * 1000
        _record("auctionauto", hit=res is not None, latency_ms=latency)
        return res
    except Exception as e:  # noqa: BLE001
        latency = (time.time() - t0) * 1000
        _record("auctionauto", error=str(e), latency_ms=latency)
        return None


# ═════════════════════════════════════════════════════════════════
# Extension layer
# ═════════════════════════════════════════════════════════════════
async def enqueue_extension_job(
    vin: str, sources: Optional[Tuple[str, ...]] = None
) -> str:
    """Add a VIN lookup job to the extension queue, return request_id."""
    request_id = uuid.uuid4().hex
    sources = sources or EXTENSION_SOURCES
    async with _lock:
        _ext_queue.append((request_id, vin, sources, time.time()))
        _ext_results[request_id] = {}
        _ext_events[request_id] = asyncio.Event()
        _gc_locked()
    return request_id


async def take_pending_jobs(limit: int = 10) -> List[Dict[str, Any]]:
    """Extension polls this to see what to look up.  Each job is yielded
    once; the result is uploaded back via push_extension_result()."""
    async with _lock:
        out: List[Dict[str, Any]] = []
        kept: Deque[Tuple[str, str, Tuple[str, ...], float]] = deque()
        now = time.time()
        while _ext_queue and len(out) < limit:
            rid, vin, sources, created = _ext_queue.popleft()
            if (now - created) > EXT_QUEUE_TTL:
                # stale: drop, no result coming
                _ext_results.pop(rid, None)
                _ext_events.pop(rid, None)
                continue
            out.append({
                "request_id": rid,
                "vin": vin,
                "sources": list(sources),
                "created_at": created,
            })
        # anything we did not pick (limit reached) goes back
        kept.extend(_ext_queue)
        _ext_queue.clear()
        _ext_queue.extend(kept)
        _gc_locked()
        return out


async def push_extension_result(request_id: str, payload: Dict[str, Any]) -> bool:
    """Content script reports a parsed lot for a given request_id.

    ``payload`` MUST include ``source`` (one of EXTENSION_SOURCES or any
    other label) and SHOULD include ``vin`` plus parsed fields.
    """
    src = (payload or {}).get("source") or "unknown"
    payload = dict(payload or {})
    payload["received_at"] = time.time()
    async with _lock:
        bucket = _ext_results.setdefault(request_id, {})
        bucket[src] = payload
        ev = _ext_events.get(request_id)
        if ev is not None:
            ev.set()
        # Even if a stale request, still record metrics for ops insight.
        _record(src, hit=True)
    return True


async def wait_for_extension_results(
    request_id: str, timeout: float = EXT_WAIT_SEC
) -> List[Dict[str, Any]]:
    """Wait until at least one extension reply arrives or timeout fires.

    Returns the list of payloads collected so far.
    """
    ev = _ext_events.get(request_id)
    if ev is None:
        return []
    try:
        await asyncio.wait_for(ev.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    async with _lock:
        bucket = _ext_results.get(request_id, {})
        return list(bucket.values())


async def extension_lookup(
    vin: str, *, timeout: float = EXT_WAIT_SEC,
    sources: Optional[Tuple[str, ...]] = None,
) -> Optional[Dict[str, Any]]:
    """Submit a job to the extension and merge whatever replies arrive."""
    rid = await enqueue_extension_job(vin, sources=sources)
    payloads = await wait_for_extension_results(rid, timeout=timeout)
    # cleanup
    async with _lock:
        _ext_results.pop(rid, None)
        _ext_events.pop(rid, None)
    if not payloads:
        return None
    return merge_results(payloads)


# ═════════════════════════════════════════════════════════════════
# Merge logic
# ═════════════════════════════════════════════════════════════════
# Per-source priority for picking the "primary" record. Lower = better.
_PRIORITY: Dict[str, int] = {
    "AUCTIONAUTO": 1,
    "poctra": 2,
    "carsfromwest": 3,
    "autoauctionhistory": 4,
    "salvagebid": 5,
    # legacy v3 source labels
    "SEARCH": 0, "WESTMOTORS": 0, "LEMON": 0,
}

# Fields where richer wins (keep value with most images / non-empty value)
_KEEP_BEST = {"images", "image_count", "title", "year", "make", "model",
              "odometer_km", "engine_l", "fuel", "current_bid_usd",
              "buy_now_usd", "sold_price_usd", "damage", "location",
              "auction", "sale_date", "lot", "url", "vin"}


def _is_better(existing: Any, candidate: Any, field: str) -> bool:
    if candidate in (None, "", []):
        return False
    if existing in (None, "", []):
        return True
    if field == "images" and isinstance(existing, list) and isinstance(candidate, list):
        return len(candidate) > len(existing)
    if field == "image_count" and isinstance(existing, int) and isinstance(candidate, int):
        return candidate > existing
    return False


def merge_results(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pick the highest-priority record as primary, then enrich it with
    fields from other sources if they are richer.
    """
    if not items:
        return {}
    sorted_items = sorted(
        items, key=lambda d: _PRIORITY.get((d.get("source") or "").strip(), 99)
    )
    primary = dict(sorted_items[0])
    secondaries = sorted_items[1:]
    primary["sources"] = [primary.get("source")] + [
        s.get("source") for s in secondaries if s.get("source")
    ]
    for sec in secondaries:
        for k, v in sec.items():
            if k not in _KEEP_BEST:
                continue
            if _is_better(primary.get(k), v, k):
                primary[k] = v
    return primary


# ═════════════════════════════════════════════════════════════════
# Health / introspection
# ═════════════════════════════════════════════════════════════════
def get_health_snapshot() -> Dict[str, Any]:
    out: Dict[str, Any] = {"sources": {}}
    for src, m in _metrics.items():
        sample = sorted(m.get("latencies_ms") or [])
        n = len(sample)
        if n:
            p50 = int(sample[n // 2])
            p95 = int(sample[max(0, int(n * 0.95) - 1)])
        else:
            p50 = p95 = 0
        calls = m.get("calls", 0)
        hits = m.get("hits", 0)
        errors = m.get("errors", 0)
        out["sources"][src] = {
            "calls": calls,
            "hits": hits,
            "errors": errors,
            "hit_ratio": round(hits / calls, 3) if calls else 0.0,
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
            "sample_size": n,
            "last_error": m.get("last_error"),
            "last_success_at": m.get("last_success_at"),
        }
    out["queue_depth"] = len(_ext_queue)
    out["results_in_flight"] = len(_ext_events)
    out["timestamp"] = int(time.time())
    return out


# ═════════════════════════════════════════════════════════════════
# GC
# ═════════════════════════════════════════════════════════════════
def _gc_locked() -> None:
    """Clean up stale results / events. Caller holds _lock."""
    now = time.time()
    stale = []
    for rid, bucket in _ext_results.items():
        # the bucket carries ``received_at`` per source — the oldest
        # wins for GC.
        last = max(
            (p.get("received_at") or 0) for p in bucket.values()
        ) if bucket else 0
        # If the bucket is empty (job pending) check the queue created_at
        if not bucket:
            for rid2, _v, _s, created in _ext_queue:
                if rid2 == rid:
                    last = created
                    break
        if last and (now - last) > EXT_RESULT_TTL:
            stale.append(rid)
    for rid in stale:
        _ext_results.pop(rid, None)
        _ext_events.pop(rid, None)


# ═══════════════════════════════════════════════════════════════════
# Phase 8.1 — Multi-client registry (fix Extension SPOF)
# ═══════════════════════════════════════════════════════════════════
#
# Each Chrome extension instance registers a stable client_id (uuid in
# chrome.storage.local) and capabilities (which sites it can parse).
# A heartbeat every 60 s keeps the entry "online".  The resolver only
# enqueues jobs when at least one online client advertises the target
# capability; otherwise the source is skipped immediately.
# ═══════════════════════════════════════════════════════════════════
_clients: Dict[str, Dict[str, Any]] = {}


def register_client(
    client_id: str,
    *,
    label: Optional[str] = None,
    capabilities: Optional[List[str]] = None,
    version: Optional[str] = None,
) -> Dict[str, Any]:
    """Idempotent registration of an extension instance."""
    cid = (client_id or "").strip()
    if not cid:
        return {"ok": False, "error": "client_id required"}
    now = time.time()
    rec = _clients.get(cid) or {
        "client_id": cid,
        "registered_at": now,
        "jobs_received": 0,
        "observations_pushed": 0,
        "results_pushed": 0,
    }
    if label:
        rec["label"] = label[:80]
    if version:
        rec["version"] = version[:32]
    rec["capabilities"] = sorted({c for c in (capabilities or []) if isinstance(c, str)})
    rec["last_seen_at"] = now
    rec["online"] = True
    _clients[cid] = rec
    _gc_clients()
    return {"ok": True, "client": rec}


def client_heartbeat(
    client_id: str,
    *,
    online: bool = True,
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Refresh last_seen_at for a known client."""
    cid = (client_id or "").strip()
    if not cid:
        return {"ok": False, "error": "client_id required"}
    rec = _clients.get(cid)
    if not rec:
        # auto-register so a freshly installed extension does not need
        # a separate /register call
        return register_client(cid, capabilities=(extras or {}).get("capabilities"))
    rec["last_seen_at"] = time.time()
    rec["online"] = bool(online)
    if extras:
        for k, v in extras.items():
            if k in {"version", "label"} and isinstance(v, str):
                rec[k] = v[:80]
    return {"ok": True, "client": rec}


def _is_online(rec: Dict[str, Any]) -> bool:
    if not rec.get("online", True):
        return False
    last = rec.get("last_seen_at") or 0
    return (time.time() - last) <= CLIENT_ONLINE_WINDOW


def get_clients() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    now = time.time()
    for rec in _clients.values():
        snap = dict(rec)
        snap["online"] = _is_online(rec)
        snap["age_sec"] = int(now - (rec.get("last_seen_at") or now))
        # Phase 9 enrichment — same fields exposed via /api/ext/health
        cid = rec.get("client_id") or ""
        # Note: client_success_rate / is_client_unhealthy may be defined
        # later in this module (Phase 9 block); guard against import
        # ordering by using getattr lookup.
        srfn = globals().get("client_success_rate")
        unfn = globals().get("is_client_unhealthy")
        snap["success_rate_recent"] = srfn(cid) if callable(srfn) else None
        snap["unhealthy"] = bool(unfn(cid)) if callable(unfn) else False
        # Strip internal deques from public payload
        snap.pop("jobs_received_at", None)
        snap.pop("successes_at", None)
        out.append(snap)
    out.sort(key=lambda r: (-int(r["online"]), r.get("client_id") or ""))
    return out


def online_clients_for(capability: str) -> List[Dict[str, Any]]:
    return [
        rec for rec in _clients.values()
        if _is_online(rec) and capability in (rec.get("capabilities") or [])
    ]


def has_online_client_for(capability: str) -> bool:
    return any(online_clients_for(capability))


def _gc_clients() -> None:
    now = time.time()
    stale = [
        cid for cid, rec in _clients.items()
        if (now - (rec.get("last_seen_at") or 0)) > CLIENT_REGISTRY_TTL
    ]
    for cid in stale:
        _clients.pop(cid, None)


# ═══════════════════════════════════════════════════════════════════
# Phase 8.2 — Event-driven scraping cache (push warming)
# ═══════════════════════════════════════════════════════════════════
#
# Extensions push observations of any lot they happen to render
# (browsing CFW/Poctra/etc) regardless of whether the backend asked
# for it.  The resolver consults this cache *before* spawning a new
# extension job — if the user opens a VIN already seen in the last
# 30 minutes, we return the stored payload synchronously (latency 0).
# ═══════════════════════════════════════════════════════════════════
_observations: Dict[str, List[Dict[str, Any]]] = {}


def cache_observation(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "payload must be object"}
    vin = (payload.get("vin") or "").strip().upper()
    if not vin or len(vin) != 17:
        return {"ok": False, "error": "vin must be 17 chars"}
    src = (payload.get("source") or "unknown").strip()
    enriched = dict(payload)
    enriched["vin"] = vin
    enriched["source"] = src
    enriched["observed_at"] = time.time()
    bucket = _observations.setdefault(vin, [])
    # de-dupe: replace existing entry from same source with the fresher one
    bucket[:] = [b for b in bucket if b.get("source") != src]
    bucket.append(enriched)
    # Track who pushed it
    cid = payload.get("client_id")
    if cid and cid in _clients:
        _clients[cid]["observations_pushed"] = (
            _clients[cid].get("observations_pushed", 0) + 1
        )
        _clients[cid]["last_seen_at"] = time.time()
        _clients[cid]["online"] = True
    _gc_observations()
    return {"ok": True, "vin": vin, "source": src, "stored": len(bucket)}


def lookup_observation(vin: str) -> Optional[Dict[str, Any]]:
    """Return merged observation cached for VIN, or None."""
    vin = (vin or "").strip().upper()
    if not vin or vin not in _observations:
        return None
    now = time.time()
    bucket = [
        b for b in _observations[vin]
        if (now - (b.get("observed_at") or 0)) <= OBSERVATION_TTL
    ]
    if not bucket:
        _observations.pop(vin, None)
        return None
    _observations[vin] = bucket
    merged = merge_results(bucket)
    merged["from_cache"] = "observation"
    return merged


def _gc_observations() -> None:
    now = time.time()
    # Drop expired entries first
    for vin, bucket in list(_observations.items()):
        fresh = [
            b for b in bucket
            if (now - (b.get("observed_at") or 0)) <= OBSERVATION_TTL
        ]
        if fresh:
            _observations[vin] = fresh
        else:
            _observations.pop(vin, None)
    # If still oversized, evict oldest VINs
    if len(_observations) > OBSERVATION_MAX:
        ordered = sorted(
            _observations.items(),
            key=lambda kv: max((b.get("observed_at") or 0) for b in kv[1]),
        )
        for vin, _ in ordered[: len(_observations) - OBSERVATION_MAX]:
            _observations.pop(vin, None)


# ═══════════════════════════════════════════════════════════════════
# Phase 8.3 — Health-based routing
# ═══════════════════════════════════════════════════════════════════
#
# A degraded source is skipped (returns None) until its rolling P95
# drops back below MAX_P95_MS or until its sample is reset.
# The gate only kicks in once we have HEALTH_GATE_MIN_SAMPLE
# observations to avoid throttling on a single slow request.
# ═══════════════════════════════════════════════════════════════════
def is_degraded(src: str, *, max_p95_ms: int = MAX_P95_MS_DEFAULT) -> bool:
    m = _metrics.get(src)
    if not m:
        return False
    sample = m.get("latencies_ms") or []
    if len(sample) < HEALTH_GATE_MIN_SAMPLE:
        return False
    # Compute P95 cheaply
    s = sorted(sample)
    idx = max(0, int(len(s) * 0.95) - 1)
    return s[idx] > max_p95_ms


def degraded_sources(*, max_p95_ms: int = MAX_P95_MS_DEFAULT) -> List[str]:
    return [src for src in _metrics if is_degraded(src, max_p95_ms=max_p95_ms)]


# ───────────────────────────────────────────────────────────────────
# Wire health-gate into auctionauto_lookup + extension_lookup
# ───────────────────────────────────────────────────────────────────
async def auctionauto_lookup_gated(vin: str) -> Optional[Dict[str, Any]]:
    if is_degraded("auctionauto"):
        logger.info("[multisource] auctionauto skipped (degraded P95)")
        _record("auctionauto", error="skipped_degraded")
        return None
    return await auctionauto_lookup(vin)


async def extension_lookup_gated(
    vin: str, *, timeout: float = EXT_WAIT_SEC,
    sources: Optional[Tuple[str, ...]] = None,
) -> Optional[Dict[str, Any]]:
    """Variant that:
       1. checks the observation cache first (instant push-warming hit)
       2. filters out capabilities for which no client is online
       3. skips degraded sources
       4. enqueues a job only for the surviving capability list
    """
    obs = lookup_observation(vin)
    if obs:
        _record("ext_observation_cache", hit=True, latency_ms=0.0)
        return obs

    candidates = list(sources or EXTENSION_SOURCES)
    healthy = [s for s in candidates if not is_degraded(s)]
    online = [s for s in healthy if has_online_client_for(s)]
    if not online:
        logger.info(
            "[multisource] no online ext clients for %s (healthy=%s)",
            candidates, healthy,
        )
        return None
    return await extension_lookup(vin, timeout=timeout, sources=tuple(online))


# Update health snapshot to expose new dimensions
_orig_get_health = get_health_snapshot


def get_health_snapshot() -> Dict[str, Any]:  # type: ignore[no-redef]
    snap = _orig_get_health()
    snap["clients"] = get_clients()
    snap["online_clients"] = sum(1 for c in snap["clients"] if c.get("online"))
    snap["degraded_sources"] = degraded_sources()
    snap["observation_cache_size"] = sum(len(v) for v in _observations.values())
    snap["observation_cache_vins"] = len(_observations)
    return snap



# ═══════════════════════════════════════════════════════════════════
# Phase 9.1 — Silent-death detection per extension client
# ═══════════════════════════════════════════════════════════════════
#
# Heartbeat alone is not enough: Chrome can be open and the worker
# alive while content scripts silently fail (CF challenge, DOM swap,
# permissions revoked, …).  We track the rolling last-10-minutes
# ratio of jobs the client received to results it actually pushed.
# A client whose ratio drops below CLIENT_MIN_SUCCESS_RATE is flagged
# unhealthy and excluded from future job dispatches even though it
# keeps heart-beating.
# ═══════════════════════════════════════════════════════════════════
_job_owner: Dict[str, str] = {}  # request_id → client_id who pulled the job


def _ensure_rate_buckets(rec: Dict[str, Any]) -> None:
    if "jobs_received_at" not in rec:
        rec["jobs_received_at"] = []
    if "successes_at" not in rec:
        rec["successes_at"] = []


def _trim_rate_buckets(rec: Dict[str, Any]) -> None:
    cutoff = time.time() - CLIENT_RATE_WINDOW
    rec["jobs_received_at"] = [t for t in rec.get("jobs_received_at", []) if t >= cutoff]
    rec["successes_at"] = [t for t in rec.get("successes_at", []) if t >= cutoff]


def _record_client_job(client_id: str) -> None:
    rec = _clients.get(client_id)
    if not rec:
        return
    _ensure_rate_buckets(rec)
    rec["jobs_received_at"].append(time.time())
    rec["jobs_received"] = rec.get("jobs_received", 0) + 1
    _trim_rate_buckets(rec)


def _record_client_success(client_id: str) -> None:
    rec = _clients.get(client_id)
    if not rec:
        return
    _ensure_rate_buckets(rec)
    rec["successes_at"].append(time.time())
    rec["results_pushed"] = rec.get("results_pushed", 0) + 1
    _trim_rate_buckets(rec)


def client_success_rate(client_id: str) -> Optional[float]:
    rec = _clients.get(client_id)
    if not rec:
        return None
    _ensure_rate_buckets(rec)
    _trim_rate_buckets(rec)
    jobs_n = len(rec["jobs_received_at"])
    if jobs_n < CLIENT_RATE_MIN_SAMPLE:
        return None
    return round(min(1.0, len(rec["successes_at"]) / max(1, jobs_n)), 3)


def is_client_unhealthy(client_id: str) -> bool:
    rate = client_success_rate(client_id)
    if rate is None:
        return False
    return rate < CLIENT_MIN_SUCCESS_RATE


def online_clients_for_v2(capability: str) -> List[Dict[str, Any]]:
    """Online + healthy clients advertising the capability."""
    return [
        rec for rec in _clients.values()
        if _is_online(rec)
        and capability in (rec.get("capabilities") or [])
        and not is_client_unhealthy(rec.get("client_id") or "")
    ]


def has_healthy_client_for(capability: str) -> bool:
    return any(online_clients_for_v2(capability))


# ═══════════════════════════════════════════════════════════════════
# Phase 9.2 — Silent data drift validation
# ═══════════════════════════════════════════════════════════════════
_drift_buckets: Dict[str, "Deque[bool]"] = {}


def _drift_bucket(src: str) -> "Deque[bool]":
    bucket = _drift_buckets.get(src)
    if bucket is None:
        bucket = deque(maxlen=SOURCE_DRIFT_WINDOW)
        _drift_buckets[src] = bucket
    return bucket


def validate_result(data: Optional[Dict[str, Any]]) -> bool:
    """Reject parser garbage. Required: 17-char VIN AND (title-with-year
    OR make+model). Photos optional — observation cache may legitimately
    arrive without images."""
    if not isinstance(data, dict):
        return False
    vin = (data.get("vin") or "").strip().upper()
    if len(vin) != 17:
        return False
    title = (data.get("title") or "").strip()
    make = (data.get("make") or "").strip()
    model = (data.get("model") or "").strip()
    year = data.get("year")
    has_title = bool(title) and (year is not None or any(c.isdigit() for c in title))
    has_yymm = bool(make and model)
    return has_title or has_yymm


def record_validation(src: str, valid: bool) -> None:
    bucket = _drift_bucket(src)
    bucket.append(bool(valid))


def source_drift_ratio(src: str) -> Optional[float]:
    bucket = _drift_buckets.get(src)
    if not bucket or len(bucket) < SOURCE_DRIFT_MIN_SAMPLE:
        return None
    invalid = sum(1 for v in bucket if not v)
    return round(invalid / len(bucket), 3)


def is_source_drifting(src: str) -> bool:
    ratio = source_drift_ratio(src)
    return ratio is not None and ratio >= SOURCE_DRIFT_MAX_INVALID


def drifting_sources() -> List[str]:
    return [s for s in _drift_buckets if is_source_drifting(s)]


# ───────────────────────────────────────────────────────────────────
# Hook validation into auctionauto + ext push + observation
# ───────────────────────────────────────────────────────────────────
_orig_auctionauto_lookup = auctionauto_lookup


async def auctionauto_lookup(vin: str) -> Optional[Dict[str, Any]]:  # type: ignore[no-redef]
    res = await _orig_auctionauto_lookup(vin)
    if res is None:
        return None
    valid = validate_result(res)
    record_validation("auctionauto", valid)
    if not valid:
        logger.warning("[multisource] auctionauto invalid payload for %s", vin)
        _record("auctionauto", error="validation_failed")
        return None
    return res


_orig_push_extension_result = push_extension_result


async def push_extension_result(request_id: str, payload: Dict[str, Any]) -> bool:  # type: ignore[no-redef]
    src = (payload or {}).get("source") or "unknown"
    valid = validate_result(payload)
    record_validation(src, valid)
    if not valid:
        logger.info(
            "[multisource] dropped invalid push from %s for rid=%s vin=%s",
            src, request_id, (payload or {}).get("vin"),
        )
        return False

    ok = await _orig_push_extension_result(request_id, payload)

    cid = (payload or {}).get("client_id")
    if cid:
        _record_client_success(cid)
    elif request_id in _job_owner:
        _record_client_success(_job_owner[request_id])
    _job_owner.pop(request_id, None)
    return ok


_orig_cache_observation = cache_observation


def cache_observation(payload: Dict[str, Any]) -> Dict[str, Any]:  # type: ignore[no-redef]
    src = (payload or {}).get("source") or "unknown"
    valid = validate_result(payload)
    record_validation(src, valid)
    if not valid:
        return {
            "ok": False,
            "error": "validation_failed",
            "drift_ratio": source_drift_ratio(src),
        }
    return _orig_cache_observation(payload)


_orig_take_jobs = take_pending_jobs


async def take_pending_jobs(  # type: ignore[no-redef]
    limit: int = 10, *, client_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    jobs = await _orig_take_jobs(limit=limit)
    if client_id:
        for j in jobs:
            _job_owner[j["request_id"]] = client_id
            _record_client_job(client_id)
    return jobs


# ───────────────────────────────────────────────────────────────────
# Combined gate: include drift in the source-skip decision
# ───────────────────────────────────────────────────────────────────
_orig_is_degraded = is_degraded


def is_degraded(src: str, *, max_p95_ms: int = MAX_P95_MS_DEFAULT) -> bool:  # type: ignore[no-redef]
    if _orig_is_degraded(src, max_p95_ms=max_p95_ms):
        return True
    return is_source_drifting(src)


async def auctionauto_lookup_gated(vin: str) -> Optional[Dict[str, Any]]:  # type: ignore[no-redef]
    if is_degraded("auctionauto"):
        logger.info("[multisource] auctionauto skipped (degraded P95/drift)")
        _record("auctionauto", error="skipped_degraded")
        return None
    return await auctionauto_lookup(vin)


async def extension_lookup_gated(  # type: ignore[no-redef]
    vin: str, *, timeout: float = EXT_WAIT_SEC,
    sources: Optional[Tuple[str, ...]] = None,
) -> Optional[Dict[str, Any]]:
    obs = lookup_observation(vin)
    if obs:
        _record("ext_observation_cache", hit=True, latency_ms=0.0)
        return obs
    candidates = list(sources or EXTENSION_SOURCES)
    healthy = [s for s in candidates if not is_degraded(s)]
    online = [s for s in healthy if has_healthy_client_for(s)]
    if not online:
        logger.info(
            "[multisource] no healthy ext clients for %s (healthy=%s)",
            candidates, healthy,
        )
        return None
    return await extension_lookup(vin, timeout=timeout, sources=tuple(online))


# ───────────────────────────────────────────────────────────────────
# Health snapshot enrichment (Phase 9)
# ───────────────────────────────────────────────────────────────────
_orig_get_health_v8 = get_health_snapshot


def get_health_snapshot() -> Dict[str, Any]:  # type: ignore[no-redef]
    snap = _orig_get_health_v8()
    for c in snap.get("clients", []):
        cid = c.get("client_id") or ""
        rate = client_success_rate(cid)
        c["success_rate_recent"] = rate
        c["unhealthy"] = is_client_unhealthy(cid)
    for src, info in snap.get("sources", {}).items():
        info["drift_ratio"] = source_drift_ratio(src)
        info["drifting"] = is_source_drifting(src)
    snap["drifting_sources"] = drifting_sources()
    return snap

