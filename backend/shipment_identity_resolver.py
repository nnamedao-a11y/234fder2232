"""
shipment_identity_resolver.py — Automation Layer Phase A + B + C
================================================================

Architectural layer that lives ABOVE VIN-centric shipment model and
auto-fills identity (container/vessel) with confidence scoring. The
module never mutates stages directly — that remains a Phase D concern
(auto transfer detection). This iteration only binds missing pieces
and saves low-confidence hits as exceptions for future manual review.

Philosophy
----------
    identity_chain = VIN → lot → booking → container → vessel → stage

Three rules (hard):

    1. confidence > 0.85  →  auto-apply
    2. 0.50 – 0.85        →  save to resolver_exceptions
    3. < 0.50             →  reject + log

Sticky rule (prevents "jumping" between vessels):

    if existing_identity.confidence > new.confidence → KEEP OLD

Dependencies
------------
    * resolver_engine.ContainerResolver / VesselResolver — low-level
      extractors with multi-source evidence (already implemented).
    * db handle (Motor) for reading shipments + writing identity links
      and exceptions.

This module does NOT import FastAPI, Socket.IO, or any HTTP plumbing —
it is pure orchestration + persistence, which makes it trivially
unit-testable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger("bibi.identity_resolver")

# Confidence bands (user-specified, see plan.md Phase 1 comments)
CONF_AUTO_APPLY = 0.85
CONF_EXCEPTION = 0.50

# Confidence weights used by calculate_confidence()
W_MMSI = 0.50
W_IMO = 0.40
W_NAME_EXACT = 0.30
W_NAME_CONTAINS = 0.20
W_ROUTE_MATCH = 0.20
W_SAME_AS_CURRENT = 0.20


# ─────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────

@dataclass
class IdentityBase:
    """Static identity attributes copied from shipment/deal at resolve time."""
    vin: Optional[str] = None
    lotNumber: Optional[str] = None
    bookingNumber: Optional[str] = None
    auctionReference: Optional[str] = None
    destination: Optional[str] = None
    customerId: Optional[str] = None


@dataclass
class ResolverAttempt:
    """One pass of resolve_shipment_identity()."""
    shipmentId: str
    base: Dict[str, Any]
    container: Dict[str, Any]     # {"value": str|None, "confidence": float, "source": str, "evidence": dict}
    vessel: Dict[str, Any]        # {"value": dict|None, "confidence": float, "source": str, "evidence": dict}
    finalConfidence: float
    decision: str                 # "applied" | "exception" | "rejected" | "sticky_kept"
    reason: str = ""
    rawEvidence: List[str] = field(default_factory=list)
    ranAt: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_str(x: Any) -> Optional[str]:
    if x is None:
        return None
    s = str(x).strip()
    return s or None


def _active_vessel_of(shipment: Dict[str, Any]) -> Dict[str, Any]:
    """Return vessel dict of the currently-active stage, or shipment.vessel fallback."""
    cur_id = shipment.get("currentStageId")
    for st in (shipment.get("stages") or []):
        if st.get("id") == cur_id:
            return st.get("vessel") or {}
    return shipment.get("vessel") or {}


def _active_container_of(shipment: Dict[str, Any]) -> Optional[str]:
    cur_id = shipment.get("currentStageId")
    for st in (shipment.get("stages") or []):
        if st.get("id") == cur_id:
            c = (st.get("container") or {}).get("number")
            if c:
                return c
    c = (shipment.get("container") or {}).get("number") or shipment.get("containerNumber")
    return c


def extract_identity_base(shipment: Dict[str, Any], deal: Optional[Dict[str, Any]] = None) -> IdentityBase:
    """Phase A — read VIN, lot, booking, etc from shipment (+optional deal)."""
    shipment = shipment or {}
    deal = deal or {}

    vin = _safe_str(shipment.get("vin") or shipment.get("VIN") or deal.get("vin") or deal.get("VIN"))

    lot = _safe_str(
        shipment.get("lotNumber")
        or shipment.get("lot")
        or deal.get("lotNumber")
        or deal.get("lot")
    )
    booking = _safe_str(
        shipment.get("bookingNumber")
        or shipment.get("booking")
        or deal.get("bookingNumber")
        or deal.get("booking")
    )
    auction = _safe_str(
        shipment.get("auctionReference")
        or shipment.get("auction")
        or deal.get("auction")
        or deal.get("auctionSite")
    )
    dest = _safe_str((shipment.get("destination") or {}).get("port") if isinstance(shipment.get("destination"), dict) else shipment.get("destination"))
    customer_id = _safe_str(shipment.get("customerId") or deal.get("customerId"))

    return IdentityBase(
        vin=vin.upper() if vin else None,
        lotNumber=lot,
        bookingNumber=booking,
        auctionReference=auction,
        destination=dest,
        customerId=customer_id,
    )


# ─────────────────────────────────────────────────────────────────────
# Confidence calculation
# ─────────────────────────────────────────────────────────────────────

def calculate_vessel_confidence(
    candidate: Dict[str, Any],
    current: Dict[str, Any],
    *,
    route_match: bool = False,
) -> float:
    """Score a vessel candidate against the currently-bound vessel.

    Weights (additive; capped at 1.0):
        +0.50 MMSI exact match
        +0.40 IMO exact match
        +0.30 name exact (case-insensitive) match
        +0.20 name contains OR contained-in current.name
        +0.20 same route / region
        +0.20 same as currently bound (stability)
    """
    if not candidate:
        return 0.0
    score = 0.0
    c_mmsi = _safe_str(candidate.get("mmsi"))
    c_imo = _safe_str(candidate.get("imo"))
    c_name = _safe_str(candidate.get("name"))
    cur_mmsi = _safe_str((current or {}).get("mmsi"))
    cur_imo = _safe_str((current or {}).get("imo"))
    cur_name = _safe_str((current or {}).get("name"))

    if c_mmsi and cur_mmsi and c_mmsi == cur_mmsi:
        score += W_MMSI
    if c_imo and cur_imo and c_imo == cur_imo:
        score += W_IMO

    if c_name and cur_name:
        a, b = c_name.upper(), cur_name.upper()
        if a == b:
            score += W_NAME_EXACT
        elif a in b or b in a:
            score += W_NAME_CONTAINS

    if route_match:
        score += W_ROUTE_MATCH

    # "Same as currently bound" = identical triple (mmsi/imo/name) → stability bonus
    if c_mmsi and cur_mmsi and c_mmsi == cur_mmsi and c_imo and cur_imo and c_imo == cur_imo:
        score += W_SAME_AS_CURRENT

    return min(round(score, 3), 1.0)


def calculate_container_confidence(source: str) -> float:
    """Simple mapping by source authority."""
    mapping = {
        "db_shipment": 1.0,
        "stage_container": 1.0,
        "identity_link": 0.95,
        "event_container_bound": 0.90,
        "deal_field": 0.80,
        "text_extract": 0.55,
        "vf_payload": 0.60,
        "none": 0.0,
    }
    return mapping.get(source, 0.30)


# ─────────────────────────────────────────────────────────────────────
# Core resolver
# ─────────────────────────────────────────────────────────────────────


class ShipmentIdentityResolver:
    """Phase A + B + C orchestrator.

    Usage (from server.py) ::

        resolver = ShipmentIdentityResolver(db)
        attempt = await resolver.resolve(shipment, vf_payload=None)
        if attempt.decision == "applied":
            ...  # caller may emit socket update
    """

    def __init__(
        self,
        db,
        *,
        audit: Optional[Callable[..., Awaitable[None]]] = None,
        container_resolver=None,
        vessel_resolver=None,
    ):
        self.db = db
        self._audit = audit  # optional async hook: audit(action, meta=...)
        # Late-import the low-level engine so tests can stub via kwargs.
        if container_resolver is None or vessel_resolver is None:
            from resolver_engine import ContainerResolver, VesselResolver  # type: ignore
            container_resolver = container_resolver or ContainerResolver(db)
            vessel_resolver = vessel_resolver or VesselResolver(db)
        self.container_resolver = container_resolver
        self.vessel_resolver = vessel_resolver

    # ── Persistence ────────────────────────────────────────────────

    async def _load_identity_link(self, shipment_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.db.shipment_identity_links.find_one({"shipmentId": shipment_id})
        except Exception as e:
            logger.debug(f"[resolver] load identity_link failed: {e}")
            return None

    async def _save_identity_link(self, shipment_id: str, patch: Dict[str, Any]) -> None:
        patch = {**patch, "updatedAt": _now_iso(), "shipmentId": shipment_id}
        try:
            await self.db.shipment_identity_links.update_one(
                {"shipmentId": shipment_id},
                {"$set": patch},
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"[resolver] save identity_link failed: {e}")

    async def _save_exception(
        self,
        shipment_id: str,
        kind: str,
        data: Dict[str, Any],
    ) -> None:
        try:
            await self.db.resolver_exceptions.insert_one({
                "shipmentId": shipment_id,
                "kind": kind,                 # "low_confidence_vessel" | "no_container"
                "data": data,
                "status": "pending",          # "pending" | "confirmed" | "rejected"
                "createdAt": _now_iso(),
            })
        except Exception as e:
            logger.warning(f"[resolver] save exception failed: {e}")

    async def _log(self, action: str, shipment_id: str, meta: Dict[str, Any]) -> None:
        if not self._audit:
            return
        try:
            await self._audit(action, resource=f"shipment:{shipment_id}", meta=meta)
        except Exception:
            pass

    # ── Container (Phase B) ────────────────────────────────────────

    async def resolve_container(
        self,
        shipment: Dict[str, Any],
        base: IdentityBase,
    ) -> Dict[str, Any]:
        """Return a container record: {'value','confidence','source','evidence'}.

        Priority:
            1. stage.container.number / shipment.container.number (source=db_shipment, conf=1.0)
            2. identity_link.containerNumber  (source=identity_link, conf=0.95)
            3. VIN → vin_container_links mapping (source=vin_mapping, conf=0.90)
            4. delegate to resolver_engine.ContainerResolver for deeper sources
        """
        existing = _active_container_of(shipment)
        if existing:
            conf = calculate_container_confidence("db_shipment")
            return {
                "value": existing,
                "confidence": conf,
                "source": "db_shipment",
                "evidence": {"from": "shipment.stages[current].container"},
            }

        link = await self._load_identity_link(shipment.get("id") or "")
        if link and link.get("containerNumber"):
            return {
                "value": link["containerNumber"],
                "confidence": float(link.get("containerConfidence") or 0.95),
                "source": "identity_link",
                "evidence": {"from": "shipment_identity_links"},
            }

        if base.vin:
            try:
                mapping = await self.db.vin_container_links.find_one({"vin": base.vin})
                if mapping and mapping.get("containerNumber"):
                    return {
                        "value": mapping["containerNumber"],
                        "confidence": float(mapping.get("confidence") or 0.90),
                        "source": "vin_mapping",
                        "evidence": {"vin": base.vin},
                    }
            except Exception:
                pass

        # Delegate to low-level engine (handles deal_field / events / text extraction).
        try:
            res = await self.container_resolver.resolve(shipment)
            return {
                "value": res.value,
                "confidence": float(res.confidence or 0.0),
                "source": res.source or "none",
                "evidence": dict(res.evidence or {}),
            }
        except Exception as e:
            logger.debug(f"[resolver] low-level container resolve failed: {e}")
            return {"value": None, "confidence": 0.0, "source": "none", "evidence": {}}

    # ── Vessel (Phase C) ───────────────────────────────────────────

    async def resolve_vessel(
        self,
        shipment: Dict[str, Any],
        container_number: Optional[str],
        vf_payload: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Return vessel record: {'value': {name,mmsi,imo,...}|None, 'confidence', 'source', 'evidence'}.

        Uses low-level VesselResolver + live VF payload (if provided by caller)
        to pick the best candidate, then scores vs currently-bound vessel
        (stability bonus, sticky rule).
        """
        current = _active_vessel_of(shipment)

        # 1. Try low-level resolver_engine (multi-source).
        base_res_value: Optional[Dict[str, Any]] = None
        base_res_source = "none"
        base_res_evidence: Dict[str, Any] = {}
        base_res_conf_raw = 0.0
        if container_number:
            try:
                vres = await self.vessel_resolver.resolve(container_number, shipment)
                if isinstance(vres.value, dict):
                    base_res_value = vres.value
                    base_res_source = vres.source or "none"
                    base_res_evidence = dict(vres.evidence or {})
                    base_res_conf_raw = float(vres.confidence or 0.0)
            except Exception as e:
                logger.debug(f"[resolver] low-level vessel resolve failed: {e}")

        # 2. If caller fed a live VF payload, try to extract a candidate.
        vf_candidate: Optional[Dict[str, Any]] = None
        if vf_payload:
            try:
                from server import _vf_extract_vessels  # type: ignore
                vessels = _vf_extract_vessels(vf_payload) or []
                if vessels:
                    # Pick candidate matching current name/mmsi first, else first.
                    target_mmsi = _safe_str(current.get("mmsi"))
                    target_name = _safe_str(current.get("name"))
                    match = None
                    for v in vessels:
                        if target_mmsi and _safe_str(v.get("mmsi")) == target_mmsi:
                            match = v
                            break
                        if target_name and _safe_str(v.get("name")) and target_name.upper() == v["name"].upper():
                            match = v
                            break
                    vf_candidate = match or vessels[0]
            except Exception as e:
                logger.debug(f"[resolver] vf payload extract failed: {e}")

        # Prefer VF live candidate when present (real-time); fall back to engine.
        candidate = vf_candidate or base_res_value
        if not candidate:
            return {
                "value": None,
                "confidence": 0.0,
                "source": base_res_source,
                "evidence": base_res_evidence,
            }

        # Score it vs current; take max of weight-score and engine's raw score.
        route_match = bool(shipment.get("route"))  # naive: having a route ~= "on route"
        score = calculate_vessel_confidence(candidate, current, route_match=route_match)
        score = max(score, base_res_conf_raw if candidate is base_res_value else 0.0)

        return {
            "value": candidate,
            "confidence": round(score, 3),
            "source": "vf_payload" if candidate is vf_candidate else base_res_source,
            "evidence": base_res_evidence if candidate is base_res_value else {"via": "live_vf_payload"},
        }

    # ── Apply / exception / sticky ────────────────────────────────

    async def _apply(
        self,
        shipment: Dict[str, Any],
        container: Dict[str, Any],
        vessel: Dict[str, Any],
        base: IdentityBase,
    ) -> None:
        shipment_id = shipment.get("id") or ""
        patch: Dict[str, Any] = {
            "vin": base.vin,
            "lotNumber": base.lotNumber,
            "bookingNumber": base.bookingNumber,
            "auctionReference": base.auctionReference,
            "customerId": base.customerId,
            "source": "resolver",
            "lastResolvedAt": _now_iso(),
        }
        if container.get("value"):
            patch["containerNumber"] = container["value"]
            patch["containerConfidence"] = container.get("confidence") or 0.0
            patch["containerSource"] = container.get("source")
        v = vessel.get("value") or {}
        if v:
            patch["vesselName"] = v.get("name")
            patch["vesselMmsi"] = v.get("mmsi")
            patch["vesselImo"] = v.get("imo")
            patch["vesselConfidence"] = vessel.get("confidence") or 0.0
            patch["vesselSource"] = vessel.get("source")
        await self._save_identity_link(shipment_id, patch)

        # Also persist VIN → container mapping (Phase B) so next run is O(1).
        if base.vin and container.get("value"):
            try:
                await self.db.vin_container_links.update_one(
                    {"vin": base.vin},
                    {
                        "$set": {
                            "vin": base.vin,
                            "containerNumber": container["value"],
                            "confidence": container.get("confidence") or 0.0,
                            "source": container.get("source"),
                            "shipmentId": shipment_id,
                            "updatedAt": _now_iso(),
                        }
                    },
                    upsert=True,
                )
            except Exception as e:
                logger.debug(f"[resolver] vin_container_links upsert failed: {e}")

    # ── Public entry ──────────────────────────────────────────────

    async def resolve(
        self,
        shipment: Dict[str, Any],
        vf_payload: Optional[Any] = None,
        deal: Optional[Dict[str, Any]] = None,
    ) -> ResolverAttempt:
        """Run Phase A+B+C on a single shipment. Returns an attempt report."""
        shipment_id = shipment.get("id") or "?"
        base = extract_identity_base(shipment, deal=deal)
        container = await self.resolve_container(shipment, base)
        vessel = await self.resolve_vessel(shipment, container.get("value"), vf_payload=vf_payload)

        # Aggregate confidence = vessel confidence if we have one, else container.
        vconf = float(vessel.get("confidence") or 0.0)
        cconf = float(container.get("confidence") or 0.0)
        final = vconf if (vessel.get("value")) else cconf

        # Sticky rule: if existing identity link has higher confidence on the
        # same dimension, KEEP OLD (do not auto-apply).
        existing = await self._load_identity_link(shipment_id) or {}
        ex_vconf = float(existing.get("vesselConfidence") or 0.0)
        ex_cconf = float(existing.get("containerConfidence") or 0.0)

        sticky_hit = False
        if vessel.get("value") and ex_vconf >= vconf > 0.0:
            # Existing identity already strong; refuse to overwrite with weaker.
            ex_mmsi = _safe_str(existing.get("vesselMmsi"))
            new_mmsi = _safe_str((vessel.get("value") or {}).get("mmsi"))
            if ex_mmsi and new_mmsi and ex_mmsi != new_mmsi:
                sticky_hit = True

        if sticky_hit:
            await self._log("resolver_sticky_kept", shipment_id, {
                "existing_mmsi": existing.get("vesselMmsi"),
                "new_mmsi": (vessel.get("value") or {}).get("mmsi"),
                "existing_conf": ex_vconf,
                "new_conf": vconf,
            })
            return ResolverAttempt(
                shipmentId=shipment_id,
                base=asdict(base),
                container=container,
                vessel=vessel,
                finalConfidence=final,
                decision="sticky_kept",
                reason=f"existing vessel confidence {ex_vconf:.2f} ≥ new {vconf:.2f}; refused to overwrite",
            )

        # Decision matrix
        if final >= CONF_AUTO_APPLY:
            await self._apply(shipment, container, vessel, base)
            await self._log("resolver_applied", shipment_id, {
                "confidence": final,
                "container": container.get("value"),
                "vessel": (vessel.get("value") or {}).get("name"),
            })
            return ResolverAttempt(
                shipmentId=shipment_id,
                base=asdict(base),
                container=container,
                vessel=vessel,
                finalConfidence=final,
                decision="applied",
                reason=f"confidence {final:.2f} ≥ {CONF_AUTO_APPLY}",
            )
        elif final >= CONF_EXCEPTION:
            await self._save_exception(shipment_id, "low_confidence_vessel", {
                "base": asdict(base),
                "container": container,
                "vessel": vessel,
                "finalConfidence": final,
            })
            await self._log("resolver_exception_saved", shipment_id, {
                "confidence": final,
                "kind": "low_confidence_vessel",
            })
            return ResolverAttempt(
                shipmentId=shipment_id,
                base=asdict(base),
                container=container,
                vessel=vessel,
                finalConfidence=final,
                decision="exception",
                reason=f"confidence {final:.2f} in exception band [{CONF_EXCEPTION}, {CONF_AUTO_APPLY})",
            )
        else:
            await self._log("resolver_rejected", shipment_id, {
                "confidence": final,
                "container": container.get("value"),
                "vessel": (vessel.get("value") or {}).get("name"),
            })
            return ResolverAttempt(
                shipmentId=shipment_id,
                base=asdict(base),
                container=container,
                vessel=vessel,
                finalConfidence=final,
                decision="rejected",
                reason=f"confidence {final:.2f} < {CONF_EXCEPTION}",
            )
