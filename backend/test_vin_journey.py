"""
POC / regression test for VIN-centric vessel journey tracking.

Validates the ENTIRE flow:
  1. Create shipment with VIN
  2. POST /api/shipments/{id}/vessel — first bind (ship A) → stage unchanged,
     vessel merged into active stage.
  3. POST /api/shipments/{id}/vessel — same ship again → merge (no new stage),
     optional container added.
  4. POST /api/shipments/{id}/vessel — DIFFERENT ship (B) → creates a NEW
     vessel stage, previous stage is marked done (history preserved!).
  5. POST /api/shipments/bind-by-vin — VIN lookup + bind works.
  6. POST /api/shipments/{id}/transfer-vessel — always creates new stage.
  7. GET /api/shipments/{id}/vessel-history — full vessel history derived
     from stages.

Run:
    cd /app/backend && python3 test_vin_journey.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

BASE = os.environ.get("POC_BACKEND_URL", "http://localhost:8001")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def section(title: str) -> None:
    print(f"\n{'=' * 60}\n {title}\n{'=' * 60}")


async def main() -> int:
    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]
    vin = f"TEST-VIN-{uuid.uuid4().hex[:8].upper()}"
    created_ids: list[str] = []

    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            # ---------- 1. Create shipment ----------
            section(f"1. Create shipment for VIN={vin}")
            payload = {
                "vin": vin,
                "customerId": f"cust_vin_{uuid.uuid4().hex[:6]}",
                "origin": {"name": "Los Angeles", "lat": 33.74, "lng": -118.27},
                "destination": {"name": "Rotterdam", "lat": 51.92, "lng": 4.47},
                "trackingActive": True,
            }
            r = await http.post(f"{BASE}/api/shipments", json=payload)
            assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
            ship = r.json()["shipment"]
            ship_id = ship["id"]
            created_ids.append(ship_id)
            print(f"  OK  created {ship_id} stages={len(ship['stages'])}")
            assert len(ship["stages"]) >= 1
            initial_stages = len(ship["stages"])

            # ---------- 2. First bind — Ship A ----------
            section("2. Bind Ship A (MSC OSCAR) — merges into active stage")
            r = await http.post(
                f"{BASE}/api/shipments/{ship_id}/vessel",
                json={"name": "MSC OSCAR", "mmsi": "227280290", "imo": "9629344"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True, body
            assert body["createdNewStage"] is False, f"should MERGE on first bind: {body}"
            assert body["vesselStagesCount"] >= 1
            print(f"  OK  merged into active stage; "
                  f"vessel stages={body['vesselStagesCount']}")

            # ---------- 3. Rebind same ship + add container ----------
            section("3. Rebind MSC OSCAR + container MSKU1234567")
            r = await http.post(
                f"{BASE}/api/shipments/{ship_id}/vessel",
                json={
                    "name": "MSC OSCAR",
                    "mmsi": "227280290",
                    "imo": "9629344",
                    "container": "MSKU1234567",
                    "containerSeal": "SEAL-001",
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["createdNewStage"] is False, f"same ship must MERGE: {body}"
            assert body["container"]["number"] == "MSKU1234567"
            print(f"  OK  container merged into same stage; no new stage created")

            # Verify container stuck on the active stage
            j = (await http.get(f"{BASE}/api/shipments/{ship_id}/journey")).json()["shipment"]
            cur_stage = next((s for s in j["stages"] if s["id"] == j["currentStageId"]), None)
            assert cur_stage is not None
            assert (cur_stage.get("container") or {}).get("number") == "MSKU1234567", cur_stage
            print(f"  OK  active stage has container: {cur_stage['container']}")

            # ---------- 4. Bind different ship — triggers STAGE SPLIT ----------
            section("4. Bind DIFFERENT ship (AQUARIUS) — closes A, opens B")
            r = await http.post(
                f"{BASE}/api/shipments/{ship_id}/vessel",
                json={"name": "AQUARIUS", "mmsi": "275535000"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["createdNewStage"] is True, f"DIFFERENT ship must create new stage: {body}"
            assert body["vesselStagesCount"] >= 2
            new_stage_id = body["newStageId"]
            assert new_stage_id
            print(f"  OK  new vessel stage created: {new_stage_id}")
            print(f"       total vessel stages: {body['vesselStagesCount']}")

            # Verify old MSC OSCAR stage is now status=done
            j = (await http.get(f"{BASE}/api/shipments/{ship_id}/journey")).json()["shipment"]
            vessel_stages = [s for s in j["stages"] if s["type"] == "vessel"]
            assert len(vessel_stages) >= 2
            done_stage = next(
                (s for s in vessel_stages if (s.get("vessel") or {}).get("name") == "MSC OSCAR"),
                None,
            )
            assert done_stage is not None, "MSC OSCAR stage disappeared!"
            assert done_stage["status"] == "done", \
                f"old stage should be done, got {done_stage['status']}"
            active_stage = next((s for s in vessel_stages if s["status"] == "active"), None)
            assert active_stage is not None
            assert (active_stage.get("vessel") or {}).get("name") == "AQUARIUS", active_stage
            print(f"  OK  MSC OSCAR → done; AQUARIUS → active")

            # events[] should have a vessel_changed entry
            events = j.get("events") or []
            assert any(e["type"] == "vessel_changed" for e in events), \
                f"vessel_changed event missing: {[e['type'] for e in events]}"
            print(f"  OK  vessel_changed event logged")

            # ---------- 5. bind-by-vin ----------
            section("5. POST /api/shipments/bind-by-vin (VIN lookup)")
            r = await http.post(
                f"{BASE}/api/shipments/bind-by-vin",
                json={"vin": vin, "name": "AQUARIUS", "mmsi": "275535000",
                      "container": "MSKU9999999"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["shipmentId"] == ship_id
            assert body["createdNewStage"] is False  # same AQUARIUS → merge
            print(f"  OK  VIN resolved to {ship_id}; container updated")

            # Non-existent VIN → 404
            r_bad = await http.post(
                f"{BASE}/api/shipments/bind-by-vin",
                json={"vin": "DOES-NOT-EXIST-12345", "name": "X", "mmsi": "1"},
            )
            assert r_bad.status_code == 404, r_bad.status_code
            print(f"  OK  unknown VIN → 404")

            # ---------- 6. transfer-vessel (explicit transshipment) ----------
            section("6. POST /transfer-vessel — force new stage")
            r = await http.post(
                f"{BASE}/api/shipments/{ship_id}/transfer-vessel",
                json={
                    "name": "AQUARIUS",
                    "mmsi": "275535000",
                    "transferPort": "Algeciras",
                    "container": "MSKU9999999",
                },
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["createdNewStage"] is True, \
                "transfer-vessel MUST create new stage even for same ship"
            print(f"  OK  forced new stage; label should mention Algeciras")

            # ---------- 7. vessel-history ----------
            section("7. GET /vessel-history")
            r = await http.get(f"{BASE}/api/shipments/{ship_id}/vessel-history")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["vin"] == vin
            stages = body["vesselStages"]
            assert len(stages) >= 3, f"expected >=3 vessel stages, got {len(stages)}: {stages}"
            for s in stages:
                print(f"    • [{s['status']}] {s['label']}  vessel={s['vessel']['name'] if s['vessel'] else '—'}  cont={s.get('container', {}).get('number') if s.get('container') else '—'}")
            # Exactly one current
            current = [s for s in stages if s["isCurrent"]]
            assert len(current) == 1, f"expected exactly one current, got {len(current)}"
            print(f"  OK  history has {len(stages)} vessel stages, 1 current")

            section("SUMMARY")
            print("  ALL VIN-CENTRIC JOURNEY CHECKS PASSED ✓")
            return 0
    except AssertionError as e:
        print(f"\n  ASSERTION FAILED: {e}")
        return 1
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n  ERROR: {e}")
        return 1
    finally:
        for sid in created_ids:
            try:
                await db.shipments.delete_one({"id": sid})
                await db.shipment_events.delete_many({"shipmentId": sid})
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
