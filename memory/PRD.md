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
