# Parser — Deployment

## Quick deploy (any environment)

One command bootstraps the entire stack:

```bash
/app/scripts/parser-bootstrap.sh
```

This script is **idempotent** — running it twice is the same as running it
once. It is also **non-destructive** — it never drops collections.

What it does (in order):

1. **Sanity-check the host.** Verifies `python3`, `pip`, `node`, `yarn`,
   `mongosh`, `supervisorctl` are present.
2. **Verify env files.** `/app/backend/.env` must contain `MONGO_URL`,
   `JWT_SECRET`, `EXT_SHARED_SECRET`, `CORS_ORIGINS`. If any are missing,
   the script writes safe defaults and stops, asking you to review.
3. **Install Python deps** from `/app/backend/requirements.txt` (skips
   already-satisfied packages).
4. **Install Playwright browsers** if missing (`PLAYWRIGHT_BROWSERS_PATH=/pw-browsers`).
   Default: chromium headless shell only.
5. **Install frontend deps** via `yarn install --silent` if `node_modules` missing.
6. **Restart supervisor services** (`backend`, `frontend`).
7. **Health check** — polls `/api/system/health` and `/api/control/overview`
   for up to 30 s. Fails loudly with the failing endpoint URL if unhealthy.
8. **Source warm-up** — calls each source's lookup once with a known good
   VIN (`DUMMY_VIN_TEST`) to populate circuit-breaker stats and exit
   half-open state. Doesn't fail the script if a source is down.

Exit codes:
* `0` — all green.
* `1` — required env var missing (script writes a `.env.example`, edits expected).
* `2` — supervisor service didn't come back up.
* `3` — health check failed after 30 s.
* `4` — system dependency missing (no Python / no MongoDB).

## Deployment from GitHub

The `.emergent/post-deploy.sh` hook runs automatically on every fresh
container creation. It:

1. Calls `/app/scripts/parser-bootstrap.sh`.
2. Logs full output to `/var/log/bibi-bootstrap.log`.
3. Never blocks the container's normal supervisor startup — even if
   bootstrap fails, the rest of the system still boots.

### First-time GitHub setup

When cloning fresh into a new container:

```bash
# 1. Clone the repo into /app (assumed pre-existing if using Emergent)
git clone https://github.com/<owner>/<repo>.git /tmp/source
rsync -a --exclude='.env' --exclude='node_modules' /tmp/source/ /app/

# 2. Bootstrap
/app/scripts/parser-bootstrap.sh

# 3. (Optional) seed admin if first deploy
# Default admin is auto-seeded on backend startup — see startup() in server.py:1842
# admin@bibi.cars / Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu
```

## Required environment variables

Live at `/app/backend/.env`:

| Var | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URL` | yes | `mongodb://localhost:27017` | MongoDB connection |
| `DB_NAME` | no | `bibi_cars` | Database name |
| `JWT_SECRET` | yes (prod) | random / dev placeholder | Admin auth & WebSocket auth |
| `EXT_SHARED_SECRET` | yes (for ext) | random | HMAC for Chrome extension |
| `CORS_ORIGINS` | yes | preview URL | Comma-separated whitelist |
| `BIBI_ADMIN_EMAIL` | no | `admin@bibi.cars` | Override seeded admin email |
| `BIBI_ADMIN_PASSWORD` | no | (hard-coded fallback) | Override seeded admin pwd |
| `WATCHLIST_POLL_INTERVAL_SEC` | no | `3600` | Watchlist live-poll cadence |
| `WATCHLIST_POLL_BATCH` | no | `20` | VINs per poll cycle |
| `EXT_AUTH_MODE` | no | `enabled` | Set `disabled` to skip HMAC in dev |

**The `frontend/.env` `REACT_APP_BACKEND_URL` and `MONGO_URL` MUST NOT be
edited** — they are managed by the platform.

## Restarting individual components

```bash
# Just backend (parser core)
sudo supervisorctl restart backend

# Just frontend
sudo supervisorctl restart frontend

# Both
sudo supervisorctl restart backend frontend

# Hot self-heal — resets stuck circuit breakers without restart
curl -X POST http://localhost:8001/api/parser/self-heal
```

## Rollback

```bash
# In Emergent UI: use the "Rollback to checkpoint" button.
# Manually:
cd /app && git log --oneline -10        # find last good commit
cd /app && git reset --hard <sha>
/app/scripts/parser-bootstrap.sh         # re-bootstrap
```

## Health-check endpoints (for external monitoring)

| URL | What it checks | Use for |
|---|---|---|
| `GET /api/system/health` | basic ping | uptime monitor |
| `GET /api/control/overview` | per-source status + system reason | dashboard |
| `GET /api/extension/info` | Chrome agent file & secret | install page |
| `POST /api/parser/self-heal` | reset circuits + restart workers | runbook |

All four are **unauthenticated by design** so external monitors can poll
them. Mutating endpoints under `/api/parser/admin/*` require master_admin.
