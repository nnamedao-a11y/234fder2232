# Parser — API Reference

All endpoints below are prefixed with the API base (`{REACT_APP_BACKEND_URL}/api/`).

## Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/system/health` | basic liveness ping |
| GET | `/control/overview` | system status, all source rows, alerts, performance |
| GET | `/extension/info` | Chrome extension version, file size, HMAC secret, sources |
| GET | `/extension/download` | downloads `bibi-cars-extension.zip` (built fresh) |
| GET | `/parser/circuits` | per-source circuit breaker stats (read-only) |
| POST | `/parser/self-heal` | resets stuck breakers, kicks watchdogs (idempotent) |

## Admin only (require_master_admin)

| Method | Path | Purpose |
|---|---|---|
| POST | `/control/debug/probe` | Run a VIN through the resolver, see which source answered |
| GET | `/admin/chrome-extension/download` | same as `/extension/download` but auth-gated |
| GET | `/parser/admin/sources` | full source registry incl. disabled ones |
| POST | `/parser/admin/sources/{key}/enable` | flip enabled flag |
| POST | `/parser/admin/sources/{key}/disable` | flip disabled flag |

## VIN lookup (the actual product)

| Method | Path | Purpose |
|---|---|---|
| POST | `/vin/lookup` | resolve VIN through all sources, returns merged record |
| GET | `/vin/{vin}` | Mongo cached lookup (no fresh fetch) |
| GET | `/vin/search?q=...` | search by partial VIN/lot/title |

Request:
```json
{ "vin": "1HGCM82633A004352", "force_fresh": false, "include_history": true }
```

Response (truncated):
```json
{
  "vin": "1HGCM82633A004352",
  "merged": {
    "vin": "...", "make": "Honda", "model": "Accord", "year": 2003,
    "images": [...], "lot_number": "...", "price": ...,
    "sale_date": "2024-...", "damage": "..."
  },
  "field_sources": [
    {"field": "make",  "session_id": "bitmotors", "score": 1.0},
    {"field": "images", "session_id": "merged",   "score": 1.0}
  ],
  "sources_count": 3,
  "quality": "A+",
  "latency_ms": 2347
}
```

## Chrome extension contract

All requests below carry HMAC headers signed with `EXT_SHARED_SECRET`:

```
X-Ext-Client-Id: <stable client uuid>
X-Ext-Timestamp: <unix seconds>
X-Ext-Nonce: <16 random bytes hex>
X-Ext-Signature: hex(hmac_sha256(secret, body + timestamp + nonce))
```

| Method | Path | Purpose |
|---|---|---|
| POST | `/ext/register` | first-time client registration |
| POST | `/ext/heartbeat` | every 60 s, includes recent success_rate |
| GET | `/ext/jobs` | poll pending VIN lookup jobs (long-poll OK) |
| POST | `/ext/observation` | submit DOM-scraped result for a VIN |
| GET | `/ext/health` | unauthenticated client-side ping |
| GET | `/ext/clients` | (admin) list all registered clients |
| GET | `/ext/degraded` | clients with low success rate |
| GET | `/ext/drifting` | clients returning suspect data |
| POST | `/ext/lookup` | (operator) ad-hoc lookup that fans out via extension |
| GET | `/ext/result/{request_id}` | poll result of `/ext/lookup` |

## Calculator (sister module, same backend)

Documented separately — see top-level CRM docs. The parser does NOT call
the calculator and vice versa; they are isolated.
