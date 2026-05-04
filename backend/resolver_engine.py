"""
resolver_engine.py — Auto Data Resolver Layer
=============================================

Назначение:
    "Never rely on 1 source. Multiple sources → confidence → choice."

    По (shipment, VIN, lot, booking) система сама находит:
      1. container.number   (ContainerResolver)
      2. vessel + mmsi/imo  (VesselResolver — если container уже знаем)
      3. detect transshipment (TransferDetector)

    На выходе ResolverResult с (value, confidence, source, evidence).
    Orchestrator AutoResolver прогоняет всё sequentially, останавливается
    на первой стратегии ≥ MIN_CONFIDENCE (по-умолчанию 0.5) — это даёт
    deterministic поведение: чем выше в списке стратегия, тем надёжнее
    источник.

Философия:
    * Никогда не hardcode  "1 источник = истина".
    * Стратегии упорядочены по убыванию confidence.
    * Каждый источник возвращает не только value но и evidence (raw
      payload), чтобы менеджер мог посмотреть "откуда это взялось" в UI.
    * Graceful fallback: если внешний API (ShipsGo/AfterShip) не
      сконфигурирован или упал — просто идём дальше к следующей стратегии,
      не бросаем исключение.
    * Resolver НЕ модифицирует БД напрямую — только возвращает результат.
      Вызывающий код (auto_bind_container / auto_bind_vessel) решает,
      сохранять или нет.

Используется:
    • update_shipment_position(shipment) — если container/vessel не
      привязан, пробует auto-resolve перед тем как пропустить tick.
    • /api/admin/shipments/{id}/resolver/run — ручной trigger для менеджера.
    • background worker _tracking_worker() — периодически pass по shipments
      с trackingActive=True без container, пробует их доresolve'ить.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("bibi.resolver")

# ─────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────

# ISO 6346 container number: 4 letters (owner+category) + 6 digits (serial)
# + 1 check digit. Total length 11, all uppercase.
ISO_6346_RE = re.compile(r"\b([A-Z]{4}\d{7})\b")

# VIN: 17 alphanumeric no I/O/Q
VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b")

# 7-digit IMO / 9-digit MMSI
IMO_RE = re.compile(r"\b(\d{7})\b")
MMSI_RE = re.compile(r"\b(\d{9})\b")

MIN_CONFIDENCE = 0.50   # anything below this is considered "not found"

# ─────────────────────────────────────────────────────────────────────
# Data types
# ─────────────────────────────────────────────────────────────────────


@dataclass
class ResolverResult:
    """One attempt at resolving a single piece of data.

    Attributes
    ----------
    value : primary resolved value (e.g. container number, or dict of
            vessel fields). ``None`` means strategy could not resolve.
    confidence : 0.0–1.0. 1.0 = golden source (already in DB), 0.3 = wild
            guess (regex match on free text).
    source : machine-readable source key (``"db_shipment"``,
            ``"deal_field"``, ``"event_container_bound"``,
            ``"text_extract"``, ``"shipsgo"``, ``"aftership"``,
            ``"vessel_scraper"``, ``"related_shipment"``).
    evidence : raw data snippet that led to this result. Kept short for
            UI display.
    strategy : name of the strategy function that produced the result
            (for debugging / explainability).
    """
    value: Any
    confidence: float
    source: str
    evidence: Dict[str, Any] = field(default_factory=dict)
    strategy: str = ""
    resolved_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def found(self) -> bool:
        return self.value is not None and self.confidence >= MIN_CONFIDENCE


def _empty(source: str = "none", strategy: str = "") -> ResolverResult:
    """Sentinel for "nothing found"."""
    return ResolverResult(value=None, confidence=0.0, source=source, strategy=strategy)


# ─────────────────────────────────────────────────────────────────────
# Extractors — pure, no I/O
# ─────────────────────────────────────────────────────────────────────


def extract_container_numbers(text: Any) -> List[str]:
    """Find all ISO 6346 container numbers in free text. Case-insensitive."""
    if not text:
        return []
    if not isinstance(text, str):
        try:
            text = str(text)
        except Exception:
            return []
    return [m.upper() for m in ISO_6346_RE.findall(text.upper())]


def _is_plausible_container(num: str) -> bool:
    """Cheap sanity check: 4 letters + 7 digits, letters not all same, not
    literally ``XXXX0000000`` placeholder."""
    if not num or len(num) != 11:
        return False
    if not (num[:4].isalpha() and num[4:].isdigit()):
        return False
    if num[:4] in ("XXXX", "TEST", "DEMO"):
        return False
    return True


# ─────────────────────────────────────────────────────────────────────
# ContainerResolver
# ─────────────────────────────────────────────────────────────────────


class ContainerResolver:
    """Find container.number for a shipment using multiple sources.

    Strategies (confidence):
        S1  0.99  shipment.container.number / stage.container.number
        S2  0.95  shipment.containerNumber (legacy top-level)
        S3  0.93  events with type in {container_bound, container_*} whose
                  payload mentions a container number
        S4  0.92  linked deal.containerNumber / deal.container
        S5  0.80  related shipments for same VIN with container bound
        S6  0.70  regex ISO 6346 in shipment.notes / vehicleTitle / deal
                  notes / description fields
    """

    def __init__(self, db):
        self.db = db

    async def resolve(self, shipment: Dict[str, Any]) -> ResolverResult:
        strategies = [
            ("s1_shipment_field", 0.99, self._from_shipment_field),
            ("s2_legacy_top",     0.95, self._from_legacy_top),
            ("s3_event_history",  0.93, self._from_events),
            ("s4_deal_field",     0.92, self._from_deal),
            ("s5_related_vin",    0.80, self._from_related_shipments),
            ("s6_text_extract",   0.70, self._from_text_extract),
        ]
        for name, conf, fn in strategies:
            try:
                hit = await fn(shipment)
            except Exception as e:
                logger.warning(f"[Resolver/Container/{name}] failed: {e}")
                continue
            if hit:
                num, evidence = hit
                if _is_plausible_container(num):
                    logger.info(
                        f"[Resolver/Container] ship={shipment.get('id')} "
                        f"→ {num} (src={name}, conf={conf})"
                    )
                    return ResolverResult(
                        value=num, confidence=conf,
                        source=name.split("_", 1)[1], strategy=name,
                        evidence=evidence or {},
                    )
        return _empty("container_not_found", "none")

    # ── S1: structured container field on shipment or active stage
    async def _from_shipment_field(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        c = (s.get("container") or {}).get("number")
        if c:
            return c.upper(), {"where": "shipment.container.number"}
        cur_id = s.get("currentStageId")
        for st in s.get("stages") or []:
            if st.get("id") == cur_id:
                cc = (st.get("container") or {}).get("number")
                if cc:
                    return cc.upper(), {"where": f"stage[{cur_id}].container.number"}
        return None

    # ── S2: legacy top-level containerNumber
    async def _from_legacy_top(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        c = s.get("containerNumber")
        if c:
            return str(c).upper(), {"where": "shipment.containerNumber"}
        return None

    # ── S3: events with container info
    async def _from_events(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        events = s.get("events") or []
        # Also read persisted event log (last 50)
        try:
            ext = await self.db.shipment_events.find({"shipmentId": s["id"]}).sort("timestamp", -1).limit(50).to_list(50)
            events = list(events) + list(ext)
        except Exception:
            pass
        for ev in events:
            t = (ev.get("type") or "").lower()
            # typed event?
            if "container" in t:
                for fld in ("container", "containerNumber", "payload", "meta", "title", "label", "description"):
                    raw = ev.get(fld)
                    if isinstance(raw, dict):
                        raw = raw.get("number") or raw.get("containerNumber") or str(raw)
                    candidates = extract_container_numbers(raw)
                    if candidates:
                        return candidates[0], {"where": "events[]", "eventType": t, "match": candidates[0]}
            # generic scan anyway (low priority handled by S6)
        return None

    # ── S4: deal-level
    async def _from_deal(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        deal_id = s.get("dealId")
        if not deal_id:
            return None
        try:
            deal = await self.db.deals.find_one({"id": deal_id})
        except Exception:
            return None
        if not deal:
            return None
        for fld in ("containerNumber", "container"):
            v = deal.get(fld)
            if isinstance(v, dict):
                v = v.get("number")
            if v:
                return str(v).upper(), {"where": f"deal.{fld}", "dealId": deal_id}
        # Also regex-scan deal free-text fields
        for fld in ("notes", "description", "shippingNotes"):
            txt = deal.get(fld)
            cands = extract_container_numbers(txt)
            if cands:
                return cands[0], {"where": f"deal.{fld}", "dealId": deal_id, "match": cands[0]}
        return None

    # ── S5: related shipments with same VIN
    async def _from_related_shipments(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        vin = (s.get("vin") or "").upper()
        if not vin or len(vin) < 10:
            return None
        try:
            related = await self.db.shipments.find(
                {"vin": vin, "id": {"$ne": s.get("id")}}
            ).limit(5).to_list(5)
        except Exception:
            return None
        for r in related:
            c = (r.get("container") or {}).get("number") or r.get("containerNumber")
            if c:
                return str(c).upper(), {"where": "related_shipment", "otherShipmentId": r.get("id")}
            # also scan stages
            for st in r.get("stages") or []:
                cc = (st.get("container") or {}).get("number")
                if cc:
                    return str(cc).upper(), {"where": "related_shipment.stage", "otherShipmentId": r.get("id")}
        return None

    # ── S6: regex extract from shipment free text
    async def _from_text_extract(self, s: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
        haystack = []
        for fld in ("vehicleTitle", "notes", "description", "label"):
            v = s.get(fld)
            if v: haystack.append(str(v))
        # Also stages labels / routes
        for st in s.get("stages") or []:
            for fld in ("label", "from", "to", "notes"):
                v = st.get(fld)
                if v: haystack.append(str(v))
        txt = "\n".join(haystack)
        cands = extract_container_numbers(txt)
        if cands:
            return cands[0], {"where": "text_extract", "match": cands[0], "sampleLen": len(txt)}
        return None


# ─────────────────────────────────────────────────────────────────────
# VesselResolver
# ─────────────────────────────────────────────────────────────────────


class VesselResolver:
    """Find vessel (mmsi/imo/name) for a given container number.

    Strategies:
        V1  0.98  shipment already has vessel bound on active stage
        V2  0.95  ShipsGo GetContainerInfo
        V3  0.90  AfterShip tracking
        V4  0.75  related shipments in our DB with same container → their vessel
        V5  0.60  VesselFinder search by vessel name (if name is all we have)
    """

    def __init__(self, db, shipsgo_lookup=None, vf_search=None):
        """
        shipsgo_lookup: async callable(container) → dict|None  (ShipsGo/AfterShip).
                       Re-uses existing `_external_container_lookup` in server.py.
        vf_search:     async callable(name) → dict|None        (VF vessel search).
                       Optional — if None, V5 is skipped.
        """
        self.db = db
        self._shipsgo_lookup = shipsgo_lookup
        self._vf_search = vf_search

    async def resolve(self, container_number: str, shipment: Optional[Dict[str, Any]] = None) -> ResolverResult:
        container_number = (container_number or "").upper().strip()
        if not _is_plausible_container(container_number):
            return _empty("vessel_bad_container", "v0_bad_input")

        strategies = [
            ("v1_current_stage",  0.98, self._from_current_stage),
            ("v2_shipsgo",        0.95, self._from_shipsgo),
            ("v3_aftership",      0.90, self._from_aftership),   # reserved — implemented via same shipsgo_lookup fallback
            ("v4_related_db",     0.75, self._from_related_db),
            ("v5_vf_by_name",     0.60, self._from_vf_by_name),
        ]
        for name, conf, fn in strategies:
            try:
                hit = await fn(container_number, shipment or {})
            except Exception as e:
                logger.warning(f"[Resolver/Vessel/{name}] failed: {e}")
                continue
            if hit:
                val, evidence = hit
                if self._is_plausible_vessel(val):
                    logger.info(
                        f"[Resolver/Vessel] container={container_number} "
                        f"→ name={val.get('name')} mmsi={val.get('mmsi')} "
                        f"imo={val.get('imo')} (src={name}, conf={conf})"
                    )
                    return ResolverResult(
                        value=val, confidence=conf,
                        source=name.split("_", 1)[1], strategy=name,
                        evidence=evidence or {},
                    )
        return _empty("vessel_not_found", "none")

    @staticmethod
    def _is_plausible_vessel(v: Any) -> bool:
        if not isinstance(v, dict): return False
        return bool(v.get("mmsi") or v.get("imo") or v.get("name"))

    async def _from_current_stage(self, c: str, s: Dict[str, Any]):
        cur_id = s.get("currentStageId")
        for st in s.get("stages") or []:
            if st.get("id") == cur_id and (st.get("container") or {}).get("number", "").upper() == c:
                v = st.get("vessel") or {}
                if self._is_plausible_vessel(v):
                    return {"name": v.get("name"), "mmsi": v.get("mmsi"), "imo": v.get("imo")}, {
                        "where": f"stage[{cur_id}].vessel"
                    }
        # top-level legacy
        tv = s.get("vessel") or {}
        if self._is_plausible_vessel(tv) and ((s.get("container") or {}).get("number", "").upper() == c
                                              or (s.get("containerNumber") or "").upper() == c):
            return {"name": tv.get("name"), "mmsi": tv.get("mmsi"), "imo": tv.get("imo")}, {
                "where": "shipment.vessel"
            }
        return None

    async def _from_shipsgo(self, c: str, s: Dict[str, Any]):
        if not self._shipsgo_lookup:
            return None
        data = await self._shipsgo_lookup(c)
        if not isinstance(data, dict):
            return None
        if data.get("error") or data.get("status") == "submitted_for_tracking":
            return None
        val = {
            "name": data.get("vesselName") or data.get("VesselName"),
            "imo":  str(data.get("imo") or "") or None,
            "mmsi": data.get("mmsi"),
        }
        if not self._is_plausible_vessel(val):
            return None
        ev = {
            "where": "shipsgo.GetContainerInfo",
            "status": data.get("status"),
            "eta": data.get("eta"),
            "origin": data.get("origin"),
            "destination": data.get("destination"),
            "mapPoint": data.get("mapPoint"),
        }
        return val, ev

    async def _from_aftership(self, c: str, s: Dict[str, Any]):
        # Reserved slot — current `_external_container_lookup` already falls
        # back from ShipsGo → AfterShip internally and returns ``source:"aftership"``.
        # So if V2 (shipsgo) didn't yield a vessel-bearing result, AfterShip
        # won't either (AfterShip's container response rarely has vessel).
        return None

    async def _from_related_db(self, c: str, s: Dict[str, Any]):
        try:
            related = await self.db.shipments.find({
                "$or": [
                    {"container.number": c},
                    {"containerNumber": c},
                    {"stages.container.number": c},
                ]
            }).limit(5).to_list(5)
        except Exception:
            return None
        for r in related:
            if r.get("id") == s.get("id"):
                continue
            # prefer active stage vessel
            cur_id = r.get("currentStageId")
            for st in r.get("stages") or []:
                if st.get("id") == cur_id:
                    v = st.get("vessel") or {}
                    if self._is_plausible_vessel(v):
                        return {"name": v.get("name"), "mmsi": v.get("mmsi"), "imo": v.get("imo")}, {
                            "where": "related_shipment.stage.vessel",
                            "otherShipmentId": r.get("id"),
                        }
            tv = r.get("vessel") or {}
            if self._is_plausible_vessel(tv):
                return {"name": tv.get("name"), "mmsi": tv.get("mmsi"), "imo": tv.get("imo")}, {
                    "where": "related_shipment.vessel",
                    "otherShipmentId": r.get("id"),
                }
        return None

    async def _from_vf_by_name(self, c: str, s: Dict[str, Any]):
        # If ALL we have is a name (e.g. from document or manager note) we
        # ask VF to resolve MMSI/IMO. Only useful when caller passes
        # vessel_name_hint via shipment.
        hint = (s.get("vesselNameHint") or "").strip()
        if not hint or not self._vf_search:
            return None
        try:
            hits = await self._vf_search(hint)
        except Exception:
            return None
        if not hits:
            return None
        v = hits[0] if isinstance(hits, list) else hits
        if not self._is_plausible_vessel(v):
            return None
        return {"name": v.get("name"), "mmsi": v.get("mmsi"), "imo": v.get("imo")}, {
            "where": "vf_search_by_name", "hint": hint,
        }


# ─────────────────────────────────────────────────────────────────────
# TransferDetector
# ─────────────────────────────────────────────────────────────────────


class TransferDetector:
    """Detect if incoming vessel data implies a transshipment.

    Rule:
        Same container number, but different vessel identity (mmsi / imo /
        normalised name) → TRANSFER. Return (True, reason).

        If current_vessel is empty (first bind) → NOT a transfer.

        If incoming vessel is empty → NOT a transfer.

        If the shipment's container has just changed → that's a bigger event,
        still report as "transfer_with_container_swap" so caller creates new
        stage.

    Returns
    -------
    dict: {
        "isTransfer": bool,
        "reason": "first_bind" | "same_vessel" | "mmsi_changed" | "imo_changed"
                  | "name_changed" | "container_and_vessel_changed",
        "oldVessel": {...},
        "newVessel": {...},
    }
    """

    @staticmethod
    def _norm_name(n: Optional[str]) -> str:
        return re.sub(r"\s+", " ", (n or "").upper()).strip()

    @classmethod
    def detect(
        cls,
        current_container: Optional[str],
        current_vessel: Optional[Dict[str, Any]],
        new_container: Optional[str],
        new_vessel: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        cv = current_vessel or {}
        nv = new_vessel or {}
        cc = (current_container or "").upper()
        nc = (new_container or "").upper() or cc   # if caller didn't pass new, assume same
        empty_cur = not (cv.get("mmsi") or cv.get("imo") or cv.get("name"))
        empty_new = not (nv.get("mmsi") or nv.get("imo") or nv.get("name"))

        if empty_new:
            return {"isTransfer": False, "reason": "empty_new", "oldVessel": cv, "newVessel": nv}
        if empty_cur:
            return {"isTransfer": False, "reason": "first_bind", "oldVessel": cv, "newVessel": nv}

        mmsi_change = bool(cv.get("mmsi") and nv.get("mmsi") and str(cv["mmsi"]) != str(nv["mmsi"]))
        imo_change  = bool(cv.get("imo")  and nv.get("imo")  and str(cv["imo"])  != str(nv["imo"]))
        name_change = bool(cls._norm_name(cv.get("name")) and cls._norm_name(nv.get("name"))
                           and cls._norm_name(cv.get("name")) != cls._norm_name(nv.get("name")))

        container_swap = bool(cc and nc and cc != nc)

        if mmsi_change or imo_change:
            reason = "container_and_vessel_changed" if container_swap else ("mmsi_changed" if mmsi_change else "imo_changed")
            return {"isTransfer": True, "reason": reason, "oldVessel": cv, "newVessel": nv,
                    "oldContainer": cc, "newContainer": nc}
        if name_change and not (mmsi_change or imo_change):
            # Name-only change with matching/unknown MMSI — suspicious but
            # could be a rename. Mark as "soft transfer" requiring human review.
            return {"isTransfer": True, "reason": "name_changed_weak", "oldVessel": cv, "newVessel": nv,
                    "oldContainer": cc, "newContainer": nc, "weak": True}
        return {"isTransfer": False, "reason": "same_vessel", "oldVessel": cv, "newVessel": nv}


# ─────────────────────────────────────────────────────────────────────
# AutoResolver — orchestrator
# ─────────────────────────────────────────────────────────────────────


@dataclass
class AutoResolveReport:
    shipmentId: str
    ranAt: str
    container: Dict[str, Any]            # ResolverResult.to_dict()
    vessel: Dict[str, Any]               # ResolverResult.to_dict()
    transfer: Dict[str, Any]             # TransferDetector.detect output
    actions: List[str] = field(default_factory=list)  # human-readable trail

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AutoResolver:
    """End-to-end orchestrator. Returns a report; does NOT mutate DB.
    Caller decides whether to persist container/vessel bind + stage split.
    """

    def __init__(self, db, shipsgo_lookup=None, vf_search=None):
        self.container_resolver = ContainerResolver(db)
        self.vessel_resolver = VesselResolver(
            db, shipsgo_lookup=shipsgo_lookup, vf_search=vf_search,
        )

    async def run(self, shipment: Dict[str, Any]) -> AutoResolveReport:
        ship_id = shipment.get("id") or "?"
        actions: List[str] = []

        c_res = await self.container_resolver.resolve(shipment)
        actions.append(
            f"container: {c_res.source} → {c_res.value or '—'} (conf {c_res.confidence:.2f})"
        )

        if not c_res.found:
            return AutoResolveReport(
                shipmentId=ship_id,
                ranAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                container=c_res.to_dict(),
                vessel=_empty("skipped_no_container").to_dict(),
                transfer={"isTransfer": False, "reason": "skipped_no_container"},
                actions=actions,
            )

        v_res = await self.vessel_resolver.resolve(c_res.value, shipment)
        actions.append(
            f"vessel: {v_res.source} → name={v_res.value.get('name') if isinstance(v_res.value, dict) else '—'} "
            f"(conf {v_res.confidence:.2f})"
        )

        # Transfer detection vs currently bound
        from_cur = shipment.get("currentStageId")
        cur_vessel: Dict[str, Any] = {}
        cur_container: Optional[str] = None
        for st in shipment.get("stages") or []:
            if st.get("id") == from_cur:
                cur_vessel = (st.get("vessel") or {})
                cur_container = (st.get("container") or {}).get("number")
        if not cur_vessel:
            cur_vessel = shipment.get("vessel") or {}
        if not cur_container:
            cur_container = (shipment.get("container") or {}).get("number") or shipment.get("containerNumber")

        transfer = TransferDetector.detect(
            cur_container, cur_vessel, c_res.value,
            v_res.value if isinstance(v_res.value, dict) else None,
        )
        actions.append(f"transfer: {transfer.get('reason')} (isTransfer={transfer.get('isTransfer')})")

        return AutoResolveReport(
            shipmentId=ship_id,
            ranAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            container=c_res.to_dict(),
            vessel=v_res.to_dict(),
            transfer=transfer,
            actions=actions,
        )
