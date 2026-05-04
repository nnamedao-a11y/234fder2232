"""
westmotors_sync.py — Full + Incremental sitemap-driven sync workers.

Full sync (default: daily at 04:00 UTC):
    sitemap.xml → ALL lots-*.xml → upsert every {vin, url, region, lastmod}
    Items missing in the latest crawl get archived=True (lifecycle).

Incremental sync (default: hourly):
    Only the FIRST lots sitemap of every region (lots-1.xml) — fresh listings.
    Never archives anything (partial scan can't prove staleness).

Both workers persist run history to `westmotors_sync_runs` and settings to
`westmotors_sync_settings`. The workers are cancellable and idempotent.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from westmotors_scraper import (
    fetch_sitemap_index,
    parse_lot_sitemap,
    is_lot_sitemap,
    is_first_lot_sitemap,
    extract_vin_from_url,
    detect_region,
    prefetch_top_n,
    warmup_from_search_logs,
)

logger = logging.getLogger("westmotors.sync")

DEFAULTS = {
    "enabled": True,
    "full_daily_hour_utc": 4,        # 04:00 UTC daily full sync
    "incremental_interval_sec": 3600,  # 1h incremental sync
    "delay_between_sitemaps_sec": 2.0,
    "archive_safety_threshold": 0.8,  # only archive if ≥80% of sitemaps were scraped
    "startup_delay_sec": 60,
    # Phase IV-1 hardening
    "prefetch_after_full_sync": True,
    "prefetch_top_n": 1000,           # # of top-lastmod VINs to pre-warm
    "prefetch_concurrency": 8,
    "prefetch_delay_per_request": 0.15,
    "warmup_on_startup": True,
    "warmup_top_searches": 500,
    "warmup_search_window_days": 14,
}

SETTINGS_COLL = "westmotors_sync_settings"
RUNS_COLL = "westmotors_sync_runs"
INDEX_COLL = "vin_data_westmotors"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ═════════════════════════════════════════════════════════════════
# Shared upsert helper
# ═════════════════════════════════════════════════════════════════
async def _upsert_index(db, items: List[Dict[str, str]]) -> Dict[str, int]:
    """Upsert {url, lastmod} entries into vin_data_westmotors.

    Returns counters {seen, new, updated, skipped}.
    """
    counters = {"seen": 0, "new": 0, "updated": 0, "skipped": 0}
    if not items or db is None:
        return counters
    now = _now()
    for it in items:
        url = it.get("url")
        if not url:
            counters["skipped"] += 1
            continue
        vin = extract_vin_from_url(url)
        if not vin:
            counters["skipped"] += 1
            continue
        counters["seen"] += 1
        region = detect_region(url)
        lastmod = it.get("lastmod") or ""
        try:
            res = await db[INDEX_COLL].update_one(
                {"vin": vin},
                {
                    "$set": {
                        "vin": vin,
                        "url": url,
                        "region": region,
                        "lastmod": lastmod,
                        "archived": False,
                        "last_seen": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                    },
                },
                upsert=True,
            )
            if res.upserted_id is not None:
                counters["new"] += 1
            elif res.modified_count:
                counters["updated"] += 1
        except Exception as e:
            logger.warning(f"[westmotors.sync] upsert error vin={vin}: {e}")
            counters["skipped"] += 1
    return counters


async def _archive_stale(db, sync_started_at: datetime) -> int:
    """Mark rows whose last_seen is older than the current sync start as archived."""
    if db is None:
        return 0
    try:
        res = await db[INDEX_COLL].update_many(
            {"last_seen": {"$lt": sync_started_at}, "archived": {"$ne": True}},
            {"$set": {"archived": True, "archived_at": _now()}},
        )
        return res.modified_count
    except Exception as e:
        logger.warning(f"[westmotors.sync] archive error: {e}")
        return 0


# ═════════════════════════════════════════════════════════════════
# Sync worker
# ═════════════════════════════════════════════════════════════════
class WestMotorsSync:
    """Sitemap-driven WestMotors index sync.

    Manages BOTH full (daily) and incremental (hourly) loops in a single
    instance to keep the wiring simple — they share the same settings
    collection and run-history collection.
    """

    def __init__(self, db, on_new_vin: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.db = db
        self.on_new_vin = on_new_vin
        self.settings: Dict[str, Any] = dict(DEFAULTS)
        self._full_task: Optional[asyncio.Task] = None
        self._inc_task: Optional[asyncio.Task] = None
        self._cancel_current = asyncio.Event()
        self._is_running_full = False
        self._is_running_inc = False
        self._progress: Dict[str, Any] = {}
        self._last_full_run: Optional[Dict[str, Any]] = None
        self._last_inc_run: Optional[Dict[str, Any]] = None

    # ─────────── Settings ───────────
    async def load_settings(self):
        try:
            doc = await self.db[SETTINGS_COLL].find_one({"_id": "config"})
            if doc:
                for k in DEFAULTS.keys():
                    if k in doc:
                        self.settings[k] = doc[k]
        except Exception as e:
            logger.warning(f"[westmotors.sync] load_settings: {e}")

    async def save_settings(self):
        try:
            await self.db[SETTINGS_COLL].update_one(
                {"_id": "config"},
                {"$set": {**self.settings, "updated_at": _now()}},
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"[westmotors.sync] save_settings: {e}")

    async def configure(self, **patch):
        for k, v in patch.items():
            if k in DEFAULTS:
                self.settings[k] = v
        await self.save_settings()
        return self.settings

    # ─────────── Stats ───────────
    async def get_stats(self) -> Dict[str, Any]:
        total = active = archived = 0
        if self.db is not None:
            try:
                total = await self.db[INDEX_COLL].count_documents({})
                active = await self.db[INDEX_COLL].count_documents({"archived": {"$ne": True}})
                archived = total - active
            except Exception:
                pass
        # last full + last incremental run from history
        last_full = self._last_full_run
        last_inc = self._last_inc_run
        return {
            "settings": self.settings,
            "is_running_full": self._is_running_full,
            "is_running_incremental": self._is_running_inc,
            "scheduler_full_active": self._full_task is not None and not self._full_task.done(),
            "scheduler_incremental_active": self._inc_task is not None and not self._inc_task.done(),
            "progress": self._progress,
            "db": {
                "total": total,
                "active": active,
                "archived": archived,
            },
            "last_full_run": last_full,
            "last_incremental_run": last_inc,
        }

    # ─────────── Cancel current ───────────
    def cancel_current(self):
        self._cancel_current.set()

    # ─────────── Run-history persistence ───────────
    async def _record_run(self, kind: str, payload: Dict[str, Any]):
        if self.db is None:
            return
        try:
            doc = {**payload, "kind": kind, "ts": _now()}
            await self.db[RUNS_COLL].insert_one(doc)
        except Exception as e:
            logger.debug(f"[westmotors.sync] _record_run: {e}")

    # ═════════════════════════════════════════════════════════════
    # Full sync
    # ═════════════════════════════════════════════════════════════
    async def run_full_sync(self) -> Dict[str, Any]:
        if self._is_running_full:
            return {"status": "already_running", "kind": "full"}
        self._is_running_full = True
        self._cancel_current.clear()
        started = _now()
        self._progress = {"kind": "full", "started_at": started.isoformat(),
                          "stage": "discover", "sitemaps_done": 0,
                          "sitemaps_total": 0, "items_seen": 0}
        totals = {"seen": 0, "new": 0, "updated": 0, "skipped": 0,
                  "archived": 0, "errors": 0}
        try:
            sub_sitemaps = await fetch_sitemap_index()
            lot_sitemaps = [s for s in sub_sitemaps if is_lot_sitemap(s["loc"])]
            self._progress["sitemaps_total"] = len(lot_sitemaps)
            logger.info(f"[westmotors.sync] full: {len(lot_sitemaps)} lot sitemaps to process")
            scanned = 0
            for sm in lot_sitemaps:
                if self._cancel_current.is_set():
                    self._progress["stage"] = "cancelled"
                    break
                self._progress["stage"] = f"scanning {sm['loc'].rsplit('/', 1)[-1]}"
                try:
                    items = await parse_lot_sitemap(sm["loc"])
                    counters = await _upsert_index(self.db, items)
                    for k in ("seen", "new", "updated", "skipped"):
                        totals[k] += counters.get(k, 0)
                    self._progress["items_seen"] += counters.get("seen", 0)
                    scanned += 1
                except Exception as e:
                    logger.warning(f"[westmotors.sync] full sitemap error {sm['loc']}: {e}")
                    totals["errors"] += 1
                self._progress["sitemaps_done"] = scanned
                # Polite pacing between sitemaps
                await asyncio.sleep(self.settings.get("delay_between_sitemaps_sec", 2.0))
            # Archive stale rows only if we scanned enough sitemaps to be confident
            if (lot_sitemaps and scanned / len(lot_sitemaps)
                    >= self.settings.get("archive_safety_threshold", 0.8)
                    and not self._cancel_current.is_set()):
                totals["archived"] = await _archive_stale(self.db, started)
            self._progress["stage"] = "done" if not self._cancel_current.is_set() else "cancelled"

            # ─── Phase IV-1: prefetch top-N freshest VINs into prefetched_data ───
            if (self.settings.get("prefetch_after_full_sync", True)
                    and not self._cancel_current.is_set()):
                self._progress["stage"] = "prefetching"
                try:
                    pf = await prefetch_top_n(
                        self.db,
                        n=int(self.settings.get("prefetch_top_n", 1000)),
                        concurrency=int(self.settings.get("prefetch_concurrency", 8)),
                        delay_per_request=float(self.settings.get("prefetch_delay_per_request", 0.15)),
                    )
                    totals["prefetched"] = pf.get("prefetched", 0)
                    totals["prefetch_skipped"] = pf.get("skipped", 0)
                    totals["prefetch_errors"] = pf.get("errors", 0)
                    self._progress["stage"] = "done"
                    logger.info(f"[westmotors.sync] prefetch complete: {pf}")
                except Exception as e:
                    logger.warning(f"[westmotors.sync] prefetch failed: {e}")
                    totals["prefetch_errors"] = totals.get("prefetch_errors", 0) + 1
        except Exception as e:
            logger.error(f"[westmotors.sync] full sync fatal: {e}")
            totals["errors"] += 1
            self._progress["stage"] = "error"
            self._progress["error"] = str(e)
        finally:
            finished = _now()
            duration = (finished - started).total_seconds()
            run = {
                "started_at": started, "finished_at": finished,
                "duration_sec": duration, **totals,
                "cancelled": self._cancel_current.is_set(),
            }
            self._last_full_run = {**run, "started_at": started.isoformat(),
                                   "finished_at": finished.isoformat()}
            await self._record_run("full", run)
            self._is_running_full = False
            self._cancel_current.clear()
        return {"status": "ok", "kind": "full", **totals,
                "duration_sec": (finished - started).total_seconds()}

    # ═════════════════════════════════════════════════════════════
    # Incremental sync (lots-1.xml of every region)
    # ═════════════════════════════════════════════════════════════
    async def run_incremental_sync(self) -> Dict[str, Any]:
        if self._is_running_inc:
            return {"status": "already_running", "kind": "incremental"}
        self._is_running_inc = True
        started = _now()
        totals = {"seen": 0, "new": 0, "updated": 0, "skipped": 0, "errors": 0}
        new_vins: List[str] = []
        try:
            sub_sitemaps = await fetch_sitemap_index()
            first_lots = [s for s in sub_sitemaps if is_first_lot_sitemap(s["loc"])]
            logger.info(f"[westmotors.sync] incremental: {len(first_lots)} first-lot sitemaps")
            for sm in first_lots:
                try:
                    items = await parse_lot_sitemap(sm["loc"])
                    # Detect new VINs BEFORE upsert for callback fanout
                    for it in items:
                        v = extract_vin_from_url(it.get("url") or "")
                        if v:
                            existing = await self.db[INDEX_COLL].find_one(
                                {"vin": v}, {"_id": 1}
                            )
                            if not existing:
                                new_vins.append(v)
                    counters = await _upsert_index(self.db, items)
                    for k in ("seen", "new", "updated", "skipped"):
                        totals[k] += counters.get(k, 0)
                except Exception as e:
                    logger.warning(f"[westmotors.sync] inc sitemap error {sm['loc']}: {e}")
                    totals["errors"] += 1
                await asyncio.sleep(self.settings.get("delay_between_sitemaps_sec", 2.0))
            # Fire callback for every truly-new VIN
            if self.on_new_vin and new_vins:
                for v in new_vins[:200]:  # cap
                    try:
                        await self.on_new_vin({"vin": v, "source": "westmotors"})
                    except Exception as e:
                        logger.debug(f"[westmotors.sync] on_new_vin err: {e}")
        except Exception as e:
            logger.error(f"[westmotors.sync] inc fatal: {e}")
            totals["errors"] += 1
        finally:
            finished = _now()
            duration = (finished - started).total_seconds()
            run = {
                "started_at": started, "finished_at": finished,
                "duration_sec": duration, **totals,
                "new_vin_callbacks": len(new_vins),
            }
            self._last_inc_run = {**run, "started_at": started.isoformat(),
                                  "finished_at": finished.isoformat()}
            await self._record_run("incremental", run)
            self._is_running_inc = False
        return {"status": "ok", "kind": "incremental", **totals,
                "duration_sec": (finished - started).total_seconds()}

    # ═════════════════════════════════════════════════════════════
    # Manual prefetch + warmup (Phase IV-1)
    # ═════════════════════════════════════════════════════════════
    async def run_prefetch(self, n: Optional[int] = None) -> Dict[str, Any]:
        """Fire a manual top-N prefetch (used for ops + tests)."""
        n = int(n or self.settings.get("prefetch_top_n", 1000))
        started = _now()
        try:
            pf = await prefetch_top_n(
                self.db, n=n,
                concurrency=int(self.settings.get("prefetch_concurrency", 8)),
                delay_per_request=float(self.settings.get("prefetch_delay_per_request", 0.15)),
            )
        except Exception as e:
            logger.warning(f"[westmotors.sync] run_prefetch error: {e}")
            pf = {"requested": 0, "prefetched": 0, "skipped": 0, "errors": 1}
        finished = _now()
        run = {**pf, "started_at": started, "finished_at": finished,
               "duration_sec": (finished - started).total_seconds()}
        await self._record_run("prefetch", run)
        return {"status": "ok", "kind": "prefetch", **run,
                "started_at": started.isoformat(),
                "finished_at": finished.isoformat()}

    async def run_warmup(self, top: Optional[int] = None,
                          window_days: Optional[int] = None) -> Dict[str, Any]:
        """Run the search-log-driven warmup (top-N popular VINs)."""
        top = int(top or self.settings.get("warmup_top_searches", 500))
        days = int(window_days or self.settings.get("warmup_search_window_days", 14))
        started = _now()
        try:
            wu = await warmup_from_search_logs(self.db, limit=top, days=days)
        except Exception as e:
            logger.warning(f"[westmotors.sync] warmup error: {e}")
            wu = {"queried": 0, "candidates": 0, "prefetched": 0,
                  "skipped": 0, "errors": 1}
        finished = _now()
        run = {**wu, "started_at": started, "finished_at": finished,
               "duration_sec": (finished - started).total_seconds()}
        await self._record_run("warmup", run)
        return {"status": "ok", "kind": "warmup", **run,
                "started_at": started.isoformat(),
                "finished_at": finished.isoformat()}

    # ═════════════════════════════════════════════════════════════
    # Schedulers
    # ═════════════════════════════════════════════════════════════
    async def _full_loop(self):
        await asyncio.sleep(self.settings.get("startup_delay_sec", 60))
        last_run_day: Optional[str] = None
        while True:
            try:
                if self.settings.get("enabled", True):
                    now = _now()
                    target_h = int(self.settings.get("full_daily_hour_utc", 4))
                    today_key = now.strftime("%Y-%m-%d")
                    if now.hour == target_h and last_run_day != today_key:
                        logger.info("[westmotors.sync] firing daily full sync")
                        await self.run_full_sync()
                        last_run_day = today_key
                # Wake up once per minute
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[westmotors.sync] full loop: {e}")
                await asyncio.sleep(60)

    async def _inc_loop(self):
        await asyncio.sleep(self.settings.get("startup_delay_sec", 60))
        while True:
            try:
                if self.settings.get("enabled", True):
                    await self.run_incremental_sync()
                interval = int(self.settings.get("incremental_interval_sec", 3600))
                await asyncio.sleep(max(60, interval))
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[westmotors.sync] inc loop: {e}")
                await asyncio.sleep(60)

    def start(self):
        if self._full_task is None or self._full_task.done():
            self._full_task = asyncio.create_task(self._full_loop())
        if self._inc_task is None or self._inc_task.done():
            self._inc_task = asyncio.create_task(self._inc_loop())
        # Phase IV-1: best-effort startup warmup from popular searches
        if self.settings.get("warmup_on_startup", True):
            asyncio.create_task(self._startup_warmup())

    async def _startup_warmup(self):
        """Run a one-time warmup ~90 s after process start so we don't slow boot."""
        try:
            await asyncio.sleep(90)
            wu = await self.run_warmup()
            logger.info(f"[westmotors.sync] startup warmup done: {wu}")
        except Exception as e:
            logger.debug(f"[westmotors.sync] startup warmup err: {e}")

    def stop(self):
        for t in (self._full_task, self._inc_task):
            if t and not t.done():
                t.cancel()
        self._full_task = None
        self._inc_task = None
