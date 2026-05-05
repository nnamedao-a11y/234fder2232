"""
BIBI Cars — Legal & Pipeline workflow (P0.1–P0.4)

Реализует, не ломая существующий 22k-строчный server.py:

  • P0.1  Customer legal fields (имя/EGN/ID-карта/адрес) + валидатор
  • P0.2  Расширенный pipeline сделки (20 стадий) + helper переходов
  • P0.3  Расчёт обязательного депозита (max_bid_usd → required_eur)
  • P0.4  Контракты v2 (type=deposit|final|purchase, 5-фазный lifecycle)

Все эндпоинты — под /api/legal/*  и  /api/contracts2/* — чтобы не
конфликтовать со старыми /api/contracts и /api/deposits.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field, validator

from security import require_manager_or_admin, require_admin, require_master_admin


# ════════════════════════════════════════════════════════════════════════════
#   1.  STAGES & STATUSES (P0.2)
# ════════════════════════════════════════════════════════════════════════════

#: Полный pipeline сделки — соответствует продуктовой логике BIBI Cars.
DEAL_STAGES: List[str] = [
    "lead",
    "qualified",
    "variants_sent",
    "deposit_contract_drafted",
    "deposit_contract_signed",
    "deposit_paid",
    "searching_at_auction",
    "auction_lost",
    "auction_won",
    "final_contract_sent",
    "final_contract_signed",
    "after_win_payment_paid",
    "in_transit_to_rotterdam",
    "arrived_rotterdam",
    "customs_calculated",
    "final_payment_paid",
    "in_transit_to_bg",
    "delivered",
    "closed",
    "cancelled",
]

#: Допустимые «прямые» переходы (forward).  Любой переход назад (rollback)
#: разрешён только админу.  Любой переход в `cancelled` разрешён в любой
#: момент и для всех ролей >= manager.
DEAL_STAGE_FORWARD: Dict[str, List[str]] = {
    "lead":                       ["qualified", "cancelled"],
    "qualified":                  ["variants_sent", "cancelled"],
    "variants_sent":              ["deposit_contract_drafted", "cancelled"],
    "deposit_contract_drafted":   ["deposit_contract_signed", "cancelled"],
    "deposit_contract_signed":    ["deposit_paid", "cancelled"],
    "deposit_paid":               ["searching_at_auction", "cancelled"],
    "searching_at_auction":       ["auction_won", "auction_lost", "cancelled"],
    "auction_lost":               ["searching_at_auction", "cancelled"],          # ещё попытка
    "auction_won":                ["final_contract_sent", "cancelled"],
    "final_contract_sent":        ["final_contract_signed", "cancelled"],
    "final_contract_signed":      ["after_win_payment_paid", "cancelled"],
    "after_win_payment_paid":     ["in_transit_to_rotterdam", "cancelled"],
    "in_transit_to_rotterdam":    ["arrived_rotterdam"],
    "arrived_rotterdam":          ["customs_calculated"],
    "customs_calculated":         ["final_payment_paid"],
    "final_payment_paid":         ["in_transit_to_bg"],
    "in_transit_to_bg":           ["delivered"],
    "delivered":                  ["closed"],
    "closed":                     [],
    "cancelled":                  [],
}

#: 8 UI-групп поверх 20 стадий — чтобы менеджер не терялся.
#: Порядок групп соответствует движению сделки.
DEAL_STAGE_GROUPS: List[Dict[str, Any]] = [
    {"id": "lead",        "label": "Лид",         "stages": ["lead"]},
    {"id": "preparation", "label": "Подготовка",  "stages": ["qualified", "variants_sent"]},
    {"id": "deposit",     "label": "Депозит",     "stages": ["deposit_contract_drafted", "deposit_contract_signed", "deposit_paid"]},
    {"id": "search",      "label": "Поиск",       "stages": ["searching_at_auction", "auction_lost"]},
    {"id": "auction",     "label": "Аукцион",     "stages": ["auction_won"]},
    {"id": "payment",     "label": "Оплата",      "stages": ["final_contract_sent", "final_contract_signed", "after_win_payment_paid"]},
    {"id": "delivery",    "label": "Доставка",    "stages": ["in_transit_to_rotterdam", "arrived_rotterdam", "customs_calculated", "final_payment_paid", "in_transit_to_bg"]},
    {"id": "done",        "label": "Завершено",   "stages": ["delivered", "closed", "cancelled"]},
]


def _stage_group_of(stage: str) -> Optional[str]:
    for g in DEAL_STAGE_GROUPS:
        if stage in g["stages"]:
            return g["id"]
    return None

#: Депозит: расширенный набор статусов + причин forfeit/refund.
DEPOSIT_STATUSES: List[str] = [
    "pending",                       # создан, оплата не подтверждена
    "paid_confirmed",                # менеджер подтвердил, что деньги пришли
    "refund_pending_voluntary",      # клиент попросил возврат до выигрыша
    "refund_pending_30d",            # 30 дней без авто — cron автоматически
    "refund_approved",               # admin одобрил возврат — ждём execute
    "refund_rejected",               # admin отклонил возврат
    "refunded",                      # возврат выполнен
    "forfeit_pending_teamlead",      # клиент отказался после выигрыша → ждём тимлида
    "forfeit_pending_admin",         # тимлид одобрил → ждём финального админ-апрува
    "forfeited",                     # сгорел в пользу штрафа аукциона
]

#: Стадии сделки, после которых refund ЗАПРЕЩЁН (только forfeit).
STAGES_AFTER_AUCTION_WIN: List[str] = [
    "auction_won",
    "final_contract_sent",
    "final_contract_signed",
    "after_win_payment_paid",
    "in_transit_to_rotterdam",
    "arrived_rotterdam",
    "customs_calculated",
    "final_payment_paid",
    "in_transit_to_bg",
    "delivered",
    "closed",
]

#: Контракт v2: 5-фазный lifecycle.
CONTRACT_TYPES: List[str] = ["deposit", "final", "purchase"]
CONTRACT_LIFECYCLE: List[str] = [
    "draft",
    "sent_to_client",
    "client_signed",
    "company_signed_stamped",
    "finalized",
]
CONTRACT_LIFECYCLE_FORWARD: Dict[str, List[str]] = {
    "draft":                  ["sent_to_client", "cancelled"],
    "sent_to_client":         ["client_signed", "cancelled"],
    "client_signed":          ["company_signed_stamped", "cancelled"],
    "company_signed_stamped": ["finalized", "cancelled"],
    "finalized":              [],
    "cancelled":              [],
}


# ════════════════════════════════════════════════════════════════════════════
#   2.  PYDANTIC MODELS
# ════════════════════════════════════════════════════════════════════════════

# --- P0.1 Customer legal fields --------------------------------------------
class CustomerLegalIn(BaseModel):
    """Поля, обязательные для генерации болгарского депозитного договора."""
    first_name: str = Field(..., min_length=1, max_length=120)
    last_name: str = Field(..., min_length=1, max_length=120)
    egn: str = Field(..., min_length=10, max_length=10, description="Болгарский ЕГН — ровно 10 цифр")
    national_id_no: str = Field(..., min_length=4, max_length=32, description="№ личной карты")
    id_card_address: str = Field(..., min_length=4, max_length=500)
    id_card_issued_by: str = Field(..., min_length=2, max_length=200)
    id_card_issue_date: str = Field(..., description="ISO date (YYYY-MM-DD)")

    @validator("egn")
    def _egn_digits(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 10:
            raise ValueError("EGN должен состоять ровно из 10 цифр")
        return v

    @validator("id_card_issue_date")
    def _iso_date(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("id_card_issue_date должен быть в формате YYYY-MM-DD")
        return v


# --- P0.3 Deposit calculation -----------------------------------------------
class DepositCalcIn(BaseModel):
    max_bid_usd: float = Field(..., ge=0)
    fx_rate_usd_to_eur: Optional[float] = Field(None, gt=0, description="Если не передан — берётся системный курс")


class DepositCreateIn(BaseModel):
    customer_id: str
    deal_id: Optional[str] = None
    max_bid_usd: float = Field(..., ge=0)
    fx_rate_usd_to_eur: Optional[float] = Field(None, gt=0)
    paid_amount_eur: float = Field(0.0, ge=0)
    note: Optional[str] = None


class DepositConfirmIn(BaseModel):
    bank_received_at: Optional[str] = None
    note: Optional[str] = None


# --- P0.4 Contract v2 -------------------------------------------------------
class ContractV2CreateIn(BaseModel):
    deal_id: str
    customer_id: str
    type: str = Field(..., description="deposit | final | purchase")
    items: List[Dict[str, Any]] = Field(default_factory=list, description="Опционально — позиции (для final)")
    notes: Optional[str] = None

    @validator("type")
    def _type_valid(cls, v: str) -> str:
        if v not in CONTRACT_TYPES:
            raise ValueError(f"type must be one of {CONTRACT_TYPES}")
        return v


class ContractV2TransitionIn(BaseModel):
    to: str = Field(..., description="Целевой lifecycle status")
    note: Optional[str] = None


# ════════════════════════════════════════════════════════════════════════════
#   3.  HELPERS
# ════════════════════════════════════════════════════════════════════════════

DEFAULT_FX_USD_TO_EUR: float = float(os.environ.get("BIBI_FX_USD_TO_EUR") or 0.92)
MIN_DEPOSIT_EUR: float = 1000.0
DEPOSIT_PCT_THRESHOLD_USD: float = 10000.0
DEPOSIT_PCT: float = 0.10
REFUND_DEADLINE_DAYS: int = int(os.environ.get("BIBI_REFUND_DEADLINE_DAYS") or 30)
REFUND_CRON_INTERVAL_SEC: int = int(os.environ.get("BIBI_REFUND_CRON_INTERVAL_SEC") or 6 * 60 * 60)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required_deposit_eur(max_bid_usd: float, fx: float) -> Dict[str, float]:
    """
    required = max(1000 EUR, 10% × max_bid_usd × fx)  — но только если
    max_bid_usd > 10 000.  Иначе всегда минимум 1000 EUR.
    """
    if max_bid_usd > DEPOSIT_PCT_THRESHOLD_USD:
        pct_eur = round(max_bid_usd * DEPOSIT_PCT * fx, 2)
        required = max(MIN_DEPOSIT_EUR, pct_eur)
    else:
        required = MIN_DEPOSIT_EUR
    return {
        "required_amount_eur": round(required, 2),
        "min_floor_eur": MIN_DEPOSIT_EUR,
        "pct_eur": round(max_bid_usd * DEPOSIT_PCT * fx, 2) if max_bid_usd > 0 else 0.0,
        "fx_rate_usd_to_eur": fx,
        "calculated_from_bid": max_bid_usd > DEPOSIT_PCT_THRESHOLD_USD,
    }


def _can_advance_deal(current: str, target: str) -> bool:
    if target == current:
        return False
    return target in DEAL_STAGE_FORWARD.get(current, [])


def _can_advance_contract(current: str, target: str) -> bool:
    if target == current:
        return False
    return target in CONTRACT_LIFECYCLE_FORWARD.get(current, [])


# ─── P1.3.1 HARDENING HELPERS ────────────────────────────────────────────

async def _audit(
    event_type: str,
    entity_type: str,
    entity_id: str,
    user: Optional[Dict[str, Any]] = None,
    payload: Optional[Dict[str, Any]] = None,
    deal_id: Optional[str] = None,
    customer_id: Optional[str] = None,
) -> None:
    """
    Append-only audit trail. Никогда не роняет основной запрос.
    Коллекция: db.audit_events.

    Зачем: бухгалтерия, юр. споры, RCA при инцидентах. После prod-deploy
    эту коллекцию нельзя редактировать вручную.
    """
    try:
        db = _db()
        doc = {
            "id": f"audit_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{uuid.uuid4().hex[:8]}",
            "type": event_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "deal_id": deal_id,
            "customer_id": customer_id,
            "user_id": (user or {}).get("id"),
            "user_email": (user or {}).get("email"),
            "user_role": (user or {}).get("role"),
            "payload": payload or {},
            "at": _now_iso(),
            "ts": datetime.now(timezone.utc),
        }
        await db.audit_events.insert_one(doc)
    except Exception:
        import logging as _lg
        _lg.getLogger("bibi.legal.audit").warning(
            "[audit] failed to write event=%s entity=%s/%s",
            event_type, entity_type, entity_id, exc_info=True,
        )


def _ensure_deal_not_locked_after_win(deal: Dict[str, Any], action: str) -> None:
    """
    Защитный guard: после auction_won сделка заморожена для определённых
    действий (новый депозит, изменение max_bid, voluntary refund).
    Forfeit — единственный разрешённый «выход» из этого состояния.

    Args:
      deal:   документ сделки из db.deals
      action: человекочитаемое имя действия для error message

    Raises:
      HTTPException 409 если сделка locked.
    """
    if deal.get("is_locked_after_win"):
        raise HTTPException(
            409,
            f"Deal {deal.get('id')} is locked after auction win. "
            f"Action '{action}' is forbidden. Use forfeit flow instead.",
        )


# ════════════════════════════════════════════════════════════════════════════
#   4.  ROUTERS
# ════════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/api", tags=["legal-workflow"])


def _db():
    """Lazy import чтобы не циклить с server.py."""
    from server import db as _server_db
    return _server_db


# ─────────── P0.1  Customer legal ──────────────────────────────────────────

@router.put("/customers/{customer_id}/legal", dependencies=[Depends(require_manager_or_admin)])
async def upsert_customer_legal(customer_id: str, payload: CustomerLegalIn = Body(...)):
    """
    Сохранить юридические поля клиента (обязательные для депозитного
    договора). Идемпотентно — повторный вызов перетирает поля.
    """
    db = _db()
    customer = await db.customers.find_one({"id": customer_id})
    if not customer:
        raise HTTPException(404, f"Customer {customer_id} not found")

    legal = payload.dict()
    legal["updated_at"] = _now_iso()

    await db.customers.update_one(
        {"id": customer_id},
        {"$set": {"legal": legal, "updated_at": _now_iso()}},
    )
    return {"success": True, "customer_id": customer_id, "legal": legal}


@router.get("/customers/{customer_id}/legal", dependencies=[Depends(require_manager_or_admin)])
async def get_customer_legal(customer_id: str):
    db = _db()
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0, "legal": 1})
    if not customer:
        raise HTTPException(404, f"Customer {customer_id} not found")
    return {"success": True, "customer_id": customer_id, "legal": customer.get("legal") or None}


@router.get("/customers/{customer_id}/legal/validate", dependencies=[Depends(require_manager_or_admin)])
async def validate_customer_legal(customer_id: str):
    """
    Проверить, что клиент готов к генерации депозитного договора:
    все 7 юридических полей заполнены и корректны.
    """
    db = _db()
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(404, f"Customer {customer_id} not found")

    legal = customer.get("legal") or {}
    missing: List[str] = []
    for key in ("first_name", "last_name", "egn", "national_id_no",
                "id_card_address", "id_card_issued_by", "id_card_issue_date"):
        if not legal.get(key):
            missing.append(key)

    ok = len(missing) == 0
    return {
        "success": True,
        "customer_id": customer_id,
        "ready_for_deposit_contract": ok,
        "missing_fields": missing,
    }


# ─────────── P0.2  Deal stages catalog + transition ────────────────────────

@router.get("/legal/deal-stages")
async def list_deal_stages():
    """Каталог всех допустимых стадий + матрица переходов."""
    return {
        "success": True,
        "stages": DEAL_STAGES,
        "forward_transitions": DEAL_STAGE_FORWARD,
    }


@router.post("/deals/{deal_id}/advance", dependencies=[Depends(require_manager_or_admin)])
async def advance_deal_stage(
    deal_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Перевести сделку на следующую стадию.  Body: { "to": "<stage>", "note": "..." }
    Forward-переход проверяется по DEAL_STAGE_FORWARD.  Rollback (назад)
    допустим только для admin/master_admin.
    """
    db = _db()
    target = (body or {}).get("to")
    if not target or target not in DEAL_STAGES:
        raise HTTPException(400, f"`to` must be one of {DEAL_STAGES}")

    # find both id keys (legacy)
    deal = await db.deals.find_one({"$or": [{"id": deal_id}, {"_id": deal_id}]})
    if not deal:
        raise HTTPException(404, f"Deal {deal_id} not found")

    current = deal.get("stage") or deal.get("status") or "lead"
    role = (user.get("role") or "").lower()
    is_admin = role in ("admin", "master_admin", "owner")

    if not _can_advance_deal(current, target):
        # Backwards rollback only for admin
        if not is_admin:
            raise HTTPException(
                409,
                f"Forbidden transition {current} → {target}. "
                f"Allowed forward: {DEAL_STAGE_FORWARD.get(current, [])}",
            )

    history_entry = {
        "from": current,
        "to": target,
        "by": user.get("email") or user.get("id"),
        "by_role": role,
        "at": _now_iso(),
        "note": (body or {}).get("note"),
    }

    await db.deals.update_one(
        {"$or": [{"id": deal_id}, {"_id": deal_id}]},
        {
            "$set": {"stage": target, "status": target, "updated_at": _now_iso()},
            "$push": {"stage_history": history_entry},
        },
    )
    return {"success": True, "deal_id": deal_id, "from": current, "to": target}


