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

---

## Phase — P1.2 Financial Breakdown (DONE — May 2026)

Goal: вынести расчёт денег в БД (templates) и развести 3 типа сумм
(`total_all` / `total_official` / `total_cash`). Это **не «инвойсы»**, это
**payment breakdown** — отражение реального cash-flow сделки, включая
наличные платежи (cash_off_books).

### Architecture invariants
```
templates  =  данные (DB)         → как считать
engine     =  логика (backend)    → считает здесь
breakdown  =  snapshot (immutable, locked=True) → навсегда
```

### What was built

**1. `financial_breakdown.py` — новый автономный модуль (~600 строк)**
- Safe AST formula parser (whitelist: `+ - * / % ** //`, unary, имена из ctx) — **БЕЗ `eval()`**
- `_compute_items_and_totals()` — engine, накапливает context, считает 3 totals
- 8 новых endpoints под `/api/admin/invoice-templates/*` и `/api/legal/deals/{id}/...`
- Seed 2 default templates на startup + indexes

**2. Templates в БД (`invoice_templates`)**
| ID | kind | items | usage |
|---|---|---|---|
| `tpl_after_win_package` | `after_win` | vehicle_price, auction_fee, delivery_to_rotterdam, service_fee, deposit_applied | auto на `auction_won` |
| `tpl_final_settlement` | `final` | vehicle_price_eur, customs_duty (×0.10), vat (×0.20), bg_transport (cash!), service_fee, adjustments (manual) | manual клик |

**3. Item structure (с разделением денег)**
```jsonc
{
  "key": "bg_transport", "label": "Transport Bulgaria",
  "type": "input", "default": 700,
  "payment_type": "cash_off_books",   // bank|stripe|cash_off_books|internal|manual
  "is_official": false,                // отражает в total_official?
  "currency": "EUR"
}
```

**4. Breakdown document (immutable snapshot)**
```jsonc
{
  "id": "fin-final-...", "kind": "final", "locked": true,
  "template_id": "tpl_final_settlement",
  "template_snapshot": { ...full copy... },     // через 2 месяца template
  "calculation_snapshot": { ...full trace... }, //   изменится → этот не трогаем
  "items": [...],
  "totals": { "total_all": 19916, "total_official": 19216, "total_cash": 700 },
  "fx_rate_snapshot": 0.92
}
```

**5. Migration: `mark_auction_won` использует template**
- Проверяется `tpl_after_win_package` в БД, если есть → engine генерирует items
- Fallback на legacy `_after_win_package_items()` если template отсутствует
- Новые поля в invoice: `kind="after_win"`, `template_id`, `template_snapshot`, `calculation_snapshot`, `totals`, `locked=true`

### New endpoints
| Method | Path | Roles | Что |
|---|---|---|---|
| GET    | `/api/admin/invoice-templates`            | admin    | list (filter by kind, active) |
| GET    | `/api/admin/invoice-templates/{id}`       | admin    | get one |
| POST   | `/api/admin/invoice-templates`            | admin    | create (validates formula syntax) |
| PATCH  | `/api/admin/invoice-templates/{id}`       | admin    | update (bumps version if items changed) |
| DELETE | `/api/admin/invoice-templates/{id}`       | admin    | soft-delete (active=false) |
| POST   | `/api/admin/invoice-templates/{id}/preview` | manager+ | dry-run engine (no DB writes) |
| POST   | `/api/legal/deals/{id}/final-breakdown`   | manager+ | сгенерировать final breakdown |
| GET    | `/api/legal/deals/{id}/financials`        | manager+ | timeline всех breakdown'ов сделки + summary |

### Hard rules (locked semantics)
- ✔ нельзя изменить breakdown после создания (`locked=True`)
- ✔ fx_rate_snapshot никогда не пересчитывается (наследие P1.3.1)
- ✔ template можно soft-delete, но breakdown'ы хранят свой `template_snapshot` навсегда
- ✔ formula error → 422 (на этапе CREATE template и при preview/generate)
- ✔ missing required input → 422
- ✔ negative values разрешены (rebate, deposit_applied = -1000)

### Stage gate (final breakdown)
Allowed only from: `arrived_rotterdam` | `customs_calculated` | `final_payment_paid` | `in_transit_to_bg` | `delivered`.
Попытка ранее → HTTP 400.

### Test coverage (E2E POC)
`/app/backend/test_p12_financial_e2e.py` — 7 test groups, **67/67 passed**:
1. Safe AST parser — 13 cases (correctness + 6 forbidden constructs + bad syntax + unknown var)
2. Seed verification — оба default template'а на месте, формулы корректны, cash_off_books флаги правильные
3. Template CRUD — create/get/preview/patch/version-bump/soft-delete
4. auction_won writes new P1.2 fields (kind, template_id, snapshots, totals, locked, payment_type)
5. Final breakdown end-to-end:
   - stage gate blocks before arrived_rotterdam
   - customs_duty = 13800 × 0.10 = 1380 ✓
   - vat = (13800 + 1380) × 0.20 = 3036 ✓
   - bg_transport=700 in total_cash, total_official excludes it
   - total_all=19916, total_official=19216, total_cash=700
   - idempotent replay returns same id
   - `/financials` listing summary correct
6. Adjustments override (negative -150) + audit_event recorded
7. Edge cases: formula syntax error → 422, missing required → 422

P1.3.1 regression: 34/34 still green.

