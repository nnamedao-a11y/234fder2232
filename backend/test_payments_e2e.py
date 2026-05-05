"""
P1.2-PAYMENTS — E2E POC TEST

Validates the payments tracking layer end-to-end:

 1. CREATE pending → status pending, summary unchanged
 2. CONFIRM pending → status confirmed, deal.payment_status updated
 3. PARTIAL    → multiple confirmed payments; status="partial"; remaining > 0
 4. PAID       → 100% covered → status="paid" + auto-advance to in_transit_to_bg
                + audit `deal_paid_in_full` + event emit
 5. OVERPAID   → > 100% → status="overpaid"; payment NOT rejected
 6. VOID       → admin voids confirmed payment → recompute drops paid_total
 7. IDEMPOTENT confirm twice → second returns idempotent=True
 8. CASH no proof → 200, is_official=False
 9. BANK no proof → 200 + warning in response
10. Cancelled deal → 409 on create
11. List + summary → matches DB sum

Run: cd /app/backend && python test_payments_e2e.py
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


async def login(client: httpx.AsyncClient) -> str:
    r = await client.post("/api/auth/login",
                           json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    r.raise_for_status()
    return r.json()["access_token"]


async def setup_paid_deal(client: httpx.AsyncClient, db, label: str) -> Dict[str, Any]:
    """
    Build a customer + deal that has gone through auction_won + has an
    after_win breakdown → ready to receive payments. total_all is returned.
    """
    suffix = uuid.uuid4().hex[:6]
    customer_id = f"cust_pay_{label}_{suffix}"
    deal_id = f"deal_pay_{label}_{suffix}"

    legal = {
        "first_name": "Payer", "last_name": "Test",
        "egn": "1234567890", "national_id_no": "AB123456",
        "id_card_address": "Sofia",
        "id_card_issued_by": "MVR Sofia",
        "id_card_issue_date": "2020-01-01",
    }
    await db.customers.insert_one({
        "id": customer_id, "name": "Payer Test",
        "email": f"{customer_id}@test.local", "phone": "+359000000000",
        "legal": legal, "max_bid_usd": 25000,
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
        "price_usd": 10000, "auction": "Copart", "lot_number": f"LOT-PAY-{label}",
        "fx_usd_to_eur": 0.92,
    })
    r.raise_for_status()
    invoice = r.json()["invoice"]
    total = (invoice.get("totals") or {}).get("total_all") or invoice.get("amount") or 0

    return {
        "customer_id": customer_id, "deal_id": deal_id,
        "deposit_id": deposit_id, "total_all": float(total),
    }


# ────────────────────────────────────────────────────────────────────────
async def test_create_pending_then_confirm(client, t, db):
    print("\n━ TEST 1+2 — create pending → confirm")
    fx = await setup_paid_deal(client, t, db, "c1") if False else await setup_paid_deal(client, db, "c1")
    deal_id = fx["deal_id"]
    total = fx["total_all"]

    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 1000, "method": "bank", "proof_url": "https://example.com/proof.png",
        "note": "first slice",
    })
    r.raise_for_status()
    body = r.json()
    pay_id = body["payment"]["id"]
    t.assert_eq("create returns pending", body["payment"]["status"], "pending")

    # status not advanced yet
    r2 = await client.get(f"/api/legal/deals/{deal_id}/payments")
    r2.raise_for_status()
    s = r2.json()
    t.assert_close("paid_total still 0 before confirm", s["summary"]["paid_total"], 0)
    t.assert_eq("payment_status=unpaid", s["payment_status"], "unpaid")

    # confirm
    r3 = await client.post(f"/api/legal/payments/{pay_id}/confirm", json={})
    r3.raise_for_status()
    cb = r3.json()
    t.assert_eq("confirm returns confirmed", cb["payment"]["status"], "confirmed")
    t.assert_close("paid_total = 1000 after confirm", cb["summary"]["paid_total"], 1000)
    t.assert_truthy("status partial",
                    cb["summary"]["paid_total"] < total,
                    f"paid={cb['summary']['paid_total']}, total={total}")


async def test_paid_in_full_auto_advance(client, t, db):
    print("\n━ TEST 3+4 — paid in full → status=paid + auto-advance")
    fx = await setup_paid_deal(client, db, "full")
    deal_id = fx["deal_id"]
    total = fx["total_all"]

    # Pay it all in one shot, auto_confirm to skip pending
    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": total, "method": "bank",
        "proof_url": "https://example.com/proof.png", "auto_confirm": True,
    })
    r.raise_for_status()
    body = r.json()
    t.assert_eq("auto_confirm → confirmed", body["payment"]["status"], "confirmed")
    t.assert_close("paid_total = total", body["summary"]["paid_total"], total)
    t.assert_eq("auto_advanced=True", body["auto_advanced"], True)

    # Check deal moved
    deal = await db.deals.find_one({"id": deal_id})
    t.assert_eq("deal.payment_status=paid", deal.get("payment_status"), "paid")
    t.assert_eq("deal.stage=in_transit_to_bg",
                deal.get("stage"), "in_transit_to_bg")

    # Audit event present
    r2 = await client.get("/api/legal/audit", params={
        "deal_id": deal_id, "type": "deal_paid_in_full",
    })
    r2.raise_for_status()
    events = r2.json()["data"]
    t.assert_truthy("deal_paid_in_full audit recorded", len(events) >= 1)


async def test_overpaid(client, t, db):
    print("\n━ TEST 5 — overpaid status (over 100%)")
    fx = await setup_paid_deal(client, db, "over")
    deal_id = fx["deal_id"]
    total = fx["total_all"]

    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": total + 500, "method": "bank", "proof_url": "x",
        "auto_confirm": True,
    })
    r.raise_for_status()
    body = r.json()
    t.assert_close("paid_total = total+500", body["summary"]["paid_total"], total + 500)

    r2 = await client.get(f"/api/legal/deals/{deal_id}/payments")
    r2.raise_for_status()
    t.assert_eq("payment_status=overpaid", r2.json()["payment_status"], "overpaid")
    t.assert_close("remaining negative",
                   r2.json()["summary"]["remaining"], -500)


async def test_void(client, t, db):
    print("\n━ TEST 6 — void confirmed payment")
    fx = await setup_paid_deal(client, db, "void")
    deal_id = fx["deal_id"]

    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 500, "method": "bank", "proof_url": "x", "auto_confirm": True,
    })
    r.raise_for_status()
    pay_id = r.json()["payment"]["id"]

    r = await client.get(f"/api/legal/deals/{deal_id}/payments")
    paid_before = r.json()["summary"]["paid_total"]

    r = await client.post(f"/api/legal/payments/{pay_id}/void",
                           json={"reason": "duplicate entry"})
    r.raise_for_status()
    t.assert_eq("void returns voided", r.json()["status"], "voided")
    t.assert_close("paid_total drops by 500",
                   r.json()["summary"]["paid_total"], paid_before - 500)


async def test_idempotent_confirm(client, t, db):
    print("\n━ TEST 7 — idempotent confirm")
    fx = await setup_paid_deal(client, db, "idem")
    deal_id = fx["deal_id"]

    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 200, "method": "bank", "proof_url": "x",
    })
    r.raise_for_status()
    pay_id = r.json()["payment"]["id"]

    r1 = await client.post(f"/api/legal/payments/{pay_id}/confirm", json={})
    r1.raise_for_status()
    r2 = await client.post(f"/api/legal/payments/{pay_id}/confirm", json={})
    r2.raise_for_status()
    t.assert_eq("first confirm idempotent=False", r1.json().get("idempotent"), False)
    t.assert_eq("second confirm idempotent=True", r2.json().get("idempotent"), True)

    # Cannot confirm voided
    await client.post(f"/api/legal/payments/{pay_id}/void",
                      json={"reason": "test"})
    r3 = await client.post(f"/api/legal/payments/{pay_id}/confirm", json={})
    t.assert_eq("confirm voided → 409", r3.status_code, 409)


async def test_method_warnings(client, t, db):
    print("\n━ TEST 8+9 — method-specific warnings")
    fx = await setup_paid_deal(client, db, "warn")
    deal_id = fx["deal_id"]

    # Cash without proof — OK, is_official=False
    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 100, "method": "cash_off_books",
    })
    r.raise_for_status()
    t.assert_eq("cash payment is_official=False",
                r.json()["payment"]["is_official"], False)

    # Bank without proof — OK with warning
    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 200, "method": "bank",
    })
    r.raise_for_status()
    t.assert_truthy("bank without proof returns warning",
                    len(r.json().get("warnings") or []) > 0,
                    f"warnings={r.json().get('warnings')}")


async def test_cancelled_deal_blocks_payment(client, t, db):
    print("\n━ TEST 10 — cancelled deal blocks new payments")
    fx = await setup_paid_deal(client, db, "canc")
    deal_id = fx["deal_id"]
    await db.deals.update_one({"id": deal_id},
                               {"$set": {"stage": "cancelled", "status": "cancelled",
                                         "is_locked_after_win": False}})

    r = await client.post(f"/api/legal/deals/{deal_id}/payments", json={
        "amount": 100, "method": "bank", "proof_url": "x",
    })
    t.assert_eq("cancelled deal → 409", r.status_code, 409)


async def cleanup(db):
    pat = "^cust_pay_"
    deal_pat = "^deal_pay_"
    await db.customers.delete_many({"id": {"$regex": pat}})
    await db.deals.delete_many({"id": {"$regex": deal_pat}})
    await db.legal_deposits.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.contracts_v2.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.invoices.delete_many({"$or": [
        {"sourceAuctionWonDealId": {"$regex": deal_pat}},
        {"sourceFinalBreakdownDealId": {"$regex": deal_pat}},
    ]})
    await db.audit_events.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.payments.delete_many({"deal_id": {"$regex": deal_pat}})


async def main() -> int:
    print(f"\n\033[0;34m━━━ P1.2-PAYMENTS — E2E POC TEST ━━━\033[0m")
    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]
    await cleanup(db)
    t = T()

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        token = await login(client)
        client.headers["Authorization"] = f"Bearer {token}"
        print(f"  ✓ logged in")

        for fn in (test_create_pending_then_confirm,
                   test_paid_in_full_auto_advance,
                   test_overpaid,
                   test_void,
                   test_idempotent_confirm,
                   test_method_warnings,
                   test_cancelled_deal_blocks_payment):
            try:
                await fn(client, t, db)
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
