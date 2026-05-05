"""
BIBI Cars — Customer Cabinet Financials (P1.2-cabinet)
═══════════════════════════════════════════════════════════════════════════

Customer-facing read API: клиент видит ПОЛНУЮ картину денег по своей сделке.

  • Что должен заплатить (breakdown items + 3 totals)
  • Что уже оплатил (payments list)
  • Сколько осталось (remaining)
  • Какие части идут «официально» (bank/stripe) — для оплаты картой
  • Какие — наличными (cash_off_books) — отображены, но не оплачиваются онлайн

Безопасность:
  • Bearer token customer-session → resolve customerId
  • Customer видит ТОЛЬКО свои сделки (deal.customerId == customer.customerId)
  • Чужая сделка → 404 (не 403, чтобы не enumerate-ить чужие IDs)
  • Не возвращаем audit_events, template_snapshot, calculation_snapshot,
    inputs_used (чтобы не светить внутренние поля)

NOTE: write-эндпоинты (создание платежа, void) НЕДОСТУПНЫ для customer.
Платежи может создать только менеджер вручную или Stripe webhook (P1.2-next).
В этом модуле только READ + кнопка-stub «Pay via Stripe» (returns intent
URL placeholder; реальная Stripe-интеграция — следующий фаза).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException


router = APIRouter(prefix="/api/cabinet", tags=["cabinet-financials"])


# ─── Helpers ──────────────────────────────────────────────────────────────

def _db():
    from server import db as _server_db
    return _server_db


async def _require_customer(authorization: Optional[str]) -> Dict[str, Any]:
    """Resolve customer session; 401 on miss."""
    from server import _require_customer as _server_require
    return await _server_require(authorization)


def _strip_internal(bd: Dict[str, Any]) -> Dict[str, Any]:
    """Remove fields клиенту не нужные/опасные."""
    blacklist = {
        "_id", "template_snapshot", "calculation_snapshot",
        "inputs_used", "linked_contract_id", "auto_created_from",
        "auction",  # contains supplier price + lot info
    }
    return {k: v for k, v in (bd or {}).items() if k not in blacklist}


def _strip_payment(p: Dict[str, Any]) -> Dict[str, Any]:
    """Public-safe payment view — drop creator/internal history."""
    if not p:
        return p
    return {
        "id": p.get("id"),
        "amount": p.get("amount"),
        "currency": p.get("currency"),
        "method": p.get("method"),
        "is_official": p.get("is_official"),
        "status": p.get("status"),
        "proof_url": p.get("proof_url"),
        "bank_received_at": p.get("bank_received_at"),
        "confirmed_at": p.get("confirmed_at"),
        "created_at": p.get("created_at"),
        "void_reason": p.get("void_reason") if p.get("status") == "voided" else None,
    }


async def _customer_owns_deal(db, customer_id: str, deal_id: str) -> bool:
    deal = await db.deals.find_one(
        {
            "$and": [
                {"$or": [{"id": deal_id}, {"_id": deal_id}]},
                {"$or": [{"customerId": customer_id}, {"customer_id": customer_id}]},
            ],
        },
        {"id": 1},
    )
    return bool(deal)


# ─── Endpoints ────────────────────────────────────────────────────────────

@router.get("/deals")
async def list_my_deals(authorization: Optional[str] = Header(None)):
    """List of all deals for the authenticated customer.
    Used by the cabinet's deal selector to populate the "my deals" dropdown.
    """
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")
    db = _db()
    cursor = db.deals.find(
        {"$or": [{"customerId": customer_id}, {"customer_id": customer_id}]},
        {"_id": 0, "id": 1, "title": 1, "vin": 1, "stage": 1, "status": 1,
         "payment_status": 1, "payment_summary": 1, "created_at": 1},
    ).sort("created_at", -1).limit(50)
    deals = await cursor.to_list(length=50)
    return {"success": True, "data": deals, "total": len(deals)}


@router.get("/deals/{deal_id}/financials")
async def get_my_deal_financials(
    deal_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Полная финансовая картина по СВОЕЙ сделке.

    Returns:
      {
        deal: {id, stage, payment_status, payment_summary, created_at, ...},
        breakdowns: [{id, kind, items, totals, locked, fx_rate_snapshot, ...}],
        payments: [{id, amount, method, status, proof_url, ...}],
        summary: {paid_total, paid_official, paid_cash, total_all,
                  total_official, total_cash, remaining, payment_count,
                  payment_status},
      }

    404 если сделка не принадлежит этому клиенту (чтобы не enumerate-ить).
    """
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")
    db = _db()

    if not await _customer_owns_deal(db, customer_id, deal_id):
        raise HTTPException(404, f"Deal {deal_id} not found")

    deal = await db.deals.find_one(
        {"$or": [{"id": deal_id}, {"_id": deal_id}]},
        {"_id": 0, "id": 1, "title": 1, "vin": 1, "stage": 1, "status": 1,
         "payment_status": 1, "payment_summary": 1, "created_at": 1,
         "max_bid_usd": 1, "fx_rate_snapshot": 1},
    )

    # Breakdowns: prefer final, also show after_win
    bds_cursor = db.invoices.find(
        {
            "$or": [
                {"dealId": deal_id, "kind": {"$in": ["after_win", "final"]}},
                {"sourceAuctionWonDealId": deal_id},
                {"sourceFinalBreakdownDealId": deal_id},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1)
    bds_raw = await bds_cursor.to_list(length=20)
    breakdowns = [_strip_internal(b) for b in bds_raw]

    # Payments: visible incl. voided (with reason) but not pending? No — show
    # everything so customer understands their full payment timeline.
    pays_cursor = db.payments.find(
        {"deal_id": deal_id}, {"_id": 0},
    ).sort("created_at", -1)
    pays_raw = await pays_cursor.to_list(length=200)
    payments = [_strip_payment(p) for p in pays_raw]

    # Recompute summary (single source of truth — same engine the manager UI uses)
    try:
        from payments_tracking import recompute_deal_payment_status
        recomputed = await recompute_deal_payment_status(deal_id)
        summary = recomputed["summary"]
        payment_status = recomputed["payment_status"]
    except Exception:
        summary = (deal or {}).get("payment_summary") or {}
        payment_status = (deal or {}).get("payment_status") or "unpaid"

    return {
        "success": True,
        "deal": deal,
        "breakdowns": breakdowns,
        "payments": payments,
        "summary": summary,
        "payment_status": payment_status,
    }


@router.post("/deals/{deal_id}/pay-intent")
async def create_pay_intent(
    deal_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    [STUB] Create a payment intent for the OFFICIAL (bank/stripe) portion
    of the customer's outstanding balance. Will return a Stripe Checkout
    Session URL when Stripe webhook integration is wired (next phase).

    Currently returns a placeholder URL + the amount the customer should pay
    to cover all official, non-cash items minus what's already paid.

    Cash items are intentionally NOT included — those are handed in person.
    """
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")
    db = _db()

    if not await _customer_owns_deal(db, customer_id, deal_id):
        raise HTTPException(404, f"Deal {deal_id} not found")

    from payments_tracking import recompute_deal_payment_status
    res = await recompute_deal_payment_status(deal_id)
    summary = res["summary"]

    official_due = max(
        0.0,
        round((summary.get("total_official") or 0) - (summary.get("paid_official") or 0), 2),
    )
    if official_due <= 0:
        return {
            "success": False,
            "reason": "no_official_due",
            "message": "Нет официальной суммы к оплате (всё закрыто или только cash).",
            "summary": summary,
        }

    # Placeholder — real Stripe integration TBD
    return {
        "success": True,
        "stub": True,
        "amount_due_eur": official_due,
        "currency": "EUR",
        "checkout_url": None,  # will be a Stripe URL in P1.2-stripe phase
        "message": ("Stripe integration в работе. Свяжитесь с менеджером "
                    "для прямого банковского перевода."),
        "summary": summary,
    }
