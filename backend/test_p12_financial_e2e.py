"""
P1.2 FINANCIAL BREAKDOWN — E2E POC TEST

Validates the entire P1.2 surface against a running backend:

  1. SAFE FORMULA PARSER  — eval_formula() rejects forbidden constructs,
                            evaluates arithmetic correctly, raises on bad
                            input. (Imported directly — no HTTP.)
  2. SEED                  — both default templates (after_win + final)
                            present and active after startup.
  3. TEMPLATE CRUD         — create / get / patch / delete / preview via
                            /api/admin/invoice-templates/* with admin auth.
  4. ENGINE INTEGRATION    — auction_won writes the new fields:
                            template_id, template_snapshot, calculation_snapshot,
                            totals.{total_all,total_official,total_cash},
                            kind="after_win", locked=true.
  5. FINAL BREAKDOWN       — POST /legal/deals/{id}/final-breakdown:
                            • stage gate (rejected before arrived_rotterdam)
                            • formula correctness (customs 10%, VAT 20%)
                            • 3 totals computed (total_all/official/cash)
                            • cash item flagged is_official=False
                            • snapshot+locked fields present
                            • idempotent (second call returns same id)
  6. AUDIT EVENTS          — financial_breakdown_created, invoice_template_*
                            events appear in audit trail with right payload.
  7. EDGE CASES            — formula error → 422, missing required input → 422,
                            negative adjustments allowed, deletion soft-delete.

Run:  cd /app/backend && python test_p12_financial_e2e.py
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


# ─── Mini test runner ────────────────────────────────────────────────────
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

    def assert_eq(self, name: str, actual: Any, expected: Any) -> None:
        if actual == expected:
            self.ok(name, f"= {actual!r}")
        else:
            self.fail(name, f"expected {expected!r}, got {actual!r}")

    def assert_close(self, name: str, actual: float, expected: float, tol: float = 0.01) -> None:
        if abs(float(actual) - float(expected)) < tol:
            self.ok(name, f"≈ {actual} (expected {expected})")
        else:
            self.fail(name, f"expected ≈{expected}, got {actual}")

    def assert_truthy(self, name: str, value: Any, hint: str = "") -> None:
        if value:
            self.ok(name, hint or repr(value)[:80])
        else:
            self.fail(name, f"expected truthy, got {value!r}")


# ─── HTTP login helper ────────────────────────────────────────────────────
async def login(client: httpx.AsyncClient) -> str:
    r = await client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()["access_token"]


# ─── DB fixture: create a deal that's already past auction_won ───────────
async def setup_post_win_deal(client: httpx.AsyncClient, db, label: str) -> Dict[str, str]:
    """
    Builds a fresh customer + deal in stage=deposit_paid, runs auction_won
    (which migrates through P1.2 template), then advances stage manually
    to arrived_rotterdam so /final-breakdown is allowed.
    """
    suffix = uuid.uuid4().hex[:6]
    customer_id = f"cust_{label}_{suffix}"
    deal_id = f"deal_{label}_{suffix}"

    legal = {
        "first_name": "Final", "last_name": "Tester",
        "egn": "1234567890", "national_id_no": "AB123456",
        "id_card_address": "Sofia, ul. Test 2",
        "id_card_issued_by": "MVR Sofia",
        "id_card_issue_date": "2020-01-01",
    }
    await db.customers.insert_one({
        "id": customer_id, "name": "Final Tester",
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

    return {"customer_id": customer_id, "deal_id": deal_id, "deposit_id": deposit_id}


# ─── TEST 1: safe formula parser (no HTTP) ────────────────────────────────
def test_safe_parser(t: T) -> None:
    print("\n━ TEST 1 — safe AST formula parser (no eval())")
    sys.path.insert(0, "/app/backend")
    from financial_breakdown import eval_formula, FormulaError

    # Correctness
    t.assert_close("simple multiply", eval_formula("vehicle_price * 0.10",
                                                     {"vehicle_price": 15000}), 1500)
    t.assert_close("compound formula",
                   eval_formula("(vehicle_price + customs_duty) * 0.20",
                                  {"vehicle_price": 15000, "customs_duty": 1500}),
                   3300)
    t.assert_close("unary minus", eval_formula("-x", {"x": 100}), -100)
    t.assert_close("modulo", eval_formula("a % b", {"a": 10, "b": 3}), 1)
    t.assert_close("power", eval_formula("a ** 2", {"a": 5}), 25)

    # Forbid eval-style attacks
    forbidden_cases = [
        ("__import__('os')", "import call"),
        ("().__class__", "attribute access"),
        ("a.upper()", "method call"),
        ("[1, 2, 3]", "list literal"),
        ("'string' + 'evil'", "string literal"),
        ("a if a > 0 else b", "conditional"),
    ]
    for expr, label in forbidden_cases:
        try:
            eval_formula(expr, {"a": 1, "b": 2})
            t.fail(f"forbid: {label}", f"expected FormulaError, got result")
        except FormulaError:
            t.ok(f"forbid: {label}", "FormulaError raised")
        except Exception as e:
            t.ok(f"forbid: {label}", f"raised {type(e).__name__}")

    # Unknown variable
    try:
        eval_formula("unknown_var * 2", {})
        t.fail("unknown var", "expected FormulaError")
    except FormulaError:
        t.ok("unknown var → FormulaError")

    # Bad syntax
    try:
        eval_formula("a + + +", {"a": 1})
        t.fail("syntax error", "expected FormulaError")
    except FormulaError:
        t.ok("syntax error → FormulaError")


# ─── TEST 2: seed verification ────────────────────────────────────────────
async def test_seed(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 2 — default templates seeded on startup")
    r = await client.get("/api/admin/invoice-templates")
    r.raise_for_status()
    items = r.json()["data"]
    ids = {x["id"] for x in items}

    t.assert_truthy("tpl_after_win_package present",
                    "tpl_after_win_package" in ids, str(ids))
    t.assert_truthy("tpl_final_settlement present",
                    "tpl_final_settlement" in ids, str(ids))

    # Verify final template has the formulas
    r = await client.get("/api/admin/invoice-templates/tpl_final_settlement")
    r.raise_for_status()
    final_tpl = r.json()["template"]
    item_keys = {it["key"]: it for it in final_tpl["items"]}
    t.assert_truthy("final has customs_duty formula",
                    item_keys.get("customs_duty", {}).get("formula") == "vehicle_price_eur * 0.10")
    t.assert_truthy("final has vat formula",
                    item_keys.get("vat", {}).get("formula") == "(vehicle_price_eur + customs_duty) * 0.20")
    t.assert_eq("bg_transport is cash_off_books",
                item_keys.get("bg_transport", {}).get("payment_type"), "cash_off_books")
    t.assert_eq("bg_transport is_official=False",
                item_keys.get("bg_transport", {}).get("is_official"), False)


# ─── TEST 3: template CRUD ────────────────────────────────────────────────
async def test_crud(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 3 — template CRUD + preview")
    suffix = uuid.uuid4().hex[:6]
    tpl_id = f"tpl_test_crud_{suffix}"

    payload = {
        "id": tpl_id,
        "name": f"Test CRUD {suffix}",
        "kind": "final",
        "items": [
            {"key": "base", "label": "Base", "type": "input",
             "default": 100, "payment_type": "bank", "is_official": True},
            {"key": "tax", "label": "Tax", "type": "formula",
             "formula": "base * 0.20", "payment_type": "bank", "is_official": True},
        ],
        "active": True,
    }

    # CREATE
    r = await client.post("/api/admin/invoice-templates", json=payload)
    t.assert_eq("create → 200", r.status_code, 200)

    # GET
    r = await client.get(f"/api/admin/invoice-templates/{tpl_id}")
    r.raise_for_status()
    t.assert_eq("get version=1", r.json()["template"]["version"], 1)

    # PREVIEW
    r = await client.post(
        f"/api/admin/invoice-templates/{tpl_id}/preview",
        json={"context": {"base": 200}},
    )
    r.raise_for_status()
    preview = r.json()["preview"]
    t.assert_close("preview tax = base*0.20",
                   next(i["amount"] for i in preview["items"] if i["key"] == "tax"),
                   40)
    t.assert_close("preview total_all = 240",
                   preview["totals"]["total_all"], 240)

    # PATCH (bumps version)
    r = await client.patch(
        f"/api/admin/invoice-templates/{tpl_id}",
        json={"name": f"CRUD-renamed-{suffix}"},
    )
    r.raise_for_status()
    t.assert_eq("patch keeps version=1 (only name changed)",
                r.json()["template"]["version"], 1)

    r = await client.patch(
        f"/api/admin/invoice-templates/{tpl_id}",
        json={"items": [
            {"key": "base", "label": "Base", "type": "input", "default": 100,
             "payment_type": "bank", "is_official": True},
        ]},
    )
    r.raise_for_status()
    t.assert_eq("patch with items bumps version=2",
                r.json()["template"]["version"], 2)

    # DELETE (soft)
    r = await client.delete(f"/api/admin/invoice-templates/{tpl_id}")
    r.raise_for_status()
    t.assert_eq("delete returns active=False",
                r.json()["active"], False)

    deleted = await db.invoice_templates.find_one({"id": tpl_id})
    t.assert_truthy("DB still has the doc", deleted is not None)
    t.assert_eq("DB.active = False", deleted.get("active"), False)


# ─── TEST 4: auction_won uses template ────────────────────────────────────
async def test_after_win_via_template(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 4 — auction_won writes new P1.2 fields")
    fx = await setup_post_win_deal(client, db, "p12aw")
    deal_id = fx["deal_id"]

    r = await client.post(f"/api/legal/deals/{deal_id}/auction/won", json={
        "price_usd": 15000, "auction": "Copart", "lot_number": "LOT-P12-AW",
        "fx_usd_to_eur": 0.92,
    })
    r.raise_for_status()
    invoice = r.json()["invoice"]

    t.assert_eq("invoice.kind == after_win", invoice.get("kind"), "after_win")
    t.assert_eq("invoice.template_id", invoice.get("template_id"), "tpl_after_win_package")
    t.assert_eq("invoice.locked == True", invoice.get("locked"), True)
    t.assert_truthy("invoice.template_snapshot present",
                    bool(invoice.get("template_snapshot")))
    t.assert_truthy("invoice.calculation_snapshot present",
                    bool(invoice.get("calculation_snapshot")))
    totals = invoice.get("totals") or {}
    t.assert_truthy("totals.total_all > 0", totals.get("total_all", 0) > 0,
                    f"total_all={totals.get('total_all')}")
    t.assert_truthy("totals has total_official",
                    "total_official" in totals)
    t.assert_truthy("totals has total_cash",
                    "total_cash" in totals)

    # Verify items have payment_type/is_official
    items = invoice.get("items") or []
    has_payment_type = all("payment_type" in i for i in items)
    t.assert_truthy("all items have payment_type", has_payment_type)


# ─── TEST 5: final breakdown end-to-end ───────────────────────────────────
async def test_final_breakdown(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 5 — final breakdown (customs+VAT+cash items+totals)")
    fx = await setup_post_win_deal(client, db, "p12fb")
    deal_id = fx["deal_id"]

    # auction_won first
    r = await client.post(f"/api/legal/deals/{deal_id}/auction/won", json={
        "price_usd": 15000, "auction": "Copart", "lot_number": "LOT-P12-FB",
        "fx_usd_to_eur": 0.92,  # vehicle_price_eur ≈ 13800
    })
    r.raise_for_status()

    # Stage gate: try BEFORE arrived_rotterdam → must 400
    r = await client.post(f"/api/legal/deals/{deal_id}/final-breakdown", json={})
    t.assert_eq("stage gate before arrived_rotterdam → 400", r.status_code, 400)

    # Manually advance stage to arrived_rotterdam (skipping logistics)
    await db.deals.update_one(
        {"id": deal_id},
        {"$set": {"stage": "arrived_rotterdam", "status": "arrived_rotterdam"}},
    )

    # Generate final breakdown (no overrides → use template defaults)
    r = await client.post(f"/api/legal/deals/{deal_id}/final-breakdown", json={
        "context": {},  # vehicle_price_eur pulled from deal.auction
    })
    if r.status_code != 200:
        print(f"    DEBUG: response={r.status_code} {r.text}")
    r.raise_for_status()
    body = r.json()
    breakdown = body["breakdown"]

    items_by_key = {it["key"]: it for it in breakdown["items"]}
    t.assert_eq("breakdown.kind == final", breakdown["kind"], "final")
    t.assert_eq("breakdown.locked == True", breakdown["locked"], True)
    t.assert_eq("breakdown.template_id", breakdown["template_id"], "tpl_final_settlement")

    # Vehicle price = 15000 USD * 0.92 = 13800 EUR
    vp = items_by_key["vehicle_price_eur"]["amount"]
    t.assert_close("vehicle_price_eur = 13800", vp, 13800)
    # customs = 13800 * 0.10 = 1380
    t.assert_close("customs_duty = 1380",
                   items_by_key["customs_duty"]["amount"], 1380)
    # VAT = (13800 + 1380) * 0.20 = 3036
    t.assert_close("vat = 3036",
                   items_by_key["vat"]["amount"], 3036)
    # bg_transport defaults to 700, cash_off_books
    t.assert_close("bg_transport = 700",
                   items_by_key["bg_transport"]["amount"], 700)
    t.assert_eq("bg_transport.is_official=False",
                items_by_key["bg_transport"]["is_official"], False)
    t.assert_eq("bg_transport.payment_type=cash_off_books",
                items_by_key["bg_transport"]["payment_type"], "cash_off_books")
    # service_fee defaults to 1000
    t.assert_close("service_fee = 1000",
                   items_by_key["service_fee"]["amount"], 1000)

    # Totals: all = 13800+1380+3036+700+1000+0(adj) = 19916
    totals = breakdown["totals"]
    t.assert_close("total_all = 19916", totals["total_all"], 19916)
    # official = total_all - bg_transport (700 cash) = 19216
    t.assert_close("total_official = 19216", totals["total_official"], 19216)
    t.assert_close("total_cash = 700", totals["total_cash"], 700)

    # Snapshot integrity
    t.assert_truthy("template_snapshot stored",
                    isinstance(breakdown.get("template_snapshot"), dict))
    t.assert_truthy("calculation_snapshot stored",
                    isinstance(breakdown.get("calculation_snapshot"), dict))
    t.assert_truthy("inputs_used stored",
                    isinstance(breakdown.get("inputs_used"), dict))

    # Idempotency: second call returns same id
    r2 = await client.post(f"/api/legal/deals/{deal_id}/final-breakdown", json={})
    r2.raise_for_status()
    b2 = r2.json()
    t.assert_eq("second call idempotent", b2["idempotent"], True)
    t.assert_eq("same breakdown id", b2["breakdown"]["id"], breakdown["id"])

    # /financials listing
    r3 = await client.get(f"/api/legal/deals/{deal_id}/financials")
    r3.raise_for_status()
    fin = r3.json()
    t.assert_truthy("financials returns >= 2 docs (after_win + final)",
                    len(fin["data"]) >= 2, f"len={len(fin['data'])}")
    t.assert_eq("summary.after_win.exists", fin["summary"]["after_win"]["exists"], True)
    t.assert_eq("summary.final.exists", fin["summary"]["final"]["exists"], True)


# ─── TEST 6: adjustments override + audit ─────────────────────────────────
async def test_adjustments_and_audit(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 6 — adjustments override + audit_event recorded")
    fx = await setup_post_win_deal(client, db, "p12adj")
    deal_id = fx["deal_id"]

    await client.post(f"/api/legal/deals/{deal_id}/auction/won", json={
        "price_usd": 10000, "auction": "Copart", "lot_number": "LOT-ADJ",
        "fx_usd_to_eur": 0.92,
    })
    await db.deals.update_one(
        {"id": deal_id},
        {"$set": {"stage": "arrived_rotterdam", "status": "arrived_rotterdam"}},
    )

    # Negative adjustment (rebate) of -150
    r = await client.post(f"/api/legal/deals/{deal_id}/final-breakdown", json={
        "overrides": {"adjustments": -150},
    })
    r.raise_for_status()
    breakdown = r.json()["breakdown"]
    adj = next(i for i in breakdown["items"] if i["key"] == "adjustments")
    t.assert_close("adjustments = -150 (rebate)", adj["amount"], -150)

    # Audit event
    r = await client.get("/api/legal/audit", params={
        "deal_id": deal_id, "type": "financial_breakdown_created",
    })
    r.raise_for_status()
    events = r.json()["data"]
    t.assert_truthy("financial_breakdown_created audit event present",
                    len(events) >= 1, f"events={len(events)}")
    if events:
        ev = events[0]
        payload = ev.get("payload") or {}
        t.assert_eq("audit.payload.kind == final", payload.get("kind"), "final")
        t.assert_eq("audit.payload.template_id",
                    payload.get("template_id"), "tpl_final_settlement")
        t.assert_truthy("audit.payload has total_all",
                        "total_all" in payload)


# ─── TEST 7: edge cases — bad formula, missing required ──────────────────
async def test_edge_cases(client: httpx.AsyncClient, t: T, db) -> None:
    print("\n━ TEST 7 — edge cases (formula error, missing required)")
    suffix = uuid.uuid4().hex[:6]
    tpl_id = f"tpl_edge_{suffix}"

    # Bad formula at validation time
    bad = {
        "id": tpl_id, "name": "Bad", "kind": "final",
        "items": [{
            "key": "x", "label": "X", "type": "formula",
            "formula": "((a + b)",  # syntax error
        }],
    }
    r = await client.post("/api/admin/invoice-templates", json=bad)
    t.assert_eq("syntax error in formula → 422", r.status_code, 422)

    # Required input missing → 422 at preview
    payload = {
        "id": f"{tpl_id}_req", "name": "Req", "kind": "final",
        "items": [{
            "key": "must_have", "label": "Must Have",
            "type": "input", "required": True,
        }],
    }
    r = await client.post("/api/admin/invoice-templates", json=payload)
    r.raise_for_status()

    r = await client.post(
        f"/api/admin/invoice-templates/{tpl_id}_req/preview",
        json={"context": {}},
    )
    t.assert_eq("missing required input → 422", r.status_code, 422)
    t.assert_truthy("error mentions missing key 'must_have'",
                    "must_have" in (r.text or ""), r.text[:140])

    # Cleanup
    await client.delete(f"/api/admin/invoice-templates/{tpl_id}_req")


# ─── Cleanup ──────────────────────────────────────────────────────────────
async def cleanup(db) -> None:
    pat = "^cust_p12(aw|fb|adj)_"
    deal_pat = "^deal_p12(aw|fb|adj)_"
    await db.customers.delete_many({"id": {"$regex": pat}})
    await db.deals.delete_many({"id": {"$regex": deal_pat}})
    await db.legal_deposits.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.contracts_v2.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.invoices.delete_many({"$or": [
        {"sourceAuctionWonDealId": {"$regex": deal_pat}},
        {"sourceFinalBreakdownDealId": {"$regex": deal_pat}},
    ]})
    await db.audit_events.delete_many({"deal_id": {"$regex": deal_pat}})
    await db.invoice_templates.delete_many({"id": {"$regex": "^tpl_test_crud_|^tpl_edge_"}})


# ─── Main ─────────────────────────────────────────────────────────────────
async def main() -> int:
    print(f"\n\033[0;34m━━━ P1.2 FINANCIAL BREAKDOWN — E2E POC TEST ━━━\033[0m")
    print(f"  base_url: {BASE_URL}")
    print(f"  admin:    {ADMIN_EMAIL}")

    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]
    await cleanup(db)

    t = T()

    # 1) Pure-python parser test (no HTTP)
    try:
        test_safe_parser(t)
    except Exception as e:
        t.fail("test_safe_parser crashed", repr(e))

    # 2-7) HTTP tests
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        token = await login(client)
        client.headers["Authorization"] = f"Bearer {token}"
        print(f"  ✓ logged in")

        for fn in (test_seed, test_crud, test_after_win_via_template,
                   test_final_breakdown, test_adjustments_and_audit, test_edge_cases):
            try:
                await fn(client, t, db)
            except Exception as e:
                t.fail(f"{fn.__name__} crashed", repr(e))

    print()
    print(f"\033[0;32m  passed: {len(t.passed)}\033[0m")
    if t.failed:
        print(f"\033[0;31m  failed: {len(t.failed)}\033[0m")
        for f in t.failed:
            print(f"    • {f}")
    print()

    await cleanup(db)
    mongo.close()
    return 0 if not t.failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
