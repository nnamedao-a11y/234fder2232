"""
lemon_sync.py — Lemon-Cars sitemap discovery + lazy parser worker.

Two distinct workloads, both runnable independently:

  1) DISCOVERY (fast)
     Walks `/sitemap.xml` → 6 lot sitemaps → upserts {lemon_id, url, region,
     lastmod} into `vin_data_lemon`. NEVER fetches detail pages.
     Run cadence:
       - Full discovery:      daily 04:30 UTC (after WestMotors)
       - Incremental:         hourly (only iblock-1 + iblock-1.part1)

  2) LAZY PARSE WORKER (continuous)
     Picks unparsed (or stale) rows ordered by lastmod desc and parses them
     into `parsed_data` (with VIN/LOT extraction). Concurrency 4, 0.3 s
     delay → ~13 URLs/sec → 166 k → ~3.5 h to fully bootstrap.
     Worker runs forever and self-rate-limits when nothing to do.

Both workloads share the same settings + run-history collections.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from lemon_scraper import (
    fetch_sitemap_index,
    parse_url_sitemap,
    is_lot_sitemap,
    is_first_lot_sitemap,
    parse_lemon_url,
    jit_parse_url,
    _is_fresh,
    COLL,
)

logger = logging.getLogger("lemon.sync")

DEFAULTS = {
    "enabled": True,
    "discovery_full_daily_hour_utc": 4,        # 04:30 UTC daily
    "discovery_incremental_interval_sec": 3600,  # hourly
    "delay_between_sitemaps_sec": 1.5,
    "archive_safety_threshold": 0.8,
    "startup_delay_sec": 90,
    # Lazy parse worker
    "parser_enabled": True,
    "parser_concurrency": 4,
    "parser_delay_per_request_sec": 0.30,
    "parser_batch_size": 100,                   # rows per query
    "parser_idle_sleep_sec": 60,                # when no work
    "parser_max_failures": 3,                   # blacklist after N failures
    "parser_stale_after_hours": 168,            # re-parse rows >7d old
}

SETTINGS_COLL = "lemon_sync_settings"
RUNS_COLL = "lemon_sync_runs"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ═════════════════════════════════════════════════════════════════
# Discovery upsert
# ═════════════════════════════════════════════════════════════════
async def _upsert_discovery(db, items: List[Dict[str, str]]) -> Dict[str, int]:
    counters = {"seen": 0, "new": 0, "updated": 0, "skipped": 0}
    if not items or db is None:
        return counters
    now = _now()
    for it in items:
        url = it.get("url")
        if not url:
            counters["skipped"] += 1
            continue
        parts = parse_lemon_url(url)
        if not parts:
            counters["skipped"] += 1
            continue
        counters["seen"] += 1
        lemon_id = parts["lemon_id"]
        region = parts["region"]
        lastmod = it.get("lastmod") or ""
        try:
            res = await db[COLL].update_one(
                {"lemon_id": lemon_id},
                {
                    "$set": {
                        "lemon_id": lemon_id,
                        "url": url,
                        "region": region,
                        "lastmod": lastmod,
                        "archived": False,
                        "last_seen": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "parsed_data": None,
                        "parse_failed_count": 0,
                        "hit_count": 0,
                    },
                },
                upsert=True,
            )
            if res.upserted_id is not None:
                counters["new"] += 1
            elif res.modified_count:
                counters["updated"] += 1
        except Exception as e:
            logger.debug(f"[lemon.sync] upsert err lemon_id={lemon_id}: {e}")
            counters["skipped"] += 1
    return counters


async def _archive_stale(db, sync_started_at: datetime) -> int:
    if db is None:
        return 0
    try:
        res = await db[COLL].update_many(
            {"last_seen": {"$lt": sync_started_at}, "archived": {"$ne": True}},
            {"$set": {"archived": True, "archived_at": _now()}},
        )
        return res.modified_count
    except Exception as e:
        logger.warning(f"[lemon.sync] archive err: {e}")
        return 0


# ═════════════════════════════════════════════════════════════════
# LemonSync — orchestrator (discovery + worker)
# ═════════════════════════════════════════════════════════════════
class LemonSync:
    def __init__(self, db, on_new_vin: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.db = db
        self.on_new_vin = on_new_vin
        self.settings: Dict[str, Any] = dict(DEFAULTS)

        self._full_task: Optional[asyncio.Task] = None
        self._inc_task: Optional[asyncio.Task] = None
        self._worker_task: Optional[asyncio.Task] = None

        self._cancel_current = asyncio.Event()
        self._is_running_full = False
        self._is_running_inc = False
        self._worker_busy = False

        self._progress: Dict[str, Any] = {}
        self._last_full_run: Optional[Dict[str, Any]] = None
        self._last_inc_run: Optional[Dict[str, Any]] = None
        self._worker_counters = {
            "started_at": None, "parsed": 0, "failed": 0, "skipped": 0,
            "current_url": None,
        }

    # ─────────── Settings ───────────
    async def load_settings(self):
        try:
            doc = await self.db[SETTINGS_COLL].find_one({"_id": "config"})
            if doc:
                for k in DEFAULTS.keys():
                    if k in doc:
                        self.settings[k] = doc[k]
        except Exception as e:
            logger.debug(f"[lemon.sync] load_settings: {e}")

    async def save_settings(self):
        try:
            await self.db[SETTINGS_COLL].update_one(
                {"_id": "config"},
                {"$set": {**self.settings, "updated_at": _now()}},
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"[lemon.sync] save_settings: {e}")

    async def configure(self, **patch):
        for k, v in patch.items():
            if k in DEFAULTS:
                self.settings[k] = v
        await self.save_settings()
        return self.settings

    # ─────────── Stats ───────────
    async def get_stats(self) -> Dict[str, Any]:
        total = active = archived = parsed = unparsed = with_vin = with_lot = 0
        if self.db is not None:
            try:
                total = await self.db[COLL].count_documents({})
                active = await self.db[COLL].count_documents({"archived": {"$ne": True}})
                archived = total - active
                parsed = await self.db[COLL].count_documents(
                    {"parsed_data": {"$ne": None, "$exists": True},
                     "archived": {"$ne": True}}
                )
                unparsed = active - parsed
                with_vin = await self.db[COLL].count_documents(
                    {"vin": {"$exists": True, "$ne": None},
                     "archived": {"$ne": True}}
                )
                with_lot = await self.db[COLL].count_documents(
                    {"lot": {"$exists": True, "$ne": None},
                     "archived": {"$ne": True}}
                )
            except Exception:
                pass
        return {
            "settings": self.settings,
            "is_running_full_discovery": self._is_running_full,
            "is_running_incremental": self._is_running_inc,
            "worker_busy": self._worker_busy,
            "scheduler_full_active": self._full_task is not None and not self._full_task.done(),
            "scheduler_incremental_active": self._inc_task is not None and not self._inc_task.done(),
            "worker_active": self._worker_task is not None and not self._worker_task.done(),
            "progress": self._progress,
            "worker_counters": self._worker_counters,
            "db": {
                "total": total,
                "active": active,
                "archived": archived,
                "parsed": parsed,
                "unparsed": unparsed,
                "with_vin": with_vin,
                "with_lot": with_lot,
                "parsed_pct": round(parsed / active * 100, 1) if active else 0.0,
            },
            "last_full_run": self._last_full_run,
            "last_incremental_run": self._last_inc_run,
        }

    def cancel_current(self):
        self._cancel_current.set()

    async def _record_run(self, kind: str, payload: Dict[str, Any]):
        if self.db is None:
            return
        try:
            await self.db[RUNS_COLL].insert_one({**payload, "kind": kind, "ts": _now()})
        except Exception:
            pass

    # ═════════════════════════════════════════════════════════════
    # DISCOVERY — full + incremental
    # ═════════════════════════════════════════════════════════════
    async def run_full_discovery(self) -> Dict[str, Any]:
        if self._is_running_full:
            return {"status": "already_running"}
        self._is_running_full = True
        self._cancel_current.clear()
        started = _now()
        self._progress = {"kind": "full_discovery", "started_at": started.isoformat(),
                          "stage": "discover", "sitemaps_done": 0,
                          "sitemaps_total": 0, "items_seen": 0}
        totals = {"seen": 0, "new": 0, "updated": 0,
                  "skipped": 0, "archived": 0, "errors": 0}
        try:
            sub = await fetch_sitemap_index()
            lot_sm = [s for s in sub if is_lot_sitemap(s["loc"])]
            self._progress["sitemaps_total"] = len(lot_sm)
            scanned = 0
            for sm in lot_sm:
                if self._cancel_current.is_set():
                    self._progress["stage"] = "cancelled"
                    break
                self._progress["stage"] = f"scanning {sm['loc'].rsplit('/', 1)[-1]}"
                try:
                    items = await parse_url_sitemap(sm["loc"])
                    counters = await _upsert_discovery(self.db, items)
                    for k in ("seen", "new", "updated", "skipped"):
                        totals[k] += counters.get(k, 0)
                    self._progress["items_seen"] += counters.get("seen", 0)
                except Exception as e:
                    logger.warning(f"[lemon.sync] full sitemap err {sm['loc']}: {e}")
                    totals["errors"] += 1
                scanned += 1
                self._progress["sitemaps_done"] = scanned
                await asyncio.sleep(self.settings.get("delay_between_sitemaps_sec", 1.5))
            if (lot_sm and scanned / len(lot_sm)
                    >= self.settings.get("archive_safety_threshold", 0.8)
                    and not self._cancel_current.is_set()):
                totals["archived"] = await _archive_stale(self.db, started)
            self._progress["stage"] = "done" if not self._cancel_current.is_set() else "cancelled"
        except Exception as e:
            logger.error(f"[lemon.sync] full fatal: {e}")
            totals["errors"] += 1
        finally:
            finished = _now()
            run = {**totals, "started_at": started, "finished_at": finished,
                   "duration_sec": (finished - started).total_seconds(),
                   "cancelled": self._cancel_current.is_set()}
            self._last_full_run = {**run, "started_at": started.isoformat(),
                                   "finished_at": finished.isoformat()}
            await self._record_run("full_discovery", run)
            self._is_running_full = False
            self._cancel_current.clear()
        return {"status": "ok", **totals,
                "duration_sec": (finished - started).total_seconds()}

    async def run_incremental_discovery(self) -> Dict[str, Any]:
        if self._is_running_inc:
            return {"status": "already_running"}
        self._is_running_inc = True
        started = _now()
        totals = {"seen": 0, "new": 0, "updated": 0, "skipped": 0, "errors": 0}
        new_lemon_ids: List[int] = []
        try:
            sub = await fetch_sitemap_index()
            firsts = [s for s in sub if is_first_lot_sitemap(s["loc"])]
            for sm in firsts:
                try:
                    items = await parse_url_sitemap(sm["loc"])
                    # Detect new IDs (for callbacks) BEFORE upsert
                    for it in items:
                        parts = parse_lemon_url(it.get("url") or "")
                        if not parts:
                            continue
                        existing = await self.db[COLL].find_one(
                            {"lemon_id": parts["lemon_id"]}, {"_id": 1})
                        if not existing:
                            new_lemon_ids.append(parts["lemon_id"])
                    counters = await _upsert_discovery(self.db, items)
                    for k in ("seen", "new", "updated", "skipped"):
                        totals[k] += counters.get(k, 0)
                except Exception as e:
                    logger.warning(f"[lemon.sync] inc sitemap err {sm['loc']}: {e}")
                    totals["errors"] += 1
                await asyncio.sleep(self.settings.get("delay_between_sitemaps_sec", 1.5))

            # Fire callbacks for genuinely new IDs (capped)
            if self.on_new_vin and new_lemon_ids:
                for lid in new_lemon_ids[:200]:
                    try:
                        await self.on_new_vin({"lemon_id": lid, "source": "lemon"})
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"[lemon.sync] inc fatal: {e}")
            totals["errors"] += 1
        finally:
            finished = _now()
            run = {**totals, "started_at": started, "finished_at": finished,
                   "duration_sec": (finished - started).total_seconds(),
                   "new_callbacks": len(new_lemon_ids)}
            self._last_inc_run = {**run, "started_at": started.isoformat(),
                                  "finished_at": finished.isoformat()}
            await self._record_run("incremental_discovery", run)
            self._is_running_inc = False
        return {"status": "ok", **totals,
                "duration_sec": (finished - started).total_seconds()}

    # ═════════════════════════════════════════════════════════════
    # LAZY PARSE WORKER — continuous, lastmod-priority
    # ═════════════════════════════════════════════════════════════
    async def _pick_next_batch(self) -> List[Dict[str, Any]]:
        """Pick up to `parser_batch_size` rows: never-parsed first, then stale."""
        max_failures = int(self.settings.get("parser_max_failures", 3))
        batch = int(self.settings.get("parser_batch_size", 100))
        # Never parsed (newest first by lastmod)
        cur = (self.db[COLL]
               .find({"archived": {"$ne": True},
                      "parsed_data": {"$in": [None, {}]},
                      "$or": [
                          {"parse_failed_count": {"$exists": False}},
                          {"parse_failed_count": {"$lt": max_failures}},
                      ]})
               .sort([("lastmod", -1), ("hit_count", -1)])
               .limit(batch))
        rows = await cur.to_list(length=batch)
        return rows

    async def _parse_one(self, row: Dict[str, Any]) -> bool:
        try:
            self._worker_counters["current_url"] = row.get("url")
            parsed = await jit_parse_url(self.db, row)
            if parsed:
                self._worker_counters["parsed"] += 1
                # Fire callback for every newly-indexed VIN
                if parsed.get("vin") and self.on_new_vin:
                    try:
                        await self.on_new_vin({
                            "vin": parsed["vin"],
                            "lemon_id": row.get("lemon_id"),
                            "lot": parsed.get("lot"),
                            "source": "lemon",
                        })
                    except Exception:
                        pass
                return True
            self._worker_counters["failed"] += 1
            return False
        except Exception as e:
            logger.debug(f"[lemon.sync] parse_one err {row.get('lemon_id')}: {e}")
            self._worker_counters["failed"] += 1
            return False

    async def _worker_loop(self):
        """Continuous lazy parser. Self-rate-limits when DB is empty."""
        await asyncio.sleep(self.settings.get("startup_delay_sec", 90))
        self._worker_counters["started_at"] = _now().isoformat()
        sem = asyncio.Semaphore(int(self.settings.get("parser_concurrency", 4)))
        idle_sleep = int(self.settings.get("parser_idle_sleep_sec", 60))
        delay = float(self.settings.get("parser_delay_per_request_sec", 0.3))

        while True:
            try:
                if not self.settings.get("parser_enabled", True):
                    await asyncio.sleep(idle_sleep)
                    continue
                rows = await self._pick_next_batch()
                if not rows:
                    self._worker_busy = False
                    await asyncio.sleep(idle_sleep)
                    continue
                self._worker_busy = True

                async def _do(row):
                    async with sem:
                        await self._parse_one(row)
                        await asyncio.sleep(delay)

                # Fire batch with bounded concurrency
                await asyncio.gather(*[_do(r) for r in rows], return_exceptions=True)
            except asyncio.CancelledError:
                self._worker_busy = False
                break
            except Exception as e:
                logger.warning(f"[lemon.sync] worker_loop err: {e}")
                await asyncio.sleep(30)

    # ═════════════════════════════════════════════════════════════
    # Discovery schedulers
    # ═════════════════════════════════════════════════════════════
    async def _full_loop(self):
        await asyncio.sleep(self.settings.get("startup_delay_sec", 90))
        last_run_day: Optional[str] = None
        while True:
            try:
                if self.settings.get("enabled", True):
                    now = _now()
                    target_h = int(self.settings.get("discovery_full_daily_hour_utc", 4))
                    today = now.strftime("%Y-%m-%d")
                    if now.hour == target_h and last_run_day != today:
                        logger.info("[lemon.sync] firing daily full discovery")
                        await self.run_full_discovery()
                        last_run_day = today
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[lemon.sync] full loop: {e}")
                await asyncio.sleep(60)

    async def _inc_loop(self):
        await asyncio.sleep(self.settings.get("startup_delay_sec", 90))
        while True:
            try:
                if self.settings.get("enabled", True):
                    await self.run_incremental_discovery()
                interval = int(self.settings.get("discovery_incremental_interval_sec", 3600))
                await asyncio.sleep(max(60, interval))
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[lemon.sync] inc loop: {e}")
                await asyncio.sleep(60)

    def start(self):
        if self._full_task is None or self._full_task.done():
            self._full_task = asyncio.create_task(self._full_loop())
        if self._inc_task is None or self._inc_task.done():
            self._inc_task = asyncio.create_task(self._inc_loop())
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())

    def stop(self):
        for t in (self._full_task, self._inc_task, self._worker_task):
            if t and not t.done():
                t.cancel()
        self._full_task = None
        self._inc_task = None
        self._worker_task = None
