# Parser — Development guide

> Read [architecture.md](./architecture.md) first — it explains the
> isolation contract every source must satisfy.

## Adding a new source

Follow these 5 steps. Estimate: 30–90 min for a well-behaved HTTP source,
2–4 h for a Cloudflare-protected site that needs the Chrome extension.

### 1. Create the scraper module

File: `/app/backend/<source>_scraper.py` (or `_sync.py` for INDEX-tier sources).

Minimum API:

```python
import httpx, logging
from typing import Optional, Dict, Any

logger = logging.getLogger('bibi-<source>')

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

async def lookup(vin: str) -> Optional[Dict[str, Any]]:
    """Resolve VIN → vehicle dict. Return None if not found OR on error."""
    if not vin or len(vin) != 17:
        return None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as c:
            r = await c.get(f'https://example.com/lookup?vin={vin}')
            if r.status_code != 200:
                return None
            return _parse(r.text, vin)
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        logger.warning(f'[<source>] {vin}: {e}')
        return None  # NEVER raise — isolation contract

def _parse(html: str, vin: str) -> Optional[Dict[str, Any]]:
    # ... DOM/regex extraction ...
    return {
        'vin': vin,
        'make': ..., 'model': ..., 'year': ...,
        'source': '<source>',
        'source_url': ...,
    }
```

### 2. Wire it into the resolver

Edit `/app/backend/multisource_resolver.py`, find the parallel-fan-out
section, add:

```python
from <source>_scraper import lookup as <source>_lookup

async def resolve(vin: str, ...) -> Dict[str, Any]:
    tasks = [
        # ... existing ...
        _wrap('<source>', <source>_lookup(vin)),
    ]
    ...
```

The `_wrap` helper records latency + error counters in `_record(src, ...)`.

### 3. Register the source in PARSER_REGISTRY

Edit `/app/backend/server.py`, find `PARSER_REGISTRY` (around line 744):

```python
PARSER_REGISTRY = {
    # ...
    "<source>": ParserEntry(
        source="<source>",
        name="<Source Name>",
        type="http",  # or "playwright" or "extension" or "passive"
        enabled=True,
        status="active",
        readiness="ready",
        readiness_detail="...",
        endpoints=["/api/<source>/lookup"],
    ),
}
```

### 4. Add it to the dashboard control overview

Edit `/app/backend/server.py` `control_overview()` (line ~12611). Add a row
in the `rows.append(...)` section so the source appears in the admin UI.

Do NOT add it to the `extension` aggregate (line 12663) unless it is a
Cloudflare-bypass capability handled by the Chrome extension.

### 5. Add it to the popup probe (only if it's CF-protected)

If the source is CF-protected and you added it to the Chrome extension:

* Update `/app/backend/chrome_extension/manifest.json` `host_permissions`
  and `content_scripts` matchers.
* Drop a `<source>.js` file into `/app/backend/chrome_extension/sites/`
  matching the existing 4 there.
* Update `/app/backend/chrome_extension/popup.js` `SOURCES` array with
  the public URLs to probe.
* Update `/app/backend/chrome_extension/popup.html` source-row block.

The ZIP is built fresh by `/api/extension/download` on each request, so
you don't have to re-zip manually.

## Testing locally

```bash
# Direct module test (skip resolver)
python3 -c "
import asyncio
from <source>_scraper import lookup
print(asyncio.run(lookup('1HGCM82633A004352')))
"

# End-to-end through resolver
curl -s -X POST http://localhost:8001/api/control/debug/probe \
  -H 'Authorization: Bearer <admin-jwt>' \
  -d '{"query":"1HGCM82633A004352"}' | jq

# Watch source health update
watch -n 2 'curl -s http://localhost:8001/api/control/overview | jq ".sources[].label, .sources[].status"'
```

## Code review checklist

Before merging a new source / scraper change:

* [ ] No bare `except:` — always `except SpecificError:` or `except Exception as e:`.
* [ ] All HTTP calls have an explicit timeout (≤ 10 s).
* [ ] All loops over external data have a hard upper-bound (`limit=1000`).
* [ ] `lookup()` returns `None` (never raises) on any error.
* [ ] Logger uses `logging.getLogger('bibi-<source>')`.
* [ ] No hardcoded secrets / API keys — read from `os.environ`.
* [ ] Module imports in `server.py` are wrapped in `try/except ImportError`
      with a logged warning so a broken module doesn't kill startup.
* [ ] Added a circuit-breaker entry in `vin_service.get_circuit_stats()` if
      the source has multiple endpoints (search vs page).
* [ ] Updated `/app/docs/parser/architecture.md` source matrix.

## Common pitfalls

* **Don't use `requests`** — only `httpx.AsyncClient`. The whole resolver is
  asyncio; a sync `requests` call will block the event loop and stall every
  other in-flight VIN query.
* **Don't share an `httpx.AsyncClient` across calls.** Always create per-call
  inside `async with` — connection pooling is fine, but a long-lived client
  leaks connections in some Cloudflare scenarios.
* **Don't trust upstream JSON.** Always validate types: `int(d.get('year', 0))`.
* **Don't log raw HTML.** Use `len(html)` or first 200 chars max.
* **Don't add another scheduler.** The system already has too many — if your
  source needs background sync, queue it through the existing
  `lemon_sync.LemonSync.lazy_parser_worker` pattern.
