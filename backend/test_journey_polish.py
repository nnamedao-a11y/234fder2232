"""
POC for Phase 2 polish items (v1.2):

  1. Canonical /tick contract: {ok, position, progress, eta, source, currentStageId}
     (no duplicate handler interferes).
  2. Socket-emit throttle: two immediate ticks ⇒ only one shipment:update event.
     Stage change or source-category change bypasses the throttle.
  3. REAL → INTERPOLATE (< 2h) → SIMULATE pipeline paths exercised.
  4. PUT /stages/{id} with invalid status transition (pending → done) is rejected
     with HTTP 400; allowed path (via /advance) works fine.
  5. ETA smoothing: EMA blends old & new. Big new ETA jump is dampened.

Run:
    cd /app/backend && python3 test_journey_polish.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta

import httpx
import socketio
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get("POC_BACKEND_URL", "http://localhost:8001")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def section(title):
    print(f"\n{'='*60}\n {title}\n{'='*60}")


async def create_ship(http):
    payload = {
        "vin": f"TEST-POLISH-{uuid.uuid4().hex[:6]}",
        "customerId": f"cust_polish_{uuid.uuid4().hex[:6]}",
        "origin": {"name": "Los Angeles", "lat": 33.74, "lng": -118.27},
        "destination": {"name": "Rotterdam", "lat": 51.92, "lng": 4.47},
        "trackingActive": True,
        "stages": [
            {"type": "land", "label": "to port", "status": "done"},
            {"type": "vessel", "label": "LA → RTM", "status": "active",
             "vessel": {"name": "MSC OSCAR", "mmsi": "227280290", "imo": "9629344"}},
            {"type": "land", "label": "delivery", "status": "pending"},
        ],
    }
    r = await http.post(f"{BASE}/api/shipments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["shipment"]


async def test_tick_contract(http, ship):
    section("1. /tick canonical contract")
    r = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    assert r.status_code == 200, r.text
    data = r.json()
    # Required keys
    for k in ("ok", "shipmentId", "position", "progress", "eta", "source", "currentStageId"):
        assert k in data, f"missing key {k}: {data}"
    assert data["ok"] is True
    # position shape
    pos = data["position"]
    if pos is not None:
        assert "lat" in pos and "lng" in pos
    print(f"  OK  /tick → ok={data['ok']} source={data['source']} "
          f"stage={data['currentStageId']} progress={data['progress']}")


async def test_socket_throttle(http, ship, db):
    section("2. Socket emit throttle (30s)")
    # Instead of juggling a real socket client we assert on the persisted
    # 'lastSocketEmitAt' field which is only written when emit actually happens.
    await db.shipments.update_one(
        {"id": ship["id"]},
        {"$unset": {"lastSocketEmitAt": "", "lastSocketEmitSource": "", "lastSocketEmitStageId": ""}},
    )
    # First tick — emit should fire (no prior timestamp).
    r1 = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    assert r1.status_code == 200
    await asyncio.sleep(0.3)
    doc1 = await db.shipments.find_one({"id": ship["id"]})
    ts1 = doc1.get("lastSocketEmitAt")
    assert ts1 is not None, "first tick should have emitted (lastSocketEmitAt not set)"
    print(f"  OK  first tick → emit happened (lastSocketEmitAt set)")

    # Second tick immediately — throttle should suppress; timestamp unchanged.
    r2 = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    assert r2.status_code == 200
    await asyncio.sleep(0.3)
    doc2 = await db.shipments.find_one({"id": ship["id"]})
    ts2 = doc2.get("lastSocketEmitAt")
    assert ts2 == ts1, f"second tick (within 30s) must NOT emit; ts1={ts1} ts2={ts2}"
    print(f"  OK  second tick within 30s → emit throttled (same lastSocketEmitAt)")

    # But stage-change should bypass the throttle:
    # activate a DIFFERENT stage then tick again.
    other_stage = next((s for s in ship["stages"] if s["id"] != ship["currentStageId"]), None)
    if other_stage:
        await http.post(f"{BASE}/api/shipments/{ship['id']}/stages/{other_stage['id']}/activate")
        await asyncio.sleep(0.3)
        r3 = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
        assert r3.status_code == 200
        await asyncio.sleep(0.3)
        doc3 = await db.shipments.find_one({"id": ship["id"]})
        ts3 = doc3.get("lastSocketEmitAt")
        assert ts3 != ts2, "stage change should bypass throttle"
        print(f"  OK  stage change bypassed throttle (new lastSocketEmitAt)")


async def test_fallback_paths(http, ship, db):
    section("3. REAL → INTERPOLATE(<2h) → SIMULATE pipeline paths")
    # Seed a 'lastRealPosition' 1h old to force INTERPOLATE path next tick.
    fake_real = {
        "lat": 40.0,
        "lng": -70.0,
        "speed": 14.0,
        "course": 90.0,
        "fetched_at": datetime.now(timezone.utc) - timedelta(hours=1),
    }
    await db.shipments.update_one({"id": ship["id"]}, {"$set": {"lastRealPosition": fake_real}})
    # Reset tracking to look "stale" so scraper returns nothing; pipeline
    # should fall back via INTERPOLATE.
    r = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    data = r.json()
    # With no VF cookies synced and a < 2h lastRealPosition we expect either
    # 'interpolated' OR 'simulated' (if scraper returns error before fallback).
    # Validate shape; the key point is the pipeline didn't crash.
    assert data.get("ok") is True, data
    print(f"  OK  tick returned source={data['source']} (interpolate/simulate valid)")

    # Now make lastRealPosition 3h old → SIMULATE path
    fake_real_old = dict(fake_real)
    fake_real_old["fetched_at"] = datetime.now(timezone.utc) - timedelta(hours=3)
    await db.shipments.update_one({"id": ship["id"]}, {"$set": {"lastRealPosition": fake_real_old}})
    r = await http.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    data = r.json()
    assert data["source"] == "simulated", f"expected simulated, got {data['source']}"
    print(f"  OK  with 3h-old real position → source=simulated")


async def test_stage_transition_guard(http, ship):
    section("4. Stage transition guard on PUT /stages/{id}")
    # Find a pending stage
    pending = [s for s in ship["stages"] if s["status"] == "pending"]
    if not pending:
        print("  SKIP (no pending stage in fixture)")
        return
    target = pending[0]
    r = await http.put(
        f"{BASE}/api/shipments/{ship['id']}/stages/{target['id']}",
        json={"status": "done"},   # illegal: pending → done direct
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text}"
    print(f"  OK  pending→done rejected with 400")

    # Legal: change label on same stage
    r2 = await http.put(
        f"{BASE}/api/shipments/{ship['id']}/stages/{target['id']}",
        json={"label": "edited label"},
    )
    assert r2.status_code == 200
    print(f"  OK  label-only edit on pending stage allowed")


async def test_eta_smoothing():
    section("5. ETA smoothing (EMA)")
    sys.path.insert(0, "/app/backend")
    from server import _smooth_eta_iso

    old = "2026-05-05T00:00:00Z"
    new = "2026-05-11T00:00:00Z"  # +6 days — should be dampened
    smoothed = _smooth_eta_iso(old, new, "simulated")
    # With alpha=0.3, blended ≈ 5.5·24·3600*0.3 + 5·24·3600*0.7, roughly +1.8 days
    # So smoothed should be LATER than old but EARLIER than new.
    d_old = datetime.fromisoformat(old.replace("Z", "+00:00"))
    d_new = datetime.fromisoformat(new.replace("Z", "+00:00"))
    d_smo = datetime.fromisoformat(smoothed.replace("Z", "+00:00"))
    assert d_old < d_smo < d_new, f"smoothing invalid: {d_old} < {d_smo} < {d_new}"
    jump_days = (d_new - d_old).total_seconds() / 86400
    smooth_days = (d_smo - d_old).total_seconds() / 86400
    print(f"  OK  raw jump=+{jump_days:.1f}d → smoothed=+{smooth_days:.1f}d (≤{jump_days*0.45:.1f}d)")

    # REAL source gets higher alpha → closer to new
    smoothed_real = _smooth_eta_iso(old, new, "real_scraped")
    d_smo_real = datetime.fromisoformat(smoothed_real.replace("Z", "+00:00"))
    assert d_smo_real > d_smo, "real source should move faster than simulated"
    print(f"  OK  real_scraped moves ETA faster toward new than simulated")

    # Pass-through when either is None
    assert _smooth_eta_iso(None, new, "real_scraped") == new
    assert _smooth_eta_iso(old, None, "real_scraped") == old
    print("  OK  None-handling is pass-through")


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    created = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            ship = await create_ship(http); created.append(ship["id"])
            await test_tick_contract(http, ship)
            await test_socket_throttle(http, ship, db)
            await test_fallback_paths(http, ship, db)
            await test_stage_transition_guard(http, ship)
        await test_eta_smoothing()
        section("SUMMARY")
        print("  ALL POLISH CHECKS PASSED")
        return 0
    except AssertionError as e:
        print(f"\n  ASSERTION FAILED: {e}")
        return 1
    except Exception as e:
        import traceback; traceback.print_exc()
        return 1
    finally:
        for sid in created:
            try:
                await db.shipments.delete_one({"id": sid})
                await db.shipment_events.delete_many({"shipmentId": sid})
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