# ─────────── P0.3  Deposit calculation & lifecycle ─────────────────────────

@router.post("/legal/deposit/calculate")
async def calculate_required_deposit(payload: DepositCalcIn = Body(...)):
    """
    Чистая утилита: посчитать обязательный депозит по правилу
      required_eur = max(1000, max_bid_usd × 0.10 × fx)  — если max_bid > $10k
      required_eur = 1000                                — иначе.
    """
    fx = payload.fx_rate_usd_to_eur or DEFAULT_FX_USD_TO_EUR
    return {
        "success": True,
        "input": payload.dict(),
        **_required_deposit_eur(payload.max_bid_usd, fx),
    }


@router.post("/legal/deposits", dependencies=[Depends(require_manager_or_admin)])
async def create_legal_deposit(
    payload: DepositCreateIn = Body(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Создать депозит с расчётом required_amount_eur.  Не подтверждает оплату —
    статус остаётся `pending` пока менеджер не вызовет /confirm-payment.
    """
    db = _db()
    customer = await db.customers.find_one({"id": payload.customer_id})
    if not customer:
        raise HTTPException(404, f"Customer {payload.customer_id} not found")

    # P1.3.1 — block new deposits on locked deals
    if payload.deal_id:
        deal = await db.deals.find_one(
            {"$or": [{"id": payload.deal_id}, {"_id": payload.deal_id}]},
            {"is_locked_after_win": 1, "id": 1, "stage": 1},
        )
        if deal:
            _ensure_deal_not_locked_after_win(deal, "create new deposit")

    fx = payload.fx_rate_usd_to_eur or DEFAULT_FX_USD_TO_EUR
    calc = _required_deposit_eur(payload.max_bid_usd, fx)

    deposit_id = f"dep_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}"
    deposit = {
        "id": deposit_id,
        "customer_id": payload.customer_id,
        "deal_id": payload.deal_id,
        "currency": "EUR",
        "max_bid_usd": payload.max_bid_usd,
        "fx_rate_usd_to_eur": fx,
        "required_amount_eur": calc["required_amount_eur"],
        "calculated_from_bid": calc["calculated_from_bid"],
        "paid_amount_eur": payload.paid_amount_eur,
        "status": "pending",
        "note": payload.note,
        "created_by": user.get("email") or user.get("id"),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "history": [
            {"event": "created", "at": _now_iso(),
             "by": user.get("email") or user.get("id"), "data": calc},
        ],
    }

    # Помечаем клиента и сделку максимальной ставкой
    await db.customers.update_one(
        {"id": payload.customer_id},
        {"$set": {"max_bid_usd": payload.max_bid_usd, "updated_at": _now_iso()}},
    )
    if payload.deal_id:
        await db.deals.update_one(
            {"$or": [{"id": payload.deal_id}, {"_id": payload.deal_id}]},
            {"$set": {"max_bid_usd": payload.max_bid_usd, "updated_at": _now_iso()}},
        )

    await db.legal_deposits.insert_one(deposit)
    deposit.pop("_id", None)
    await _audit(
        event_type="deposit_created", entity_type="legal_deposit", entity_id=deposit_id,
        user=user, deal_id=payload.deal_id, customer_id=payload.customer_id,
        payload={"max_bid_usd": payload.max_bid_usd, "fx": fx,
                 "required_eur": calc["required_amount_eur"],
                 "paid_amount_eur": payload.paid_amount_eur},
    )
    return {"success": True, "deposit": deposit}


@router.get("/legal/deposits/{deposit_id}", dependencies=[Depends(require_manager_or_admin)])
async def get_legal_deposit(deposit_id: str):
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")
    return {"success": True, "deposit": d}


@router.put("/legal/deposits/{deposit_id}/confirm-payment", dependencies=[Depends(require_manager_or_admin)])
async def confirm_deposit_payment(
    deposit_id: str,
    payload: DepositConfirmIn = Body(default={}),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Менеджер вручную подтверждает: «деньги пришли в банк».
    Запрещает подтверждать, если paid_amount_eur < required_amount_eur.
    Стартует 30-дневный таймер поиска авто.
    """
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")

    if d.get("status") != "pending":
        raise HTTPException(409, f"Deposit is in status `{d.get('status')}` — cannot confirm")

    # P1.3.1 — block confirm on locked deals (post-win freeze)
    if d.get("deal_id"):
        deal = await db.deals.find_one(
            {"$or": [{"id": d["deal_id"]}, {"_id": d["deal_id"]}]},
            {"is_locked_after_win": 1, "id": 1, "stage": 1},
        )
        if deal:
            _ensure_deal_not_locked_after_win(deal, "confirm deposit payment")

    paid = float(d.get("paid_amount_eur") or 0)
    required = float(d.get("required_amount_eur") or 0)
    if paid + 0.01 < required:
        raise HTTPException(
            422,
            f"Paid amount ({paid} EUR) is below required ({required} EUR). "
            f"Update paid_amount_eur first.",
        )

    bank_at = (payload.bank_received_at or _now_iso())
    now = _now_iso()

    # 30-дневный таймер стартует ОТ момента поступления денег
    refund_eligible_at = (datetime.fromisoformat(bank_at.replace("Z", "+00:00"))
                          if "Z" in bank_at else datetime.fromisoformat(bank_at))
    refund_eligible_iso = (refund_eligible_at.replace(tzinfo=refund_eligible_at.tzinfo
                                                       or timezone.utc)
                            ).isoformat()
    # REFUND_DEADLINE_DAYS days
    from datetime import timedelta as _td
    deadline = (refund_eligible_at + _td(days=REFUND_DEADLINE_DAYS))
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {
            "$set": {
                "status": "paid_confirmed",
                "bank_received_at": bank_at,
                "search_timer_started_at": refund_eligible_iso,
                "search_timer_deadline_at": deadline.isoformat(),
                "confirmed_by": user.get("email") or user.get("id"),
                "confirmed_at": now,
                "updated_at": now,
            },
            "$push": {
                "history": {
                    "event": "paid_confirmed",
                    "at": now,
                    "by": user.get("email") or user.get("id"),
                    "data": {"bank_received_at": bank_at, "note": payload.note},
                }
            },
        },
    )

    # Best-effort: подвинуть сделку в стадию `deposit_paid`
    if d.get("deal_id"):
        await db.deals.update_one(
            {"$or": [{"id": d["deal_id"]}, {"_id": d["deal_id"]}]},
            {
                "$set": {"stage": "deposit_paid", "status": "deposit_paid", "updated_at": now},
                "$push": {"stage_history": {
                    "from": "deposit_contract_signed", "to": "deposit_paid",
                    "by": user.get("email") or user.get("id"), "by_role": user.get("role"),
                    "at": now, "note": "auto-advance after deposit confirmed",
                }},
            },
        )

    await _audit(
        event_type="deposit_paid_confirmed", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={
            "paid_amount_eur": paid,
            "required_amount_eur": required,
            "bank_received_at": bank_at,
            "search_timer_deadline_at": deadline.isoformat(),
            "fx_rate_usd_to_eur": d.get("fx_rate_usd_to_eur"),
            "note": payload.note,
        },
    )
    return {"success": True, "deposit_id": deposit_id, "status": "paid_confirmed",
            "search_timer_deadline_at": deadline.isoformat()}


@router.post("/legal/deposits/{deposit_id}/forfeit/request", dependencies=[Depends(require_manager_or_admin)])
async def request_deposit_forfeit(
    deposit_id: str,
    body: Dict[str, Any] = Body(default={}),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """Менеджер запрашивает сгорание депозита (клиент отказался ПОСЛЕ выигрыша).
    Переводит в `forfeit_pending_teamlead`."""
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")
    if d.get("status") != "paid_confirmed":
        raise HTTPException(409, f"Forfeit allowed only from `paid_confirmed`, current: {d.get('status')}")

    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {
            "$set": {"status": "forfeit_pending_teamlead", "forfeit_reason": body.get("reason"),
                     "forfeit_requested_by": user.get("email") or user.get("id"),
                     "forfeit_requested_at": now, "updated_at": now},
            "$push": {"history": {"event": "forfeit_requested", "at": now,
                                  "by": user.get("email") or user.get("id"),
                                  "data": {"reason": body.get("reason")}}}},
    )
    await _audit(
        event_type="deposit_forfeit_requested", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"reason": body.get("reason"), "from_status": "paid_confirmed"},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "forfeit_pending_teamlead"}


