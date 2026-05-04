# BIBI Cars — Product Requirements (cumulative)

**Status:** Production-ready core (Provider Pressure + Business Metrics shipped on top of existing V3.2 CRM).

## Phase — Provider Pressure + Business Metrics (done)

### Goal
Превратить существующие `orders` в механизм давления на провайдеров (managers)
и дать админу ровно 3 ключевых бизнес-метрики.

### What was built

#### 1. Provider Pressure engine (wired to event bus)
- `/app/backend/provider_stats.py` — `ProviderStatsService`
  - Формула: `response×0.3 + completion×0.4 + activity×0.3 − latePenalty` → `score 0..100`
  - 5-уровневая таксономия тиров (user spec):
    - 80–100 **high**      → multiplier ×1.2 (boost)
    - 60–79  **normal**    → ×1.0
    - 40–59  **warning**   → ×0.8 + сообщение "ты теряешь заказы"
    - 20–39  **penalized** → ×0.5 (штраф)
    - <20    **hidden**    → ИСКЛЮЧЁН из matching
- Event-bus подписка (`notifications.bus`): `order_started`, `order_finished`
- Автоматический stamp `assignedAt/startedAt/completedAt` на `db.orders`
- Back-fill всех провайдеров при старте (асинхронный фон).

#### 2. Tier-change detection + cooldown
- При каждом `recompute` сравнивается prev_tier vs new_tier
- На изменение — эмит `provider_tier_changed` через bus
- Cooldown **6 часов на провайдера** через `lastTierNotifyAt`
- Шаблоны (UA+EN) и правила маршрутизации добавлены в `notifications.py`:
  - Получатели: сам manager (in_app) + master_admin (in_app)

#### 3. Matching integration
- `ProviderStatsService.pick_best_provider(candidate_ids)` — ранжирует по `score*multiplier`, исключает hidden
- Подключен в Ringostat fallback (`server.py` ~ line 3671)
- Новый/неизвестный провайдер получает neutral score 50 (не голодает)

#### 4. API endpoints
| Method | Path | Roles | Что делает |
|---|---|---|---|
| GET  | `/api/providers/me/stats`               | auth     | мои score/tier/метрики |
| GET  | `/api/providers/{id}/stats`             | self/admin | чужие (только admin/team_lead) |
| GET  | `/api/admin/providers/stats`            | admin    | список всех, отсортированный по score desc |
| POST | `/api/admin/providers/stats/recompute`  | admin    | пересчёт одного (query `?provider_id=`) или всех |
| GET  | `/api/admin/metrics`                    | admin    | 3 KPI: conversion, avg_order_time, repeat_rate |

#### 5. Frontend UI
- `/admin/business-metrics` — 3 метрики в карточках (conversion, avg_order_time, repeat_rate) с авто-обновлением раз в минуту
- `/admin/provider-health` — таблица всех провайдеров: score-бар, tier-badge, sub-scores, late starts; кнопка "Перерахувати всіх"
- `ProviderHealthWidget` — в `/manager` workspace: gradient-карточка с моим score, tier и pressure-сообщением
- Новые пункты сайдбара в группе **Control**:
  - Бізнес-метрики
  - Provider Pressure

### Not built (explicit user scope freeze)
- ❌ revenue / active_providers metrics — "не расширяем, не нужно"
- ❌ Real email — без `RESEND_API_KEY`, остаётся dry-run в `email_outbox`; включится автоматически добавлением ключа в `backend/.env`
- ❌ Новые роли / экраны / ML

## Test coverage (automated)
`/app/backend/test_provider_pressure.py` — end-to-end smoke:
- event-bus wiring
- score/tier computation (fast=98/high, slow=21/penalized, 5 late starts)
- pick_best_provider excludes hidden tier
- tier-change emission + 6h cooldown verified
- /api/admin/metrics arithmetic (conversion 0.5, avg_order_time 3.49h)

All 6 blocks green on last run.

---

## Phase — P1.3.1 Hardening (DONE — May 2026)

Goal: дожать архитектуру `auction_won` до production-grade прежде чем
расширять invoice templates. Пять инвариантов, без которых нельзя в прод.

### What was hardened

| # | Инвариант | Как реализовано |
|---|-----------|-----------------|
| 1 | **Atomic CAS lock** против race conditions | `auction_locked` + CAS update_one в `mark_auction_won` (line 1538-1571 `legal_workflow.py`). Только ОДИН concurrent caller проходит, остальные → idempotent ответ. |
| 2 | **`is_locked_after_win` freeze** | Guard `_ensure_deal_not_locked_after_win()` в: `POST /legal/deposits` (create), `PUT /legal/deposits/{id}/confirm-payment`. После auction_won любая попытка → HTTP 409. |
| 3 | **`fx_rate_snapshot`** в 4 местах | Записывается атомарно в: `deal.fx_rate_snapshot`, `deal.auction.fx_rate_snapshot`, `contract_v2.fx_rate_snapshot`, `invoice.fx_rate_snapshot`. **Никогда не пересчитывается.** |
| 4 | **deposit ↔ invoice hard link** | `invoice.deposit_id`, `invoice.deposit_applied_eur`, `invoice.linked_contract_id` + обратный `deposit.applied_to_invoice_id` (двусторонняя связь для бухгалтерии). |
| 5 | **Append-only audit_events** | Коллекция `db.audit_events` + `_audit()` helper. События: `deposit_created`, `deposit_paid_confirmed`, `deposit_forfeit_requested/teamlead_approved/forfeited`, `deposit_refund_requested_voluntary/approved/rejected/refunded`, `contract_created`, `contract_transition`, `contract_signed_pdf_uploaded`, `auction_won`. Каждое — с user_id, user_email, role, payload, ts. |

### New endpoints
| Method | Path | Что |
|---|---|---|
| GET | `/api/legal/audit?deal_id=&customer_id=&type=&...` | фильтрованный read с пагинацией (limit ≤ 500) |
| GET | `/api/legal/deals/{deal_id}/audit` | timeline по сделке для UI |

### MongoDB indexes (P1.3.1)
Создаются на startup (`server.py` `_seed_staff_from_env` neighbour):
- `audit_events.ts` (-1)
- `audit_events.(deal_id, ts)`, `(customer_id, ts)`, `(entity_type, entity_id, ts)`, `(type, ts)`
- `audit_events.id` (unique sparse)

### Test coverage (E2E POC)
`/app/backend/test_p131_hardening_e2e.py` — 6 test groups, 34 assertions, **all green**:
1. CAS lock — 5 concurrent /auction/won → exactly 1 contract+invoice
2. Post-win freeze — create-deposit on locked deal → 409 with proper message
3. FX snapshot — 0.87 (custom rate) persists in 4 places + response
4. Deposit↔invoice link — bidirectional verified, `Deposit applied` line item present
5. Audit events — 3 event types via API + filter + per-deal endpoint
6. Idempotent replay — second `/auction/won` returns same IDs, exactly 1 audit event

### NOT built (deliberately deferred)
- ❌ Invoice templates DB collection (`invoice_templates`) — следующий шаг (P1.2)
- ❌ Final settlement package (customs + VAT + transport BG + adjustments) — P1.2
- ❌ Audit UI на фронте — backend готов, фронт в P1.2

