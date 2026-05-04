# Parser — Operations

## Daily checks (5 min)

```bash
curl -s http://localhost:8001/api/control/overview | jq '{
  status: .system.label,
  reason: .system.reason,
  primary_up: .system.primary_up,
  primary_down: .system.primary_down,
  ext_online: .extension.online,
  alerts: .alerts
}'
```

Green criteria:
* `status == "OK"` OR (`status == "PARTIAL"` AND `primary_up | length >= 1`)
* `alerts | length == 0` OR contains only the standard "no extension clients" message

Red criteria — escalate immediately:
* `status == "DEGRADED"` (no primary sources up)
* `primary_up | length == 0`
* Multiple unhealthy clients in `extension.clients[].unhealthy`

## Runbook: source went down

1. **Identify the source** — check `/api/control/overview` `sources[]`.
2. **Look at recent errors:** `tail -n 200 /var/log/supervisor/backend.err.log | grep -i <source>`
3. **Test it directly:** see [development.md](./development.md) → Testing locally.
4. **Reset its circuit breaker:** `curl -X POST http://localhost:8001/api/parser/self-heal`
5. **If still down >15 min:** disable it temporarily in admin UI
   (`/admin/parser/settings`) so it stops counting against system status.
6. **File ticket** with grep'd logs + last successful timestamp.

## Runbook: extension shows 0 clients

This is **not critical** — primary sources still serve VINs. The 4
CF-protected sources (poctra/cfw/aah/salvagebid) are temporarily offline.

Fix:
1. Operator should open Chrome → check the BIBI extension popup.
2. If popup shows "Помічник не з'єднаний з CRM" — the extension lost its
   stored Backend URL. Re-enter on settings tab.
3. If popup is fine but admin still shows 0 clients — `EXT_SHARED_SECRET`
   in `/app/backend/.env` was rotated. Get the new secret from
   `/admin/parser?tab=extension` (HMAC секрет copy button) and re-paste
   into the extension popup.
4. Re-install: visit `/admin/parser?tab=extension` → Скачати ZIP →
   in `chrome://extensions/` remove old, load fresh unpacked.

## Runbook: parser hangs / VIN queries time out

Usually one slow source is dragging everyone down because someone
disabled the parallel fan-out (it's supposed to be parallel).

1. Check `tail -f /var/log/supervisor/backend.err.log` for `WARN` /
   `ERROR` rate.
2. `curl http://localhost:8001/api/control/overview | jq '.sources[] | select(.latency_p95_ms > 5000)'`
   identifies who's slow.
3. Self-heal: `POST /api/parser/self-heal`.
4. If it persists, restart the backend: `sudo supervisorctl restart backend`.
   This costs ~5 s of downtime — VIN queries fail-fast during that window.

## Runbook: MongoDB collection grew too large

```bash
mongosh bibi_cars --eval 'db.audit.stats(1024*1024).size'         # MB
mongosh bibi_cars --eval 'db.search_logs.stats(1024*1024).size'   # MB
mongosh bibi_cars --eval 'db.vin_data.stats(1024*1024).size'      # MB
```

* `audit` has a 90-day TTL — should self-trim. If not, check index:
  `db.audit.getIndexes()`.
* `search_logs` keeps everything (used for analytics). Manual archive
  if > 1 GB: `db.search_logs.deleteMany({ts: {$lt: <90d_ago>}})`.
* `vin_data` is intentionally kept indefinitely — vehicle records are
  the product. **Do not bulk-delete.**

## Logs to watch

| Log | What it tells you | grep recipe |
|---|---|---|
| `/var/log/supervisor/backend.out.log` | startup banners, startup() flow | `grep -E 'STARTUP|✓\|✗'` |
| `/var/log/supervisor/backend.err.log` | exceptions, warnings | `grep -E 'ERROR|WARNING'` |
| `/var/log/supervisor/frontend.err.log` | webpack compile errors | `grep -i 'error\|failed'` |
| `/var/log/bibi-bootstrap.log` | bootstrap script output | only on deploy |

## Performance baseline (production)

* `/api/system/health` p99 < 50 ms
* `/api/control/overview` p99 < 250 ms
* `/api/vin/lookup` p50 < 3 s, p95 < 8 s, p99 < 12 s (parallel sources)
* `/api/calculator/calculate` p99 < 100 ms
* MongoDB `vin_data.find_one({vin})` p99 < 20 ms with index

If p95 of `/api/vin/lookup` > 10 s, run the runbook above.
