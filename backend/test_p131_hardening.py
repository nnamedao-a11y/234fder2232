"""
P1.3.1 HARDENING — E2E test (10 сценариев).

Покрытие:
  H1  : auction_locked + is_locked_after_win flags set on deal after win
  H2  : Concurrent double-POST → only ONE creates artifacts (race-safety)
  H3  : New deposit on locked deal → 409 (post-win freeze)
  H4  : confirm-payment of pending deposit on locked deal → 409
  H5  : FX snapshot persisted on deal/contract/invoice
  H6  : invoice.deposit_id == funded deposit's id
  H7  : invoice.deposit_applied_eur == paid_amount_eur
  H8  : Reverse link: legal_deposits.applied_to_invoice_id set
  H9  : audit_events записан для auction_won (event_type, deal_id, payload)
  H10 : audit_events записан для deposit_created

Запуск: cd /app/backend && python test_p131_hardening.py
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


async def seed_deal_with_deposit(suffix: str, deal_stage: str = "searching_at_auction",
                                  paid_eur: float = 1500.0):
    """Customer + deal + paid_confirmed deposit. Чистит старые артефакты."""
    db = _db()
    cid = f"cust_p131_{suffix}"
    did = f"deal_p131_{suffix}"
    await db.customers.update_one(
        {"id": cid},
        {"$set": {
            "id": cid, "firstName": "P131", "lastName": suffix,
            "email": f"p131_{suffix}@x.com",
            "legal": {
                "first_name": "P131", "last_name": suffix,
                "egn": "9901011234", "national_id_no": "BG1",
                "id_card_address": "Sofia, str X 1", "id_card_issued_by": "MVR",
                "id_card_issue_date": "2020-01-01",
            },
        }}, upsert=True,
    )
    # Сбрасываем lock-флаги перед сидингом
    await db.deals.update_one(
        {"id": did},
        {"$set": {
            "id": did, "title": f"deal {suffix}", "customerId": cid,
            "stage": deal_stage, "status": deal_stage,
            "vin": f"P131{suffix.upper()}xxxxxxxx"[:17],
            "max_bid_usd": 15000,
        },
         "$unset": {
            "auction_locked": "", "auction_locked_at": "",
            "auction_locked_by": "", "is_locked_after_win": "",
            "fx_rate_snapshot": "", "auction": "", "final_contract_id": "",
        }}, upsert=True,
    )
    # Чистим артефакты от предыдущих прогонов
    await db.contracts_v2.delete_many({"deal_id": did})
    await db.invoices.delete_many({"$or": [{"sourceAuctionWonDealId": did}, {"dealId": did}]})
    await db.audit_events.delete_many({"deal_id": did})
    dep_id = f"dep_p131_{suffix}"
    await db.legal_deposits.update_one(
        {"deal_id": did},
        {"$set": {
            "id": dep_id,
            "deal_id": did, "customer_id": cid,
            "status": "paid_confirmed",
            "paid_amount_eur": paid_eur,
            "max_bid_usd": 15000.0,
            "search_timer_deadline_at": (datetime.now(timezone.utc).isoformat()),
        },
         "$unset": {"applied_to_invoice_id": "", "applied_at": ""}},
        upsert=True,
    )
    return cid, did, dep_id


async def main():
    token = await get_token()
    headers = {"Authorization": f"Bearer {token}"}
    db = _db()
    results = []
    fail = 0

    async with httpx.AsyncClient(base_url=API, headers=headers, timeout=15.0) as http:

        # ─── H1: lock flags set after win ─────────────────────────────────
        cid1, did1, dep1 = await seed_deal_with_deposit("h1", "searching_at_auction", 1500.0)
        r = await http.post(f"/api/legal/deals/{did1}/auction/won", json={
            "price_usd": 15000, "auction": "Copart", "lot_number": "H1-LOT",
        })
        ok = r.status_code == 200
        deal = await db.deals.find_one({"id": did1})
        ok = ok and deal.get("auction_locked") is True \
             and deal.get("is_locked_after_win") is True \
             and deal.get("auction_locked_by") \
             and deal.get("auction_locked_at")
        results.append(("H1: auction_locked + is_locked_after_win set", ok,
                        f"locked={deal.get('auction_locked')}, "
                        f"win_lock={deal.get('is_locked_after_win')}"))
        if not ok: fail += 1

        # ─── H2: concurrent race — only one creates artifacts ──────────────
        cid2, did2, dep2 = await seed_deal_with_deposit("h2", "searching_at_auction")
        # Параллельно отправляем 5 одинаковых запросов
        async def fire():
            return await http.post(f"/api/legal/deals/{did2}/auction/won", json={
                "price_usd": 12000, "auction": "Copart", "lot_number": "RACE",
            })
        responses = await asyncio.gather(*(fire() for _ in range(5)))
        statuses = [r.status_code for r in responses]
        bodies = [r.json() for r in responses if r.status_code == 200]
        # Должна быть ровно 1 запись contract+invoice
        n_contracts = await db.contracts_v2.count_documents({"deal_id": did2, "type": "final"})
        n_invoices = await db.invoices.count_documents({"sourceAuctionWonDealId": did2})
        # Хотя бы один success-non-idempotent + остальные idempotent
        winners = [b for b in bodies if not b.get("idempotent") and b.get("contract_created")]
        ok = (n_contracts == 1 and n_invoices == 1 and len(winners) == 1
              and all(s in (200, 409) for s in statuses))
        results.append(("H2: concurrent race-safe (5 simul → 1 winner)", ok,
                        f"statuses={statuses}, contracts={n_contracts}, invoices={n_invoices}, "
                        f"winners={len(winners)}"))
        if not ok: fail += 1

        # ─── H3: new deposit on locked deal → 409 ──────────────────────────
        # Используем locked deal из H1
        r = await http.post("/api/legal/deposits", json={
            "customer_id": cid1, "deal_id": did1,
            "max_bid_usd": 5000, "paid_amount_eur": 500,
        })
        ok = r.status_code == 409
        results.append(("H3: new deposit on locked deal → 409", ok,
                        f"http={r.status_code}"))
        if not ok: fail += 1

        # ─── H4: confirm pending deposit on locked deal → 409 ──────────────
        # Создаём pending depo на свежей сделке и потом блокируем deal вручную
        cid4, did4, _ = await seed_deal_with_deposit("h4", "searching_at_auction")
        # Создаём дополнительный pending депозит
        r_dep = await http.post("/api/legal/deposits", json={
            "customer_id": cid4, "deal_id": did4,
            "max_bid_usd": 8000, "paid_amount_eur": 1000,
        })
        new_dep_id = r_dep.json()["deposit"]["id"]
        # Лочим сделку через прямой апдейт БД (имитируем post-win)
        await db.deals.update_one({"id": did4}, {"$set": {"is_locked_after_win": True}})
        r = await http.put(f"/api/legal/deposits/{new_dep_id}/confirm-payment", json={})
        ok = r.status_code == 409
        results.append(("H4: confirm-payment on locked deal → 409", ok,
                        f"http={r.status_code}"))
        if not ok: fail += 1

        # ─── H5: fx_rate_snapshot persisted on deal/contract/invoice ───────
        cid5, did5, _ = await seed_deal_with_deposit("h5", "searching_at_auction")
        r = await http.post(f"/api/legal/deals/{did5}/auction/won", json={
            "price_usd": 10000, "auction": "Copart", "fx_usd_to_eur": 0.94,
        })
        body = r.json()
        deal = await db.deals.find_one({"id": did5})
        contract = await db.contracts_v2.find_one({"deal_id": did5, "type": "final"})
        invoice = await db.invoices.find_one({"sourceAuctionWonDealId": did5})
        ok = (deal.get("fx_rate_snapshot") == 0.94
              and contract.get("fx_rate_snapshot") == 0.94
              and invoice.get("fx_rate_snapshot") == 0.94
              and body.get("fx_rate_snapshot") == 0.94)
        results.append(("H5: fx_rate_snapshot persisted everywhere", ok,
                        f"deal={deal.get('fx_rate_snapshot')}, "
                        f"contract={contract.get('fx_rate_snapshot')}, "
                        f"invoice={invoice.get('fx_rate_snapshot')}"))
        if not ok: fail += 1

        # ─── H6: invoice.deposit_id == funded deposit id ───────────────────
        ok = invoice.get("deposit_id") and invoice.get("deposit_id").startswith("dep_p131_h5")
        results.append(("H6: invoice.deposit_id == deposit.id (hard link)", ok,
                        f"deposit_id={invoice.get('deposit_id')}"))
        if not ok: fail += 1

        # ─── H7: invoice.deposit_applied_eur == paid_amount_eur ───────────
        ok = invoice.get("deposit_applied_eur") == 1500.0
        results.append(("H7: invoice.deposit_applied_eur == 1500", ok,
                        f"applied={invoice.get('deposit_applied_eur')}"))
        if not ok: fail += 1

        # ─── H8: reverse link on deposit ──────────────────────────────────
        dep_h5 = await db.legal_deposits.find_one({"deal_id": did5})
        ok = (dep_h5.get("applied_to_invoice_id") == invoice.get("id")
              and dep_h5.get("applied_at"))
        results.append(("H8: deposit.applied_to_invoice_id reverse link", ok,
                        f"applied_to_invoice={dep_h5.get('applied_to_invoice_id')}"))
        if not ok: fail += 1

        # ─── H9: audit_events for auction_won ─────────────────────────────
        audit = await db.audit_events.find_one(
            {"type": "auction_won", "deal_id": did5}
        )
        ok = (audit is not None
              and audit.get("entity_type") == "deal"
              and audit.get("entity_id") == did5
              and audit.get("user_email")
              and audit.get("payload", {}).get("price_usd") == 10000.0
              and audit.get("payload", {}).get("fx_rate_snapshot") == 0.94)
        results.append(("H9: audit_events.auction_won written", ok,
                        f"audit={audit.get('id') if audit else 'NA'}"))
        if not ok: fail += 1

        # ─── H10: audit_events for deposit_created ────────────────────────
        # Сделаем чистый seed (deposit_created audit пишется при /api/legal/deposits)
        cid10 = "cust_p131_h10"
        did10 = "deal_p131_h10"
        await db.customers.update_one({"id": cid10}, {"$set": {
            "id": cid10, "firstName": "P131", "lastName": "h10",
            "email": "p131_h10@x.com",
            "legal": {
                "first_name": "P131", "last_name": "h10", "egn": "9901011234",
                "national_id_no": "BG1", "id_card_address": "addr",
                "id_card_issued_by": "MVR", "id_card_issue_date": "2020-01-01",
            }
        }}, upsert=True)
        await db.deals.update_one({"id": did10}, {"$set": {
            "id": did10, "title": "h10", "customerId": cid10,
            "stage": "qualified", "status": "qualified",
        }, "$unset": {"is_locked_after_win": ""}}, upsert=True)
        await db.audit_events.delete_many({"deal_id": did10})
        r = await http.post("/api/legal/deposits", json={
            "customer_id": cid10, "deal_id": did10,
            "max_bid_usd": 8000, "paid_amount_eur": 800,
        })
        ok_http = r.status_code == 200
        new_dep = r.json()["deposit"]["id"]
        audit_dep = await db.audit_events.find_one(
            {"type": "deposit_created", "entity_id": new_dep}
        )
        ok = (ok_http and audit_dep is not None
              and audit_dep.get("payload", {}).get("max_bid_usd") == 8000.0)
        results.append(("H10: audit_events.deposit_created written", ok,
                        f"audit={audit_dep.get('id') if audit_dep else 'NA'}"))
        if not ok: fail += 1

    print("\n" + "=" * 70)
    print(" P1.3.1 HARDENING — E2E TEST RESULTS")
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
