# BIBI VIN Parser Module

> **Module owner:** parser team · **Status:** production · **Version:** 4.1.x

This document set describes the **VIN Parser** module in BIBI Cars CRM —
its architecture, deployment, development, operations, and troubleshooting.
It lives under `/app/docs/parser/` (NOT in repo root) by design — every
major module owns its own docs subtree.

## Index

| Doc | Audience | Read when |
|---|---|---|
| [architecture.md](./architecture.md) | engineers, ops | onboarding, before refactoring |
| [deployment.md](./deployment.md) | ops, devops | first deploy, redeploy, scaling |
| [development.md](./development.md) | engineers | adding a new source / changing logic |
| [operations.md](./operations.md) | ops, on-call | daily monitoring, runbooks |
| [troubleshooting.md](./troubleshooting.md) | ops, on-call | something is broken |
| [api-reference.md](./api-reference.md) | engineers | wiring frontend / external clients |
| [chrome-extension.md](./chrome-extension.md) | ops, support | install / debug Chrome extension |

## TL;DR

The parser resolves a VIN (or LOT number) → vehicle data by querying multiple
independent sources in parallel and merging their answers. Sources are isolated
from each other: **if any one is up, the parser serves VINs**. Architecture
and each source are described in [architecture.md](./architecture.md).

## Quick start (operator)

```bash
# 1. Bootstrap the entire parser stack from scratch (idempotent — safe to re-run)
/app/scripts/parser-bootstrap.sh

# 2. Verify it is healthy
curl -s http://localhost:8001/api/control/overview | jq '.system'

# 3. Self-heal if a source got stuck (resets circuit breakers, restarts workers)
curl -s -X POST http://localhost:8001/api/parser/self-heal | jq
```

For GitHub-driven deploys the bootstrap is also wired through `.emergent/post-deploy.sh`
so it runs automatically on every fresh container.

## Source matrix

| Key | Tier | Bypasses CF? | Module | Started by |
|---|---|---|---|---|
| `bitmotors` | LIVE | n/a (direct) | `bitmotors_scraper.py` | live-only (per-query, no scheduler) |
| `westmotors` | INDEX | n/a (sitemap) | `westmotors_sync.py` | sitemap sync scheduler |
| `lemon` | INDEX | n/a (sitemap) | `lemon_sync.py` | discovery + lazy parser worker |
| `auctionauto` | HTTP | n/a | `auctionauto_scraper.py` | per-query, no scheduler |
| `extension` | EXT | **yes** (CF-bypass) | `chrome_extension/` + `multisource_resolver.py` | external Chrome agent |
| `statvin` | enrich | n/a | `statvin_scraper.py` | JIT enrichment per query |
| `vesselfinder` | track | n/a | `vesselfinder_scraper.py` | shipment tracking worker |

Deprecated (kept for back-compat, return 410 Gone): `carfast`, `bidcars`, `copart`, `iaai`.

## Stability guarantees

* **Source-level isolation.** A failing source does NOT take down the rest. Each is wrapped in its own circuit breaker (`vin_service.get_circuit_stats`).
* **Graceful module-load degradation.** If any scraper module can't import (missing dep, syntax error in a hot patch), the rest of the parser keeps serving — see `try/except` blocks at the top of `server.py`.
* **Self-healing.** Background workers reset stuck circuits every 5 min. Manual self-heal is one POST: `/api/parser/self-heal`.
* **Idempotent startup.** Re-running `parser-bootstrap.sh` against an already-running stack is safe; nothing is destroyed.
* **No mocked data.** All numbers in the dashboard come from live counters in `multisource_resolver._record()`.
