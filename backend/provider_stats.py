"""
BIBI — Provider Pressure / Health-Score engine
==============================================

Maps "provider" → our ``managerId`` on orders. The engine:

1. subscribes to the notification event-bus (the same bus that already
   powers emails / in-app), so we never touch business logic again to
   add new metrics;
2. on every relevant event writes timing into the order doc
   (``assignedAt``, ``startedAt``, ``completedAt``) and recomputes the
   provider's rolling stats;
3. exposes a single ``score 0-100`` + tier + pressure message that drives
   matching / visibility / boosts;
4. emits ``provider_tier_changed`` with a 6h-per-provider cooldown so
   the master / team-lead get notified only on real transitions.

Formula (matches spec 1:1):

    response_score   = clamp(1 - response_time_min / 60, 0, 1)
    completion_score = completed / total       (0 if total=0 → 0.5 neutral)
    activity_score   = 1 if last_activity < 24h else 0.5
    delay_penalty    = min(late_starts * 0.05, 0.4)

    raw = response*0.3 + completion*0.4 + activity*0.3 - delay_penalty
    score = round(clamp(raw * 100, 0, 100))

Tiers (user spec, 5 levels):

    >= 80    high       "🟢 Boost ×1.2 — ти в пріоритеті"
    >= 60    normal     "🟡 Тримай темп"
    >= 40    warning    "🟠 Ти втрачаєш замовлення через повільні старти"
    >= 20    penalized  "🔴 Штраф — наздоганяй або буде відключення"
    <  20    hidden     "🚫 Приховано з matching — зв'яжись з адміном"

Matching multipliers (used by ``pick_best_provider``):

    tier == "high"       → multiplier = 1.2
    tier == "normal"     → multiplier = 1.0
    tier == "warning"    → multiplier = 0.8
    tier == "penalized"  → multiplier = 0.5
    tier == "hidden"     → EXCLUDED from matching entirely
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger("bibi.provider_stats")

# ── tier taxonomy (user spec) ─────────────────────────────────────
TIER_THRESHOLDS = [
    (80, "high"),
    (60, "normal"),
    (40, "warning"),
    (20, "penalized"),
    (0,  "hidden"),
]

TIER_ORDER = ["hidden", "penalized", "warning", "normal", "high"]

TIER_MESSAGE_UA = {
    "high":      "🟢 Boost ×1.2 — ти в пріоритеті у matching",
    "normal":    "🟡 Тримай темп — ще трошки й потрапиш у boost",
    "warning":   "🟠 Ти втрачаєш замовлення через повільні старти",
    "penalized": "🔴 Штраф — наздоганяй або буде відключення",
    "hidden":    "🚫 Приховано з matching — зв'яжись з адміном",
}

TIER_MESSAGE_EN = {
    "high":      "🟢 Boost ×1.2 — you have priority in matching",
    "normal":    "🟡 Keep the pace — almost at boost tier",
    "warning":   "🟠 You are losing orders due to slow starts",
    "penalized": "🔴 Penalized — catch up or you will be cut off",
    "hidden":    "🚫 Hidden from matching — contact admin",
}

TIER_MULTIPLIER = {
    "high":      1.2,
    "normal":    1.0,
    "warning":   0.8,
    "penalized": 0.5,
    "hidden":    0.0,  # excluded
}

WEIGHTS = {"response": 0.3, "completion": 0.4, "activity": 0.3}
COOLDOWN_HOURS = 6  # per-provider cooldown between tier-change notifications


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _parse_dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


def tier_for(score: float) -> str:
    for threshold, name in TIER_THRESHOLDS:
        if score >= threshold:
            return name
    return "hidden"


def multiplier_for(score_or_tier) -> float:
    """Accepts either a numeric score or a tier string."""
    if isinstance(score_or_tier, (int, float)):
        return TIER_MULTIPLIER.get(tier_for(float(score_or_tier)), 1.0)
    return TIER_MULTIPLIER.get(str(score_or_tier or "normal"), 1.0)


# ── core service ────────────────────────────────────────────────────
class ProviderStatsService:
    def __init__(self, db, bus=None):
        self.db = db
        self.bus = bus

    # Which event drives which timing field on the order doc
    TIMING_FIELDS = {
        "order_started":  "startedAt",
        "order_finished": "completedAt",
    }

    async def hook(self, event: str, payload: Dict[str, Any]) -> None:
        """Event-bus entry point. Never raises into the bus."""
        try:
            order = payload.get("order") or {}
            provider_id = order.get("managerId") or order.get("provider_id")
            if not provider_id:
                return

            # Stamp timing on the order if applicable (idempotent).
            field = self.TIMING_FIELDS.get(event)
            if field and order.get("id") and not order.get(field):
                await self.db.orders.update_one(
                    {"id": order["id"]},
                    {"$set": {field: datetime.now(timezone.utc).isoformat()}},
                )

            # Also ensure assignedAt is present — first touch wins (idempotent)
            if event == "order_started" and order.get("id") and not order.get("assignedAt"):
                await self.db.orders.update_one(
                    {"id": order["id"], "assignedAt": {"$in": [None, ""]}},
                    {"$set": {"assignedAt": order.get("created_at") or datetime.now(timezone.utc).isoformat()}},
                )

            # Recompute aggregate stats for this provider (+ tier-change side-effects).
            await self.recompute(provider_id)
        except Exception:
            logger.exception("[provider_stats] hook failed for event=%s", event)

    async def recompute(self, provider_id: str) -> Dict[str, Any]:
        """Scan all orders for this provider and rebuild the stats doc."""
        now = datetime.now(timezone.utc)
        cursor = self.db.orders.find({"managerId": provider_id}, {"_id": 0})
        orders = await cursor.to_list(length=10_000)
        total = len(orders)

        prev_doc = await self.db.provider_stats.find_one({"providerId": provider_id}, {"_id": 0}) or {}
        prev_tier = prev_doc.get("tier")
        prev_notify_at = _parse_dt(prev_doc.get("lastTierNotifyAt"))

        if total == 0:
            stats = {
                "providerId": provider_id,
                "score": 0,
                "tier": "hidden",
                "metrics": {
                    "responseTimeAvg": None,
                    "startDelayAvg":   None,
                    "completionRate":  0,
                    "avgCompletionTime": None,
                    "activeOrders":    0,
                    "totalOrders":     0,
                    "lastActivityAt":  None,
                },
                "penalties": {"lateStarts": 0, "cancellations": 0, "noShows": 0},
                "message":   TIER_MESSAGE_UA["hidden"],
                "updatedAt": now.isoformat(),
            }
            await self.db.provider_stats.update_one(
                {"providerId": provider_id},
                {"$set": stats, "$setOnInsert": {"createdAt": now.isoformat()}},
                upsert=True,
            )
            return stats

        # ── aggregations ─────────────────────────────────────────
        completed = [o for o in orders if o.get("status") == "completed"]
        cancelled = [o for o in orders if o.get("status") == "cancelled"]
        active = [o for o in orders if o.get("status") in ("pending", "in_progress")]

        response_deltas:   List[float] = []  # minutes  (assigned → started)
        completion_deltas: List[float] = []  # hours    (started → completed)
        last_activity: Optional[datetime] = None
        late_starts = 0  # started more than 1h after assignment

        for o in orders:
            assigned  = _parse_dt(o.get("assignedAt") or o.get("created_at"))
            started   = _parse_dt(o.get("startedAt"))
            completed_at = _parse_dt(o.get("completedAt"))

            if assigned and started:
                dmin = (started - assigned).total_seconds() / 60.0
                if dmin >= 0:
                    response_deltas.append(dmin)
                    if dmin > 60:  # > 1h late
                        late_starts += 1
            if started and completed_at:
                dh = (completed_at - started).total_seconds() / 3600.0
                if dh >= 0:
                    completion_deltas.append(dh)

            # any event timestamp counts
            for cand in (completed_at, started, assigned):
                if cand and (last_activity is None or cand > last_activity):
                    last_activity = cand

        response_avg   = sum(response_deltas) / len(response_deltas) if response_deltas else None
        completion_avg = sum(completion_deltas) / len(completion_deltas) if completion_deltas else None
        completion_rate = len(completed) / total

        # ── scoring ──────────────────────────────────────────────
        if response_avg is None:
            response_score = 0.5  # neutral — no data
        else:
            response_score = _clamp01(1 - (response_avg / 60.0))

        completion_score = completion_rate

        if last_activity is None:
            activity_score = 0.0
        else:
            hrs = (now - last_activity).total_seconds() / 3600.0
            activity_score = 1.0 if hrs < 24 else (0.5 if hrs < 24 * 7 else 0.2)

        delay_penalty = min(late_starts * 0.05, 0.4)
        raw = (WEIGHTS["response"] * response_score
               + WEIGHTS["completion"] * completion_score
               + WEIGHTS["activity"] * activity_score
               - delay_penalty)
        score = int(round(max(0.0, min(1.0, raw)) * 100))
        new_tier = tier_for(score)

        stats = {
            "providerId": provider_id,
            "score": score,
            "tier": new_tier,
            "multiplier": TIER_MULTIPLIER.get(new_tier, 1.0),
            "metrics": {
                "responseTimeAvg":    round(response_avg, 2) if response_avg is not None else None,
                "startDelayAvg":      round(response_avg, 2) if response_avg is not None else None,
                "completionRate":     round(completion_rate, 3),
                "avgCompletionTime":  round(completion_avg, 2) if completion_avg is not None else None,
                "activeOrders":       len(active),
                "totalOrders":        total,
                "completedOrders":    len(completed),
                "cancelledOrders":    len(cancelled),
                "lastActivityAt":     last_activity.isoformat() if last_activity else None,
            },
            "penalties":     {"lateStarts": late_starts, "cancellations": len(cancelled), "noShows": 0},
            "sub_scores": {
                "responseScore":   round(response_score, 3),
                "completionScore": round(completion_score, 3),
                "activityScore":   round(activity_score, 3),
                "delayPenalty":    round(delay_penalty, 3),
            },
            "message":   TIER_MESSAGE_UA[new_tier],
            "message_en": TIER_MESSAGE_EN[new_tier],
            "updatedAt": now.isoformat(),
        }

        # Preserve lastTierNotifyAt unless we're about to notify (below)
        if prev_notify_at:
            stats["lastTierNotifyAt"] = prev_notify_at.isoformat()

        notified = False
        # ── tier-change detection + cooldown + notification ──────
        if prev_tier and new_tier != prev_tier:
            cooldown_ok = (
                prev_notify_at is None
                or (now - prev_notify_at) >= timedelta(hours=COOLDOWN_HOURS)
            )
            if cooldown_ok and self.bus is not None:
                try:
                    manager = await self.db.users.find_one({"id": provider_id}, {"_id": 0})
                    if not manager:
                        manager = await self.db.staff.find_one({"id": provider_id}, {"_id": 0})
                    payload = {
                        "manager": manager or {"id": provider_id},
                        "provider_id": provider_id,
                        "prev_tier": prev_tier,
                        "new_tier": new_tier,
                        "score": score,
                        "direction": "up" if TIER_ORDER.index(new_tier) > TIER_ORDER.index(prev_tier) else "down",
                        "message_ua": TIER_MESSAGE_UA[new_tier],
                        "message_en": TIER_MESSAGE_EN[new_tier],
                    }
                    await self.bus.emit("provider_tier_changed", payload)
                    stats["lastTierNotifyAt"] = now.isoformat()
                    notified = True
                    logger.info(
                        "[provider_stats] tier change for %s: %s → %s (score=%d) → notified",
                        provider_id, prev_tier, new_tier, score,
                    )
                except Exception:
                    logger.exception("[provider_stats] tier-change notify failed")
            else:
                logger.info(
                    "[provider_stats] tier change for %s: %s → %s (score=%d) → cooldown active",
                    provider_id, prev_tier, new_tier, score,
                )

        await self.db.provider_stats.update_one(
            {"providerId": provider_id},
            {"$set": stats, "$setOnInsert": {"createdAt": now.isoformat()}},
            upsert=True,
        )
        stats["_tier_notified"] = notified
        return stats

    async def recompute_all(self) -> Dict[str, Any]:
        """Admin/back-fill: rebuild every provider's stats at once."""
        providers = await self.db.orders.distinct("managerId")
        providers = [p for p in providers if p]
        results = []
        for pid in providers:
            try:
                results.append(await self.recompute(pid))
            except Exception:
                logger.exception("[provider_stats] recompute failed for %s", pid)
        return {"count": len(results), "providers": providers}

    async def get(self, provider_id: str) -> Dict[str, Any]:
        doc = await self.db.provider_stats.find_one({"providerId": provider_id}, {"_id": 0})
        if not doc:
            doc = await self.recompute(provider_id)
        return doc

    async def list_all(self, sort_by_score: bool = True) -> List[Dict[str, Any]]:
        cursor = self.db.provider_stats.find({}, {"_id": 0})
        if sort_by_score:
            cursor = cursor.sort("score", -1)
        return await cursor.to_list(length=1000)

    async def pick_best_provider(self, candidate_ids: List[str]) -> Optional[str]:
        """Pick the best provider from a candidate list using score+multiplier.

        Rules (user spec):
          - tier == "hidden"  (<20)  → EXCLUDED
          - tier == "high"    (>=80) → multiplier 1.2 (boost)
          - otherwise sorted by (score * multiplier) desc

        If no stats doc exists for a candidate, they get neutral score=50 so a
        brand-new manager isn't starved. Returns None if no eligible candidate.
        """
        if not candidate_ids:
            return None
        docs = {}
        cursor = self.db.provider_stats.find(
            {"providerId": {"$in": list(candidate_ids)}}, {"_id": 0}
        )
        async for d in cursor:
            docs[d["providerId"]] = d

        ranked: List[tuple] = []
        for cid in candidate_ids:
            d = docs.get(cid) or {}
            tier = d.get("tier") or "normal"   # new/unseen → neutral
            score = d.get("score")
            if score is None:
                score = 50
            if tier == "hidden":
                continue
            mult = TIER_MULTIPLIER.get(tier, 1.0)
            ranked.append((score * mult, score, cid))

        if not ranked:
            return None
        ranked.sort(key=lambda t: (t[0], t[1]), reverse=True)
        return ranked[0][2]


# ── singleton + bus wiring ─────────────────────────────────────────
service: Optional[ProviderStatsService] = None


def init(db, bus):
    """Register ourselves on the notification bus.
    ``bus`` is the ``EventBus`` instance from notifications.py.
    """
    global service
    service = ProviderStatsService(db, bus)
    for ev in ("order_started", "order_finished"):
        bus.on(ev, _make_handler(ev))
    logger.info("[provider_stats] wired: subscribed to order_started / order_finished")
    return service


def _make_handler(event: str):
    async def _h(payload):
        if service is None:
            return
        await service.hook(event, payload)
    return _h