@router.post("/legal/deposits/{deposit_id}/forfeit/teamlead-approve", dependencies=[Depends(require_admin)])
async def teamlead_approve_forfeit(
    deposit_id: str,
    user: Dict[str, Any] = Depends(require_admin),
):
    """Тимлид (или admin) подтверждает сгорание → ждём финального админ-апрува."""
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")
    if d.get("status") != "forfeit_pending_teamlead":
        raise HTTPException(409, f"Wrong state: {d.get('status')}")
    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": {"status": "forfeit_pending_admin", "teamlead_approved_by": user.get("email") or user.get("id"),
                  "teamlead_approved_at": now, "updated_at": now},
         "$push": {"history": {"event": "teamlead_approved_forfeit", "at": now,
                               "by": user.get("email") or user.get("id"), "data": None}}},
    )
    await _audit(
        event_type="deposit_forfeit_teamlead_approved", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"prev_status": "forfeit_pending_teamlead"},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "forfeit_pending_admin"}


@router.post("/legal/deposits/{deposit_id}/forfeit/admin-finalize", dependencies=[Depends(require_master_admin)])
async def admin_finalize_forfeit(
    deposit_id: str,
    user: Dict[str, Any] = Depends(require_master_admin),
):
    """Финальное админ-подтверждение → депозит сгорает."""
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")
    if d.get("status") != "forfeit_pending_admin":
        raise HTTPException(409, f"Wrong state: {d.get('status')}")
    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": {"status": "forfeited", "admin_finalized_by": user.get("email") or user.get("id"),
                  "admin_finalized_at": now, "updated_at": now},
         "$push": {"history": {"event": "forfeited", "at": now,
                               "by": user.get("email") or user.get("id"), "data": None}}},
    )
    await _audit(
        event_type="deposit_forfeited", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"paid_amount_eur": float(d.get("paid_amount_eur") or 0)},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "forfeited"}


# ═════════════════════════════════════════════════════════════════════════
#   P1.1  REFUND FLOW  (30-day cron + voluntary + approve + execute)
# ═════════════════════════════════════════════════════════════════════════
#
#   Statuses (добавлены в DEPOSIT_STATUSES):
#     paid_confirmed → refund_pending_30d   (AUTO, cron, 30 дней без auction_won)
#     paid_confirmed → refund_pending_voluntary (manager, до auction_won)
#     refund_pending_*  → refund_approved    (admin)
#     refund_pending_*  → refund_rejected    (admin)
#     refund_approved   → refunded           (admin/manager, execute)
#
#   Rule: если deal.stage ∈ STAGES_AFTER_AUCTION_WIN → refund ЗАПРЕЩЁН,
#         только forfeit flow (уже реализован выше).

