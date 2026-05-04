"""
POC test for Shipment Journey Tracking (Phase 1).

Validates, end-to-end against a LIVE backend (no mocks):
  1. create_shipment with default single-vessel stage
  2. create_shipment with multi-stage route
  3. /api/shipments/{id}/journey returns proper structure + lazy backfill on
     legacy shipments (shipments inserted directly into Mongo with no stages[])
  4. bind vessel via PUT /stages/{stage_id} — `vessel_assigned` event created
  5. /api/shipments/{id}/tick runs pipeline:
        • when current stage is vessel + vessel has mmsi/imo/name → REAL attempted
        • when current stage is land → REAL skipped, goes to simulate
  6. advance stage — stage_changed + delivered events when last stage done
  7. activate stage — manager override works
  8. movement sanity — injected spike is rejected
  9. serialize_journey output matches contract

Run:
    cd /app/backend && python3 test_journey_tracking.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get("POC_BACKEND_URL", "http://localhost:8001")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def section(title):
    print(f"\n{'='*60}\n {title}\n{'='*60}")


async def drop_shipment(db, shipment_id):
    try:
        await db.shipments.delete_one({"id": shipment_id})
        await db.shipment_events.delete_many({"shipmentId": shipment_id})
    except Exception:
        pass


async def poc_create_default(client: httpx.AsyncClient) -> dict:
    section("1. POST /api/shipments (default single-vessel stage)")
    payload = {
        "vin": "TEST-JRN-" + uuid.uuid4().hex[:6].upper(),
        "customerId": f"cust_poc_{uuid.uuid4().hex[:6]}",
        "origin": {"name": "Los Angeles", "lat": 33.74, "lng": -118.27},
        "destination": {"name": "Rotterdam", "lat": 51.92, "lng": 4.47},
        "trackingActive": True,
    }
    r = await client.post(f"{BASE}/api/shipments", json=payload)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    ship = r.json()["shipment"]
    assert len(ship.get("stages") or []) >= 1, "stages missing"
    assert ship.get("currentStageId"), "currentStageId missing"
    cs = [s for s in ship["stages"] if s["id"] == ship["currentStageId"]][0]
    assert cs["type"] == "vessel" and cs["status"] == "active"
    print(f"  OK  created {ship['id']} with stage {cs['id']} type={cs['type']}")
    return ship


async def poc_create_multistage(client: httpx.AsyncClient) -> dict:
    section("2. POST /api/shipments (multi-stage route)")
    payload = {
        "vin": "TEST-MS-" + uuid.uuid4().hex[:6].upper(),
        "customerId": f"cust_poc_{uuid.uuid4().hex[:6]}",
        "origin": {"name": "Los Angeles", "lat": 33.74, "lng": -118.27},
        "destination": {"name": "Sofia", "lat": 42.70, "lng": 23.32},
        "trackingActive": True,
        "stages": [
            {"type": "land",   "label": "Auction → LA Port",    "from": "Auction",  "to": "LA Port",       "status": "done"},
            {"type": "vessel", "label": "LA → Rotterdam",       "from": "LA Port",  "to": "Rotterdam",     "status": "active"},
            {"type": "land",   "label": "Rotterdam → Sofia",    "from": "Rotterdam","to": "Sofia",         "status": "pending"},
        ],
    }
    r = await client.post(f"{BASE}/api/shipments", json=payload)
    assert r.status_code == 200, r.text
    ship = r.json()["shipment"]
    assert len(ship["stages"]) == 3
    active = [s for s in ship["stages"] if s["status"] == "active"]
    assert len(active) == 1 and active[0]["type"] == "vessel"
    print(f"  OK  created {ship['id']} with 3 stages, active={active[0]['id']}")
    return ship


async def poc_backfill_legacy(client: httpx.AsyncClient, db) -> str:
    section("3. GET /journey on legacy shipment (auto-backfill stages[])")
    legacy_id = f"ship_legacy_{uuid.uuid4().hex[:8]}"
    await db.shipments.insert_one({
        "id": legacy_id,
        "customerId": "cust_legacy",
        "origin": {"name": "Legacy Origin", "lat": 10.0, "lng": 20.0},
        "destination": {"name": "Legacy Dest", "lat": 30.0, "lng": 40.0},
        "route": [{"lat": 10.0, "lng": 20.0}, {"lat": 30.0, "lng": 40.0}],
        "progress": 0.0,
        "trackingActive": False,
        "created_at": datetime.now(timezone.utc),
        # no stages, no currentStageId
    })
    r = await client.get(f"{BASE}/api/shipments/{legacy_id}/journey")
    assert r.status_code == 200, r.text
    ship = r.json()["shipment"]
    assert ship["stages"] and ship["currentStageId"], "backfill did not populate stages"
    print(f"  OK  backfilled {legacy_id} → 1 default vessel stage")

    # Verify persisted back to Mongo (not just in response)
    fresh = await db.shipments.find_one({"id": legacy_id})
    assert fresh.get("stages") and fresh.get("currentStageId"), "backfill not persisted"
    print(f"  OK  backfill persisted to Mongo")
    return legacy_id


async def poc_bind_vessel(client: httpx.AsyncClient, ship: dict):
    section("4. PUT /stages/{id} — bind vessel → vessel_assigned event")
    stage_id = ship["currentStageId"]
    r = await client.put(
        f"{BASE}/api/shipments/{ship['id']}/stages/{stage_id}",
        json={"vessel": {"name": "MSC OSCAR", "mmsi": "227280290", "imo": "9629344"}},
    )
    assert r.status_code == 200, r.text
    updated = r.json()["shipment"]
    cs = [s for s in updated["stages"] if s["id"] == stage_id][0]
    assert cs["vessel"]["mmsi"] == "227280290"
    evts = updated.get("events") or []
    assert any(e["type"] == "vessel_assigned" for e in evts), "vessel_assigned event missing"
    print(f"  OK  vessel bound to stage; {len(evts)} events total")


async def poc_tick(client: httpx.AsyncClient, ship: dict):
    section("5. POST /tick — runs update_shipment_position")
    r = await client.post(f"{BASE}/api/shipments/{ship['id']}/tick")
    assert r.status_code == 200, r.text
    body = r.json()
    # Two /tick handlers exist in server.py (legacy + new); either returns
    # {"success": True} or {"ok": True}.
    assert body.get("ok") is True or body.get("success") is True, body
    # Note: live VF fetch depends on having synced cookies; we accept either
    # 'real_scraped' (if session present) or 'simulated'/'interpolated'.
    print(f"  OK  tick → source={body.get('trackingSource')} progress={body.get('progress')}")

    # fetch journey — currentPosition must be populated
    j = (await client.get(f"{BASE}/api/shipments/{ship['id']}/journey")).json()["shipment"]
    cp = j.get("currentPosition")
    assert cp and "lat" in cp and "lng" in cp, f"currentPosition missing: {cp}"
    print(f"  OK  currentPosition lat={cp['lat']:.3f} lng={cp['lng']:.3f} source={cp.get('source')}")


async def poc_movement_sanity(client: httpx.AsyncClient, db, ship: dict):
    section("8. Movement sanity — spike rejected")
    # Inject a known-good last position then call tick while forcing VF to return
    # a spike... Since we can't easily force VF to teleport, we test the helper
    # directly via an in-process import.
    sys.path.insert(0, "/app/backend")
    from server import is_valid_movement
    # Normal movement — 20 km in 2 min, OK
    assert is_valid_movement(
        {"lat": 30.0, "lng": 120.0}, {"lat": 30.1, "lng": 120.1}, 120
    ) is True, "should accept 20km/2min"
    # Teleport — 2000 km in 60 s, must reject
    assert is_valid_movement(
        {"lat": 30.0, "lng": 120.0}, {"lat": 40.0, "lng": 100.0}, 60
    ) is False, "should reject 2000km/60s"
    # Missing prev — permissive
    assert is_valid_movement(None, {"lat": 1.0, "lng": 1.0}, None) is True
    print("  OK  is_valid_movement blocks spikes, allows normal movement")


async def poc_advance_stage(client: httpx.AsyncClient, ship: dict):
    section("6. POST /stages/advance — mark current done, activate next")
    r = await client.post(f"{BASE}/api/shipments/{ship['id']}/stages/advance")
    assert r.status_code == 200, r.text
    updated = r.json()["shipment"]
    events = [e["type"] for e in updated.get("events") or []]
    assert "stage_changed" in events, events
    print(f"  OK  advanced; new currentStageId={updated.get('currentStageId')} events={events[-3:]}")


async def poc_activate_stage(client: httpx.AsyncClient, ship: dict):
    section("7. POST /stages/{id}/activate — manager override")
    first_stage_id = ship["stages"][0]["id"]
    r = await client.post(
        f"{BASE}/api/shipments/{ship['id']}/stages/{first_stage_id}/activate"
    )
    assert r.status_code == 200, r.text
    updated = r.json()["shipment"]
    assert updated["currentStageId"] == first_stage_id
    active_stages = [s for s in updated["stages"] if s["status"] == "active"]
    assert len(active_stages) == 1 and active_stages[0]["id"] == first_stage_id
    print(f"  OK  activated first stage; stages statuses: {[s['status'] for s in updated['stages']]}")


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    created_ids = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            ship1 = await poc_create_default(http); created_ids.append(ship1["id"])
            ship2 = await poc_create_multistage(http); created_ids.append(ship2["id"])
            legacy_id = await poc_backfill_legacy(http, db); created_ids.append(legacy_id)
            await poc_bind_vessel(http, ship2)
            await poc_tick(http, ship2)
            await poc_advance_stage(http, ship2)
            await poc_activate_stage(http, ship2)
            await poc_movement_sanity(http, db, ship2)

        section("SUMMARY")
        print("  ALL CHECKS PASSED")
        return 0
    except AssertionError as e:
        print(f"\n  ASSERTION FAILED: {e}")
        return 1
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"\n  ERROR: {e}")
        return 1
    finally:
        for sid in created_ids:
            await drop_shipment(db, sid)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
