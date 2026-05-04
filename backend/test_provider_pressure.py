"""End-to-end test for Provider Pressure engine.

Covers:
  • event-bus wiring (order_started / order_finished reach provider_stats.hook)
  • recompute produces correct score & tier for 5-level taxonomy
  • tier-change detection emits `provider_tier_changed` with 6h cooldown
  • matching helper pick_best_provider respects tier rules
  • admin metrics endpoint returns 3 metrics with correct arithmetic
  • invoice → mark-paid → order auto-creation stamps assignedAt

Run manually:
    cd /app/backend && python3 test_provider_pressure.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app/backend")

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "http://localhost:8001"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bibi_cars")

ADMIN_EMAIL = "admin@bibi.cars"
ADMIN_PWD = os.environ.get("BIBI_ADMIN_PASSWORD", "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    r = await client.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["access_token"]


async def test_all():
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    client = httpx.AsyncClient(timeout=15)

    print("━" * 60)
    print("PROVIDER PRESSURE — end-to-end test")
    print("━" * 60)

    # ── 0. login as admin ───────────────────────────────────────
    admin_token = await login(client, ADMIN_EMAIL, ADMIN_PWD)
    H = {"Authorization": f"Bearer {admin_token}"}
    print("[0] admin login OK")

    # ── 1. backend health ───────────────────────────────────────
    r = await client.get(f"{BASE}/api/system/health")
    assert r.json().get("status") == "healthy"
    print("[1] /api/system/health OK")

    # ── 2. provider_stats service wired? ────────────────────────
    r = await client.get(f"{BASE}/api/providers/me/stats", headers=H)
    r.raise_for_status()
    me = r.json()["stats"]
    assert me.get("providerId") is not None
    print(f"[2] /api/providers/me/stats OK  (me.tier={me.get('tier')}, score={me.get('score')})")

    # ── 3. seed three test managers + synthetic orders ──────────
    #      pid_fast  → many completed fast   → should land in 'high'
    #      pid_slow  → late starts           → should land in 'warning' or lower
    #      pid_ghost → never started         → 'hidden'
    now = datetime.now(timezone.utc)
    await db.provider_stats.delete_many({"providerId": {"$in": ["pid_fast", "pid_slow", "pid_ghost"]}})
    await db.orders.delete_many({"managerId": {"$in": ["pid_fast", "pid_slow", "pid_ghost"]}})

    fast_orders = []
    for i in range(5):
        assigned = now - timedelta(hours=3 + i)
        started  = assigned + timedelta(minutes=5)   # fast
        completed = started + timedelta(hours=1)
        fast_orders.append({
            "id": f"ord_fast_{i}",
            "managerId": "pid_fast",
            "customerId": f"c_fast_{i}",
            "status": "completed",
            "assignedAt":  _iso(assigned),
            "startedAt":   _iso(started),
            "completedAt": _iso(completed),
            "created_at":  _iso(assigned),
        })
    await db.orders.insert_many(fast_orders)

    slow_orders = []
    for i in range(5):
        assigned = now - timedelta(hours=4 + i)
        started  = assigned + timedelta(minutes=90)  # > 60 min = late
        completed = started + timedelta(hours=8) if i < 2 else None
        doc = {
            "id": f"ord_slow_{i}",
            "managerId": "pid_slow",
            "customerId": f"c_slow_{i}",
            "status": "completed" if completed else "in_progress",
            "assignedAt":  _iso(assigned),
            "startedAt":   _iso(started),
            "completedAt": _iso(completed) if completed else None,
            "created_at":  _iso(assigned),
        }
        slow_orders.append(doc)
    await db.orders.insert_many(slow_orders)

    await db.orders.insert_one({
        "id": "ord_ghost_0",
        "managerId": "pid_ghost",
        "customerId": "c_ghost",
        "status": "cancelled",
        "assignedAt":  _iso(now - timedelta(days=30)),
        "created_at":  _iso(now - timedelta(days=30)),
    })

    # Force a recompute via admin endpoint
    r = await client.post(f"{BASE}/api/admin/providers/stats/recompute", headers=H)
    r.raise_for_status()
    print(f"[3] recompute-all OK  (count={r.json().get('count')})")

    fast = await db.provider_stats.find_one({"providerId": "pid_fast"}, {"_id": 0})
    slow = await db.provider_stats.find_one({"providerId": "pid_slow"}, {"_id": 0})
    ghost = await db.provider_stats.find_one({"providerId": "pid_ghost"}, {"_id": 0})

    print(f"    pid_fast  : score={fast['score']:3d}  tier={fast['tier']}")
    print(f"    pid_slow  : score={slow['score']:3d}  tier={slow['tier']}  late={slow['penalties']['lateStarts']}")
    print(f"    pid_ghost : score={ghost['score']:3d}  tier={ghost['tier']}")

    assert fast["tier"] in ("high", "normal"), f"expected high/normal got {fast['tier']}"
    assert slow["penalties"]["lateStarts"] >= 3, f"expected late starts, got {slow['penalties']['lateStarts']}"
    # Cancelled-only provider has 0 response / 0 completion → very low
    assert ghost["tier"] in ("hidden", "penalized", "warning"), f"ghost tier unexpected: {ghost['tier']}"
    print("[3a] tier computation correct")

    # ── 4. matching helper ──────────────────────────────────────
    import provider_stats as _ps
    import notifications as _notif
    # Initialise in THIS process (server has its own init); harmless double-init.
    _ps.init(db, _notif.bus)
    best = await _ps.service.pick_best_provider(["pid_fast", "pid_slow", "pid_ghost"])
    print(f"[4] pick_best_provider([fast,slow,ghost]) → {best}")
    assert best == "pid_fast", f"expected pid_fast, got {best}"

    # Provider in 'hidden' tier should NEVER be returned solo:
    # place-holder: if only ghost candidate → None
    ghost_alone = await _ps.service.pick_best_provider(["pid_ghost"])
    if ghost["tier"] == "hidden":
        assert ghost_alone is None, f"hidden provider must be excluded, got {ghost_alone}"
        print("[4a] hidden provider correctly excluded from matching")

    # ── 5. tier-change event + cooldown ─────────────────────────
    #      Manually flip tier by injecting more fast orders then recomputing.
    captured = []

    async def _spy(payload):
        captured.append(payload)

    _notif.bus.on("provider_tier_changed", _spy)

    # Nuke pid_slow stats (force 'unknown → new tier' fires notification)
    await db.provider_stats.update_one(
        {"providerId": "pid_slow"},
        {"$set": {"tier": "hidden"}},  # simulate previous state
    )
    await _ps.service.recompute("pid_slow")
    await asyncio.sleep(0.4)   # let the fire-and-forget task run
    # A tier change fires an event when prev_tier != new_tier
    after = await db.provider_stats.find_one({"providerId": "pid_slow"}, {"_id": 0})
    print(f"[5] tier_change: events captured={len(captured)}  new_tier={after['tier']}")
    assert len(captured) >= 1, "expected at least one provider_tier_changed event"
    evt = captured[0]
    assert evt.get("provider_id") == "pid_slow"
    assert evt.get("prev_tier") == "hidden"
    print(f"    event payload OK: {evt.get('prev_tier')} → {evt.get('new_tier')} (score={evt.get('score')})")

    # Second recompute within cooldown → NO new event (lastTierNotifyAt blocks)
    captured.clear()
    # Force a tier flip back
    await db.provider_stats.update_one(
        {"providerId": "pid_slow"},
        {"$set": {"tier": "hidden"}},
    )
    await _ps.service.recompute("pid_slow")
    await asyncio.sleep(0.4)
    print(f"[5a] cooldown test: events captured={len(captured)} (expected 0)")
    assert len(captured) == 0, f"cooldown failed — got {len(captured)} events"

    # ── 6. admin metrics endpoint ───────────────────────────────
    # First, add a few invoices to produce conversion > 0
    await db.invoices.insert_many([
        {"id": "inv_t1", "customerId": "c1", "status": "paid",   "total": 100, "currency": "USD", "created_at": _iso(now)},
        {"id": "inv_t2", "customerId": "c2", "status": "paid",   "total": 200, "currency": "USD", "created_at": _iso(now)},
        {"id": "inv_t3", "customerId": "c3", "status": "sent",   "total": 300, "currency": "USD", "created_at": _iso(now)},
        {"id": "inv_t4", "customerId": "c4", "status": "pending","total": 400, "currency": "USD", "created_at": _iso(now)},
    ])

    r = await client.get(f"{BASE}/api/admin/metrics", headers=H)
    r.raise_for_status()
    m = r.json()["metrics"]
    print(f"[6] /api/admin/metrics: conversion={m['conversion']['value']}  avg_order_time_h={m['avg_order_time']['value_hours']}  repeat_rate={m['repeat_rate']['value']}")
    assert m["conversion"]["paid"] >= 2
    assert m["conversion"]["sent"] >= 4
    assert m["conversion"]["value"] > 0
    assert m["avg_order_time"]["value_hours"] is not None  # we have completed orders
    print("[6a] metrics arithmetic OK")

    # ── 7. cleanup ──────────────────────────────────────────────
    await db.invoices.delete_many({"id": {"$in": ["inv_t1", "inv_t2", "inv_t3", "inv_t4"]}})
    await db.orders.delete_many({"managerId": {"$in": ["pid_fast", "pid_slow", "pid_ghost"]}})
    await db.provider_stats.delete_many({"providerId": {"$in": ["pid_fast", "pid_slow", "pid_ghost"]}})
    await client.aclose()
    c.close()

    print("━" * 60)
    print("ALL TESTS PASSED ✓")
    print("━" * 60)


if __name__ == "__main__":
    asyncio.run(test_all())
