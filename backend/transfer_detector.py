"""
transfer_detector.py — Phase D of the Automation Layer
======================================================

Auto Transfer Detection — decides whether a newly observed vessel for a
shipment constitutes a real transshipment (transfer) and, if yes, splits
the active vessel stage without manager intervention.

Five guards (**all must pass** before the transfer is applied):

    A. MMSI of the candidate differs from the vessel currently bound
       to the active stage.
    B. Stability: the same candidate MMSI was observed ≥
       ``TRANSFER_MIN_SEEN_COUNT`` consecutive times
       (``vessel_candidates_tracking`` counter).
    C. Confidence of the candidate ≥ ``TRANSFER_MIN_CONFIDENCE``.
    D. Teleport protection: haversine distance between the shipment's
       last known position and the candidate's position is
       ≤ ``MAX_TELEPORT_KM``.
    E. Sticky: existing vessel confidence < candidate confidence
       (otherwise KEEP OLD — prevents vessel "jumping").

Extra (f) progress regression guard — optional. Reject transfer if
``new_progress < old_progress - 0.10`` (vessel appears to go backwards).

If any guard fails the detector writes a ``resolver_exceptions`` row
with ``reason=<guard>`` so the manager can still review via
``/api/admin/identity/exceptions``.

On success the detector:
    1. marks the previous stage ``status=done`` + ``completedAt=now``
    2. pushes a new vessel stage (same container carried over)
    3. updates ``currentStageId``
    4. writes ``transfer_detected`` to ``audit_log``
    5. emits a ``shipment:update`` socketio event (caller's
       responsibility — detector only returns the result dict).

Design goals:
    * **Pure module** — no FastAPI / socketio imports.
    * **Schema aware** — uses business ``id`` key (not MongoDB _id).
    * **Fail-safe** — any Mongo error is caught & logged; never raises
      out of ``process_shipment`` so VF handler cannot crash because
      of transfer logic.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("bibi.transfer_detector")

# ──────────────────────────────────────────────────────────────────────
# Thresholds (env-overridable by the caller; hard-coded for now)
# ──────────────────────────────────────────────────────────────────────

TRANSFER_MIN_CONFIDENCE = 0.75
TRANSFER_MIN_SEEN_COUNT = 2
MAX_TELEPORT_KM = 500.0          # ignore jumps > 500 km
MAX_PROGRESS_REGRESSION = 0.10    # reject if progress drops by 10%+
STICKY_PROTECT_MARGIN = 0.0       # require NEW > OLD strictly (margin 0)


# ──────────────────────────────────────────────────────────────────────
# Utilities
# ──────────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    R = 6371.0
    try:
        dLat = math.radians(float(lat2) - float(lat1))
        dLon = math.radians(float(lon2) - float(lon1))
        a = (
            math.sin(dLat / 2) ** 2
            + math.cos(math.radians(float(lat1)))
            * math.cos(math.radians(float(lat2)))
            * math.sin(dLon / 2) ** 2
        )
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    except Exception:
        return 0.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).isoformat().replace("+00:00", "Z")


def _get_current_stage(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cur_id = shipment.get("currentStageId")
    for s in shipment.get("stages") or []:
        if s.get("id") == cur_id:
            return s
    return None


# ──────────────────────────────────────────────────────────────────────
# Result dataclass — plain dict for simplicity
# ──────────────────────────────────────────────────────────────────────

def _result(
    status: str,
    reason: str,
    *,
    shipment_id: str = "",
    new_stage_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "ok": status == "transfer",
        "status": status,              # "transfer" | "skipped" | "exception" | "error"
        "reason": reason,
        "shipmentId": shipment_id,
    }
    if new_stage_id:
        out["newStageId"] = new_stage_id
    if extra:
        out.update(extra)
    return out


# ──────────────────────────────────────────────────────────────────────
# Main class
# ──────────────────────────────────────────────────────────────────────


class AutoTransferDetector:
    """Phase D orchestrator. One instance per app; re-use the DB handle."""

    def __init__(self, db):
        self.db = db

    # ── Persistence helpers ───────────────────────────────────────

    async def _update_seen(
        self,
        shipment_id: str,
        mmsi: str,
        confidence: float,
    ) -> int:
        """Increment the seenCount for (shipmentId, mmsi). Returns the NEW count."""
        key = f"{shipment_id}:{mmsi}"
        try:
            now = _now()
            existing = await self.db.vessel_candidates_tracking.find_one({"_id": key})
            if existing:
                new_count = int(existing.get("seenCount") or 0) + 1
                await self.db.vessel_candidates_tracking.update_one(
                    {"_id": key},
                    {
                        "$set": {
                            "lastSeenAt": now,
                            "confidence": confidence,
                        },
                        "$inc": {"seenCount": 1},
                    },
                )
                return new_count
            await self.db.vessel_candidates_tracking.insert_one({
                "_id": key,
                "shipmentId": shipment_id,
                "mmsi": mmsi,
                "seenCount": 1,
                "firstSeenAt": now,
                "lastSeenAt": now,
                "confidence": confidence,
            })
            return 1
        except Exception as e:
            cls = type(e).__name__
            if "Duplicate" in cls:
                # Raced: another task inserted first → fall back to read+inc
                try:
                    doc = await self.db.vessel_candidates_tracking.find_one_and_update(
                        {"_id": key},
                        {"$inc": {"seenCount": 1}, "$set": {"lastSeenAt": _now()}},
                        return_document=True,
                    )
                    return int((doc or {}).get("seenCount") or 2)
                except Exception:
                    return 2
            logger.warning(f"[transfer] seen counter insert failed: {e}")
            return 1

    async def _reset_other_candidates(self, shipment_id: str, keep_mmsi: str) -> None:
        """When one MMSI is confirmed → drop stale counters for other candidates."""
        try:
            await self.db.vessel_candidates_tracking.delete_many({
                "shipmentId": shipment_id,
                "mmsi": {"$ne": keep_mmsi},
            })
        except Exception as e:
            logger.debug(f"[transfer] reset counters failed: {e}")

    async def _save_exception(
        self,
        shipment_id: str,
        reason: str,
        data: Dict[str, Any],
    ) -> None:
        try:
            await self.db.resolver_exceptions.insert_one({
                "shipmentId": shipment_id,
                "kind": "transfer_rejected",
                "reason": reason,
                "data": data,
                "status": "pending",
                "createdAt": _iso(),
            })
        except Exception as e:
            logger.debug(f"[transfer] exception insert failed: {e}")

    async def _audit(self, action: str, shipment_id: str, meta: Dict[str, Any]) -> None:
        try:
            await self.db.audit_log.insert_one({
                "ts": _iso(),
                "action": action,
                "resource": f"shipment:{shipment_id}",
                "meta": meta,
            })
        except Exception as e:
            logger.debug(f"[transfer] audit failed: {e}")

    # ── Transfer application ───────────────────────────────────────

    async def _apply_transfer(
        self,
        shipment: Dict[str, Any],
        current_stage: Dict[str, Any],
        new_vessel: Dict[str, Any],
    ) -> Dict[str, Any]:
        shipment_id = shipment.get("id") or ""
        now = _now()
        now_iso = _iso(now)

        # 1. close the current stage
        try:
            await self.db.shipments.update_one(
                {"id": shipment_id, "stages.id": current_stage.get("id")},
                {
                    "$set": {
                        "stages.$.status": "done",
                        "stages.$.completedAt": now_iso,
                    }
                },
            )
        except Exception as e:
            logger.warning(f"[transfer] close stage failed: {e}")
            return _result("error", f"close_stage_failed: {e}", shipment_id=shipment_id)

        # 2. carry container forward from current stage (Phase D spec)
        carried_container = current_stage.get("container") or shipment.get("container") or None

        new_stage_id = f"stage_transfer_{int(now.timestamp())}"
        new_stage = {
            "id": new_stage_id,
            "type": "vessel",
            "status": "active",
            "label": f"Перевантаження на {new_vessel.get('name') or 'нове судно'}",
            "startedAt": now_iso,
            "vessel": {
                "name": new_vessel.get("name"),
                "mmsi": new_vessel.get("mmsi"),
                "imo": new_vessel.get("imo"),
            },
            "container": carried_container,
            "source": "auto_transfer_detector",
        }

        try:
            await self.db.shipments.update_one(
                {"id": shipment_id},
                {
                    "$push": {"stages": new_stage},
                    "$set": {
                        "currentStageId": new_stage_id,
                        "vessel": new_stage["vessel"],      # top-level mirror
                        "vesselConfidence": float(new_vessel.get("confidence") or 0.0),
                        "lastTransferAt": now_iso,
                    },
                },
            )
        except Exception as e:
            logger.warning(f"[transfer] push new stage failed: {e}")
            return _result("error", f"push_stage_failed: {e}", shipment_id=shipment_id)

        # 3. reset candidate counters for this shipment now that we committed
        await self._reset_other_candidates(shipment_id, keep_mmsi=str(new_vessel.get("mmsi") or ""))

        # 4. audit
        await self._audit("transfer_detected", shipment_id, {
            "from": {
                "name": (current_stage.get("vessel") or {}).get("name"),
                "mmsi": (current_stage.get("vessel") or {}).get("mmsi"),
            },
            "to": {
                "name": new_vessel.get("name"),
                "mmsi": new_vessel.get("mmsi"),
                "imo": new_vessel.get("imo"),
            },
            "newStageId": new_stage_id,
            "confidence": new_vessel.get("confidence"),
        })

        return _result(
            "transfer",
            "committed",
            shipment_id=shipment_id,
            new_stage_id=new_stage_id,
            extra={"from": current_stage.get("vessel"), "to": new_stage["vessel"]},
        )

    # ── Public entry ──────────────────────────────────────────────

    async def process_shipment(
        self,
        shipment: Dict[str, Any],
        new_vessel: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Run all five guards + progress regression on one shipment/new-vessel
        pair. Never raises; always returns a result dict.

        ``new_vessel`` shape (at minimum)::
            {
                "name": "...", "mmsi": "...", "imo": "...",
                "confidence": 0.0..1.0,
                "position": {"lat": ..., "lng": ...}   # optional, for teleport
                "progress":  float                      # optional, for regression
            }
        """
        try:
            shipment_id = shipment.get("id") or ""
            current_stage = _get_current_stage(shipment)
            if not current_stage or current_stage.get("type") != "vessel":
                return _result("skipped", "no_active_vessel_stage", shipment_id=shipment_id)

            current_vessel = current_stage.get("vessel") or {}
            cur_mmsi = str(current_vessel.get("mmsi") or "").strip()
            new_mmsi = str(new_vessel.get("mmsi") or "").strip()
            if not new_mmsi:
                return _result("skipped", "no_new_mmsi", shipment_id=shipment_id)

            # ── Guard A: MMSI actually changed ────────────────────
            if cur_mmsi and cur_mmsi == new_mmsi:
                # Same vessel: keep counter warm but do nothing
                await self._update_seen(shipment_id, new_mmsi, float(new_vessel.get("confidence") or 0.0))
                return _result("skipped", "same_vessel", shipment_id=shipment_id)

            confidence = float(new_vessel.get("confidence") or 0.0)

            # ── Guard C: confidence ≥ threshold ───────────────────
            if confidence < TRANSFER_MIN_CONFIDENCE:
                await self._save_exception(shipment_id, "low_confidence", {
                    "newMmsi": new_mmsi,
                    "newName": new_vessel.get("name"),
                    "confidence": confidence,
                })
                await self._audit("transfer_rejected_low_confidence", shipment_id, {
                    "confidence": confidence, "threshold": TRANSFER_MIN_CONFIDENCE,
                })
                return _result("exception", "low_confidence", shipment_id=shipment_id,
                               extra={"confidence": confidence})

            # ── Guard B: stability (seenCount ≥ N) ────────────────
            seen = await self._update_seen(shipment_id, new_mmsi, confidence)
            if seen < TRANSFER_MIN_SEEN_COUNT:
                return _result("skipped", "pending_stability", shipment_id=shipment_id,
                               extra={"seenCount": seen, "required": TRANSFER_MIN_SEEN_COUNT})

            # ── Guard D: teleport protection ──────────────────────
            ship_pos = shipment.get("currentPosition") or {}
            new_pos = new_vessel.get("position") or {}
            if (
                isinstance(ship_pos, dict) and isinstance(new_pos, dict)
                and ship_pos.get("lat") is not None and new_pos.get("lat") is not None
            ):
                d = haversine_km(
                    ship_pos["lat"], ship_pos["lng"],
                    new_pos["lat"], new_pos["lng"],
                )
                if d > MAX_TELEPORT_KM:
                    await self._save_exception(shipment_id, "teleport", {
                        "distanceKm": round(d, 1),
                        "maxAllowed": MAX_TELEPORT_KM,
                        "from": ship_pos, "to": new_pos,
                    })
                    await self._audit("transfer_rejected_teleport", shipment_id, {
                        "distanceKm": round(d, 1),
                    })
                    return _result("exception", "teleport", shipment_id=shipment_id,
                                   extra={"distanceKm": round(d, 1)})

            # ── Guard E: sticky — existing conf ≥ new conf ────────
            existing_conf = float(current_vessel.get("confidence") or 0.0)
            # identity_link is a secondary authority on confidence
            try:
                link = await self.db.shipment_identity_links.find_one({"shipmentId": shipment_id})
                if link:
                    existing_conf = max(existing_conf, float(link.get("vesselConfidence") or 0.0))
            except Exception:
                pass
            if existing_conf - STICKY_PROTECT_MARGIN >= confidence and existing_conf > 0:
                await self._audit("transfer_rejected_sticky", shipment_id, {
                    "existing": existing_conf, "new": confidence,
                })
                return _result("skipped", "sticky_protect", shipment_id=shipment_id,
                               extra={"existing": existing_conf, "new": confidence})

            # ── Guard F: progress regression ──────────────────────
            old_progress = float(shipment.get("progress") or 0.0)
            new_progress = float(new_vessel.get("progress") or old_progress)
            if old_progress > 0 and (old_progress - new_progress) > MAX_PROGRESS_REGRESSION:
                await self._save_exception(shipment_id, "progress_regression", {
                    "old": old_progress, "new": new_progress,
                    "delta": round(old_progress - new_progress, 3),
                })
                await self._audit("transfer_rejected_regression", shipment_id, {
                    "old": old_progress, "new": new_progress,
                })
                return _result("exception", "progress_regression", shipment_id=shipment_id,
                               extra={"old": old_progress, "new": new_progress})

            # ── All guards green → commit transfer ────────────────
            return await self._apply_transfer(shipment, current_stage, new_vessel)

        except Exception as e:
            logger.exception(f"[transfer] process_shipment crashed: {e}")
            return _result("error", f"exception: {e}", shipment_id=shipment.get("id") or "?")
