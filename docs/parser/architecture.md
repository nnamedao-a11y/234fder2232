# Parser — Architecture

> **Goal:** Resolve a VIN/LOT into a structured vehicle record by querying
> multiple independent sources in parallel, then merging the best fields
> from each. **Any one source up = parser is up.**

## High-level diagram

```
  ┌────────────────────────────────────────────────────────────────────┐
  │                          FastAPI server.py                         │
  │                                                                    │
  │   /api/vin/* /api/lookup/* /api/control/overview /api/parser/*     │
  └──────────────────────────────┬─────────────────────────────────────┘
                                 │
     ┌───────────────────────────┴───────────────────────────────┐
     │                  multisource_resolver                     │
     │   • runs sources in parallel                              │
     │   • per-source circuit breaker                            │
     │   • field-level merge (FIELD_CONFIDENCE)                  │
     │   • observation cache (TTL 5 min)                         │
     │   • extension job queue                                   │
     └───────────────────────────┬───────────────────────────────┘
                                 │
   ┌────┬────────────────────────┴────────┬───────────────┬───────┐
   ▼    ▼                                 ▼               ▼       ▼
┌─────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌─────┐ ┌────────┐
│bitmotors│ │westmotors│ │   lemon    │ │auctionauto │ │ext. │ │statvin │
│  LIVE   │ │  INDEX   │ │   INDEX    │ │   HTTP     │ │ EXT │ │ enrich │
└─────────┘ └──────────┘ └────────────┘ └────────────┘ └──┬──┘ └────────┘
  bidmotors    westmotors   lemon-cars      auctionauto    │
  .bg sitemap   sitemap      sitemap         .org HTTP     │
                                                           │
                              ┌────────────────────────────┘
                              ▼
                  ┌─────────────────────────┐
                  │ Chrome Extension agent  │
                  │  (in operator browser)  │
                  │ • content scripts open  │
                  │   poctra/cfw/aah/sb     │
                  │ • parse DOM, POST back  │
                  │ • HMAC-signed payload   │
                  └─────────────────────────┘
```

## Tiers — what each one means

| Tier | Meaning | Latency | Always-on |
|---|---|---|---|
| **LIVE** | Scraper hits the source on each query, no caching layer in front | 1–4 s | ✓ |
| **INDEX** | Background worker rebuilds a sitemap-driven local index, queries hit Mongo | <100 ms | ✓ (after first sync) |
| **HTTP** | Pure HTTP scraper (no Playwright) | 0.5–2 s | ✓ |
| **EXT** | Operator's Chrome extension fans out to CF-protected sites | 3–10 s | only when ≥1 client online |
| **enrich** | Adds extra fields (sold history, price stats) on top of any other tier | +0.5 s | best-effort |

## Resolver chain order

```
LIVE → INDEX → HTTP → EXT (CF fallback)
```

The resolver **does not stop on first hit** — it queries them in parallel,
then merges. The chain order matters only for tie-breaking when two sources
return the same field with different values; higher-tier wins.

## Circuit breakers

Each source has an independent circuit breaker (`ttl_cache.py` + per-source
counters in `vin_service.get_circuit_stats`):

* **Closed** (normal): all calls go through.
* **Open** (failing): calls return immediately with `{circuit_open: true}` —
  source is excluded from this query, the other sources still run.
* **Half-open** (testing): every 60 s one probe is allowed; if it succeeds,
  the breaker closes again.

This means a slow / 503-spamming source can NEVER block the others.

## Field-level merge (V3.2 Field Intelligence)

When multiple sources return data for the same VIN, we **don't pick one
winner** — we pick the **best value per field**:

```python
field_score = session_score * field_confidence
```

where `FIELD_CONFIDENCE` is defined in `server.py`:

```
vin/make/model/year/images = 1.0  (anyone with data wins)
odometer/lot_number       = 0.95
damage/auction_name       = 0.85-0.9
location/color/engine     = 0.7-0.75
```

Result: a vehicle record can have its `vin` from BitMotors, `images` from
Lemon, `lot_number` from AuctionAuto, `sale_date` from Stat.vin — all in a
single merged document.

## Source isolation contract

Every source module **MUST** satisfy this contract or it WILL be excluded
from the live system:

1. **Failure budget.** A single bad call must not raise out of the source.
   Catch and return `None` / `{}`. Errors are recorded via
   `_record(src, error=...)`.
2. **Bounded latency.** Hard cap with `httpx.AsyncClient(timeout=...)` or
   `asyncio.wait_for`. Default budget: 10 s per call.
3. **No global state mutation outside `_record`.**
4. **Idempotent.** Calling `lookup(vin)` twice must be safe.
5. **Module-load resilience.** If your `import` fails, `server.py` already
   wraps it in `try/except ImportError` — DO NOT remove that wrapper.

See [development.md](./development.md) for the full add-a-source recipe.

## Data flow on a single VIN query

```
  POST /api/vin/lookup {vin}
       │
       ▼
  multisource_resolver.resolve(vin)   ◄── kicks all sources in parallel
       │
       ├── bitmotors.search_vin(vin)         (LIVE, ~2s)
       ├── westmotors.lookup(vin)            (INDEX, ~50ms)
       ├── lemon.lookup(vin)                 (INDEX, ~50ms)
       ├── auctionauto.lookup(vin)           (HTTP, ~1s)
       ├── extension_lookup(vin, capabilities) (EXT, ~5s)
       │      │
       │      ▼
       │   /api/ext/lookup → enqueue → wait_for_extension_results(timeout=10s)
       │   while waiting, extension polls /api/ext/jobs, opens hidden tab,
       │   POSTs DOM scrape via /api/ext/observation
       │
       └── statvin.enrich(merged_record)      (+0.5s)
       │
       ▼
  merge_results([...]) → MergedRecord
       │
       ▼
  return JSON
```

Budget: 10 s soft, 12 s hard (resolver returns whatever finished by then,
remaining sources are reaped by `_gc_locked()`).

## Persistence

| Collection | Purpose | TTL |
|---|---|---|
| `vin_data` | Merged records per VIN | indefinite (stale_marked_at if >24h) |
| `westmotors_state` | INDEX sync state | indefinite |
| `lemon_state` | INDEX sync state | indefinite |
| `search_logs` | Analytics: every lookup ever | indefinite (sharded by date) |
| `search_watchlist` | User-pending VIN watches | until notified |
| `audit` | Operator/admin audit trail | 90 days (TTL index) |
| `vf_meta`, `vf_raw` | VesselFinder shipment tracking | TTL based |
| `ext_clients` | Chrome agent registry | 14 days idle TTL |
| `ext_nonces` | HMAC replay protection | 5 min TTL |

## Live-only mode (current production setting)

Since April 2026 the parser runs in **live-only mode**:

* No autonomous BitMotors scraper loop (was: every 30 min).
* No daily full sync of ~55k pages.
* No hourly incremental top-pages worker.

**Why:** BidMotors is a real-time auction stream — anything cached is stale
within minutes. We rely on `live_search()` per query and use the local
`vin_data` only as a `STALE_FALLBACK` when BidMotors is unreachable.

The `search_watchlist` watcher (every 1 hour, `WATCHLIST_POLL_INTERVAL_SEC`)
is the only background loop touching BitMotors.
