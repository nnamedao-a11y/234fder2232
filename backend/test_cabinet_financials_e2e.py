"""
P1.2-CABINET — E2E POC TEST

Validates the customer-facing financial cabinet endpoints:

 1. UNAUTHENTICATED   → 401 on all endpoints
 2. STRANGER'S DEAL   → 404 (must NOT enumerate other customers' deals)
 3. LIST MY DEALS     → returns only my deals, not others
 4. DEAL FINANCIALS   → full picture (breakdowns + payments + summary)
 5. INTERNAL FIELDS   → template_snapshot / calculation_snapshot etc. NOT in response
 6. PAY-INTENT        → returns stub with correct official_due amount
 7. NO OFFICIAL DUE   → returns reason='no_official_due' when fully paid

Run: cd /app/backend && python test_cabinet_financials_e2e.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from typing import Any, Dict, List

import httpx
from motor.motor_asyncio import AsyncIOMotorClient


BASE_URL = os.environ.get("BIBI_TEST_BASE_URL", "http://localhost:8001")
ADMIN_EMAIL = os.environ.get("BIBI_ADMIN_EMAIL", "admin@bibi.cars")
ADMIN_PASSWORD = os.environ.get(
    "BIBI_ADMIN_PASSWORD", "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu"
)
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


class T:
    def __init__(self) -> None:
        self.passed: List[str] = []
        self.failed: List[str] = []

    def ok(self, name: str, msg: str = "") -> None:
        self.passed.append(name)
        print(f"  \033[0;32m✓\033[0m {name}{(' — ' + msg) if msg else ''}")

    def fail(self, name: str, msg: str) -> None:
        self.failed.append(name)
        print(f"  \033[0;31m✗\033[0m {name} — {msg}")

    def assert_eq(self, name, actual, expected):
        if actual == expected: self.ok(name, f"= {actual!r}")
        else: self.fail(name, f"expected {expected!r}, got {actual!r}")

    def assert_close(self, name, actual, expected, tol=0.01):
        if abs(float(actual) - float(expected)) < tol: self.ok(name, f"≈ {actual}")
        else: self.fail(name, f"expected ≈{expected}, got {actual}")

    def assert_truthy(self, name, value, hint=""):
        if value: self.ok(name, hint or repr(value)[:80])
        else: self.fail(name, f"expected truthy, got {value!r}")


async def admin_login(client: httpx.AsyncClient) -> str:
    r = await client.post("/api/auth/login",
                           json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    return r.json()["access_token"]


async def make_customer_session(db, customer_id: str) -> str:
    """
    Helper: mint a customer session token directly in Mongo (bypassing the
    public Google login flow). The backend's _resolve_bearer matches by
    `token` or `session_token` and checks `expires_at`.
    """
    from datetime import datetime, timedelta, timezone
    token = f"test-cab-{uuid.uuid4().hex}"
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    doc = {
        "token": token,
        "session_token": token,
        "customerId": customer_id,
        "user_id": customer_id,
        "email": f"{customer_id}@test.local",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at,
        "active": True,
    }
    await db.customer_sessions.insert_one(doc)
    return token


async def setup_paid_deal(client: httpx.AsyncClient, db, label: str) -> Dict[str, Any]:
    """Create a customer + deal that's gone through auction_won (has after_win)."""
    suffix = uuid.uuid4().hex[:6]
    customer_id = f"cust_cab_{label}_{suffix}"
    deal_id = f"deal_cab_{label}_{suffix}"

    await db.customers.insert_one({
        "id": customer_id, "name": f"Cab Test {label}",
        "email": f"{customer_id}@test.local", "phone": "+359000000000",
        "legal": {
            "first_name": "Cab", "last_name": "Test",
            "egn": "1234567890", "national_id_no": "AB123456",
            "id_card_address": "Sofia",
            "id_card_issued_by": "MVR Sofia",
            "id_card_issue_date": "2020-01-01",
        },
        "max_bid_usd": 25000,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    await db.deals.insert_one({
        "id": deal_id, "_id": deal_id,
        "customerId": customer_id, "customer_id": customer_id,
        "stage": "deposit_paid", "status": "deposit_paid",
        "max_bid_usd": 25000, "stage_history": [],
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    r = await client.post("/api/legal/deposits", json={
        "customer_id": customer_id, "deal_id": deal_id,
        "max_bid_usd": 25000, "fx_rate_usd_to_eur": 0.92,
        "paid_amount_eur": 2300, "note": f"setup-{label}",
    })
    r.raise_for_status()
    deposit_id = r.json()["deposit"]["id"]

    r = await client.put(
        f"/api/legal/deposits/{deposit_id}/confirm-payment",
        json={"note": "setup-confirm"},
    )
    r.raise_for_status()

    r = await client.post(f"/api/legal/deals/{deal_id}/auction/won", json={
        "price_usd": 10000, "auction": "Copart", "lot_number": f"LOT-CAB-{label}",
        "fx_usd_to_eur": 0.92,
    })
    r.raise_for_status()
    invoice = r.json()["invoice"]
    total = (invoice.get("totals") or {}).get("total_all") or invoice.get("amount") or 0

    return {
        "customer_id": customer_id, "deal_id": deal_id,
        "deposit_id": deposit_id, "total_all": float(total),
    }


# ─── Tests ────────────────────────────────────────────────────────────────

async def test_unauthenticated(client_admin, t, db):
    print("\n━ TEST 1 — unauthenticated requests blocked")
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15.0) as anon:
        r = await anon.get("/api/cabinet/deals")
        t.assert_eq("GET /cabinet/deals → 401", r.status_code, 401)
        r = await anon.get("/api/cabinet/deals/anything/financials")
        t.assert_eq("GET /cabinet/deals/X/financials → 401", r.status_code, 401)
        r = await anon.post("/api/cabinet/deals/anything/pay-intent", json={})
        t.assert_eq("POST /cabinet/deals/X/pay-intent → 401", r.status_code, 401)


async def test_isolation(client_admin, t, db):
    print("\n━ TEST 2 — customer cannot see another customer's deal")
    fxA = await setup_paid_deal(client_admin, db, "iso_a")
    fxB = await setup_paid_deal(client_admin, db, "iso_b")

    tokenA = await make_customer_session(db, fxA["customer_id"])
    async with httpx.AsyncClient(
        base_url=BASE_URL, timeout=15.0,
        headers={"Authorization": f"Bearer {tokenA}"},
    ) as c:
        # A can see his own
        r = await c.get(f"/api/cabinet/deals/{fxA['deal_id']}/financials")
        t.assert_eq("A sees own deal → 200", r.status_code, 200)
        # A cannot see B's
        r = await c.get(f"/api/cabinet/deals/{fxB['deal_id']}/financials")
        t.assert_eq("A asks for B's deal → 404", r.status_code, 404)
        # /deals returns only A's
        r = await c.get("/api/cabinet/deals")
        r.raise_for_status()
        ids = {d["id"] for d in r.json().get("data", [])}
        t.assert_truthy("A's deal in list", fxA["deal_id"] in ids)
        t.assert_truthy("B's deal NOT in list",
                        fxB["deal_id"] not in ids,
                        f"ids={ids}")


async def test_full_picture(client_admin, t, db):
    print("\n━ TEST 4 + 5 — full financial picture + no internal fields leaked")
    fx = await setup_paid_deal(client_admin, db, "full")
    deal_id = fx["deal_id"]
    total = fx["total_all"]
    token = await make_customer_session(db, fx["customer_id"])

    async with httpx.AsyncClient(
        base_url=BASE_URL, timeout=15.0,
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        # Add a confirmed payment first (manager via admin token)
        r = await client_admin.post(
            f"/api/legal/deals/{deal_id}/payments",
            json={"amount": 2000, "method": "bank", "proof_url": "x",
                  "auto_confirm": True},
        )
        r.raise_for_status()

        # Customer view
        r = await c.get(f"/api/cabinet/deals/{deal_id}/financials")
        r.raise_for_status()
        body = r.json()

        t.assert_truthy("response.deal present", bool(body.get("deal")))
        t.assert_truthy("response.breakdowns >= 1", len(body.get("breakdowns") or []) >= 1)
        t.assert_truthy("response.payments >= 1", len(body.get("payments") or []) >= 1)
        t.assert_close("summary.total_all = total", body["summary"]["total_all"], total)
        t.assert_close("summary.paid_total = 2000", body["summary"]["paid_total"], 2000)
        t.assert_eq("payment_status=partial", body["payment_status"], "partial")

        # Internal fields NOT leaked
        bd = (body.get("breakdowns") or [{}])[0]
        t.assert_truthy("template_snapshot stripped",
                        "template_snapshot" not in bd, str(list(bd.keys())[:10]))
        t.assert_truthy("calculation_snapshot stripped",
                        "calculation_snapshot" not in bd)
        t.assert_truthy("auction stripped (has supplier price)",
                        "auction" not in bd)

        pay = (body.get("payments") or [{}])[0]
        t.assert_truthy("payment.history NOT exposed",
                        "history" not in pay, str(list(pay.keys())))
        t.assert_truthy("payment.created_by NOT exposed",
                        "created_by" not in pay)


async def test_pay_intent(client_admin, t, db):
    print("\n━ TEST 6 + 7 — pay-intent stub")
    fx = await setup_paid_deal(client_admin, db, "pay")
    deal_id = fx["deal_id"]
    token = await make_customer_session(db, fx["customer_id"])

    async with httpx.AsyncClient(
        base_url=BASE_URL, timeout=15.0,
        headers={"Authorization": f"Bearer {token}"},
    ) as c:
        # When nothing is paid, official_due > 0
        r = await c.post(f"/api/cabinet/deals/{deal_id}/pay-intent", json={})
        r.raise_for_status()
        body = r.json()
        t.assert_eq("stub=True (no Stripe yet)", body.get("stub"), True)
        t.assert_truthy("amount_due_eur > 0", body.get("amount_due_eur", 0) > 0)

        # Pay all official → next call returns no_official_due
        r = await client_admin.post(
            f"/api/legal/deals/{deal_id}/payments",
            json={
                "amount": body["amount_due_eur"],
                "method": "bank", "proof_url": "x",
                "auto_confirm": True,
            },
        )
        r.raise_for_status()

        r = await c.post(f"/api/cabinet/deals/{deal_id}/pay-intent", json={})
        r.raise_for_status()
        body2 = r.json()
        t.assert_eq("after full payment → no_official_due",
                    body2.get("reason"), "no_official_due")


async def cleanup(db):
    pat = "^cust_cab_"
    deal_pat = "^deal_cab_"
    await db.customers.delete_many({"id": {"$regex": pat}})
    await db.deals.delete_many({"id": {"$regex": deal_pat}})
    await db.legal_deposits.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.contracts_v2.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.invoices.delete_many({"$or": [
        {"sourceAuctionWonDealId": {"$regex": deal_pat}},
        {"sourceFinalBreakdownDealId": {"$regex": deal_pat}},
    ]})
    await db.payments.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.audit_events.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.customer_sessions.delete_many({"token": {"$regex": "^test-cab-"}})


async def main() -> int:
    print(f"\n\033[0;34m━━━ P1.2-CABINET — E2E POC TEST ━━━\033[0m")
    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]
    await cleanup(db)
    t = T()

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client_admin:
        token = await admin_login(client_admin)
        client_admin.headers["Authorization"] = f"Bearer {token}"
        print(f"  ✓ admin logged in")

        for fn in (test_unauthenticated, test_isolation,
                   test_full_picture, test_pay_intent):
            try:
                await fn(client_admin, t, db)
            except Exception as e:
                t.fail(f"{fn.__name__} crashed", repr(e))

    print()
    print(f"\033[0;32m  passed: {len(t.passed)}\033[0m")
    if t.failed:
        print(f"\033[0;31m  failed: {len(t.failed)}\033[0m")
        for f in t.failed: print(f"    • {f}")
    print()

    await cleanup(db)
    mongo.close()
    return 0 if not t.failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