class _RefundRequestIn(BaseModel):
    reason: Optional[str] = None
    note: Optional[str] = None


class _RefundApproveIn(BaseModel):
    note: Optional[str] = None


class _RefundRejectIn(BaseModel):
    reason: str = Field(..., min_length=2, max_length=500)


class _RefundExecuteIn(BaseModel):
    method: str = Field("bank_manual", description="stripe | bank_manual")
    stripe_payment_intent_id: Optional[str] = None
    bank_proof_url: Optional[str] = None
    note: Optional[str] = None


async def _emit_safe(event: str, payload: Dict[str, Any]) -> None:
    """Best-effort emit to notifications.bus; никогда не роняет транзакцию."""
    try:
        from notifications import bus as _bus  # type: ignore
        await _bus.emit(event, payload)
    except Exception:
        import logging
        logging.getLogger("bibi.legal").warning(
            "[legal] notifications.bus.emit(%s) failed", event, exc_info=True
        )


def _deal_is_after_win(deal: Optional[Dict[str, Any]]) -> bool:
    if not deal:
        return False
    stage = deal.get("stage") or deal.get("status") or ""
    return stage in STAGES_AFTER_AUCTION_WIN


@router.post("/legal/deposits/{deposit_id}/refund/request",
             dependencies=[Depends(require_manager_or_admin)])
