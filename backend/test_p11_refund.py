"""
P1.1 Refund Cron — E2E test (7 сценариев).
Запуск: cd /app/backend && python test_p11_refund.py
"""
import asyncio, os, sys, json, time
import httpx
from datetime import datetime, timedelta, timezone

API = os.environ.get("BIBI_API", "http://localhost:8001")
ADMIN = ("admin@bibi.cars", os.environ.get("BIBI_ADMIN_PASSWORD") or "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu")

OK = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"


async def get_token() -> str:
    async with httpx.AsyncClient(base_url=API, timeout=10.0) as c:
        r = await c.post("/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
        r.raise_for_status()
        return r.json()["access_token"]


async def seed(http: httpx.AsyncClient, suffix: str, deal_stage: str = "deposit_paid"):
    """Создать customer + deal с заданной стадией."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    mc = AsyncIOMotorClient(mongo_url)
    db = mc[os.environ.get("DB_NAME", "test_database")]
    cid = f"cust_p11_{suffix}"
    did = f"deal_p11_{suffix}"
    await db.customers.update_one(
        {"id": cid},
        {"$set": {"id": cid, "firstName": "P11", "lastName": suffix,
                  "email": f"p11_{suffix}@x.com",
                  "legal": {
                      "first_name": "P11", "last_name": suffix,
                      "egn": "9901011234", "national_id_no": "BG1",
                      "id_card_address": "addr", "id_card_issued_by": "MVR",
                      "id_card_issue_date": "2020-01-01",
                  }}},
        upsert=True,
    )
    await db.deals.update_one(
        {"id": did},
        {"$set": {"id": did, "title": f"deal {suffix}", "customerId": cid,
                  "stage": deal_stage, "status": deal_stage,
                  "vin": f"WBA{suffix.upper()}xxxxxxxxx"[:17]}},
        upsert=True,
    )
    return cid, did, db


async def make_deposit(http: httpx.AsyncClient, cid: str, did: str, deadline_offset_days: int = -1,
                       force_deal_stage_after: str = None):
    """Создать депозит и сразу подтвердить, при необходимости backdate deadline.
    force_deal_stage_after: после confirm-payment вручную переписать deal.stage
    (потому что confirm-payment автоматически ставит deposit_paid)."""
    r = await http.post("/api/legal/deposits", json={
        "customer_id": cid, "deal_id": did,
        "max_bid_usd": 25000, "paid_amount_eur": 2300,
    })
    r.raise_for_status()
    dep_id = r.json()["deposit"]["id"]

    r = await http.put(f"/api/legal/deposits/{dep_id}/confirm-payment", json={})
    r.raise_for_status()

    from motor.motor_asyncio import AsyncIOMotorClient
    mc = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = mc[os.environ.get("DB_NAME", "test_database")]
    # Backdate deadline для сценариев cron
    if deadline_offset_days != 0:
        new_deadline = (datetime.now(timezone.utc) + timedelta(days=deadline_offset_days)).isoformat()
        await db.legal_deposits.update_one({"id": dep_id},
            {"$set": {"search_timer_deadline_at": new_deadline}})
    if force_deal_stage_after:
        await db.deals.update_one({"id": did},
            {"$set": {"stage": force_deal_stage_after, "status": force_deal_stage_after}})
    return dep_id


async def main():
    token = await get_token()
    headers = {"Authorization": f"Bearer {token}"}
    results = []
    fail = 0

    async with httpx.AsyncClient(base_url=API, headers=headers, timeout=15.0) as http:

        # ── 1. paid_confirmed + deadline passed + no auction → refund_pending_30d ──
        cid, did, db = await seed(http, "s1", "deposit_paid")
        dep1 = await make_deposit(http, cid, did, deadline_offset_days=-1)
        r = await http.post("/api/legal/refund/scan-now")
        scan = r.json()
        d = (await http.get(f"/api/legal/deposits/{dep1}")).json()["deposit"]
        ok = d["status"] == "refund_pending_30d" and scan["promoted"] >= 1
        results.append(("S1: cron promotes paid_confirmed → refund_pending_30d", ok, d["status"]))
        if not ok: fail += 1

        # ── 2. paid_confirmed + deadline passed + auction_won → NOT promoted ──
        cid2, did2, _ = await seed(http, "s2", "deposit_paid")
        dep2 = await make_deposit(http, cid2, did2, deadline_offset_days=-1,
                                   force_deal_stage_after="auction_won")
        await http.post("/api/legal/refund/scan-now")
        d2 = (await http.get(f"/api/legal/deposits/{dep2}")).json()["deposit"]
        ok = d2["status"] == "paid_confirmed"  # не должен меняться
        results.append(("S2: deal=auction_won blocks cron promotion", ok, d2["status"]))
        if not ok: fail += 1

        # ── 3. voluntary refund before auction_won → refund_pending_voluntary ──
        cid3, did3, _ = await seed(http, "s3", "deposit_paid")
        dep3 = await make_deposit(http, cid3, did3, deadline_offset_days=+30)
        r = await http.post(f"/api/legal/deposits/{dep3}/refund/request",
                            json={"reason": "client wants out"})
        d3 = (await http.get(f"/api/legal/deposits/{dep3}")).json()["deposit"]
        ok = r.status_code == 200 and d3["status"] == "refund_pending_voluntary"
        results.append(("S3: voluntary refund pre-auction → refund_pending_voluntary", ok, d3["status"]))
        if not ok: fail += 1

        # ── 4. voluntary refund AFTER auction_won → 422 ──
        cid4, did4, _ = await seed(http, "s4", "deposit_paid")
        dep4 = await make_deposit(http, cid4, did4, deadline_offset_days=+30,
                                   force_deal_stage_after="auction_won")
        r = await http.post(f"/api/legal/deposits/{dep4}/refund/request",
                            json={"reason": "too late"})
        ok = r.status_code == 422
        results.append(("S4: voluntary refund after auction_won → 422", ok, r.status_code))
        if not ok: fail += 1

        # ── 5. approve refund (S3) → refund_approved ──
        r = await http.post(f"/api/legal/deposits/{dep3}/refund/approve", json={"note": "ok"})
        d5 = (await http.get(f"/api/legal/deposits/{dep3}")).json()["deposit"]
        ok = r.status_code == 200 and d5["status"] == "refund_approved"
        results.append(("S5: admin approve → refund_approved", ok, d5["status"]))
        if not ok: fail += 1

        # ── 6. execute manual bank refund → refunded ──
        r = await http.post(f"/api/legal/deposits/{dep3}/refund/execute",
                            json={"method": "bank_manual",
                                  "bank_proof_url": "/static/proofs/test.pdf"})
        d6 = (await http.get(f"/api/legal/deposits/{dep3}")).json()["deposit"]
        ok = r.status_code == 200 and d6["status"] == "refunded" and d6.get("refund_method") == "bank_manual"
        results.append(("S6: execute manual refund → refunded", ok, d6["status"]))
        if not ok: fail += 1

        # ── 7. cron повторно не делает дублей (для S1 dep1 уже refund_pending_30d) ──
        before = (await http.get(f"/api/legal/deposits/{dep1}")).json()["deposit"]
        r = await http.post("/api/legal/refund/scan-now")
        scan2 = r.json()
        after = (await http.get(f"/api/legal/deposits/{dep1}")).json()["deposit"]
        ok = (before["status"] == after["status"] == "refund_pending_30d"
              and scan2["promoted"] == 0)
        results.append(("S7: cron idempotency (no dup promote)", ok,
                        f"promoted={scan2['promoted']}"))
        if not ok: fail += 1

        # ── 8. Reject voluntary refund (extra: создадим новый и отвергнем) ──
        cid8, did8, _ = await seed(http, "s8", "deposit_paid")
        dep8 = await make_deposit(http, cid8, did8, deadline_offset_days=+30)
        await http.post(f"/api/legal/deposits/{dep8}/refund/request", json={"reason": "x"})
        r = await http.post(f"/api/legal/deposits/{dep8}/refund/reject",
                            json={"reason": "deal is fine"})
        d8 = (await http.get(f"/api/legal/deposits/{dep8}")).json()["deposit"]
        ok = r.status_code == 200 and d8["status"] == "paid_confirmed" \
             and d8.get("refund_rejection_reason") == "deal is fine"
        results.append(("S8: reject refund → back to paid_confirmed", ok, d8["status"]))
        if not ok: fail += 1

        # ── 9. Stage groups in catalog ──
        cat = (await http.get("/api/legal/catalog")).json()
        groups = cat.get("deal_stage_groups", [])
        ok = len(groups) == 8 and all("stages" in g and "label" in g for g in groups)
        results.append(("S9: catalog returns 8 stage groups", ok, f"groups={len(groups)}"))
        if not ok: fail += 1

        # ── 10. Contract finalized hard-binds deal.stage forward ──
        # Создадим новую сделку в lead, контракт final → transition → проверим что deal.stage == final_contract_signed
        cid10, did10, db = await seed(http, "s10", "deposit_paid")
        rc = await http.post("/api/contracts2", json={
            "deal_id": did10, "customer_id": cid10, "type": "final",
        })
        cid_contract = rc.json()["contract"]["id"]
        await http.post(f"/api/contracts2/{cid_contract}/transition", json={"to": "sent_to_client"})
        await http.post(f"/api/contracts2/{cid_contract}/transition", json={"to": "client_signed"})
        deal = await db.deals.find_one({"id": did10})
        ok = deal.get("stage") == "final_contract_signed"
        results.append(("S10: contract.client_signed → deal.stage hard sync", ok, deal.get("stage")))
        if not ok: fail += 1

    print("\n" + "=" * 70)
    print(" P1.1 REFUND FLOW — E2E TEST RESULTS")
    print("=" * 70)
    for name, ok, val in results:
        mark = OK if ok else FAIL
        print(f" {mark} {name}  [{val}]")
    print("=" * 70)
    print(f" {'PASSED' if fail == 0 else 'FAILED'}: {len(results) - fail}/{len(results)}")
    print("=" * 70)
    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
