"""
P1.3 Auction Events — E2E test.

Покрытие сценариев (10):
  S1  : auction_won из searching_at_auction → stage=auction_won, contract+invoice созданы
  S2  : invoice items соответствуют after_win_package шаблону (5 позиций с deposit applied)
  S3  : invoice.linked_contract_id = contract.id (связь жёсткая)
  S4  : final_contract_id записан в deal
  S5  : повторный POST идемпотентен (idempotent=true, тот же contract+invoice id)
  S6  : из стадии lead → 400 Bad Request
  S7  : без paid_confirmed депозита → 409 Conflict
  S8  : auction_won из auction_lost → разрешено (повторная попытка)
  S9  : кастомные fee/delivery/service переопределяют дефолты
  S10 : depozit_eur = 0 → в items НЕТ строки "Deposit applied"

Запуск:
  cd /app/backend && python test_p13_auction.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("BIBI_API", "http://localhost:8001")
ADMIN = ("admin@bibi.cars",
         os.environ.get("BIBI_ADMIN_PASSWORD") or "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu")

OK = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"


def _db():
    mc = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    return mc[os.environ.get("DB_NAME", "test_database")]


async def get_token() -> str:
    async with httpx.AsyncClient(base_url=API, timeout=10.0) as c:
        r = await c.post("/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
        r.raise_for_status()
        return r.json()["access_token"]


async def seed_deal(suffix: str, deal_stage: str = "searching_at_auction",
                     with_deposit: bool = True):
    """Customer + deal, опционально с paid_confirmed депозитом."""
    db = _db()
    cid = f"cust_p13_{suffix}"
    did = f"deal_p13_{suffix}"
    await db.customers.update_one(
        {"id": cid},
        {"$set": {
            "id": cid, "firstName": "P13", "lastName": suffix,
            "email": f"p13_{suffix}@x.com",
            "legal": {
                "first_name": "P13", "last_name": suffix,
                "egn": "9901011234", "national_id_no": "BG1",
                "id_card_address": "Sofia, str X 1", "id_card_issued_by": "MVR",
                "id_card_issue_date": "2020-01-01",
            },
        }}, upsert=True,
    )
    await db.deals.update_one(
        {"id": did},
        {"$set": {
            "id": did, "title": f"deal {suffix}", "customerId": cid,
            "stage": deal_stage, "status": deal_stage,
            "vin": f"P13{suffix.upper()}xxxxxxxxxxx"[:17],
            "max_bid_usd": 15000,
        }}, upsert=True,
    )
    # Чистим артефакты от предыдущих прогонов
    await db.contracts_v2.delete_many({"deal_id": did})
    await db.invoices.delete_many({"$or": [{"sourceAuctionWonDealId": did}, {"dealId": did}]})

    if with_deposit:
        await db.legal_deposits.update_one(
            {"deal_id": did},
            {"$set": {
                "id": f"dep_p13_{suffix}",
                "deal_id": did, "customer_id": cid,
                "status": "paid_confirmed",
                "paid_amount_eur": 1500.0,
                "max_bid_usd": 15000.0,
                "search_timer_deadline_at":
                    (datetime.now(timezone.utc).isoformat()),
            }}, upsert=True,
        )
    else:
        await db.legal_deposits.delete_many({"deal_id": did})
    return cid, did


async def main():
    token = await get_token()
    headers = {"Authorization": f"Bearer {token}"}
    db = _db()
    results = []
    fail = 0

    async with httpx.AsyncClient(base_url=API, headers=headers, timeout=15.0) as http:

        # ─── S1: happy path ────────────────────────────────────────────────
        cid1, did1 = await seed_deal("s1", "searching_at_auction")
        r = await http.post(f"/api/legal/deals/{did1}/auction/won", json={
            "price_usd": 15000, "auction": "Copart", "lot_number": "LOT-001",
        })
        ok = r.status_code == 200
        body = r.json() if ok else {}
        ok = ok and body.get("success") and body.get("stage") == "auction_won" \
             and body.get("contract", {}).get("id") and body.get("invoice", {}).get("id") \
             and body.get("contract_created") is True \
             and body.get("invoice_created") is True
        deal = await db.deals.find_one({"id": did1})
        ok = ok and deal.get("stage") == "auction_won"
        results.append(("S1: auction_won → stage+contract+invoice created", ok,
                        f"stage={deal.get('stage') if deal else 'NA'}"))
        if not ok: fail += 1
        s1_contract_id = body.get("contract", {}).get("id")
        s1_invoice_id = body.get("invoice", {}).get("id")

        # ─── S2: invoice items ─────────────────────────────────────────────
        # 15000 * 0.92 = 13800 EUR; + 500 + 800 + 1000 - 1500 = 14600
        items = body.get("items") or []
        names = [i["name"] for i in items]
        ok = (len(items) == 5
              and "Vehicle price" in names
              and "Auction fee" in names
              and "Delivery to Rotterdam" in names
              and "Service fee" in names
              and "Deposit applied" in names
              and abs(body.get("total_eur", 0) - 14600) < 1)
        results.append(("S2: invoice items = after_win_package (5 lines)", ok,
                        f"total={body.get('total_eur')}, n_items={len(items)}"))
        if not ok: fail += 1

        # ─── S3: invoice ↔ contract linkage ────────────────────────────────
        inv_doc = await db.invoices.find_one({"id": s1_invoice_id}, {"_id": 0})
        ok = inv_doc and inv_doc.get("linked_contract_id") == s1_contract_id \
             and inv_doc.get("kind") == "after_win_package" \
             and inv_doc.get("status") == "pending"
        results.append(("S3: invoice.linked_contract_id == contract.id", ok,
                        f"linked={inv_doc.get('linked_contract_id') if inv_doc else 'NA'}"))
        if not ok: fail += 1

        # ─── S4: deal.final_contract_id записан ─────────────────────────────
        ok = deal.get("final_contract_id") == s1_contract_id
        results.append(("S4: deal.final_contract_id is set", ok,
                        f"fcid={deal.get('final_contract_id')}"))
        if not ok: fail += 1

        # ─── S5: idempotency ──────────────────────────────────────────────
        r2 = await http.post(f"/api/legal/deals/{did1}/auction/won", json={
            "price_usd": 99999, "auction": "DIFFERENT", "lot_number": "OTHER",
        })
        ok = r2.status_code == 200
        b2 = r2.json() if ok else {}
        ok = ok and b2.get("idempotent") is True \
             and b2.get("contract", {}).get("id") == s1_contract_id \
             and b2.get("invoice", {}).get("id") == s1_invoice_id \
             and b2.get("contract_created") is False \
             and b2.get("invoice_created") is False
        # Дополнительно: ни один новый contract/invoice не должен появиться
        n_contracts = await db.contracts_v2.count_documents({"deal_id": did1, "type": "final"})
        n_invoices = await db.invoices.count_documents({"sourceAuctionWonDealId": did1})
        ok = ok and n_contracts == 1 and n_invoices == 1
        results.append(("S5: idempotency — no duplicate artifacts", ok,
                        f"contracts={n_contracts}, invoices={n_invoices}"))
        if not ok: fail += 1

        # ─── S6: bad stage (lead) → 400 ────────────────────────────────────
        cid6, did6 = await seed_deal("s6", "lead", with_deposit=True)
        r = await http.post(f"/api/legal/deals/{did6}/auction/won", json={
            "price_usd": 10000, "auction": "Copart",
        })
        ok = r.status_code == 400
        results.append(("S6: stage=lead → 400 Bad Request", ok, f"http={r.status_code}"))
        if not ok: fail += 1

        # ─── S7: no funded deposit → 409 ───────────────────────────────────
        cid7, did7 = await seed_deal("s7", "searching_at_auction", with_deposit=False)
        r = await http.post(f"/api/legal/deals/{did7}/auction/won", json={
            "price_usd": 12000, "auction": "IAA",
        })
        ok = r.status_code == 409
        results.append(("S7: no paid_confirmed deposit → 409", ok, f"http={r.status_code}"))
        if not ok: fail += 1

        # ─── S8: auction_lost → auction_won (retry path) ──────────────────
        cid8, did8 = await seed_deal("s8", "auction_lost", with_deposit=True)
        r = await http.post(f"/api/legal/deals/{did8}/auction/won", json={
            "price_usd": 8000, "auction": "Copart", "lot_number": "RETRY-99",
        })
        ok = r.status_code == 200
        b8 = r.json() if ok else {}
        ok = ok and b8.get("stage") == "auction_won" and b8.get("contract_created") is True
        results.append(("S8: auction_lost → auction_won transition allowed", ok,
                        f"stage={b8.get('stage')}"))
        if not ok: fail += 1

        # ─── S9: custom fees override defaults ─────────────────────────────
        cid9, did9 = await seed_deal("s9", "deposit_paid", with_deposit=True)
        r = await http.post(f"/api/legal/deals/{did9}/auction/won", json={
            "price_usd": 10000, "auction": "Manheim",
            "auction_fee_eur": 250, "delivery_eur": 600, "service_fee_eur": 1500,
            "fx_usd_to_eur": 0.95,
        })
        ok = r.status_code == 200
        b9 = r.json() if ok else {}
        # 10000 * 0.95 = 9500 + 250 + 600 + 1500 - 1500 = 10350
        items9 = b9.get("items") or []
        item_map = {i["name"]: i["amount"] for i in items9}
        ok = (ok
              and abs(item_map.get("Vehicle price", 0) - 9500) < 1
              and item_map.get("Auction fee") == 250
              and item_map.get("Delivery to Rotterdam") == 600
              and item_map.get("Service fee") == 1500
              and abs(b9.get("total_eur", 0) - 10350) < 1)
        results.append(("S9: custom auction_fee/delivery/service override defaults", ok,
                        f"total={b9.get('total_eur')}"))
        if not ok: fail += 1

        # ─── S10: deposit_eur = 0 → no Deposit-applied line ──────────────
        cid10, did10 = await seed_deal("s10", "deposit_paid", with_deposit=True)
        # Зануляем paid_amount_eur
        await db.legal_deposits.update_one(
            {"deal_id": did10},
            {"$set": {"paid_amount_eur": 0.0}},
        )
        r = await http.post(f"/api/legal/deals/{did10}/auction/won", json={
            "price_usd": 5000, "auction": "Copart",
        })
        ok = r.status_code == 200
        b10 = r.json() if ok else {}
        items10 = b10.get("items") or []
        names10 = [i["name"] for i in items10]
        ok = (ok and len(items10) == 4 and "Deposit applied" not in names10)
        results.append(("S10: deposit_eur=0 → no 'Deposit applied' item", ok,
                        f"n_items={len(items10)}"))
        if not ok: fail += 1

    # ─── Pretty-print ────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print(" P1.3 AUCTION EVENTS — E2E TEST RESULTS")
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