async def request_deposit_refund(
    deposit_id: str,
    body: _RefundRequestIn = Body(default=_RefundRequestIn()),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Добровольный возврат депозита ДО выигрыша авто.
    Разрешён только если deal.stage < auction_won и status=paid_confirmed.
    Переводит депозит в refund_pending_voluntary.
    """
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")

    if d.get("status") != "paid_confirmed":
        raise HTTPException(409, f"Voluntary refund allowed only from `paid_confirmed`, current: {d.get('status')}")

    # Если сделка уже после auction_won — только forfeit flow
    if d.get("deal_id"):
        deal = await db.deals.find_one(
            {"$or": [{"id": d["deal_id"]}, {"_id": d["deal_id"]}]}, {"stage": 1, "status": 1}
        )
        if _deal_is_after_win(deal):
            raise HTTPException(
                422,
                "Deal is already past auction_won. Voluntary refund is forbidden — use forfeit flow.",
            )

    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": {
            "status": "refund_pending_voluntary",
            "refund_reason": body.reason or "client_voluntary",
            "refund_requested_by": user.get("email") or user.get("id"),
            "refund_requested_at": now,
            "updated_at": now,
         },
         "$push": {"history": {"event": "refund_requested_voluntary", "at": now,
                               "by": user.get("email") or user.get("id"),
                               "data": {"reason": body.reason, "note": body.note}}}},
    )
    await _emit_safe("deposit_refund_requested", {
        "depositId": deposit_id, "dealId": d.get("deal_id"),
        "customerId": d.get("customer_id"), "kind": "voluntary",
        "reason": body.reason, "by": user.get("email") or user.get("id"),
    })
    await _audit(
        event_type="deposit_refund_requested_voluntary", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"reason": body.reason, "note": body.note,
                 "paid_amount_eur": float(d.get("paid_amount_eur") or 0)},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "refund_pending_voluntary"}


@router.post("/legal/deposits/{deposit_id}/refund/approve",
             dependencies=[Depends(require_admin)])
async def approve_deposit_refund(
    deposit_id: str,
    body: _RefundApproveIn = Body(default=_RefundApproveIn()),
    user: Dict[str, Any] = Depends(require_admin),
):
    """Admin одобряет возврат (из любого refund_pending_*). Статус → refund_approved."""
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")

    if d.get("status") not in ("refund_pending_30d", "refund_pending_voluntary"):
        raise HTTPException(409, f"Approve allowed only from refund_pending_*, current: {d.get('status')}")

    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": {
            "status": "refund_approved",
            "refund_approved_by": user.get("email") or user.get("id"),
            "refund_approved_at": now,
            "updated_at": now,
         },
         "$push": {"history": {"event": "refund_approved", "at": now,
                               "by": user.get("email") or user.get("id"),
                               "data": {"note": body.note}}}},
    )
    await _emit_safe("deposit_refund_approved", {
        "depositId": deposit_id, "dealId": d.get("deal_id"),
        "customerId": d.get("customer_id"),
        "by": user.get("email") or user.get("id"),
    })
    await _audit(
        event_type="deposit_refund_approved", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"note": body.note},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "refund_approved"}


@router.post("/legal/deposits/{deposit_id}/refund/reject",
             dependencies=[Depends(require_admin)])
async def reject_deposit_refund(
    deposit_id: str,
    body: _RefundRejectIn = Body(...),
    user: Dict[str, Any] = Depends(require_admin),
):
    """Admin отклоняет возврат. Депозит возвращается в paid_confirmed."""
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")

    if d.get("status") not in ("refund_pending_30d", "refund_pending_voluntary"):
        raise HTTPException(409, f"Reject allowed only from refund_pending_*, current: {d.get('status')}")

    now = _now_iso()
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": {
            "status": "paid_confirmed",  # откат
            "refund_rejected_by": user.get("email") or user.get("id"),
            "refund_rejected_at": now,
            "refund_rejection_reason": body.reason,
            "updated_at": now,
         },
         "$push": {"history": {"event": "refund_rejected", "at": now,
                               "by": user.get("email") or user.get("id"),
                               "data": {"reason": body.reason}}}},
    )
    await _emit_safe("deposit_refund_rejected", {
        "depositId": deposit_id, "dealId": d.get("deal_id"),
        "customerId": d.get("customer_id"),
        "reason": body.reason,
        "by": user.get("email") or user.get("id"),
    })
    await _audit(
        event_type="deposit_refund_rejected", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"reason": body.reason, "rolled_back_to": "paid_confirmed"},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "paid_confirmed", "reason": body.reason}


@router.post("/legal/deposits/{deposit_id}/refund/execute",
             dependencies=[Depends(require_admin)])
async def execute_deposit_refund(
    deposit_id: str,
    body: _RefundExecuteIn = Body(default=_RefundExecuteIn()),
    user: Dict[str, Any] = Depends(require_admin),
):
    """
    Выполнить фактический возврат:
      method="stripe" → вызвать Stripe Refund API (async, isolated)
      method="bank_manual" → просто пометить refunded с proof-ссылкой
    Допустимо только из refund_approved.
    Идемпотентно: повтор возврата на status=refunded → 409.
    """
    db = _db()
    d = await db.legal_deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, f"Deposit {deposit_id} not found")

    if d.get("status") == "refunded":
        raise HTTPException(409, "Already refunded")
    if d.get("status") != "refund_approved":
        raise HTTPException(409, f"Execute allowed only from refund_approved, current: {d.get('status')}")

    now = _now_iso()
    paid_eur = float(d.get("paid_amount_eur") or 0)

    stripe_refund_id: Optional[str] = None
    stripe_error: Optional[str] = None

    if body.method == "stripe":
        pi_id = body.stripe_payment_intent_id or d.get("stripe_payment_intent_id")
        if not pi_id:
            raise HTTPException(422, "stripe_payment_intent_id is required for method=stripe")
        try:
            import stripe as _stripe  # type: ignore
            # Ключ берётся либо из env, либо из БД настроек (как в server.py)
            key = (os.environ.get("STRIPE_SECRET_KEY")
                   or os.environ.get("STRIPE_API_KEY"))
            if not key:
                cfg = await db.settings.find_one({"key": "stripe"}) or {}
                key = (cfg.get("secretKey") if cfg else None)
            if not key:
                raise RuntimeError("Stripe secret key not configured")
            _stripe.api_key = key
            import asyncio as _asyncio
            refund = await _asyncio.to_thread(
                lambda: _stripe.Refund.create(
                    payment_intent=pi_id,
                    amount=int(round(paid_eur * 100)),
                )
            )
            stripe_refund_id = getattr(refund, "id", None) or (refund.get("id") if isinstance(refund, dict) else None)
        except Exception as ex:
            stripe_error = str(ex)
            # Статус остаётся refund_approved, пишем ошибку — ручная доразборка
            await db.legal_deposits.update_one(
                {"id": deposit_id},
                {"$set": {"refund_last_error": stripe_error, "updated_at": now},
                 "$push": {"history": {"event": "refund_execute_failed", "at": now,
                                        "by": user.get("email") or user.get("id"),
                                        "data": {"method": body.method, "error": stripe_error}}}},
            )
            raise HTTPException(502, f"Stripe refund failed: {stripe_error}")

    # Успех → status = refunded
    set_doc: Dict[str, Any] = {
        "status": "refunded",
        "refund_method": body.method,
        "refunded_at": now,
        "refunded_by": user.get("email") or user.get("id"),
        "refund_bank_proof_url": body.bank_proof_url,
        "stripe_refund_id": stripe_refund_id,
        "refund_last_error": None,
        "updated_at": now,
    }
    await db.legal_deposits.update_one(
        {"id": deposit_id},
        {"$set": set_doc,
         "$push": {"history": {"event": "refunded", "at": now,
                               "by": user.get("email") or user.get("id"),
                               "data": {"method": body.method,
                                        "stripe_refund_id": stripe_refund_id,
                                        "bank_proof_url": body.bank_proof_url,
                                        "note": body.note}}}},
    )
    await _emit_safe("deposit_refunded", {
        "depositId": deposit_id, "dealId": d.get("deal_id"),
        "customerId": d.get("customer_id"),
        "amount_eur": paid_eur, "method": body.method,
        "stripe_refund_id": stripe_refund_id,
    })
    await _audit(
        event_type="deposit_refunded", entity_type="legal_deposit",
        entity_id=deposit_id, user=user,
        deal_id=d.get("deal_id"), customer_id=d.get("customer_id"),
        payload={"method": body.method, "amount_eur": paid_eur,
                 "stripe_refund_id": stripe_refund_id,
                 "bank_proof_url": body.bank_proof_url},
    )
    return {"success": True, "deposit_id": deposit_id, "status": "refunded",
            "method": body.method, "stripe_refund_id": stripe_refund_id}


# ────── REFUND CRON — 30 days without car ──────────────────────────────
async def scan_refund_eligible_deposits() -> Dict[str, Any]:
    """
    Проходит по всем депозитам status=paid_confirmed,
    у которых search_timer_deadline_at <= now и сделка ещё не после выигрыша.
    Переводит в refund_pending_30d. Идемпотентно (использует $set на конкретный статус).
    """
    db = _db()
    now = datetime.now(timezone.utc)
    promoted = 0
    skipped_after_win = 0
    checked = 0

    # Берём iso-строки (у нас search_timer_deadline_at хранится как iso)
    query = {
        "status": "paid_confirmed",
        "search_timer_deadline_at": {"$lte": now.isoformat()},
    }
    async for dep in db.legal_deposits.find(query):
        checked += 1
        deal = None
        if dep.get("deal_id"):
            deal = await db.deals.find_one(
                {"$or": [{"id": dep["deal_id"]}, {"_id": dep["deal_id"]}]},
                {"stage": 1, "status": 1},
            )
        if _deal_is_after_win(deal):
            skipped_after_win += 1
            continue

        # Идемпотентность: обновляем только если статус всё ещё paid_confirmed
        res = await db.legal_deposits.update_one(
            {"id": dep["id"], "status": "paid_confirmed"},
            {"$set": {
                "status": "refund_pending_30d",
                "refund_reason": "no_car_found_30_days",
                "refund_eligible_at": now.isoformat(),
                "updated_at": now.isoformat(),
             },
             "$push": {"history": {"event": "auto_refund_eligible", "at": now.isoformat(),
                                    "by": "cron", "data": {"days": REFUND_DEADLINE_DAYS}}}},
        )
        if res.modified_count:
            promoted += 1
            await _emit_safe("deposit_refund_eligible", {
                "depositId": dep["id"], "dealId": dep.get("deal_id"),
                "customerId": dep.get("customer_id"),
                "days": REFUND_DEADLINE_DAYS,
            })

    return {"checked": checked, "promoted": promoted, "skipped_after_win": skipped_after_win,
            "at": now.isoformat()}


_cron_started = False


async def refund_eligibility_cron_loop():
    """Фоновый цикл: сканирует депозиты каждые REFUND_CRON_INTERVAL_SEC."""
    import asyncio as _asyncio
    import logging as _lg
    log = _lg.getLogger("bibi.legal.refund-cron")
    log.info("[refund-cron] starting (every %ss, deadline=%sd)",
             REFUND_CRON_INTERVAL_SEC, REFUND_DEADLINE_DAYS)
    # Небольшая задержка чтобы сервер поднялся
    await _asyncio.sleep(15)
    while True:
        try:
            r = await scan_refund_eligible_deposits()
            if r.get("promoted"):
                log.info("[refund-cron] promoted=%s checked=%s skipped_after_win=%s",
                         r["promoted"], r["checked"], r["skipped_after_win"])
        except Exception:
            log.exception("[refund-cron] scan failed")
        await _asyncio.sleep(REFUND_CRON_INTERVAL_SEC)


def start_refund_cron_once():
    """Запустить cron один раз (идемпотентно)."""
    global _cron_started
    if _cron_started:
        return
    _cron_started = True
    import asyncio as _asyncio
    _asyncio.create_task(refund_eligibility_cron_loop())


@router.post("/legal/refund/scan-now", dependencies=[Depends(require_admin)])
async def refund_scan_now(_: Dict[str, Any] = Depends(require_admin)):
    """Ручной запуск сканирования (для отладки и E2E-тестов)."""
    res = await scan_refund_eligible_deposits()
    return {"success": True, **res}


# ─────────── P0.4  Contracts v2 ────────────────────────────────────────────

@router.post("/contracts2", dependencies=[Depends(require_manager_or_admin)])
async def create_contract_v2(
    payload: ContractV2CreateIn = Body(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Создать контракт.  Если type=='deposit' — обязательно требуем, чтобы
    у клиента были заполнены legal-поля (P0.1).
    """
    db = _db()
    customer = await db.customers.find_one({"id": payload.customer_id})
    if not customer:
        raise HTTPException(404, f"Customer {payload.customer_id} not found")

    if payload.type == "deposit":
        legal = customer.get("legal") or {}
        missing = [k for k in ("first_name", "last_name", "egn", "national_id_no",
                                "id_card_address", "id_card_issued_by", "id_card_issue_date")
                   if not legal.get(k)]
        if missing:
            raise HTTPException(
                422,
                f"Customer is missing legal fields, cannot create deposit contract. Missing: {missing}",
            )

    contract_id = f"contract2_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}"
    now = _now_iso()
    contract = {
        "id": contract_id,
        "type": payload.type,
        "deal_id": payload.deal_id,
        "customer_id": payload.customer_id,
        "lifecycle": "draft",
        "items": payload.items,
        "notes": payload.notes,
        "pdf_url": None,
        "signed_pdf_url": None,
        "company_signed_pdf_url": None,
        "snapshot_customer_legal": customer.get("legal") if payload.type == "deposit" else None,
        "history": [{"event": "created", "lifecycle": "draft",
                     "by": user.get("email") or user.get("id"), "at": now}],
        "created_by": user.get("email") or user.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    await db.contracts_v2.insert_one(contract)
    contract.pop("_id", None)

    # Привязываем contract id к сделке
    if payload.deal_id:
        if payload.type == "deposit":
            field = "deposit_contract_id"
            stage_target = "deposit_contract_drafted"
        elif payload.type == "final":
            field = "final_contract_id"
            stage_target = "final_contract_sent"
        else:
            field = "purchase_contract_id"
            stage_target = None

        update: Dict[str, Any] = {"$set": {field: contract_id, "updated_at": now}}
        if stage_target:
            update["$set"]["stage"] = stage_target
            update["$set"]["status"] = stage_target
            update.setdefault("$push", {})["stage_history"] = {
                "from": None, "to": stage_target,
                "by": user.get("email") or user.get("id"), "by_role": user.get("role"),
                "at": now, "note": f"contract2 {payload.type} draft created",
            }
        await db.deals.update_one({"$or": [{"id": payload.deal_id}, {"_id": payload.deal_id}]}, update)

    await _audit(
        event_type="contract_created", entity_type="contract_v2",
        entity_id=contract_id, user=user,
        deal_id=payload.deal_id, customer_id=payload.customer_id,
        payload={"type": payload.type, "lifecycle": "draft",
                 "items_count": len(payload.items or [])},
    )
    return {"success": True, "contract": contract}


@router.get("/contracts2/{contract_id}", dependencies=[Depends(require_manager_or_admin)])
async def get_contract_v2(contract_id: str):
    db = _db()
    c = await db.contracts_v2.find_one({"id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, f"Contract {contract_id} not found")
    return {"success": True, "contract": c}


@router.get("/contracts2", dependencies=[Depends(require_manager_or_admin)])
async def list_contracts_v2(deal_id: Optional[str] = None, customer_id: Optional[str] = None,
                              type: Optional[str] = None, lifecycle: Optional[str] = None,
                              limit: int = 50):
    db = _db()
    q: Dict[str, Any] = {}
    if deal_id:
        q["deal_id"] = deal_id
    if customer_id:
        q["customer_id"] = customer_id
    if type:
        q["type"] = type
    if lifecycle:
        q["lifecycle"] = lifecycle
    cursor = db.contracts_v2.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items, "total": len(items)}


@router.post("/contracts2/{contract_id}/transition", dependencies=[Depends(require_manager_or_admin)])
async def transition_contract_v2(
    contract_id: str,
    payload: ContractV2TransitionIn = Body(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Перевести контракт в новый lifecycle-статус с проверкой матрицы переходов.
    Допустимые: draft → sent_to_client → client_signed → company_signed_stamped → finalized.
    """
    db = _db()
    c = await db.contracts_v2.find_one({"id": contract_id})
    if not c:
        raise HTTPException(404, f"Contract {contract_id} not found")

    target = payload.to
    if target not in CONTRACT_LIFECYCLE and target != "cancelled":
        raise HTTPException(400, f"`to` must be one of {CONTRACT_LIFECYCLE} (or cancelled)")

    current = c.get("lifecycle") or "draft"
    role = (user.get("role") or "").lower()
    is_admin = role in ("admin", "master_admin", "owner")

    if not _can_advance_contract(current, target):
        if not is_admin:
            raise HTTPException(
                409,
                f"Forbidden transition {current} → {target}. "
                f"Allowed forward: {CONTRACT_LIFECYCLE_FORWARD.get(current, [])}",
            )

    now = _now_iso()
    await db.contracts_v2.update_one(
        {"id": contract_id},
        {"$set": {"lifecycle": target, "updated_at": now},
         "$push": {"history": {"event": "transition", "from": current, "to": target,
                               "at": now, "by": user.get("email") or user.get("id"),
                               "note": payload.note}}},
    )

    # ═══════ HARD SYNC: contract lifecycle → deal.stage ═══════
    # Жёсткая связь, чтобы менеджер никогда не видел "контракт подписан,
    # но сделка в variants_sent". История пишется в stage_history.
    deal_id = c.get("deal_id")
    contract_type = c.get("type")
    if deal_id and contract_type:
        deal_target: Optional[str] = None
        if contract_type == "deposit":
            if target == "sent_to_client":
                deal_target = "deposit_contract_drafted"
            elif target in ("client_signed", "company_signed_stamped", "finalized"):
                deal_target = "deposit_contract_signed"
        elif contract_type == "final":
            if target == "sent_to_client":
                deal_target = "final_contract_sent"
            elif target in ("client_signed", "company_signed_stamped", "finalized"):
                deal_target = "final_contract_signed"

        if deal_target:
            deal = await db.deals.find_one(
                {"$or": [{"id": deal_id}, {"_id": deal_id}]}, {"stage": 1, "status": 1}
            )
            cur_stage = (deal or {}).get("stage") or (deal or {}).get("status")
            # Не откатываем сделку назад если она уже ушла дальше
            target_idx = DEAL_STAGES.index(deal_target) if deal_target in DEAL_STAGES else -1
            cur_idx = DEAL_STAGES.index(cur_stage) if cur_stage in DEAL_STAGES else -1
            if target_idx > cur_idx:
                await db.deals.update_one(
                    {"$or": [{"id": deal_id}, {"_id": deal_id}]},
                    {
                        "$set": {"stage": deal_target, "status": deal_target, "updated_at": now},
                        "$push": {"stage_history": {
                            "from": cur_stage, "to": deal_target,
                            "by": user.get("email") or user.get("id"),
                            "by_role": user.get("role"),
                            "at": now,
                            "note": f"auto: contract2 {contract_type} → {target}",
                            "source": "contract_sync",
                            "contract_id": contract_id,
                        }},
                    },
                )

    await _audit(
        event_type="contract_transition", entity_type="contract_v2",
        entity_id=contract_id, user=user,
        deal_id=c.get("deal_id"), customer_id=c.get("customer_id"),
        payload={"from": current, "to": target, "type": c.get("type"),
                 "note": payload.note},
    )
    return {"success": True, "contract_id": contract_id, "from": current, "to": target}


@router.post("/contracts2/{contract_id}/upload-signed", dependencies=[Depends(require_manager_or_admin)])
async def upload_signed_pdf(
    contract_id: str,
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Загрузить уже подписанный PDF.  Файл сохраняется в /static/contracts/.
    Поле `signed_pdf_url` обновляется.  Lifecycle вручную через /transition.
    """
    db = _db()
    c = await db.contracts_v2.find_one({"id": contract_id})
    if not c:
        raise HTTPException(404, f"Contract {contract_id} not found")

    if not (file.filename or "").lower().endswith((".pdf",)):
        raise HTTPException(415, "Only PDF allowed")

    base_dir = "/app/backend/static/contracts"
    os.makedirs(base_dir, exist_ok=True)
    safe_name = f"{contract_id}_{uuid.uuid4().hex[:8]}.pdf"
    abs_path = os.path.join(base_dir, safe_name)
    body = await file.read()
    with open(abs_path, "wb") as f:
        f.write(body)
    url = f"/static/contracts/{safe_name}"

    now = _now_iso()
    await db.contracts_v2.update_one(
        {"id": contract_id},
        {"$set": {"signed_pdf_url": url, "updated_at": now},
         "$push": {"history": {"event": "signed_pdf_uploaded", "at": now,
                               "by": user.get("email") or user.get("id"),
                               "data": {"url": url, "size_bytes": len(body)}}}},
    )
    await _audit(
        event_type="contract_signed_pdf_uploaded", entity_type="contract_v2",
        entity_id=contract_id, user=user,
        deal_id=c.get("deal_id"), customer_id=c.get("customer_id"),
        payload={"url": url, "size_bytes": len(body), "type": c.get("type")},
    )
    return {"success": True, "contract_id": contract_id, "signed_pdf_url": url}


# ════════════════════════════════════════════════════════════════════════════
#   6.  AUCTION EVENTS (P1.3)
# ════════════════════════════════════════════════════════════════════════════
#
#   Atomic event "we won the car" — mark deal, auto-create final contract
#   draft, auto-create after_win_package invoice, fan-out notifications.
#   Idempotent: повторный вызов на сделке уже в auction_won никаких новых
#   артефактов НЕ создаёт, возвращает существующие.
#
#   Что НЕ делаем здесь (по решению P1.3 scope):
#     • polling Copart/IAA — оставлено на P1.4
#     • автоматический выпуск (lifecycle = sent_to_client) — менеджер сам
#     • email/PDF generation — оставлено на P1.5
# ────────────────────────────────────────────────────────────────────────────

DEFAULT_AUCTION_FEE_EUR: float = float(os.environ.get("BIBI_DEFAULT_AUCTION_FEE_EUR") or 500.0)
DEFAULT_DELIVERY_TO_ROTTERDAM_EUR: float = float(os.environ.get("BIBI_DEFAULT_DELIVERY_EUR") or 800.0)
DEFAULT_SERVICE_FEE_EUR: float = float(os.environ.get("BIBI_DEFAULT_SERVICE_FEE_EUR") or 1000.0)

#: Стадии сделки, ИЗ которых разрешён переход в auction_won.
#: deposit_paid допустим — менеджер мог сразу зафиксировать выигрыш не двигая
#: сделку через searching_at_auction (бывает на «горячих» лотах).
STAGES_ALLOWING_AUCTION_WON: tuple = ("searching_at_auction", "auction_lost", "deposit_paid")

#: Статусы депозита, которые считаются «деньги приняты» — нужен хотя бы
#: один такой депозит на сделке, иначе auction_won запрещён.
DEPOSIT_STATUSES_FUNDED: tuple = ("paid_confirmed", "refund_pending_30d", "refund_pending_voluntary")


class _AuctionWonIn(BaseModel):
    """Payload события auction_won."""
    price_usd: float = Field(..., gt=0, description="Hammer price в USD")
    auction: str = Field(..., min_length=1, max_length=64,
                         description="Название аукциона (Copart, IAA, Manheim, etc.)")
    lot_number: Optional[str] = Field(None, max_length=64)
    auction_fee_eur: Optional[float] = Field(None, ge=0,
                                              description="Override default 500 EUR")
    delivery_eur: Optional[float] = Field(None, ge=0,
                                           description="Override default 800 EUR")
    service_fee_eur: Optional[float] = Field(None, ge=0,
                                              description="Override default 1000 EUR")
    fx_usd_to_eur: Optional[float] = Field(None, gt=0,
                                            description="Override default 0.92")
    won_at: Optional[str] = Field(None, description="ISO datetime; default = now")
    note: Optional[str] = Field(None, max_length=500)


def _after_win_package_items(
    price_eur: float,
    auction_fee: float,
    delivery: float,
    service_fee: float,
    deposit_eur: float,
) -> List[Dict[str, Any]]:
    """
    Базовый шаблон после-победного инвойса.
      Vehicle price + auction fee + delivery to Rotterdam + service fee
      − deposit applied (если есть).
    Все суммы в EUR.
    """
    items: List[Dict[str, Any]] = [
        {"name": "Vehicle price",           "amount": round(price_eur, 2),    "currency": "EUR"},
        {"name": "Auction fee",             "amount": round(auction_fee, 2),  "currency": "EUR"},
        {"name": "Delivery to Rotterdam",   "amount": round(delivery, 2),     "currency": "EUR"},
        {"name": "Service fee",             "amount": round(service_fee, 2),  "currency": "EUR"},
    ]
    if deposit_eur and deposit_eur > 0:
        items.append({"name": "Deposit applied", "amount": -round(deposit_eur, 2), "currency": "EUR"})
    return items


@router.post("/legal/deals/{deal_id}/auction/won",
             dependencies=[Depends(require_manager_or_admin)])
async def mark_auction_won(
    deal_id: str,
    payload: _AuctionWonIn = Body(...),
    user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Атомарное событие «мы выиграли авто».

    Что делает:
      1. Двигает deal.stage → auction_won (с записью в stage_history).
      2. Создаёт final contract (draft) — если на сделке его ещё нет.
      3. Создаёт invoice (after_win_package, status=pending) — если нет.
      4. Эмитит события: auction_won, auction_won_customer, auction_won_manager.

    Гарантии (edge cases):
      • Идемпотентно: повтор на уже-auction_won сделке возвращает существующие
        contract/invoice без дублей.
      • Без подтверждённого депозита (paid_confirmed) → 409 Conflict.
      • Из стадии `lead`, `qualified`, `closed` etc. → 400 Bad Request.
      • Параллельный вызов: уникальный индекс по (deal_id, type) на contracts_v2
        + проверка `sourceAuctionWonDealId` на invoices гарантируют отсутствие
        дублей даже при race condition.

    Returns:
      {
        success, idempotent, deal_id, stage, contract, invoice, total_eur,
      }
    """
    db = _db()

    deal = await db.deals.find_one({"$or": [{"id": deal_id}, {"_id": deal_id}]})
    if not deal:
        raise HTTPException(404, f"Deal {deal_id} not found")

    current_stage = deal.get("stage") or deal.get("status")
    already_won = current_stage == "auction_won"

    # ─── Idempotent shortcut ─────────────────────────────────────────────
    # Если сделка УЖЕ в auction_won — просто возвращаем существующие
    # contract+invoice. Не делаем никаких записей в БД, не эмитим заново.
    if already_won:
        existing_contract = await db.contracts_v2.find_one(
            {"deal_id": deal_id, "type": "final"}, {"_id": 0}
        ) or {}
        existing_invoice = await db.invoices.find_one(
            {"sourceAuctionWonDealId": deal_id}, {"_id": 0}
        ) or {}
        return {
            "success": True,
            "idempotent": True,
            "deal_id": deal_id,
            "stage": "auction_won",
            "contract": existing_contract,
            "contract_created": False,
            "invoice": existing_invoice,
            "invoice_created": False,
            "total_eur": float(existing_invoice.get("amount") or 0),
            "items": existing_invoice.get("items") or [],
            "auction": deal.get("auction") or {},
        }

    # Stage gate
    if current_stage not in STAGES_ALLOWING_AUCTION_WON:
        raise HTTPException(
            400,
            f"Deal stage is '{current_stage}'. auction_won allowed only from "
            f"{list(STAGES_ALLOWING_AUCTION_WON)}.",
        )

    # Deposit gate — нужен хотя бы один funded депозит на сделке
    funded_deposit = await db.legal_deposits.find_one(
        {"deal_id": deal_id, "status": {"$in": list(DEPOSIT_STATUSES_FUNDED)}}
    )
    if not funded_deposit:
        raise HTTPException(
            409,
            "auction_won requires at least one paid_confirmed deposit on this deal.",
        )

    deposit_eur = float(funded_deposit.get("paid_amount_eur") or 0)
    deposit_id = funded_deposit.get("id")
    fx = float(payload.fx_usd_to_eur or DEFAULT_FX_USD_TO_EUR)
    price_eur = float(payload.price_usd) * fx
    auction_fee = (payload.auction_fee_eur if payload.auction_fee_eur is not None
                   else DEFAULT_AUCTION_FEE_EUR)
    delivery = (payload.delivery_eur if payload.delivery_eur is not None
                else DEFAULT_DELIVERY_TO_ROTTERDAM_EUR)
    service_fee = (payload.service_fee_eur if payload.service_fee_eur is not None
                   else DEFAULT_SERVICE_FEE_EUR)

    # ─── P1.2 — Use invoice_templates if present, fallback to hardcoded ────
    # Breakdown engine is centralised in financial_breakdown.py; we pull the
    # active after_win template and plug in per-deal context. If the template
    # is missing (first-boot, migration gap), we fall back to the legacy
    # _after_win_package_items() so auction_won never breaks.
    template_snapshot: Optional[Dict[str, Any]] = None
    calculation_snapshot: Optional[Dict[str, Any]] = None
    totals: Dict[str, float] = {}
    try:
        import financial_breakdown as _fb
        tpl = await db.invoice_templates.find_one(
            {"kind": "after_win", "active": True}, {"_id": 0},
        )
        if tpl:
            ctx = {
                "vehicle_price": round(price_eur, 2),
                "vehicle_price_eur": round(price_eur, 2),
                "auction_fee": round(auction_fee, 2),
                "delivery_to_rotterdam": round(delivery, 2),
                "service_fee": round(service_fee, 2),
                "deposit_applied": -round(deposit_eur, 2) if deposit_eur > 0 else 0.0,
                "fx_rate_snapshot": fx,
            }
            engine_result = _fb._compute_items_and_totals(tpl["items"], ctx, {})
            items = [
                {"name": i["label"], "amount": i["amount"], "currency": i["currency"],
                 "key": i["key"], "payment_type": i["payment_type"],
                 "is_official": i["is_official"], "type": i["type"]}
                for i in engine_result["items"]
            ]
            totals = engine_result["totals"]
            template_snapshot = tpl
            calculation_snapshot = engine_result["calc"]
        else:
            items = _after_win_package_items(price_eur, auction_fee, delivery, service_fee, deposit_eur)
    except Exception as _e:
        import logging as _lg
        _lg.getLogger("bibi.legal").warning(
            "[auction_won] template engine failed, falling back to legacy items: %s", _e,
        )
        items = _after_win_package_items(price_eur, auction_fee, delivery, service_fee, deposit_eur)

    total_eur = round(sum(i["amount"] for i in items), 2)
    if not totals:
        # Legacy path: compute the 3 totals from the plain items list
        totals = {
            "total_all": total_eur,
            "total_official": round(sum(
                i["amount"] for i in items
                if i.get("is_official", True)
            ), 2) if any("is_official" in i for i in items) else total_eur,
            "total_cash": round(sum(
                i["amount"] for i in items
                if i.get("payment_type") == "cash_off_books"
            ), 2),
        }

    now = _now_iso()
    auction_meta = {
        "price_usd": float(payload.price_usd),
        "price_eur": round(price_eur, 2),
        "fx": fx,
        "fx_rate_snapshot": fx,                # P1.3.1 — explicit, never recomputed
        "auction": payload.auction,
        "lot_number": payload.lot_number,
        "won_at": payload.won_at or now,
        "note": payload.note,
        "registered_by": user.get("email") or user.get("id"),
        "registered_at": now,
    }

    # ─── Step 1. ATOMIC CAS LOCK + stage transition (P1.3.1) ───────────────
    # Гарантирует: даже если 2 запроса прилетят одновременно, только один
    # выиграет CAS и пройдёт дальше. Второй попадёт в idempotent-ветку.
    # Условия CAS: стадия из STAGES_ALLOWING_AUCTION_WON И auction_locked != True.
    cas_filter = {
        "$or": [{"id": deal_id}, {"_id": deal_id}],
        "$and": [
            {"$or": [
                {"stage": {"$in": list(STAGES_ALLOWING_AUCTION_WON)}},
                {"status": {"$in": list(STAGES_ALLOWING_AUCTION_WON)}},
            ]},
            {"$or": [{"auction_locked": {"$exists": False}},
                      {"auction_locked": False}]},
        ],
    }
    cas_update = {
        "$set": {
            "stage": "auction_won",
            "status": "auction_won",
            "auction": auction_meta,
            "auction_locked": True,
            "auction_locked_at": now,
            "auction_locked_by": user.get("email") or user.get("id"),
            "is_locked_after_win": True,
            "fx_rate_snapshot": fx,            # P1.3.1
            "updated_at": now,
        },
        "$push": {"stage_history": {
            "from": current_stage, "to": "auction_won",
            "by": user.get("email") or user.get("id"),
            "by_role": user.get("role"),
            "at": now,
            "note": (f"auction_won: {payload.auction}"
                     + (f" lot {payload.lot_number}" if payload.lot_number else "")),
            "source": "auction_event",
        }},
    }
    cas_result = await db.deals.update_one(cas_filter, cas_update)
    if cas_result.modified_count != 1:
        # CAS не сработал → кто-то параллельно опередил, либо сделка изменилась.
        # Re-fetch и решаем как реагировать.
        deal_re = await db.deals.find_one({"$or": [{"id": deal_id}, {"_id": deal_id}]})
        if deal_re and (deal_re.get("stage") or deal_re.get("status")) == "auction_won":
            # Другой запрос победил гонку — возвращаем idempotent-ответ
            existing_contract = await db.contracts_v2.find_one(
                {"deal_id": deal_id, "type": "final"}, {"_id": 0}
            ) or {}
            existing_invoice = await db.invoices.find_one(
                {"sourceAuctionWonDealId": deal_id}, {"_id": 0}
            ) or {}
            return {
                "success": True, "idempotent": True, "deal_id": deal_id,
                "stage": "auction_won",
                "contract": existing_contract, "contract_created": False,
                "invoice": existing_invoice, "invoice_created": False,
                "total_eur": float(existing_invoice.get("amount") or 0),
                "items": existing_invoice.get("items") or [],
                "auction": deal_re.get("auction") or {},
                "race_resolved": True,
            }
        # Странный кейс — лок занят, но не auction_won
        raise HTTPException(
            409,
            "Deal is currently being processed (auction_locked). Try again in a few seconds.",
        )

    # ─── Step 2. Find or create final contract (draft) ──────────────────────
    contract = await db.contracts_v2.find_one(
        {"deal_id": deal_id, "type": "final"}, {"_id": 0}
    )
    contract_created = False
    if not contract:
        contract_id = (f"contract2_{int(datetime.now(timezone.utc).timestamp())}"
                        f"_{uuid.uuid4().hex[:8]}")
        customer = await db.customers.find_one(
            {"id": deal.get("customerId") or deal.get("customer_id")}, {"legal": 1}
        )
        contract = {
            "id": contract_id,
            "type": "final",
            "deal_id": deal_id,
            "customer_id": deal.get("customerId") or deal.get("customer_id"),
            "lifecycle": "draft",
            "items": items,
            "notes": (f"Auto-created from auction_won event. "
                      f"Auction={payload.auction}, lot={payload.lot_number or '—'}, "
                      f"hammer=${float(payload.price_usd):,.0f}."),
            "pdf_url": None,
            "signed_pdf_url": None,
            "company_signed_pdf_url": None,
            "snapshot_customer_legal": (customer or {}).get("legal"),
            "auto_created_from": "auction_won",
            "auction": auction_meta,
            "fx_rate_snapshot": fx,            # P1.3.1
            "linked_deposit_id": deposit_id,   # P1.3.1
            "history": [{
                "event": "created", "lifecycle": "draft",
                "by": "system:auction_won", "at": now,
                "data": {"source": "auction_won",
                         "auction": payload.auction,
                         "lot_number": payload.lot_number,
                         "fx_rate_snapshot": fx}
            }],
            "created_by": "system:auction_won",
            "created_at": now,
            "updated_at": now,
        }
        await db.contracts_v2.insert_one(contract)
        contract.pop("_id", None)
        contract_created = True

        # Привязать contract id к сделке
        await db.deals.update_one(
            {"$or": [{"id": deal_id}, {"_id": deal_id}]},
            {"$set": {"final_contract_id": contract["id"], "updated_at": now}},
        )

    # ─── Step 3. Find or create invoice (after_win_package, draft) ──────────
    invoice = await db.invoices.find_one(
        {"sourceAuctionWonDealId": deal_id}, {"_id": 0}
    )
    invoice_created = False
    if not invoice:
        invoice_id = (f"inv-aw-{int(datetime.now(timezone.utc).timestamp())}"
                       f"-{uuid.uuid4().hex[:6]}")
        invoice = {
            "id": invoice_id,
            "customerId": deal.get("customerId") or deal.get("customer_id"),
            "dealId": deal_id,
            "amount": total_eur,
            "total": total_eur,
            "currency": "EUR",
            "status": "pending",
            "kind": "after_win",                          # P1.2 — canonical kind
            "template": "after_win_package",              # legacy field
            "template_id": (template_snapshot or {}).get("id") or "tpl_after_win_package",
            "template_snapshot": template_snapshot,       # P1.2 — immutable copy
            "calculation_snapshot": calculation_snapshot, # P1.2 — full trace
            "totals": totals,                             # P1.2 — 3 totals
            "items": items,
            "auction": auction_meta,
            "fx_rate_snapshot": fx,                       # P1.3.1
            # P1.3.1 — hard link deposit → invoice (для бухгалтерии и аудита)
            "deposit_id": deposit_id if deposit_eur > 0 else None,
            "deposit_applied_eur": round(deposit_eur, 2),
            "sourceAuctionWonDealId": deal_id,
            "auto_created_from": "auction_won",
            "linked_contract_id": contract.get("id"),
            "locked": True,                               # P1.2 — immutable
            "due_date": None,
            "dueDate": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.invoices.insert_one(invoice)
        invoice.pop("_id", None)
        invoice_created = True

        # ─ обратный линк: на депозите ставим invoice_id (двусторонняя связь)
        if deposit_id and deposit_eur > 0:
            await db.legal_deposits.update_one(
                {"id": deposit_id},
                {"$set": {
                    "applied_to_invoice_id": invoice_id,
                    "applied_at": now,
                    "updated_at": now,
                 },
                 "$push": {"history": {
                     "event": "applied_to_invoice", "at": now,
                     "by": "system:auction_won",
                     "data": {"invoice_id": invoice_id,
                              "amount_eur": round(deposit_eur, 2)},
                 }}},
            )

    # ─── Step 4. Notifications ──────────────────────────────────────────────
    customer_id = deal.get("customerId") or deal.get("customer_id")
    await _emit_safe("auction_won", {
        "dealId": deal_id, "customerId": customer_id,
        "contractId": contract.get("id"), "invoiceId": invoice.get("id"),
        "auction": payload.auction, "lot_number": payload.lot_number,
        "price_usd": float(payload.price_usd), "price_eur": round(price_eur, 2),
        "fx_rate_snapshot": fx,
        "by": user.get("email") or user.get("id"),
        "idempotent": False,
        "contract_created": contract_created, "invoice_created": invoice_created,
    })
    # Customer-facing event
    await _emit_safe("auction_won_customer", {
        "customerId": customer_id, "dealId": deal_id,
        "title": "Вы выиграли авто 🎉",
        "message": (f"Сделка {deal_id}: следующий шаг — финальный договор и оплата. "
                    f"Сумма к оплате: €{total_eur:,.0f}."),
        "contractId": contract.get("id"), "invoiceId": invoice.get("id"),
        "kind": "auction_won",
    })
    # Manager-facing event
    await _emit_safe("auction_won_manager", {
        "dealId": deal_id, "customerId": customer_id,
        "title": f"Deal {deal_id} → auction_won",
        "message": (f"Contract {contract.get('id')} + invoice {invoice.get('id')} "
                    f"созданы автоматически. К оплате €{total_eur:,.0f}."),
        "contractId": contract.get("id"), "invoiceId": invoice.get("id"),
        "kind": "auction_won",
    })

    # ─── Step 5. Audit log (P1.3.1) ────────────────────────────────────────
    await _audit(
        event_type="auction_won", entity_type="deal", entity_id=deal_id,
        user=user, deal_id=deal_id, customer_id=customer_id,
        payload={
            "from_stage": current_stage,
            "auction": payload.auction,
            "lot_number": payload.lot_number,
            "price_usd": float(payload.price_usd),
            "price_eur": round(price_eur, 2),
            "fx_rate_snapshot": fx,
            "total_eur": total_eur,
            "deposit_id": deposit_id,
            "deposit_applied_eur": round(deposit_eur, 2),
            "contract_id": contract.get("id"),
            "contract_created": contract_created,
            "invoice_id": invoice.get("id"),
            "invoice_created": invoice_created,
        },
    )

    return {
        "success": True,
        "idempotent": False,
        "deal_id": deal_id,
        "stage": "auction_won",
        "contract": contract,
        "contract_created": contract_created,
        "invoice": invoice,
        "invoice_created": invoice_created,
        "total_eur": total_eur,
        "items": items,
        "auction": auction_meta,
        "fx_rate_snapshot": fx,
        "deposit_id": deposit_id,
        "deposit_applied_eur": round(deposit_eur, 2),
        "is_locked_after_win": True,
    }


# ════════════════════════════════════════════════════════════════════════════
#   7.  AUDIT TRAIL READ API (P1.3.1)
# ════════════════════════════════════════════════════════════════════════════
#
#   Public read endpoints для бухгалтерии, юр.отдела и менеджеров.
#   Запись в audit_events НЕ выполняется через API — только через _audit()
#   из доменных endpoints. Это append-only: ни PUT, ни DELETE здесь нет.
#

@router.get("/legal/audit", dependencies=[Depends(require_manager_or_admin)])
async def list_audit_events(
    deal_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    type: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 100,
):
    """
    Прочитать audit_events с фильтрами. Сортировка: новые сверху.
    Все параметры опциональны — без фильтров возвращает последние `limit` событий.
    Защита: только manager/admin/master_admin.
    """
    db = _db()
    q: Dict[str, Any] = {}
    if deal_id:
        q["deal_id"] = deal_id
    if customer_id:
        q["customer_id"] = customer_id
    if entity_type:
        q["entity_type"] = entity_type
    if entity_id:
        q["entity_id"] = entity_id
    if type:
        q["type"] = type
    if user_email:
        q["user_email"] = user_email

    limit = max(1, min(limit, 500))
    cursor = db.audit_events.find(q, {"_id": 0}).sort("ts", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    # Сериализуем datetime ts -> isoformat (чтобы JSON не падал)
    for it in items:
        ts = it.get("ts")
        if isinstance(ts, datetime):
            it["ts"] = ts.isoformat()
    return {"success": True, "data": items, "total": len(items), "filters": q}


@router.get("/legal/deals/{deal_id}/audit", dependencies=[Depends(require_manager_or_admin)])
async def get_deal_audit_trail(deal_id: str, limit: int = 200):
    """Полный audit-trail по конкретной сделке (timeline для UI)."""
    db = _db()
    limit = max(1, min(limit, 500))
    cursor = db.audit_events.find({"deal_id": deal_id}, {"_id": 0}).sort("ts", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    for it in items:
        ts = it.get("ts")
        if isinstance(ts, datetime):
            it["ts"] = ts.isoformat()
    return {"success": True, "deal_id": deal_id, "data": items, "total": len(items)}


# ════════════════════════════════════════════════════════════════════════════
#   5.  STATIC CATALOG  (для UI)
# ════════════════════════════════════════════════════════════════════════════

@router.get("/legal/catalog")
async def legal_catalog():
    """
    Один эндпоинт для фронта — отдаёт все справочники сразу:
    стадии сделки, статусы депозита, типы и lifecycle контракта.
    """
    return {
        "success": True,
        "deal_stages": DEAL_STAGES,
        "deal_stage_forward": DEAL_STAGE_FORWARD,
        "deal_stage_groups": DEAL_STAGE_GROUPS,
        "stages_after_auction_win": STAGES_AFTER_AUCTION_WIN,
        "deposit_statuses": DEPOSIT_STATUSES,
        "contract_types": CONTRACT_TYPES,
        "contract_lifecycle": CONTRACT_LIFECYCLE,
        "contract_lifecycle_forward": CONTRACT_LIFECYCLE_FORWARD,
        "deposit_rules": {
            "min_eur": MIN_DEPOSIT_EUR,
            "pct_threshold_usd": DEPOSIT_PCT_THRESHOLD_USD,
            "pct": DEPOSIT_PCT,
            "default_fx_usd_to_eur": DEFAULT_FX_USD_TO_EUR,
            "refund_deadline_days": REFUND_DEADLINE_DAYS,
        },
        "auction_defaults": {
            "auction_fee_eur": DEFAULT_AUCTION_FEE_EUR,
            "delivery_to_rotterdam_eur": DEFAULT_DELIVERY_TO_ROTTERDAM_EUR,
            "service_fee_eur": DEFAULT_SERVICE_FEE_EUR,
            "default_fx_usd_to_eur": DEFAULT_FX_USD_TO_EUR,
            "stages_allowing_auction_won": list(STAGES_ALLOWING_AUCTION_WON),
        },
    }
