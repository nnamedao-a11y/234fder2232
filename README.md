# BIBI Cars CRM (V3.2)

Full-stack auto-import CRM for the Ukrainian / Bulgarian market. FastAPI +
React + MongoDB.

## Quick start

```bash
# Clone, then bootstrap the entire parser stack with one command:
/app/scripts/parser-bootstrap.sh

# Verify everything is healthy:
/app/scripts/parser-smoke-test.sh
```

On every fresh container `.emergent/post-deploy.sh` runs the bootstrap
automatically and logs to `/var/log/bibi-bootstrap.log`.

## Module documentation

Each major module owns its own subtree under `/app/docs/`:

| Module | Docs |
|---|---|
| **VIN Parser** (4 sources + Chrome ext + resolver) | [`/app/docs/parser/`](./docs/parser/README.md) |

The parser docs cover architecture, deployment, development, operations,
troubleshooting, API reference, and Chrome extension internals
([941 lines, 8 docs](./docs/parser/README.md)).

## Default admin

```
admin@bibi.cars  /  Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu
```

Re-seeded on every backend startup. Override via `BIBI_ADMIN_EMAIL` /
`BIBI_ADMIN_PASSWORD` in `backend/.env`.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/parser-bootstrap.sh` | One-command idempotent deploy (8 steps, ~5 s when warm) |
| `scripts/parser-smoke-test.sh` | Read-only health assertions, exit 0 on full pass |
| `.emergent/post-deploy.sh` | Auto-runs bootstrap on container creation |

## Structure

```
/app/
├── backend/                 FastAPI server, scrapers, Chrome extension src
│   ├── server.py            main app, ~19k lines, all /api/* routes
│   ├── multisource_resolver.py  parallel VIN resolver + circuit breakers
│   ├── bitmotors_scraper.py     LIVE source
│   ├── westmotors_sync.py       INDEX source
│   ├── lemon_sync.py            INDEX source
│   ├── auctionauto_scraper.py   HTTP source
│   ├── statvin_scraper.py       enrichment
│   ├── chrome_extension/        bundled extension files (zipped on demand)
│   └── .env
├── frontend/                React 19 + CRACO + Tailwind + shadcn
│   ├── src/pages/           admin + public pages
│   ├── src/components/      shared UI
│   └── .env
├── docs/parser/             ←  parser module documentation
├── scripts/                 deployment + smoke tests
└── .emergent/post-deploy.sh ←  auto-bootstrap hook
```
