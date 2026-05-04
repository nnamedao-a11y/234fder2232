# Parser — Troubleshooting

## Symptom → Diagnosis matrix

| Symptom | Likely cause | First action |
|---|---|---|
| `/api/control/overview` returns 500 | DB down or bad startup | `tail -n 100 backend.err.log` |
| All sources `status: down` | Network egress blocked at host | `curl -v https://google.com` |
| 1 source `status: down`, others ok | Source is broken or blocked us | Self-heal (see below) |
| `system.label: DEGRADED` (red) | Zero primary sources up | All sources `status: down` runbook |
| `system.label: PARTIAL` + ext offline | Normal — operator extension not online | Extension runbook in [operations.md](./operations.md) |
| Popup hangs on "Перевірка стану…" | Old extension version (v3.x / v4.0) | Reinstall fresh ZIP |
| Chrome shows red icon "could not load" | manifest.json corrupted in zip | Re-download ZIP |
| `/api/extension/download` 404 | `chrome_extension/` dir missing in container | Re-deploy from GitHub |
| Login fails for `admin@bibi.cars` | password rotated or DB wiped | See "Auth recovery" below |
| Backend won't start: `ImportError: bitmotors_scraper` | playwright-stealth missing | `pip install playwright-stealth==2.0.3` |
| `httpx.RemoteProtocolError` flood in logs | upstream Cloudflare 429 | Wait 5 min, breaker auto-recovers |

## Self-heal commands

```bash
# Resets all circuit breakers, restarts watchdogs (no downtime)
curl -s -X POST http://localhost:8001/api/parser/self-heal | jq

# Hard restart — backend (5s downtime, parser fully reinitializes)
sudo supervisorctl restart backend

# Reload .env without code restart (only env vars in os.environ.get())
sudo supervisorctl signal SIGHUP backend
```

## Auth recovery

Backed-in admin credentials live at `/app/backend/server.py` lines
1849-1864 (DEFAULTS dict). On every backend startup, `seed_staff()` runs
and:

* Creates the 3 staff accounts if missing.
* **Force-resets the password hash** to match the hard-coded default.
* Re-enables disabled accounts.

So if login is broken — **just restart backend**:

```bash
sudo supervisorctl restart backend
sleep 6
curl -s -X POST http://localhost:8001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bibi.cars","password":"Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"}' | jq .access_token
```

If you want to override defaults set `BIBI_ADMIN_EMAIL` /
`BIBI_ADMIN_PASSWORD` in `/app/backend/.env` and restart.

## Diagnostic one-liners

```bash
# Are services up?
sudo supervisorctl status

# Is the parser actually answering?
time curl -s http://localhost:8001/api/control/overview > /dev/null

# Are circuit breakers stuck open?
curl -s http://localhost:8001/api/parser/circuits | jq

# Detailed source health
curl -s http://localhost:8001/api/control/overview | jq '.sources[] | {key, status, calls, errors, p95: .latency_p95_ms}'

# Live MongoDB connection sanity
mongosh bibi_cars --quiet --eval 'db.runCommand({ping:1})'

# Disk pressure?
df -h /app /var/log

# Memory pressure?
free -h
```

## When to escalate

File a P1 ticket immediately if:
* `status: DEGRADED` for > 10 min after running the source-down runbook.
* `/api/system/health` returns 5xx for > 30 s.
* MongoDB ping fails.
* `/var/log/supervisor/backend.err.log` shows OOM kills.

File a P2 within 24 h if:
* One source has been `status: down` for > 1 h.
* p95 latency on `/api/vin/lookup` > 10 s.
* Daily error rate > 5 %.