### NOT built (P1.2 scope freeze)
- ❌ Frontend UI for templates editor — backend ready, UI in P1.2-UI phase
- ❌ Frontend "Generate Final Costs" button — endpoint ready, UI in P1.2-UI phase
- ❌ Excel/PDF export of breakdown — backlog

---

## Phase — P1.2-payments + P1.2-UI (DONE — May 2026)

Goal: закрыть финансовый цикл сделки — учёт реальных платежей + UI для
менеджеров. Это последний слой над `financial_breakdown` который превращает
систему из «считает сколько надо» в «контролирует сколько пришло».

### Architectural model
```
Backend:                     Frontend:
─────────                    ────────
breakdown (immutable)        BreakdownPanel + BreakdownCard
   ↓                           ↓
payments (append-only)        PaymentsPanel + PaymentsTable
   ↓                           ↓
recompute_status()             auto-refresh + status badge
   ↓                           ↓
deal.payment_status           color-coded progress bar
```

### Backend (payments_tracking.py — ~470 lines)
**Endpoints:**
| Method | Path | Roles | Что |
|---|---|---|---|
| POST | `/api/legal/deals/{id}/payments` | manager+ | Зарегистрировать платёж (pending или confirmed if `auto_confirm` + admin) |
| POST | `/api/legal/payments/{id}/confirm` | manager+ | Подтвердить (idempotent) |
| POST | `/api/legal/payments/{id}/void` | **admin only** | Отменить (НЕ удалить) с причиной |
| GET | `/api/legal/deals/{id}/payments` | manager+ | List + summary (paid/remaining/status + 3-by-flow split) |
| GET | `/api/legal/payments/{id}` | manager+ | Get one |
| POST | `/api/legal/deals/{id}/payments/recompute` | manager+ | Manual recompute (debug) |

**Hard rules:**
- ✔ Payment immutable after confirm — только void (с reason)
- ✔ Void не удаляет — `status=voided`, audit trail сохраняется
- ✔ Idempotent confirm (повтор = 200 + idempotent=True)
- ✔ Cancelled deal → 409 на create
- ✔ Bank без proof_url → 200 + warning (не блок)
- ✔ Cash без proof → 200 без warning (нормально)
- ✔ Переплата разрешена → status="overpaid" (не отказ)
- ✔ `is_official` авто-derived: bank/stripe/internal → True; cash → False

**Auto-status (single source of truth):**
```
recompute_deal_payment_status(deal_id):
  paid_total = SUM(amount) WHERE status=confirmed
  status = unpaid (0) | partial (>0 < total) | paid (>= total) | overpaid (> total)
  IF first transition to paid AND stage in STAGES_ALLOWING_AUTO_PAID:
     stage → "in_transit_to_bg"
     emit event "deal_paid_in_full"
     audit "deal_paid_in_full"
```

**Audit events (4 new):**
- `payment_created`, `payment_confirmed`, `payment_voided`, `deal_paid_in_full`

### Frontend (LegalWorkflowPage.jsx — `FinancialsTab`)
Новый таб **"Financials & Payments (P1.2)"** содержит:

**Left rail:** селектор сделки (синхронизирован с обоими панелями)

**BreakdownPanel:**
- Список всех breakdown'ов (after_win + final), сортированы newest-first
- `BreakdownCard`: цветовая разметка
  - 🟦 After-Win (header) | 🟣 Final (header)
  - 🔴 cash_off_books строки — красная подсветка фона
  - 🟢 negative amounts (rebate, deposit) — зелёный
  - LOCKED 🔒 badge на immutable breakdown'ах
  - FX rate snapshot отображается рядом с датой
- 3 totals в footer карточки: Total / Official / Cash 🔴
- **«Generate Final Costs»** кнопка → preview modal → confirm

**PaymentsPanel:**
- Status badge (unpaid/partial/paid/overpaid) — цветовой
- Прогресс-бар оплаты (зелёный/жёлтый/синий по статусу)
- 3-card summary: To pay / Paid / Remaining
- Таблица платежей с:
  - Method tint (Bank/Stripe/Cash 🔴)
  - Status badge (pending/confirmed/voided)
  - Proof link (если есть)
  - **Confirm** кнопка для pending
  - **Void** кнопка (admin only, с prompt для reason)
- **«Add Payment»** modal: amount + method (3 кнопки) + proof + auto-confirm checkbox

### Test coverage
**P1.2-payments E2E** (`test_payments_e2e.py`) — 7 test groups, **23/23 passed**:
1. Create pending → confirm flow (paid_total updates)
2. Paid in full → auto-advance stage to `in_transit_to_bg` + audit `deal_paid_in_full`
3. Overpaid status (paid > total) — accepted, not rejected
4. Void confirmed payment → recompute drops paid_total by that amount
5. Idempotent confirm (replay returns idempotent=True; voided cannot be confirmed → 409)
6. Cash no proof OK + Bank no proof returns warnings
7. Cancelled deal blocks new payment → 409

**Regression**: P1.3.1 (34/34) and P1.2 (67/67) STILL all green.
**System smoke**: ALL CHECKS PASSED.

### NOT built (deliberate)
- ❌ Customer-facing payment view («Мой счёт»)
- ❌ Payment proof file upload (currently URL-based; can plug in object storage)
- ❌ Stripe webhook auto-confirm (hooked-in path is `auto_confirm`, but no hook yet)
- ❌ Email notifications on payment_confirmed / deal_paid_in_full
- ❌ PDF export of breakdown

