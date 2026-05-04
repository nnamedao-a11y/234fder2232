"""
Smoke-test для P0.1–P0.4: customer legal → deposit calc → contract v2 lifecycle.
Запускается из контейнера: python3 /app/tests/test_legal_workflow.py
"""
import os
import sys
import json
import asyncio
import httpx
import jwt as _jwt
from datetime import datetime, timezone

BASE = os.environ.get("BIBI_BASE", "http://localhost:8001")
JWT_SECRET = os.environ.get("JWT_SECRET", "bibi_jwt_MkSpYR1GiVZL2i8UfWf4EBrEer1ZtWq")


def make_token(role: str = "manager", uid: str = "test-mgr-1", email: str = "test@bibi.cars") -> str:
    """Build a fresh HS256 JWT compatible with security.require_*"""
    payload = {
        "sub": uid,
        "id": uid,
        "email": email,
        "role": role,
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": int(datetime.now(timezone.utc).timestamp()) + 3600,
    }
    return _jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def main() -> int:
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = ""):
        flag = "✅" if ok else "❌"
        print(f"  {flag} {name}{(' — ' + detail) if detail else ''}")
        if not ok:
            failures.append(name + (f" :: {detail}" if detail else ""))

    mgr_tok = make_token("manager", "mgr-1", "mgr@bibi.cars")
    admin_tok = make_token("master_admin", "adm-1", "adm@bibi.cars")
    H_M = {"Authorization": f"Bearer {mgr_tok}"}
    H_A = {"Authorization": f"Bearer {admin_tok}"}

    async with httpx.AsyncClient(base_url=BASE, timeout=15) as c:
        # ════════════ Catalog ════════════
        print("\n=== 0. Catalog ===")
        r = await c.get("/api/legal/catalog")
        check("GET /api/legal/catalog 200", r.status_code == 200, str(r.status_code))
        cat = r.json()
        check("20 deal_stages", len(cat["deal_stages"]) == 20)
        check("8 deposit_statuses", len(cat["deposit_statuses"]) == 8)
        check("5 contract_lifecycle", len(cat["contract_lifecycle"]) == 5)
        check("deposit_rules.min_eur == 1000", cat["deposit_rules"]["min_eur"] == 1000)

        # ════════════ Deposit calculator ════════════
        print("\n=== 1. Deposit calculator ===")
        r = await c.post("/api/legal/deposit/calculate", json={"max_bid_usd": 5000})
        check("calc max_bid=5k → required=1000", r.status_code == 200 and r.json()["required_amount_eur"] == 1000.0,
              json.dumps(r.json()))
        r = await c.post("/api/legal/deposit/calculate", json={"max_bid_usd": 25000, "fx_rate_usd_to_eur": 0.92})
        body = r.json()
        # 25000*0.10*0.92 = 2300 EUR (> 1000 floor)
        check("calc max_bid=25k → required=2300", r.status_code == 200 and body["required_amount_eur"] == 2300.0,
              json.dumps(body))
        check("calculated_from_bid flag", body["calculated_from_bid"] is True)
        r = await c.post("/api/legal/deposit/calculate", json={"max_bid_usd": 11000, "fx_rate_usd_to_eur": 0.92})
        body = r.json()
        # 11000*0.10*0.92 = 1012 EUR > 1000 floor → 1012
        check("calc max_bid=11k → required=1012", r.status_code == 200 and body["required_amount_eur"] == 1012.0,
              json.dumps(body))

        # ════════════ Customer legal ════════════
        print("\n=== 2. Customer legal fields (P0.1) ===")
        # Need a real customer in DB. Insert one directly via existing API.
        # Use admin-like creation: directly via mongo-less route — POST /api/customers
        cust_payload = {"name": "Test Buyer", "email": "buyer@example.com", "phone": "+359000000000"}
        r = await c.post("/api/customers", json=cust_payload, headers=H_M)
        if r.status_code not in (200, 201):
            # Fallback: many BIBI APIs need different shape. Try admin route.
            r = await c.post("/api/admin/customers", json=cust_payload, headers=H_A)
        check("create customer", r.status_code in (200, 201), f"{r.status_code}: {r.text[:200]}")
        if r.status_code in (200, 201):
            cust_resp = r.json()
            customer_id = cust_resp.get("id") or cust_resp.get("customer", {}).get("id") or cust_resp.get("_id")
        else:
            # last resort: create directly via mongo
            from motor.motor_asyncio import AsyncIOMotorClient
            mc = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            mdb = mc[os.environ.get("DB_NAME", "test_database")]
            customer_id = "cust_test_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            await mdb.customers.insert_one({"id": customer_id, **cust_payload})
            mc.close()
            print(f"     (fallback) inserted customer directly: {customer_id}")
        check("customer_id present", bool(customer_id), str(customer_id))

        # 2a. Validate empty → ready=False
        r = await c.get(f"/api/customers/{customer_id}/legal/validate", headers=H_M)
        check("validate empty → not ready", r.status_code == 200 and r.json()["ready_for_deposit_contract"] is False,
              str(r.json().get("missing_fields")))
        # 2b. Reject bad EGN
        r = await c.put(f"/api/customers/{customer_id}/legal", headers=H_M, json={
            "first_name": "Иван", "last_name": "Иванов", "egn": "12345",  # too short
            "national_id_no": "ID123", "id_card_address": "Sofia, Vitosha 1",
            "id_card_issued_by": "MVR Sofia", "id_card_issue_date": "2020-01-15",
        })
        check("reject EGN<10 digits", r.status_code == 422, str(r.status_code))
        # 2c. Accept good payload
        good_legal = {
            "first_name": "Иван", "last_name": "Иванов", "egn": "1234567890",
            "national_id_no": "ID-AB-12345", "id_card_address": "Sofia, Vitosha 1",
            "id_card_issued_by": "MVR Sofia", "id_card_issue_date": "2020-01-15",
        }
        r = await c.put(f"/api/customers/{customer_id}/legal", headers=H_M, json=good_legal)
        check("accept valid legal", r.status_code == 200, r.text[:200])
        # 2d. Validate again → ready=True
        r = await c.get(f"/api/customers/{customer_id}/legal/validate", headers=H_M)
        check("validate filled → ready", r.status_code == 200 and r.json()["ready_for_deposit_contract"] is True)

        # ════════════ Deposit lifecycle ════════════
        print("\n=== 3. Deposit lifecycle (P0.3) ===")
        r = await c.post("/api/legal/deposits", headers=H_M, json={
            "customer_id": customer_id,
            "max_bid_usd": 25000,
            "fx_rate_usd_to_eur": 0.92,
            "paid_amount_eur": 1000,  # less than required 2300 → confirm should fail
            "note": "test deposit",
        })
        check("create deposit", r.status_code == 200, r.text[:200])
        dep = r.json()["deposit"]
        deposit_id = dep["id"]
        check("required_amount_eur=2300", dep["required_amount_eur"] == 2300.0)
        check("status=pending", dep["status"] == "pending")

        # Try confirm with insufficient paid → 422
        r = await c.put(f"/api/legal/deposits/{deposit_id}/confirm-payment", headers=H_M, json={})
        check("confirm rejects underpayment", r.status_code == 422, r.text[:200])

        # Bump paid_amount_eur via mongo (no endpoint to update arbitrary field)
        from motor.motor_asyncio import AsyncIOMotorClient
        mc = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        mdb = mc[os.environ.get("DB_NAME", "test_database")]
        await mdb.legal_deposits.update_one({"id": deposit_id}, {"$set": {"paid_amount_eur": 2300}})

        r = await c.put(f"/api/legal/deposits/{deposit_id}/confirm-payment", headers=H_M, json={})
        check("confirm accepts when paid>=required", r.status_code == 200, r.text[:200])
        confirm_body = r.json()
        check("status→paid_confirmed", confirm_body["status"] == "paid_confirmed")
        check("30-day deadline set", "search_timer_deadline_at" in confirm_body)

        # ════════════ Contract v2 ════════════
        print("\n=== 4. Contract v2 lifecycle (P0.4) ===")
        # Create deal so contract has linkage
        deal_id = "deal_test_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        await mdb.deals.insert_one({"id": deal_id, "customerId": customer_id, "stage": "qualified",
                                     "status": "qualified", "created_at": datetime.now(timezone.utc).isoformat()})

        r = await c.post("/api/contracts2", headers=H_M, json={
            "deal_id": deal_id, "customer_id": customer_id, "type": "deposit",
            "items": [], "notes": "test deposit contract",
        })
        check("create deposit contract (legal ready)", r.status_code == 200, r.text[:300])
        contract_id = r.json()["contract"]["id"]
        check("lifecycle=draft", r.json()["contract"]["lifecycle"] == "draft")
        check("snapshot legal saved", r.json()["contract"]["snapshot_customer_legal"]["egn"] == "1234567890")

        # Forbid skipping a step
        r = await c.post(f"/api/contracts2/{contract_id}/transition", headers=H_M,
                          json={"to": "client_signed"})
        check("reject illegal jump draft→client_signed (manager)", r.status_code == 409, r.text[:120])

        # Walk happy path
        for target in ["sent_to_client", "client_signed", "company_signed_stamped", "finalized"]:
            r = await c.post(f"/api/contracts2/{contract_id}/transition", headers=H_M, json={"to": target})
            check(f"transition → {target}", r.status_code == 200, r.text[:200])

        # Final state — no more forward
        r = await c.post(f"/api/contracts2/{contract_id}/transition", headers=H_M,
                          json={"to": "draft"})
        check("reject finalized→draft (manager)", r.status_code == 409, r.text[:120])
        # Admin может откатить
        r = await c.post(f"/api/contracts2/{contract_id}/transition", headers=H_A, json={"to": "draft"})
        check("admin allowed to rollback finalized→draft", r.status_code == 200, r.text[:200])

        # ════════════ Block deposit-contract creation when legal missing ═════
        print("\n=== 5. Block deposit contract for customer w/o legal ===")
        # New customer without legal
        cust_no_legal = "cust_no_legal_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        await mdb.customers.insert_one({"id": cust_no_legal, "name": "Mr No Docs"})
        r = await c.post("/api/contracts2", headers=H_M, json={
            "deal_id": deal_id, "customer_id": cust_no_legal, "type": "deposit",
        })
        check("reject deposit contract without legal fields", r.status_code == 422, r.text[:200])
        # `final` контракт — без проверки legal должен пройти
        r = await c.post("/api/contracts2", headers=H_M, json={
            "deal_id": deal_id, "customer_id": cust_no_legal, "type": "final",
        })
        check("allow `final` contract without legal fields", r.status_code == 200, r.text[:200])

        # ════════════ Deal advance ════════════
        print("\n=== 6. Deal advance (P0.2) ===")
        # deal currently has stage=`final_contract_signed` after the previous flow
        deal_doc = await mdb.deals.find_one({"id": deal_id}, {"_id": 0})
        cur = deal_doc.get("stage") or "qualified"
        # Try forbidden jump
        r = await c.post(f"/api/deals/{deal_id}/advance", headers=H_M, json={"to": "delivered"})
        check("reject forbidden deal jump (manager)", r.status_code == 409, r.text[:150])
        # Allowed forward (depends on current)
        forward_map = {
            "qualified": "variants_sent",
            "variants_sent": "deposit_contract_drafted",
            "deposit_contract_drafted": "deposit_contract_signed",
            "deposit_contract_signed": "deposit_paid",
            "deposit_paid": "searching_at_auction",
            "searching_at_auction": "auction_won",
            "auction_won": "final_contract_sent",
            "final_contract_sent": "final_contract_signed",
            "final_contract_signed": "after_win_payment_paid",
        }
        nxt = forward_map.get(cur, "cancelled")
        r = await c.post(f"/api/deals/{deal_id}/advance", headers=H_M, json={"to": nxt})
        check(f"forward {cur}→{nxt}", r.status_code == 200, r.text[:200])

        mc.close()

    print("\n══════════════════════════════════════════")
    if failures:
        print(f"FAIL — {len(failures)} checks failed:")
        for f in failures:
            print("   •", f)
        return 1
    else:
        print("ALL CHECKS PASSED ✓")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
