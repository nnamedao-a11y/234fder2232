"""
bitmotors_incremental.py — Hourly incremental sync for BidMotors catalogue.

Purpose:
  The daily full-sync covers the entire 55 000-page catalogue once every 24 h.
  Users expect new listings to be discoverable within minutes, not hours, so
  this worker scrapes only the **first N pages** (default 10) every hour,
  because BidMotors surfaces the freshest vehicles on the first pages.

Contract:
  * ONLY upserts — never marks anything ``archived=True`` (that is the daily
    full-sync's responsibility, since partial scans cannot prove stale-ness).
  * On every NEW upsert (``r.upserted_id`` truthy), fires a watchlist notify
    so the socket.io hook can ping the user who searched for that VIN earlier.
  * Writes a row to ``search_logs`` / ``incremental_runs`` for analytics.
  * Polite by default: 10 pages × 1 s delay = ~10–15 s per cycle.
  * Cancellable; settings persisted in ``parser_incremental_sync_settings``.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

from bitmotors_scraper import (
    LIVE_SEARCH_HEADERS,
    calculate_quality,
    parse_catalogue_card,
)

logger = logging.getLogger("bitmotors.incremental")


class BitmotorsIncrementalSync:
    """Hourly top-pages scraper. No archiving, only create/update."""

    DEFAULT_SETTINGS = {
        "enabled": True,
        "interval_seconds": 3600,   # 1 h
        "pages": 10,                # top pages per cycle
        "delay_seconds": 1.0,
        "retry_on_error": 2,
        "startup_delay_seconds": 30,  # grace period on server boot
    }

    def __init__(self, db, on_new_vehicle: Optional[Callable[[Dict[str, Any]], Any]] = None):
        """`on_new_vehicle(doc)` — async callback fired on every net-new VIN."""
        self.db = db
        self.on_new_vehicle = on_new_vehicle
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._cancel_current = asyncio.Event()
        self.settings: Dict[str, Any] = dict(self.DEFAULT_SETTINGS)
        self.stats: Dict[str, Any] = {
            "is_running": False,
            "last_run_started_at": None,
            "last_run_finished_at": None,
            "last_success_at": None,
            "last_error": None,
            "last_pages_scraped": 0,
            "last_vehicles_found": 0,
            "last_new": 0,
            "last_updated": 0,
            "last_notified": 0,
            "last_errors_count": 0,
            "current_page": 0,
            "current_total_pages": 0,
            "run_count": 0,
            "total_new_cars": 0,
            "total_notifications_sent": 0,
        }

    # ── Settings persistence ─────────────────────────────
    async def load_settings(self) -> None:
        if self.db is None:
            return
        try:
            doc = await self.db.parser_incremental_sync_settings.find_one({"source": "bitmotors"})
        except Exception as e:
            logger.warning(f"[incremental] settings load failed: {e}")
            return
        if not doc:
            return
        for k in self.DEFAULT_SETTINGS:
            if k in doc:
                self.settings[k] = doc[k]
        # Clamp
        self.settings["interval_seconds"] = max(300, int(self.settings["interval_seconds"]))
        self.settings["pages"] = max(1, min(50, int(self.settings["pages"])))
        self.settings["delay_seconds"] = max(0.0, min(5.0, float(self.settings["delay_seconds"])))
        self.settings["retry_on_error"] = max(0, min(5, int(self.settings["retry_on_error"])))
        self.settings["startup_delay_seconds"] = max(0, int(self.settings["startup_delay_seconds"]))

    async def save_settings(self) -> None:
        if self.db is None:
            return
        try:
            await self.db.parser_incremental_sync_settings.update_one(
                {"source": "bitmotors"},
                {
                    "$set": {**self.settings, "updated_at": datetime.now(timezone.utc)},
                    "$setOnInsert": {"source": "bitmotors", "created_at": datetime.now(timezone.utc)},
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"[incremental] settings save failed: {e}")

    async def configure(self, **kwargs) -> Dict[str, Any]:
        for k, v in kwargs.items():
            if k in self.DEFAULT_SETTINGS and v is not None:
                self.settings[k] = v
        await self.save_settings()
        return dict(self.settings)

    # ── Scrape one page with retry ──────────────────────
    async def _scrape_page(self, client: httpx.AsyncClient, page: int) -> List[Dict[str, Any]]:
        retries = int(self.settings["retry_on_error"])
        backoff = 2.0
        last_err: Optional[Exception] = None
        for attempt in range(retries + 1):
            if self._cancel_current.is_set() or not self.running:
                return []
            try:
                url = (
                    "https://bidmotors.bg/en/catalogue"
                    if page <= 1
                    else f"https://bidmotors.bg/en/catalogue?page={page}"
                )
                resp = await client.get(url, headers=LIVE_SEARCH_HEADERS, timeout=15)
                if resp.status_code in (429, 403):
                    last_err = RuntimeError(f"HTTP {resp.status_code}")
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")
                out: List[Dict[str, Any]] = []
                for card in soup.select("article.car-card"):
                    v = parse_catalogue_card(card)
                    if v and v.get("vin"):
                        out.append(v)
                return out
            except Exception as e:
                last_err = e
                await asyncio.sleep(backoff * (2 ** attempt))
        logger.warning(f"[incremental] page {page} failed after retries: {last_err}")
        return []

    # ── Upsert one ──────────────────────────────────────
    async def _upsert(self, v: Dict[str, Any]) -> str:
        """Return 'new' | 'updated' | 'skipped'."""
        if self.db is None:
            return "skipped"
        vin = v.get("vin")
        if not vin:
            return "skipped"
        now = datetime.now(timezone.utc)
        doc = {k: val for k, val in v.items() if val is not None}
        doc["updated_at"] = now
        doc["last_seen"] = now
        doc["archived"] = False
        doc["source"] = "bitmotors"
        q, ff, conf = calculate_quality(doc)
        doc["quality"] = q
        doc["fields_filled"] = ff
        doc["confidence"] = conf
        try:
            existing = await self.db.vin_data.find_one(
                {"vin": vin}, {"_id": 0, "make": 1, "model": 1}
            )
            if existing:
                if existing.get("make") and not doc.get("make"):
                    doc.pop("make", None)
                if existing.get("model") and not doc.get("model"):
                    doc.pop("model", None)
            r = await self.db.vin_data.update_one(
                {"vin": vin},
                {"$set": doc, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )
            if r.upserted_id:
                return "new"
            if r.modified_count:
                return "updated"
            return "skipped"
        except Exception as e:
            logger.debug(f"[incremental] upsert {vin} failed: {e}")
            return "skipped"

    # ── One full cycle ──────────────────────────────────
    async def run_once(self, pages: Optional[int] = None) -> Dict[str, Any]:
        if self.stats.get("is_running"):
            return {"success": False, "error": "already_running"}
        self.stats["is_running"] = True
        self.stats["run_count"] += 1
        self.stats["current_page"] = 0
        self.stats["last_error"] = None
        self._cancel_current.clear()

        started = datetime.now(timezone.utc)
        self.stats["last_run_started_at"] = started.isoformat()

        total_pages = int(pages if pages is not None else self.settings["pages"])
        total_pages = max(1, min(50, total_pages))
        self.stats["current_total_pages"] = total_pages

        total_vehicles = 0
        total_new = 0
        total_upd = 0
        errors = 0
        total_notified = 0

        try:
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=True, headers=LIVE_SEARCH_HEADERS
            ) as client:
                for page in range(1, total_pages + 1):
                    if self._cancel_current.is_set() or not self.running:
                        break
                    vehicles = await self._scrape_page(client, page)
                    if not vehicles:
                        errors += 1
                    total_vehicles += len(vehicles)
                    for v in vehicles:
                        status = await self._upsert(v)
                        if status == "new":
                            total_new += 1
                            self.stats["total_new_cars"] += 1
                            # Fire watchlist callback
                            if self.on_new_vehicle:
                                try:
                                    notified = await self.on_new_vehicle(v)
                                    if notified:
                                        total_notified += int(notified)
                                        self.stats["total_notifications_sent"] += int(notified)
                                except Exception as e:
                                    logger.warning(f"[incremental] on_new_vehicle callback failed: {e}")
                        elif status == "updated":
                            total_upd += 1
                    self.stats["current_page"] = page
                    # Polite delay
                    if page < total_pages and not self._cancel_current.is_set():
                        await asyncio.sleep(float(self.settings["delay_seconds"]))

            finished = datetime.now(timezone.utc)
            elapsed = (finished - started).total_seconds()
            self.stats.update({
                "is_running": False,
                "last_run_finished_at": finished.isoformat(),
                "last_success_at": finished.isoformat() if not self._cancel_current.is_set() else None,
                "last_pages_scraped": self.stats["current_page"],
                "last_vehicles_found": total_vehicles,
                "last_new": total_new,
                "last_updated": total_upd,
                "last_notified": total_notified,
                "last_errors_count": errors,
                "current_page": 0,
                "current_total_pages": 0,
            })

            # Persist run history
            try:
                if self.db is not None:
                    await self.db.incremental_runs.insert_one({
                        "source": "bitmotors",
                        "started_at": started,
                        "finished_at": finished,
                        "pages": total_pages,
                        "vehicles_found": total_vehicles,
                        "new": total_new,
                        "updated": total_upd,
                        "notified": total_notified,
                        "errors": errors,
                        "elapsed_seconds": round(elapsed, 2),
                        "cancelled": self._cancel_current.is_set(),
                    })
            except Exception:
                pass

            return {
                "success": True,
                "pages": total_pages,
                "vehicles_found": total_vehicles,
                "new": total_new,
                "updated": total_upd,
                "notified": total_notified,
                "errors": errors,
                "elapsed_seconds": round(elapsed, 2),
                "cancelled": self._cancel_current.is_set(),
            }
        except Exception as e:
            logger.error(f"[incremental] fatal: {e}")
            self.stats["is_running"] = False
            self.stats["last_error"] = str(e)[:300]
            self.stats["last_run_finished_at"] = datetime.now(timezone.utc).isoformat()
            return {"success": False, "error": str(e)[:200]}

    # ── Hourly loop ─────────────────────────────────────
    async def _loop(self):
        logger.info(
            f"[incremental] loop started (every {self.settings['interval_seconds']}s, "
            f"{self.settings['pages']} pages)"
        )
        # Grace period at boot
        try:
            await asyncio.wait_for(
                self._stop.wait(),
                timeout=int(self.settings.get("startup_delay_seconds", 30)),
            )
            return
        except asyncio.TimeoutError:
            pass

        while self.running:
            try:
                if self.settings.get("enabled", True) and not self.stats.get("is_running"):
                    await self.run_once()
            except Exception as e:
                logger.warning(f"[incremental] loop error: {e}")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=int(self.settings["interval_seconds"]),
                )
                break
            except asyncio.TimeoutError:
                continue
        logger.info("[incremental] loop stopped")

    def start(self) -> Dict[str, Any]:
        if self.running:
            return {"success": False, "message": "already running"}
        self.running = True
        self._stop.clear()
        self.task = asyncio.create_task(self._loop())
        return {"success": True, "message": "incremental loop started"}

    def stop(self) -> Dict[str, Any]:
        if not self.running:
            return {"success": False, "message": "not running"}
        self.running = False
        self._stop.set()
        self._cancel_current.set()
        if self.task:
            self.task.cancel()
            self.task = None
        return {"success": True, "message": "incremental loop stopped"}

    def cancel_current(self) -> Dict[str, Any]:
        self._cancel_current.set()
        return {"success": True, "message": "current run cancelled"}

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.stats,
            "running": self.running,
            "settings": dict(self.settings),
        }
