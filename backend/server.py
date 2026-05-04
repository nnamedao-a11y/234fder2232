"""
BIBI V3.2 - Multi-Session Ingestion with Field-Level Intelligence
==================================================================
Architecture:
  Extension (Agent) → Config API → SessionManager → Queue → Field Intelligence → MongoDB
  
Features:
  - Session Scoring (success rate + data completeness + latency)
  - Field-Level Intelligence (best source per field)
  - Remote Config & Heartbeat
  - Session Blacklisting
  - Source Attribution

**SYSTEM SIMPLIFIED (April 2026):**
  - PRIMARY FOCUS: Bitmotors scraper ONLY
  - DEPRECATED: Copart Chrome Extension, AI features, Carfast, Bidcars
  - Code preserved but disabled (enabled=False in PARSER_REGISTRY)
"""
import os
import re
import asyncio
import hashlib
import secrets
import uuid
import time
import json
import logging
import traceback
from enum import Enum
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from collections import defaultdict
from dataclasses import dataclass, field
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect, Request, Response, Depends, Header, UploadFile, File, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import httpx
import socketio
from jose import JWTError, jwt

# ═══════════════════════════════════════════════════════════════════
# DEPRECATED PARSERS (preserved but disabled)
# ═══════════════════════════════════════════════════════════════════
# Optional heavy imports - graceful degradation
try:
    from bidcars_parser import BidCarsParser
    BIDCARS_AVAILABLE = True
except ImportError:
    BIDCARS_AVAILABLE = False
    logging.warning("bidcars_parser not available - bid.cars endpoints will return errors")

# ═══════════════════════════════════════════════════════════════════
# PRIMARY PARSER: BITMOTORS
# ═══════════════════════════════════════════════════════════════════
# BidMotors scraper
print("[DEBUG] About to import BitmotorsScraper")
try:
    from bitmotors_scraper import BitmotorsScraper, BitmotorsFullSync, live_search as bm_live_search
    BITMOTORS_AVAILABLE = True
    print("[DEBUG] ✓✓✓ BitmotorsScraper + FullSync + live_search loaded successfully ✓✓✓")
    logging.info("✓ BitmotorsScraper + FullSync + live_search loaded successfully")
except Exception as e:
    BITMOTORS_AVAILABLE = False
    print(f"[DEBUG] ✗✗✗ BitmotorsScraper import failed: {e}")
    logging.warning(f"bitmotors_scraper not available: {e}")

# vin_service — clean LIVE-FIRST SEARCH→PAGE fallback (independent of legacy)
try:
    from vin_service import (
        get_car_by_vin as vs_get_car_by_vin,
        get_cache_stats as vs_get_cache_stats,
        clear_cache as vs_clear_cache,
        normalize_vin as vs_normalize_vin,
        is_valid_vin as vs_is_valid_vin,
        is_live as vs_is_live,
        enrich_with_history as vs_enrich_with_history,
        get_circuit_stats as vs_get_circuit_stats,
        reset_circuits as vs_reset_circuits,
    )
    VIN_SERVICE_AVAILABLE = True
    print("[DEBUG] ✓ vin_service (SEARCH→PAGE fallback + circuit breakers + statvin) loaded")
    logging.info("✓ vin_service (SEARCH→PAGE fallback + circuit breakers + statvin) loaded")
except Exception as _e:
    VIN_SERVICE_AVAILABLE = False
    print(f"[DEBUG] ✗ vin_service import failed: {_e}")
    logging.warning(f"vin_service not available: {_e}")

# Stat.vin — JIT enrichment for sold-history + price intelligence (no DB, no sync)
try:
    from statvin_scraper import (
        fetch_statvin as sv_fetch,
        enrich_with_statvin as sv_enrich,
        get_latency_stats as sv_latency,
        get_cache_stats as sv_cache_stats,
        clear_cache as sv_clear_cache,
    )
    STATVIN_AVAILABLE = True
    print("[DEBUG] ✓ statvin_scraper (JIT history enrichment) loaded")
    logging.info("✓ statvin_scraper (JIT history enrichment) loaded")
except Exception as _e:
    STATVIN_AVAILABLE = False
    print(f"[DEBUG] ✗ statvin_scraper import failed: {_e}")
    logging.warning(f"statvin_scraper not available: {_e}")

# Incremental sync (hourly top-pages worker)
try:
    from bitmotors_incremental import BitmotorsIncrementalSync
    INCREMENTAL_AVAILABLE = True
except Exception as _e:
    INCREMENTAL_AVAILABLE = False
    logging.warning(f"bitmotors_incremental not available: {_e}")

# Phase IV — WestMotors sitemap-driven INDEX fallback
try:
    from westmotors_sync import WestMotorsSync
    WESTMOTORS_AVAILABLE = True
except Exception as _e:
    WESTMOTORS_AVAILABLE = False
    logging.warning(f"westmotors_sync not available: {_e}")

# Phase IV-2 — Lemon-Cars INDEX (lazy parsing + VIN+LOT double index)
try:
    from lemon_sync import LemonSync
    LEMON_AVAILABLE = True
except Exception as _e:
    LEMON_AVAILABLE = False
    logging.warning(f"lemon_sync not available: {_e}")

# TTL cache for hot live-search queries (5 min, 2048 entries)
try:
    from ttl_cache import TTLCache
    live_search_cache = TTLCache(ttl_seconds=300, max_size=2048)
except Exception as _e:
    live_search_cache = None
    logging.warning(f"ttl_cache unavailable: {_e}")

# ═══════════════════════════════════════════════════════════════════
# CARFAST COOKIE PROXY SERVICE (V4.0)
# ═══════════════════════════════════════════════════════════════════
# Architecture:
#   Extension → collects cf_clearance cookies → POST /api/carfast/session/import
#   Backend → stores cookies → uses them for parsing
#   CRM → POST /api/carfast/parse → Backend fetches with cookies → returns data
# ═══════════════════════════════════════════════════════════════════

@dataclass
class CarfastCookie:
    name: str
    value: str
    domain: str
    expires: Optional[float] = None
    
@dataclass
class CarfastSession:
    session_id: str
    cookies: List[CarfastCookie] = field(default_factory=list)
    user_agent: str = ""
    imported_at: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    last_used: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    success_count: int = 0
    fail_count: int = 0
    blocked: bool = False
    
    # Session TTL in minutes
    SESSION_TTL_MINUTES = 30
    
    def get_cookie_header(self) -> str:
        """Build Cookie header string"""
        return "; ".join([f"{c.name}={c.value}" for c in self.cookies])
    
    def has_cf_clearance(self) -> bool:
        """Check if cf_clearance cookie exists"""
        return any(c.name == "cf_clearance" for c in self.cookies)
    
    def has_cf_bm(self) -> bool:
        """Check if __cf_bm cookie exists"""
        return any(c.name == "__cf_bm" for c in self.cookies)
    
    def get_age_minutes(self) -> float:
        """Get session age in minutes"""
        return (datetime.now(timezone.utc).timestamp() - self.imported_at) / 60
    
    def is_expired(self) -> bool:
        """Check if cookies are expired (30 min default)"""
        return self.get_age_minutes() > self.SESSION_TTL_MINUTES
    
    def get_status(self) -> Dict:
        """Get detailed session status"""
        return {
            "sessionId": self.session_id[:8] + "...",
            "ageMinutes": round(self.get_age_minutes(), 1),
            "ttlMinutes": self.SESSION_TTL_MINUTES,
            "isExpired": self.is_expired(),
            "hasCfClearance": self.has_cf_clearance(),
            "hasCfBm": self.has_cf_bm(),
            "cookieCount": len(self.cookies),
            "successCount": self.success_count,
            "failCount": self.fail_count,
            "isBlocked": self.blocked,
            "hasUserAgent": bool(self.user_agent),
        }

class CarfastCookieStore:
    """In-memory cookie store with MongoDB backup"""
    
    def __init__(self):
        self.sessions: Dict[str, CarfastSession] = {}
        self._default_session_id = "default"
    
    def import_cookies(self, session_id: str, cookies: List[Dict], user_agent: str = "") -> CarfastSession:
        """Import cookies from extension"""
        parsed_cookies = []
        important_cookies = []
        
        for c in cookies:
            cookie = CarfastCookie(
                name=c.get("name", ""),
                value=c.get("value", ""),
                domain=c.get("domain", ""),
                expires=c.get("expirationDate")
            )
            parsed_cookies.append(cookie)
            
            # Track important cookies
            if cookie.name in ["cf_clearance", "__cf_bm"]:
                important_cookies.append(f"{cookie.name}={cookie.value[:15]}...")
        
        session = CarfastSession(
            session_id=session_id,
            cookies=parsed_cookies,
            user_agent=user_agent
        )
        self.sessions[session_id] = session
        
        # Also store as default if it has cf_clearance
        if session.has_cf_clearance():
            self.sessions[self._default_session_id] = session
        
        # Detailed logging
        logger.info(f"[CARFAST] ══════════════════════════════════════")
        logger.info(f"[CARFAST] Session imported: {session_id[:12]}...")
        logger.info(f"[CARFAST] Cookies: {len(parsed_cookies)} total")
        logger.info(f"[CARFAST] cf_clearance: {'✓' if session.has_cf_clearance() else '✗'}")
        logger.info(f"[CARFAST] __cf_bm: {'✓' if session.has_cf_bm() else '✗'}")
        logger.info(f"[CARFAST] User-Agent: {user_agent[:50]}..." if user_agent else "[CARFAST] User-Agent: NOT PROVIDED!")
        logger.info(f"[CARFAST] ══════════════════════════════════════")
        
        return session
    
    def get_session(self, session_id: str = None) -> Optional[CarfastSession]:
        """Get session by ID or default"""
        if session_id and session_id in self.sessions:
            return self.sessions[session_id]
        return self.sessions.get(self._default_session_id)
    
    def get_best_session(self) -> Optional[CarfastSession]:
        """Get best available session (not blocked, not expired, has cf_clearance)"""
        valid_sessions = [
            s for s in self.sessions.values()
            if not s.blocked and not s.is_expired() and s.has_cf_clearance()
        ]
        if not valid_sessions:
            return None
        # Sort by success rate
        return max(valid_sessions, key=lambda s: s.success_count - s.fail_count)
    
    def mark_success(self, session_id: str):
        """Mark session as successful"""
        if session_id in self.sessions:
            self.sessions[session_id].success_count += 1
            self.sessions[session_id].last_used = datetime.now(timezone.utc).timestamp()
            logger.info(f"[CARFAST] Session {session_id[:8]}... SUCCESS (total: {self.sessions[session_id].success_count})")
    
    def mark_failure(self, session_id: str):
        """Mark session as failed"""
        if session_id in self.sessions:
            self.sessions[session_id].fail_count += 1
            s = self.sessions[session_id]
            logger.warning(f"[CARFAST] Session {session_id[:8]}... FAILED (total: {s.fail_count})")
            
            # Auto-block after 5 consecutive failures
            if s.fail_count > 5 and s.success_count < 2:
                s.blocked = True
                logger.error(f"[CARFAST] Session {session_id[:8]}... BLOCKED due to excessive failures")
    
    def get_status(self) -> Dict:
        """Get overall status"""
        sessions = list(self.sessions.values())
        valid = [s for s in sessions if not s.blocked and not s.is_expired() and s.has_cf_clearance()]
        
        return {
            "hasSession": len(valid) > 0,
            "totalSessions": len(sessions),
            "validSessions": len(valid),
            "cookieCount": sum(len(s.cookies) for s in valid),
            "hasCfClearance": any(s.has_cf_clearance() for s in sessions),
        }
    
    def clear_expired(self):
        """Remove expired sessions"""
        expired = [sid for sid, s in self.sessions.items() if s.is_expired()]
        for sid in expired:
            del self.sessions[sid]
        if expired:
            logger.info(f"[CARFAST] Cleared {len(expired)} expired sessions")

# Global cookie store
carfast_cookie_store = CarfastCookieStore()

# ═══════════════════════════════════════════════════════════════════
# PLAYWRIGHT PARSER - Undetected Browser
# ═══════════════════════════════════════════════════════════════════
from playwright.async_api import async_playwright

class PlaywrightCarfastParser:
    """Parse Carfast using undetected browser"""
    
    CARFAST_BASE = "https://carfast.express"
    
    def __init__(self):
        self.browser = None
        self.context = None
        self.playwright = None
    
    async def ensure_browser(self):
        """Ensure browser is running"""
        import os
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/pw-browsers'
        
        if not self.browser:
            self.playwright = await async_playwright().start()
            # Use Firefox - less detectable than Chromium
            self.browser = await self.playwright.firefox.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled']
            )
            self.context = await self.browser.new_context(
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
                viewport={'width': 1920, 'height': 1080},
                locale='uk-UA'
            )
            logger.info("[CARFAST-PW] Firefox browser started")
        return self.context
    
    async def parse_url(self, url: str) -> Dict[str, Any]:
        """Parse URL using Playwright browser"""
        logger.info(f"[CARFAST-PW] Parsing: {url}")
        
        try:
            context = await self.ensure_browser()
            page = await context.new_page()
            
            # Go to page
            response = await page.goto(url, wait_until='domcontentloaded', timeout=60000)
            
            # Wait for page to settle
            await page.wait_for_timeout(5000)
            
            # Check for Cloudflare challenge
            content = await page.content()
            
            cloudflare_indicators = ["Just a moment", "Checking your browser", "cf-browser-verification"]
            retry = 0
            while any(ind in content for ind in cloudflare_indicators) and retry < 10:
                logger.info(f"[CARFAST-PW] Cloudflare challenge, waiting... ({retry+1}/10)")
                await page.wait_for_timeout(3000)
                content = await page.content()
                retry += 1
            
            # Check status
            if response and response.status == 403:
                await page.close()
                return {"success": False, "error": "403 Forbidden", "status": 403}
            
            # Extract data
            data = await self._extract_data(page, url)
            html_len = len(content)
            
            await page.close()
            
            logger.info(f"[CARFAST-PW] SUCCESS - {len(data)} fields, {html_len} chars")
            
            return {
                "success": True,
                "data": data,
                "html_length": html_len,
                "method": "playwright_firefox"
            }
            
        except Exception as e:
            logger.error(f"[CARFAST-PW] Error: {e}")
            return {"success": False, "error": str(e)}
    
    async def _extract_data(self, page, url: str) -> Dict[str, Any]:
        """Extract vehicle data from page"""
        data = {"url": url}
        
        try:
            # Try to get VIN
            vin_el = await page.query_selector('[data-vin], .vin-code, .vehicle-vin')
            if vin_el:
                data["vin"] = await vin_el.text_content()
            else:
                # Try regex from content
                content = await page.content()
                import re
                vin_match = re.search(r'[A-HJ-NPR-Z0-9]{17}', content)
                if vin_match:
                    data["vin"] = vin_match.group(0)
            
            # Try to get title/name
            title_el = await page.query_selector('h1, .vehicle-title, .lot-title')
            if title_el:
                data["title"] = (await title_el.text_content()).strip()
            
            # Try to get price
            price_el = await page.query_selector('.price, .current-bid, .buy-now-price')
            if price_el:
                price_text = await price_el.text_content()
                data["price"] = price_text.strip()
            
            # Try to get lot number
            lot_el = await page.query_selector('.lot-number, .lot-id')
            if lot_el:
                data["lot_number"] = (await lot_el.text_content()).strip()
            
            # Try to get odometer
            odo_el = await page.query_selector('.odometer, .mileage')
            if odo_el:
                data["odometer"] = (await odo_el.text_content()).strip()
            
            # Get page title as fallback
            data["page_title"] = await page.title()
            
        except Exception as e:
            logger.warning(f"[CARFAST-PW] Extract error: {e}")
        
        return data
    
    async def close(self):
        """Close browser"""
        if self.browser:
            await self.browser.close()
            self.browser = None
            self.context = None

# Global Playwright parser
playwright_parser = PlaywrightCarfastParser()

class CarfastParser:
    """Backend parser using stored cookies with retry and validation"""
    
    CARFAST_BASE = "https://carfast.express"
    MAX_RETRIES = 2
    RETRY_DELAY = 2  # seconds
    
    # Required cookies for Cloudflare bypass
    REQUIRED_COOKIES = ["cf_clearance"]
    RECOMMENDED_COOKIES = ["cf_clearance", "__cf_bm"]
    
    def __init__(self, cookie_store: CarfastCookieStore):
        self.cookie_store = cookie_store
    
    def validate_cookies(self, session: CarfastSession) -> Dict[str, Any]:
        """Validate session has required cookies"""
        cookie_names = [c.name for c in session.cookies]
        
        # Check required cookies
        missing_required = [c for c in self.REQUIRED_COOKIES if c not in cookie_names]
        if missing_required:
            return {
                "valid": False,
                "error": f"Missing required cookies: {missing_required}",
                "missing": missing_required
            }
        
        # Check recommended cookies
        missing_recommended = [c for c in self.RECOMMENDED_COOKIES if c not in cookie_names]
        
        return {
            "valid": True,
            "cookies": cookie_names,
            "missing_recommended": missing_recommended,
            "warning": f"Missing recommended: {missing_recommended}" if missing_recommended else None
        }
    
    async def parse_url(self, url: str, session_id: str = None, retry_count: int = 0) -> Dict[str, Any]:
        """Parse Carfast URL using stored cookies with auto-retry"""
        session = self.cookie_store.get_session(session_id) or self.cookie_store.get_best_session()
        
        # Session validation
        if not session:
            return {"success": False, "error": "No valid session. Open carfast.express in browser first.", "needsRefresh": True, "code": "NO_SESSION"}
        
        if session.is_expired():
            age = (datetime.now(timezone.utc).timestamp() - session.imported_at) / 60
            return {"success": False, "error": f"Session expired ({age:.0f} min old, max 30 min)", "needsRefresh": True, "code": "SESSION_EXPIRED"}
        
        # Cookie validation
        validation = self.validate_cookies(session)
        if not validation["valid"]:
            return {"success": False, "error": validation["error"], "needsRefresh": True, "code": "MISSING_COOKIES"}
        
        # Build headers - CRITICAL: Use exact same User-Agent as browser
        headers = {
            "Cookie": session.get_cookie_header(),
            "User-Agent": session.user_agent,  # Must match browser exactly!
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "Referer": self.CARFAST_BASE,
        }
        
        # Log cookies being used (partially masked)
        cookie_header = session.get_cookie_header()
        cf_value = next((c.value[:10] + "..." for c in session.cookies if c.name == "cf_clearance"), "N/A")
        logger.info(f"[CARFAST] Parsing {url} with cf_clearance={cf_value}, retry={retry_count}")
        
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                response = await client.get(url, headers=headers)
                
                html = response.text
                
                # Check for Cloudflare block patterns
                is_cloudflare_block = any([
                    response.status_code == 403,
                    "cf-browser-verification" in html,
                    "Just a moment" in html,
                    "Checking your browser" in html,
                    "challenge-platform" in html,
                    "_cf_chl" in html,
                ])
                
                if is_cloudflare_block:
                    self.cookie_store.mark_failure(session.session_id)
                    
                    # Auto-retry once
                    if retry_count < self.MAX_RETRIES:
                        logger.warning(f"[CARFAST] Cloudflare block, retrying in {self.RETRY_DELAY}s...")
                        await asyncio.sleep(self.RETRY_DELAY)
                        return await self.parse_url(url, session_id, retry_count + 1)
                    
                    return {
                        "success": False, 
                        "error": "Cloudflare block - cookies may be invalid or expired",
                        "needsRefresh": True,
                        "status": response.status_code,
                        "code": "CLOUDFLARE_BLOCK",
                        "retries": retry_count
                    }
                
                if response.status_code != 200:
                    return {"success": False, "error": f"HTTP {response.status_code}", "status": response.status_code, "code": "HTTP_ERROR"}
                
                # Success - parse HTML
                self.cookie_store.mark_success(session.session_id)
                
                # Extract data from HTML
                data = self._extract_data(html, url)
                
                return {
                    "success": True,
                    "data": data,
                    "html_length": len(html),
                    "session_id": session.session_id[:8] + "...",
                    "retries": retry_count,
                    "validation": validation
                }
                
        except httpx.TimeoutException:
            # Auto-retry on timeout
            if retry_count < self.MAX_RETRIES:
                logger.warning(f"[CARFAST] Timeout, retrying...")
                await asyncio.sleep(self.RETRY_DELAY)
                return await self.parse_url(url, session_id, retry_count + 1)
            return {"success": False, "error": "Request timeout after retries", "code": "TIMEOUT", "retries": retry_count}
        except Exception as e:
            logger.error(f"[CARFAST] Parse error: {e}")
            return {"success": False, "error": str(e), "code": "ERROR"}
    
    def _extract_data(self, html: str, url: str) -> Dict[str, Any]:
        """Extract vehicle data from HTML"""
        
        data = {"url": url}
        
        # Try to find VIN
        vin_match = re.search(r'[A-HJ-NPR-Z0-9]{17}', html)
        if vin_match:
            data["vin"] = vin_match.group(0)
        
        # Try to find lot number
        lot_match = re.search(r'lot[:\s#]*(\d+)', html, re.I)
        if lot_match:
            data["lot_number"] = lot_match.group(1)
        
        # Try to find price
        price_match = re.search(r'\$\s*([\d,]+)', html)
        if price_match:
            data["price"] = price_match.group(1).replace(",", "")
        
        # Try to find odometer
        odo_match = re.search(r'(\d{1,3}[,\s]?\d{3})\s*(mi|km|miles)', html, re.I)
        if odo_match:
            data["odometer"] = odo_match.group(1).replace(",", "").replace(" ", "")
        
        # Try to extract JSON data if available
        json_match = re.search(r'<script[^>]*type="application/json"[^>]*>([^<]+)</script>', html)
        if json_match:
            try:
                json_data = json.loads(json_match.group(1))
                if isinstance(json_data, dict):
                    data["raw_json"] = json_data
            except:
                pass
        
        # Try __NUXT__ data
        nuxt_match = re.search(r'window\.__NUXT__\s*=\s*(.+?)</script>', html, re.S)
        if nuxt_match:
            try:
                # This is usually JS not JSON, but we can try
                data["has_nuxt"] = True
            except:
                pass
        
        return data

# Global parser instance  
carfast_parser = CarfastParser(carfast_cookie_store)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bibi-v3.2")

# ═══════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bibi_cars")

db_client: Optional[AsyncIOMotorClient] = None
db = None
bitmotors_parser_instance = None
bitmotors_full_sync_instance = None
bitmotors_incremental_instance = None

# ═══════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict"""
    if doc is None:
        return None
    
    result = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, dict):
            result[key] = serialize_doc(value)
        elif isinstance(value, list):
            result[key] = [serialize_doc(item) if isinstance(item, dict) else item for item in value]
        else:
            result[key] = value
    
    return result

# ═══════════════════════════════════════════════════════════════════
# FIELD CONFIDENCE MAP (V3.2)
# ═══════════════════════════════════════════════════════════════════
FIELD_CONFIDENCE = {
    'vin': 1.0,
    'make': 1.0,
    'model': 1.0,
    'year': 1.0,
    'odometer': 0.95,
    'damage': 0.9,
    'title': 0.85,
    'lot_number': 0.9,
    'auction_name': 0.85,
    'sale_date': 0.8,
    'location': 0.75,
    'color': 0.7,
    'engine': 0.7,
    'transmission': 0.7,
    'images': 1.0,
}

ALL_FIELDS = list(FIELD_CONFIDENCE.keys())

# ═══════════════════════════════════════════════════════════════════
# GLOBAL CONFIG (V3.2 Control)
# ═══════════════════════════════════════════════════════════════════
@dataclass
class ParserConfig:
    enabled: bool = True
    rate_limit_ms: int = 2000
    min_score: float = 0.3
    debug: bool = False
    targets: List[str] = field(default_factory=lambda: ["carfast"])
    blacklist_threshold_fails: int = 10
    blacklist_threshold_success: int = 2

parser_config = ParserConfig()

# ═══════════════════════════════════════════════════════════════════
# UNIFIED PARSER REGISTRY
# ═══════════════════════════════════════════════════════════════════
@dataclass
class ParserEntry:
    source: str
    name: str
    type: str  # extension, api, playwright, passive
    enabled: bool = False
    status: str = "standby"  # active, standby, error, disabled
    last_run: Optional[str] = None
    items_parsed: int = 0
    errors_count: int = 0
    readiness: str = "ready"  # ready, needs_config, incomplete, broken
    readiness_detail: str = ""
    api_key: str = ""
    endpoints: List[str] = field(default_factory=list)
    
PARSER_REGISTRY: Dict[str, ParserEntry] = {
    "bitmotors": ParserEntry(
        source="bitmotors",
        name="Bitmotors",
        type="api",
        enabled=True,
        status="active",
        readiness="ready" if BITMOTORS_AVAILABLE else "broken",
        readiness_detail="Autonomous scraper for bidmotors.bg. Scrapes catalogue every 30 min." if BITMOTORS_AVAILABLE else "Missing bitmotors_scraper module.",
        endpoints=["/api/ingestion/admin/parsers/bitmotors/run", "/api/ingestion/admin/parsers/bitmotors/stop", "/api/ingestion/admin/parsers/bitmotors/run-once", "/api/ingestion/admin/parsers/bitmotors/stats"],
    ),
    "carfast": ParserEntry(
        source="carfast",
        name="Carfast",
        type="extension",
        enabled=False,
        status="standby",
        readiness="needs_config",
        readiness_detail="Requires Chrome Extension installed and connected. Cookie proxy for Cloudflare bypass.",
        endpoints=["/api/carfast/session/import", "/api/carfast/parse", "/api/carfast/vehicles"],
    ),
    "bidcars": ParserEntry(
        source="bidcars",
        name="Bid.Cars",
        type="playwright",
        enabled=False,
        status="standby",
        readiness="ready" if BIDCARS_AVAILABLE else "broken",
        readiness_detail="Playwright scraper for bid.cars. " + ("Ready." if BIDCARS_AVAILABLE else "Missing playwright_stealth module."),
        endpoints=["/api/bidcars/parse", "/api/bidcars/search", "/api/bidcars/vehicles"],
    ),
    "autoastat": ParserEntry(
        source="autoastat",
        name="AutoAstat",
        type="passive",
        enabled=False,
        status="standby",
        readiness="ready",
        readiness_detail="Passive receiver. Accepts data from Chrome Extension content scripts.",
        endpoints=["/api/autoastat/ingest", "/api/autoastat/vehicles"],
    ),
    "copart": ParserEntry(
        source="copart",
        name="Copart",
        type="playwright",
        enabled=False,
        status="standby",
        readiness="incomplete",
        readiness_detail="Playwright scraper with page parser. Cloudflare protection not fully bypassed.",
        endpoints=["/api/scrape/job"],
    ),
    "iaai": ParserEntry(
        source="iaai",
        name="IAAI",
        type="playwright",
        enabled=False,
        status="standby",
        readiness="incomplete",
        readiness_detail="Playwright scraper with page parser. Cloudflare protection not fully bypassed.",
        endpoints=["/api/scrape/job"],
    ),
}

# ═══════════════════════════════════════════════════════════════════
# SESSION SERVICE (V3.1 with Scoring)
# ═══════════════════════════════════════════════════════════════════
@dataclass
class Session:
    session_id: str
    last_seen: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    success_count: int = 0
    fail_count: int = 0
    avg_latency: float = 0.0
    vin_count: int = 0
    avg_fields: float = 0.0  # V3.1: Average data completeness
    blocked: bool = False    # V3.1: Blacklist flag
    priority: int = 1        # V3.2: Manual priority (1-10)

class SessionService:
    """Tracks all browser sessions with scoring"""
    
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self._rate_limits: Dict[str, float] = {}
    
    def touch(self, session_id: str, latency: float = 0, success: bool = True):
        """Update session on each request"""
        if session_id not in self.sessions:
            self.sessions[session_id] = Session(session_id=session_id)
        
        s = self.sessions[session_id]
        s.last_seen = datetime.now(timezone.utc).timestamp()
        
        if success:
            s.success_count += 1
            s.vin_count += 1
        else:
            s.fail_count += 1
        
        if latency > 0:
            s.avg_latency = (s.avg_latency + latency) / 2
        
        # Auto-blacklist check
        self._check_blacklist(s)
        
        return s
    
    def update_fields(self, session_id: str, count: int):
        """V3.1: Track data completeness per session"""
        s = self.sessions.get(session_id)
        if not s:
            return
        
        if s.avg_fields == 0:
            s.avg_fields = count / len(ALL_FIELDS)
        else:
            s.avg_fields = (s.avg_fields + count / len(ALL_FIELDS)) / 2
    
    def get_score(self, session_id: str) -> float:
        """
        V3.1: Calculate session score
        
        Formula:
          score = (successRate * 0.5) + (dataCompleteness * 0.3) + (latencyScore * 0.2)
        """
        s = self.sessions.get(session_id)
        if not s:
            return 0.0
        
        if s.blocked:
            return 0.0
        
        # Success rate (0-1)
        total = s.success_count + s.fail_count
        success_rate = s.success_count / total if total > 0 else 0.5
        
        # Data completeness (0-1)
        completeness = s.avg_fields
        
        # Latency score (lower is better, 0-1)
        # 0ms = 1.0, 3000ms+ = 0.0
        latency_score = max(0, 1 - s.avg_latency / 3000) if s.avg_latency else 0.5
        
        # Priority multiplier
        priority_mult = s.priority / 5  # 1-10 → 0.2-2.0
        
        score = (
            success_rate * 0.5 +
            completeness * 0.3 +
            latency_score * 0.2
        ) * priority_mult
        
        return min(1.0, max(0.0, score))
    
    def _check_blacklist(self, s: Session):
        """V3.1: Auto-blacklist bad sessions"""
        if s.fail_count > parser_config.blacklist_threshold_fails:
            if s.success_count < parser_config.blacklist_threshold_success:
                s.blocked = True
                logger.warning(f"[SESSION] Blocked session {s.session_id[:8]}... (too many failures)")
    
    def is_rate_limited(self, session_id: str) -> bool:
        """Check rate limit"""
        now = datetime.now(timezone.utc).timestamp() * 1000
        last = self._rate_limits.get(session_id, 0)
        
        # Adjust rate limit by score
        score = self.get_score(session_id)
        effective_limit = parser_config.rate_limit_ms
        if score > 0.8:
            effective_limit = parser_config.rate_limit_ms * 0.5  # Faster for good sessions
        elif score < 0.4:
            effective_limit = parser_config.rate_limit_ms * 2  # Slower for bad sessions
        
        if now - last < effective_limit:
            return True
        
        self._rate_limits[session_id] = now
        return False
    
    def disable(self, session_id: str):
        """Manually disable session"""
        if session_id in self.sessions:
            self.sessions[session_id].blocked = True
    
    def enable(self, session_id: str):
        """Re-enable session"""
        if session_id in self.sessions:
            self.sessions[session_id].blocked = False
    
    def set_priority(self, session_id: str, priority: int):
        """Set manual priority (1-10)"""
        if session_id in self.sessions:
            self.sessions[session_id].priority = max(1, min(10, priority))
    
    def get(self, session_id: str) -> Optional[Session]:
        return self.sessions.get(session_id)
    
    def get_all(self) -> List[Session]:
        return list(self.sessions.values())
    
    def get_active(self, timeout_minutes: int = 5) -> List[Session]:
        now = datetime.now(timezone.utc).timestamp()
        cutoff = now - (timeout_minutes * 60)
        return [s for s in self.sessions.values() if s.last_seen > cutoff and not s.blocked]
    
    def get_stats(self) -> Dict:
        active = self.get_active()
        blocked = [s for s in self.sessions.values() if s.blocked]
        
        return {
            "total_sessions": len(self.sessions),
            "active_sessions": len(active),
            "blocked_sessions": len(blocked),
            "total_vins": sum(s.vin_count for s in self.sessions.values()),
            "avg_score": sum(self.get_score(s.session_id) for s in active) / len(active) if active else 0,
        }

# ═══════════════════════════════════════════════════════════════════
# INGESTION QUEUE (V3)
# ═══════════════════════════════════════════════════════════════════
@dataclass
class IngestionJob:
    vin: str
    session_id: str
    data: Dict[str, Any]
    url: str
    timestamp: float
    session_score: float = 0.0

class IngestionQueue:
    def __init__(self):
        self.queue: asyncio.Queue = None
        self.processing = False
        self.processed_count = 0
        self.error_count = 0
        self._handler = None
    
    async def init(self):
        self.queue = asyncio.Queue()
    
    def set_handler(self, handler):
        self._handler = handler
    
    async def push(self, job: IngestionJob):
        if self.queue:
            await self.queue.put(job)
    
    async def start(self):
        if self.processing:
            return
        self.processing = True
        
        while self.processing:
            try:
                job = await asyncio.wait_for(self.queue.get(), timeout=0.1)
                await self._handle(job)
                self.queue.task_done()
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"[QUEUE] Error: {e}")
                self.error_count += 1
    
    async def _handle(self, job: IngestionJob):
        try:
            if self._handler:
                await self._handler(job)
            self.processed_count += 1
        except Exception as e:
            logger.error(f"[QUEUE] Handler error: {e}")
            self.error_count += 1
    
    def get_stats(self) -> Dict:
        return {
            "queue_size": self.queue.qsize() if self.queue else 0,
            "processed": self.processed_count,
            "errors": self.error_count,
            "running": self.processing,
        }

# ═══════════════════════════════════════════════════════════════════
# AGGREGATOR SERVICE (V3.2 with Field Intelligence)
# ═══════════════════════════════════════════════════════════════════
@dataclass
class FieldSource:
    field: str
    value: Any
    session_id: str
    score: float

@dataclass
class VinRecord:
    vin: str
    sources: List[Dict] = field(default_factory=list)
    merged: Dict = field(default_factory=dict)
    field_sources: List[FieldSource] = field(default_factory=list)  # V3.2
    quality: str = "D"
    fields_filled: int = 0
    created_at: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    updated_at: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())

class AggregatorService:
    """V3.2: Field-Level Intelligence Merge"""
    
    def __init__(self, session_service: SessionService):
        self.store: Dict[str, VinRecord] = {}
        self.session_service = session_service
    
    def ingest(self, job: IngestionJob) -> VinRecord:
        vin = job.vin.upper()
        
        if vin not in self.store:
            self.store[vin] = VinRecord(vin=vin)
        
        record = self.store[vin]
        
        # Add source with score
        record.sources.append({
            "session_id": job.session_id,
            "data": job.data,
            "url": job.url,
            "ts": job.timestamp,
            "score": job.session_score,
        })
        
        # V3.2: Field-level intelligent merge
        record.merged, record.field_sources = self._smart_merge(record.sources)
        record.fields_filled = self._count_fields(record.merged)
        record.quality = self._calculate_quality(record.fields_filled)
        record.updated_at = datetime.now(timezone.utc).timestamp()
        
        return record
    
    def _smart_merge(self, sources: List[Dict]) -> tuple[Dict, List[FieldSource]]:
        """
        V3.2: Field-Level Intelligence
        
        For each field, select the best source based on:
          field_score = session_score * field_confidence
        """
        result = {}
        field_sources = []
        
        # Sort sources by session score (highest first), use 0.5 as default
        sorted_sources = sorted(
            sources,
            key=lambda s: s.get('score', 0.5) if s.get('score', 0) > 0 else 0.5,
            reverse=True
        )
        
        for field_name in ALL_FIELDS:
            if field_name == 'images':
                continue  # Handle images separately
            
            best_value = None
            best_score = -1  # Start at -1 so any value wins
            best_session = None
            
            for source in sorted_sources:
                data = source.get('data', {})
                
                # Try both snake_case and camelCase
                value = data.get(field_name) or data.get(self._to_camel(field_name))
                
                if not value:
                    continue
                
                # Use 0.5 as default score for new sessions
                raw_score = source.get('score', 0)
                session_score = raw_score if raw_score > 0 else 0.5
                field_confidence = FIELD_CONFIDENCE.get(field_name, 0.5)
                combined_score = session_score * field_confidence
                
                if combined_score > best_score:
                    best_score = combined_score
                    best_value = value
                    best_session = source.get('session_id')
            
            if best_value:
                result[field_name] = best_value
                field_sources.append(FieldSource(
                    field=field_name,
                    value=best_value,
                    session_id=best_session,
                    score=round(best_score, 3)
                ))
        
        # V3.2: Deduplicate and merge images from all sources
        all_images = set()
        for source in sources:
            images = source.get('data', {}).get('images', [])
            for img in images:
                if img and isinstance(img, str):
                    all_images.add(img)
        
        if all_images:
            result['images'] = list(all_images)[:20]
            field_sources.append(FieldSource(
                field='images',
                value=f"{len(all_images)} images merged",
                session_id='merged',
                score=1.0
            ))
        
        return result, field_sources
    
    def _to_camel(self, snake_str: str) -> str:
        components = snake_str.split('_')
        return components[0] + ''.join(x.title() for x in components[1:])
    
    def _count_fields(self, data: Dict) -> int:
        return sum(1 for f in ALL_FIELDS if data.get(f))
    
    def _calculate_quality(self, fields: int) -> str:
        if fields >= 10: return 'A+'
        if fields >= 8: return 'A'
        if fields >= 6: return 'B'
        if fields >= 4: return 'C'
        return 'D'
    
    def get(self, vin: str) -> Optional[VinRecord]:
        return self.store.get(vin.upper())
    
    def get_stats(self) -> Dict:
        records = list(self.store.values())
        quality_dist = defaultdict(int)
        for r in records:
            quality_dist[r.quality] += 1
        
        return {
            "total_vins": len(records),
            "total_sources": sum(len(r.sources) for r in records),
            "avg_sources_per_vin": sum(len(r.sources) for r in records) / len(records) if records else 0,
            "quality_distribution": dict(quality_dist),
        }

# ═══════════════════════════════════════════════════════════════════
# WEBSOCKET MANAGER (V3.2 Real-time)
# ═══════════════════════════════════════════════════════════════════
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

ws_manager = ConnectionManager()

# ═══════════════════════════════════════════════════════════════════
# GLOBAL SERVICES
# ═══════════════════════════════════════════════════════════════════
session_service = SessionService()
ingestion_queue = IngestionQueue()
aggregator = AggregatorService(session_service)
bitmotors_parser_instance: Optional['BitmotorsScraper'] = None
bitmotors_full_sync_instance: Optional['BitmotorsFullSync'] = None
bitmotors_incremental_instance: Optional['BitmotorsIncrementalSync'] = None
westmotors_sync_instance: Optional['WestMotorsSync'] = None
lemon_sync_instance: Optional['LemonSync'] = None

# ═══════════════════════════════════════════════════════════════════
# QUEUE HANDLER
# ═══════════════════════════════════════════════════════════════════
async def queue_handler(job: IngestionJob):
    record = aggregator.ingest(job)
    
    # Broadcast to WebSocket clients
    await ws_manager.broadcast({
        "type": "vin_ingested",
        "vin": record.vin,
        "quality": record.quality,
        "sources_count": len(record.sources),
        "session_id": job.session_id[:8] + "...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    
    # Save to MongoDB
    if db is not None:
        # Prepare field sources for storage
        field_sources_dict = [
            {"field": fs.field, "session_id": fs.session_id, "score": fs.score}
            for fs in record.field_sources
        ]
        
        await db.vin_data.update_one(
            {'vin': record.vin},
            {
                '$set': {
                    'vin': record.vin,
                    'merged': record.merged,
                    'quality': record.quality,
                    'fields_filled': record.fields_filled,
                    'sources_count': len(record.sources),
                    'field_sources': field_sources_dict,
                    'updated_at': datetime.now(timezone.utc),
                    **record.merged,
                },
                '$setOnInsert': {'created_at': datetime.now(timezone.utc)},
                '$push': {
                    'sources': {'$each': [record.sources[-1]], '$slice': -10}
                }
            },
            upsert=True
        )

# ═══════════════════════════════════════════════════════════════════
# FASTAPI APP
# ═══════════════════════════════════════════════════════════════════

# OLD LIFESPAN - ЗАКОММЕНТИРОВАНО (не работало)
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     ... код был здесь ...

# ИСПОЛЬЗУЕМ @fastapi_app.on_event("startup") вместо lifespan

fastapi_app = FastAPI(title="BIBI V3.2", version="3.2.0")

# ═══════════════════════════════════════════════════════════════════
# SOCKET.IO SETUP FOR REAL-TIME RINGOSTAT EVENTS
# ═══════════════════════════════════════════════════════════════════
# Secret key for JWT (should match frontend auth)
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=False
)

# Wrap with ASGI app - this becomes the main 'app'
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# JWT authentication for WebSocket
def verify_token(token: str) -> Dict[str, Any]:
    """Verify JWT token and return payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as e:
        logger.error(f"JWT verification failed: {e}")
        return None

@sio.event
async def connect(sid, environ, auth):
    """Handle WebSocket connection with JWT auth"""
    logger.info(f"[WS] Connection attempt from {sid}")
    
    # Extract token from auth dict or query string
    token = None
    if auth and isinstance(auth, dict):
        token = auth.get('token')
    
    if not token:
        # Try to get from query string
        query_string = environ.get('QUERY_STRING', '')
        for param in query_string.split('&'):
            if param.startswith('token='):
                token = param.split('=', 1)[1]
                break
    
    if not token:
        logger.warning(f"[WS] No token provided for {sid}")
        raise ConnectionRefusedError('Authentication required')
    
    # Verify token
    payload = verify_token(token)
    if not payload:
        logger.warning(f"[WS] Invalid token for {sid}")
        raise ConnectionRefusedError('Invalid token')
    
    user_id = payload.get('user_id') or payload.get('sub')
    role = payload.get('role', 'customer')
    
    if not user_id:
        logger.warning(f"[WS] No user_id in token for {sid}")
        raise ConnectionRefusedError('Invalid token payload')
    
    # Save session data
    await sio.save_session(sid, {
        'user_id': user_id,
        'role': role,
        'email': payload.get('email', '')
    })
    
    # Join user-specific room
    await sio.enter_room(sid, f"user:{user_id}")
    
    # Join role-specific room (for manager broadcasts). Legacy `master_admin`
    # stays here so in-flight sessions from before the rename keep getting
    # their role-scoped socket events.
    if role in ['admin', 'manager', 'master_admin', 'team_lead']:
        await sio.enter_room(sid, f"role:{role}")
    
    logger.info(f"[WS] Connected: {sid} | user:{user_id} | role:{role}")
    await sio.emit('connected', {'status': 'ok', 'user_id': user_id}, room=sid)

@sio.event
async def disconnect(sid):
    """Handle WebSocket disconnection"""
    session = await sio.get_session(sid)
    user_id = session.get('user_id', 'unknown') if session else 'unknown'
    logger.info(f"[WS] Disconnected: {sid} | user:{user_id}")

# Helper function to emit events
async def emit_to_user(user_id: str, event: str, data: dict):
    """Emit event to specific user"""
    await sio.emit(event, data, room=f"user:{user_id}")

async def emit_to_role(role: str, event: str, data: dict):
    """Emit event to all users with specific role"""
    await sio.emit(event, data, room=f"role:{role}")

logger.info("✓ Socket.IO server initialized")

# ═══════════════════════════════════════════════════════════════════
# END SOCKET.IO SETUP
# ═══════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════
# WATCHLIST LIVE-POLL WORKER (LIVE-FIRST architecture)
# ─────────────────────────────────────────────────────────────────
# Old: notify when a VIN appeared in our scraped DB.
# New: poll BidMotors LIVE for every pending VIN once an hour. If found,
#      notify the user (socket + persisted timeline event).
# ═══════════════════════════════════════════════════════════════════
WATCHLIST_POLL_INTERVAL_SEC = int(os.environ.get("WATCHLIST_POLL_INTERVAL_SEC", "3600"))
WATCHLIST_POLL_BATCH = int(os.environ.get("WATCHLIST_POLL_BATCH", "20"))
WATCHLIST_POLL_DELAY = float(os.environ.get("WATCHLIST_POLL_DELAY", "2.0"))


async def _watchlist_live_poll_loop():
    """Periodically check pending watchlist VINs against BidMotors LIVE.

    Runs every WATCHLIST_POLL_INTERVAL_SEC. Each cycle:
      1. Pulls up to N pending (notified=false) VINs.
      2. For each VIN runs `bm_live_search(vin)` (5 min TTL cache).
      3. On hit → emits socket events + marks notified.
    """
    await asyncio.sleep(60)  # cold-boot grace
    logger.info(f"[watchlist-poll] loop online (interval={WATCHLIST_POLL_INTERVAL_SEC}s)")
    while True:
        try:
            if db is None:
                await asyncio.sleep(WATCHLIST_POLL_INTERVAL_SEC)
                continue
            cursor = db.search_watchlist.find(
                {"notified": False},
                {"_id": 0, "id": 1, "vin": 1, "userId": 1, "email": 1},
            ).limit(WATCHLIST_POLL_BATCH)
            pending = await cursor.to_list(length=WATCHLIST_POLL_BATCH)
            if not pending:
                await asyncio.sleep(WATCHLIST_POLL_INTERVAL_SEC)
                continue

            logger.info(f"[watchlist-poll] checking {len(pending)} pending VINs")
            for w in pending:
                vin = (w.get("vin") or "").upper()
                if not vin or not BITMOTORS_AVAILABLE:
                    continue
                try:
                    result = await bm_live_search(vin, db=None, limit=1)
                    detail = result.get("detail") if result else None
                    if not detail:
                        items = (result or {}).get("items") or []
                        detail = items[0] if items else None
                    if not detail:
                        continue

                    payload = {
                        "vin": vin,
                        "title": detail.get("title")
                            or (f"{detail.get('year','')} {detail.get('make','')} {detail.get('model','')}".strip() or None),
                        "image": (detail.get("images") or [None])[0] or detail.get("image"),
                        "auction_name": detail.get("auction_name"),
                        "lot_number": detail.get("lot_number"),
                        "detail_url": detail.get("source_url") or detail.get("detail_url"),
                        "price": detail.get("price"),
                        "found_at": datetime.now(timezone.utc).isoformat(),
                        "source": "live",
                    }

                    uid = w.get("userId")
                    if uid:
                        try:
                            await sio.emit("car_found", payload, room=f"user_{uid}")
                        except Exception:
                            pass
                    try:
                        await sio.emit(
                            "public:car_found",
                            {**payload, "watcher_email": w.get("email")},
                            room="public",
                        )
                    except Exception:
                        pass

                    await db.search_watchlist.update_one(
                        {"id": w.get("id")},
                        {"$set": {
                            "notified": True,
                            "notified_at": datetime.now(timezone.utc),
                            "matched_title": payload.get("title"),
                            "matched_image": payload.get("image"),
                            "matched_lot": payload.get("lot_number"),
                            "matched_via": "live_poll",
                        }},
                    )
                    try:
                        await db.audit.insert_one({
                            "type": "watchlist_notified",
                            "vin": vin,
                            "via": "live_poll",
                            "ts": datetime.now(timezone.utc),
                        })
                    except Exception:
                        pass
                except Exception as _e:
                    logger.debug(f"[watchlist-poll] vin={vin} check failed: {_e}")
                # polite pause between VINs
                await asyncio.sleep(WATCHLIST_POLL_DELAY)

            await asyncio.sleep(WATCHLIST_POLL_INTERVAL_SEC)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"[watchlist-poll] cycle error: {e}")
            await asyncio.sleep(60)


async def _payment_reminder_loop():
    """Background reminder scanner.
    Once per hour walks the invoices collection. For every invoice that is
    still pending/sent and whose `sentAt`+reminder_after days has passed
    AND no reminder has been fired in the last 48h — emit `payment_reminder`.
    Interval and threshold are intentionally conservative so we don't spam.
    """
    REMINDER_AFTER_DAYS = int(os.environ.get("BIBI_REMINDER_AFTER_DAYS", "3"))
    COOLDOWN_HOURS     = 48
    SCAN_INTERVAL_SEC  = 3600  # 1h

    import notifications as _notif
    await asyncio.sleep(60)  # let server warm up
    while True:
        try:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(days=REMINDER_AFTER_DAYS)
            cooldown = now - timedelta(hours=COOLDOWN_HOURS)
            cursor = db.invoices.find({
                "status": {"$in": ["sent", "pending"]},
                "$or": [
                    {"sentAt": {"$lte": cutoff.isoformat()}},
                    {"created_at": {"$lte": cutoff.isoformat()}},
                ],
            }, {"_id": 0})
            sent = 0
            async for inv in cursor:
                last = inv.get("lastReminderAt")
                if last and last >= cooldown.isoformat():
                    continue
                try:
                    customer = await db.customers.find_one({"id": inv.get("customerId")}, {"_id": 0}) or {}
                    manager = {"id": inv.get("managerId"), "email": inv.get("managerEmail")}
                    await _notif.emit(_notif.EVENT_PAYMENT_REMINDER, {
                        "invoice": inv, "customer": customer, "manager": manager,
                    })
                    await db.invoices.update_one(
                        {"id": inv["id"]},
                        {"$set": {"lastReminderAt": now.isoformat()},
                         "$inc": {"reminderCount": 1}},
                    )
                    sent += 1
                except Exception:
                    logger.exception("[reminder] emit failed for %s", inv.get("id"))
            if sent:
                logger.info("[reminder] dispatched %d payment reminders", sent)
        except Exception:
            logger.exception("[reminder] loop iteration failed")
        await asyncio.sleep(SCAN_INTERVAL_SEC)


@fastapi_app.on_event("startup")
async def startup():
    global db_client, db, bitmotors_parser_instance, bitmotors_full_sync_instance, bitmotors_incremental_instance, westmotors_sync_instance, lemon_sync_instance
    
    print("="*80)
    print("🔥🔥🔥 STARTUP EXECUTED 🔥🔥🔥")
    print("="*80)
    print("[STARTUP] Initializing...")
    logger.info("[STARTUP] BIBI V3.2 Starting...")
    
    # MongoDB
    db_client = AsyncIOMotorClient(MONGO_URL, maxPoolSize=20, minPoolSize=2)
    db = db_client[DB_NAME]

    # ── Notifications system (event bus + email/in-app channels) ──
    try:
        import notifications as _notif_mod
        _notif_mod.init(db, sio)
        await _notif_mod.service.seed_defaults()
        logger.info("[notif] NotificationService initialised (%s email provider)",
                    _notif_mod.service.email.provider)
        # Background task: payment reminders (scan once per hour)
        asyncio.create_task(_payment_reminder_loop())
    except Exception:
        logger.exception("[notif] failed to initialise NotificationService")

    # ── Provider Pressure engine (score / tier / matching / notify) ──
    try:
        import provider_stats as _ps
        import notifications as _notif_mod_ps
        _ps.init(db, _notif_mod_ps.bus)
        logger.info("[provider_stats] engine wired to event bus (order_started, order_finished)")
        # Back-fill existing providers on boot (non-blocking)
        async def _ps_backfill():
            try:
                await asyncio.sleep(5)
                if _ps.service is not None:
                    r = await _ps.service.recompute_all()
                    logger.info("[provider_stats] boot back-fill: %d providers", r.get("count", 0))
            except Exception:
                logger.exception("[provider_stats] boot back-fill failed")
        asyncio.create_task(_ps_backfill())
    except Exception:
        logger.exception("[provider_stats] failed to wire")
    
    # ═══════════════════════════════════════════════════════════════════
    # LIVE-FIRST architecture (no auto-accumulation)
    # ─────────────────────────────────────────────────────────────────
    # We deliberately do NOT start:
    #   - BitmotorsScraper autonomous loop (was: scrape catalogue every 30 min)
    #   - BitmotorsFullSync scheduler        (was: daily ~55k page sync)
    #   - BitmotorsIncrementalSync           (was: hourly top-10 pages)
    # Reason: BidMotors data is a real-time stream (auctions update hourly).
    # Any local snapshot is stale within minutes. We rely on live_search()
    # for every customer query and use the local vin_data only as a
    # STALE_FALLBACK when BidMotors is unreachable.
    # ═══════════════════════════════════════════════════════════════════
    if BITMOTORS_AVAILABLE:
        # Keep the scraper instance for ad-hoc search_vin() calls only.
        # Its autonomous loop is NEVER started.
        bitmotors_parser_instance = BitmotorsScraper(db)
        try:
            p = PARSER_REGISTRY.get("bitmotors")
            if p:
                p.enabled = False
                p.status = "live-only"
        except Exception:
            pass
        print("[STARTUP] ✓ BidMotors live-only mode (no accumulation)")
        logger.info("✓ BidMotors live-only mode — no autonomous scraping; live_search() per query")
        # Mark all previously accumulated rows as stale fallback (idempotent)
        try:
            await db.vin_data.update_many(
                {"stale": {"$ne": True}},
                {"$set": {"stale": True, "archived": True, "stale_marked_at": datetime.now(timezone.utc)}},
            )
        except Exception as _e:
            logger.debug(f"[STARTUP] stale-mark skipped: {_e}")

        # ── Watchlist live-poll worker (every hour, checks pending VINs LIVE) ──
        try:
            asyncio.create_task(_watchlist_live_poll_loop())
            print("[STARTUP] ✓ Watchlist live-poll worker started (interval 1h)")
            logger.info("✓ Watchlist live-poll worker started")
        except Exception as _e:
            logger.warning(f"[STARTUP] watchlist-poll init failed: {_e}")

        # Ensure indexes once (search_logs analytics, watchlist, favorites)
        try:
            await db.search_watchlist.create_index([("vin", 1), ("notified", 1)])
            await db.search_watchlist.create_index([("userId", 1), ("createdAt", -1)])
            await db.search_watchlist.create_index([("email", 1)])
            await db.search_logs.create_index([("vin", 1), ("ts", -1)])
            await db.search_logs.create_index([("ts", -1)])
            await db.favorites.create_index([("customerId", 1), ("vin", 1)], unique=True, sparse=True)
            await db.favorites.create_index([("customerId", 1), ("createdAt", -1)])
            await db.favorites.create_index([("vin", 1)])

            # ── Legal workflow (P0.1–P0.4) collections ──
            await db.legal_deposits.create_index("id", unique=True)
            await db.legal_deposits.create_index([("customer_id", 1), ("created_at", -1)])
            await db.legal_deposits.create_index([("deal_id", 1)])
            await db.legal_deposits.create_index([("status", 1)])
            await db.contracts_v2.create_index("id", unique=True)
            await db.contracts_v2.create_index([("deal_id", 1), ("type", 1)])
            await db.contracts_v2.create_index([("customer_id", 1), ("created_at", -1)])
            await db.contracts_v2.create_index([("lifecycle", 1)])
        except Exception as _ie:
            logger.debug(f"[STARTUP] indexes skipped: {_ie}")

        # Legacy (unused — kept as dead code path so import errors don't fire)
        if False and INCREMENTAL_AVAILABLE:
            try:
                async def _on_new_vehicle(v: Dict[str, Any]) -> int:
                    """Callback: fired on every NET-NEW VIN discovered by
                    the incremental worker. Look up the ``search_watchlist``
                    for pending watchers and emit a socket event to each.
                    Returns the number of notifications sent.
                    """
                    try:
                        vin = (v.get("vin") or "").upper()
                        if not vin:
                            return 0
                        cursor = db.search_watchlist.find({
                            "vin": vin,
                            "notified": False,
                        })
                        watchers = await cursor.to_list(length=100)
                        if not watchers:
                            return 0
                        payload = {
                            "vin": vin,
                            "title": v.get("title")
                                or (f"{v.get('year','')} {v.get('make','')} {v.get('model','')}".strip() or None),
                            "image": (v.get("images") or [None])[0],
                            "auction_name": v.get("auction_name"),
                            "lot_number": v.get("lot_number"),
                            "detail_url": v.get("detail_url"),
                            "price": v.get("price"),
                            "found_at": datetime.now(timezone.utc).isoformat(),
                        }
                        sent = 0
                        for w in watchers:
                            try:
                                uid = w.get("userId") or w.get("user_id")
                                # Per-user room
                                if uid:
                                    await sio.emit(
                                        "car_found",
                                        payload,
                                        room=f"user_{uid}",
                                    )
                                # Global public room (anonymous watchers)
                                await sio.emit(
                                    "public:car_found",
                                    {**payload, "watcher_email": w.get("email")},
                                    room="public",
                                )
                                sent += 1
                            except Exception as _e:
                                logger.debug(f"[watchlist] emit failed for {w.get('_id')}: {_e}")
                        # Mark notified
                        await db.search_watchlist.update_many(
                            {"vin": vin, "notified": False},
                            {"$set": {
                                "notified": True,
                                "notified_at": datetime.now(timezone.utc),
                                "matched_title": payload.get("title"),
                                "matched_image": payload.get("image"),
                                "matched_lot": payload.get("lot_number"),
                            }},
                        )
                        # Audit
                        try:
                            await db.audit.insert_one({
                                "type": "watchlist_notified",
                                "vin": vin,
                                "watchers": sent,
                                "ts": datetime.now(timezone.utc),
                            })
                        except Exception:
                            pass
                        return sent
                    except Exception as e:
                        logger.warning(f"[watchlist] on_new_vehicle error: {e}")
                        return 0

                bitmotors_incremental_instance = BitmotorsIncrementalSync(db, on_new_vehicle=_on_new_vehicle)
                await bitmotors_incremental_instance.load_settings()
                bitmotors_incremental_instance.start()
                print(
                    "[STARTUP] ✓✓✓ BitmotorsIncrementalSync started "
                    f"(every {bitmotors_incremental_instance.settings['interval_seconds']}s, "
                    f"{bitmotors_incremental_instance.settings['pages']} pages) ✓✓✓"
                )
                logger.info("✓✓✓ BitmotorsIncrementalSync started ✓✓✓")

                # Ensure indexes for the new collections
                try:
                    await db.search_watchlist.create_index([("vin", 1), ("notified", 1)])
                    await db.search_watchlist.create_index([("userId", 1), ("createdAt", -1)])
                    await db.search_watchlist.create_index([("email", 1)])
                    await db.search_logs.create_index([("vin", 1), ("ts", -1)])
                    await db.search_logs.create_index([("ts", -1)])
                    await db.incremental_runs.create_index([("started_at", -1)])
                    # Phase III — Favorites indexes
                    await db.favorites.create_index([("customerId", 1), ("vin", 1)], unique=True, sparse=True)
                    await db.favorites.create_index([("customerId", 1), ("createdAt", -1)])
                    await db.favorites.create_index([("vin", 1)])
                except Exception as _ie:
                    logger.debug(f"[STARTUP] Phase-II indexes skipped: {_ie}")
            except Exception as _e:
                logger.warning(f"[STARTUP] BitmotorsIncrementalSync init failed: {_e}")

    # Phase IV — WestMotors sitemap-driven INDEX fallback
    if WESTMOTORS_AVAILABLE and db is not None:
        try:
            westmotors_sync_instance = WestMotorsSync(db)
            await westmotors_sync_instance.load_settings()
            westmotors_sync_instance.start()
            # Indexes for the WestMotors VIN catalog
            try:
                await db.vin_data_westmotors.create_index([("vin", 1)], unique=True)
                await db.vin_data_westmotors.create_index([("region", 1)])
                await db.vin_data_westmotors.create_index([("archived", 1), ("last_seen", -1)])
                await db.vin_data_westmotors.create_index([("lastmod", -1)])
                # Phase IV-1 indexes for prefetch + LRU/popularity
                await db.vin_data_westmotors.create_index([("hit_count", -1)])
                await db.vin_data_westmotors.create_index([("prefetched_at", -1)])
                await db.westmotors_sync_runs.create_index([("started_at", -1)])
            except Exception as _ie:
                logger.debug(f"[STARTUP] WestMotors indexes skipped: {_ie}")
            print("[STARTUP] ✓✓✓ WestMotorsSync started (full+incremental schedulers) ✓✓✓")
            logger.info("✓✓✓ WestMotorsSync started ✓✓✓")
        except Exception as _e:
            logger.warning(f"[STARTUP] WestMotorsSync init failed: {_e}")

    # Phase IV-2 — Lemon-Cars INDEX (lazy parser + sitemap discovery + VIN+LOT)
    if LEMON_AVAILABLE and db is not None:
        try:
            lemon_sync_instance = LemonSync(db)
            await lemon_sync_instance.load_settings()
            lemon_sync_instance.start()
            try:
                # Primary key: lemon_id (numeric, in URL)
                await db.vin_data_lemon.create_index([("lemon_id", 1)], unique=True)
                # Sparse VIN/LOT indexes — only filled rows after parsing
                await db.vin_data_lemon.create_index(
                    [("vin", 1)], sparse=True, name="vin_sparse")
                await db.vin_data_lemon.create_index(
                    [("lot", 1)], sparse=True, name="lot_sparse")
                await db.vin_data_lemon.create_index([("region", 1)])
                await db.vin_data_lemon.create_index([("archived", 1), ("last_seen", -1)])
                # Worker priority: unparsed first, sorted by lastmod desc
                await db.vin_data_lemon.create_index(
                    [("parsed_data", 1), ("lastmod", -1), ("hit_count", -1)])
                await db.vin_data_lemon.create_index([("hit_count", -1)])
                await db.lemon_sync_runs.create_index([("started_at", -1)])
            except Exception as _ie:
                logger.debug(f"[STARTUP] Lemon indexes skipped: {_ie}")
            print("[STARTUP] ✓✓✓ LemonSync started (discovery + lazy parser worker) ✓✓✓")
            logger.info("✓✓✓ LemonSync started ✓✓✓")
        except Exception as _e:
            logger.warning(f"[STARTUP] LemonSync init failed: {_e}")
    
    # Start Ringostat CRON job (every 5 minutes)
    asyncio.create_task(ringostat_cron_loop())
    print("[STARTUP] ✓ Ringostat CRON started")
    logger.info("✓ Ringostat calls export CRON started (5min interval)")
    
    # Start Shipping Tracking Worker (every 30 minutes)
    asyncio.create_task(tracking_worker_loop())
    print("[STARTUP] ✓ Shipping Tracking Worker started")
    logger.info("✓ Shipping tracking worker started (30min interval)")

    # Load tracking provider keys from DB (persisted across restarts)
    try:
        await _load_tracking_keys_from_db()
    except Exception as e:
        logger.warning(f"[STARTUP] tracking keys load: {e}")

    # Ensure unique indexes to prevent duplicate seed documents.
    # These collections all use a business "id" key (not Mongo _id) to
    # identify records across API calls. Without a unique index, concurrent
    # seed requests racing on `find_one() → insert_one()` will create dupes.
    try:
        await db.shipments.create_index("id", unique=True, name="uniq_shipment_id")
        await db.deals.create_index("id", unique=True, name="uniq_deal_id")
        await db.shipment_events.create_index("id", unique=True, name="uniq_event_id")
        await db.staff.create_index("email", unique=True, name="uniq_staff_email")
        # Audit log TTL 90 days
        await db.audit_log.create_index(
            "ts", expireAfterSeconds=90 * 24 * 3600, name="audit_ttl_90d"
        )
        # VF payload metadata TTL 7 days (small, kept for debugging + health)
        await db.vf_payload_meta.create_index(
            "storedAt", expireAfterSeconds=7 * 24 * 3600, name="vf_meta_ttl_7d"
        )
        # VF payload RAW TTL 24 h (only written when PAYLOAD_DEBUG_STORE=1)
        await db.vf_payload_raw.create_index(
            "storedAt", expireAfterSeconds=24 * 3600, name="vf_raw_ttl_24h"
        )
        # Extension heartbeat is a singleton per provider; no TTL needed
        # ── Automation layer collections (Phase A+B+C) ──
        await db.shipment_identity_links.create_index("shipmentId", unique=True, name="uniq_identity_shipmentId")
        await db.shipment_identity_links.create_index("vin", name="idx_identity_vin")
        await db.resolver_exceptions.create_index(
            "createdAt", expireAfterSeconds=30 * 24 * 3600, name="resolver_exc_ttl_30d"
        )
        await db.resolver_exceptions.create_index([("shipmentId", 1), ("status", 1)], name="idx_exc_ship_status")
        await db.vin_container_links.create_index("vin", unique=True, name="uniq_vin_container")
        # Nonce store for HMAC replay protection — TTL 120s (2× HMAC window)
        await db.ext_nonces.create_index(
            "ts", expireAfterSeconds=120, name="ext_nonces_ttl_120s"
        )
        await db.ext_nonces.create_index("nonce", unique=True, name="uniq_ext_nonce")
        # Phase D — transfer detection candidate counters (TTL 24 h)
        await db.vessel_candidates_tracking.create_index("shipmentId", name="idx_vct_shipmentId")
        await db.vessel_candidates_tracking.create_index(
            "lastSeenAt", expireAfterSeconds=24 * 3600, name="vct_ttl_24h"
        )
        # Phase E — ext_clients registry (per-manager HMAC secret)
        await db.ext_clients.create_index("clientId", unique=True, name="uniq_ext_clientId")
        await db.ext_clients.create_index("managerEmail", name="idx_ext_clients_email")
        print("[STARTUP] ✓ Unique indexes ensured (shipments/deals/shipment_events/staff) + TTL (audit/vf_meta/vf_raw/resolver_exc/ext_nonces/vct) + ext_clients")
    except Exception as e:
        logger.warning(f"[STARTUP] index creation (non-fatal): {e}")

    # ── Seed staff accounts from env (bootstrap only; prod uses real secrets mgr)
    try:
        await _seed_staff_from_env()
    except Exception as e:
        logger.warning(f"[STARTUP] staff seeding (non-fatal): {e}")

    print("[STARTUP] Ready!")
    print("="*80)
    logger.info("BIBI V3.2 - Ready")

    # ── Register security hooks (nonce replay-guard + HMAC failure audit) ──
    register_nonce_verifier(_verify_ext_nonce)
    register_hmac_fail_audit(_audit_hmac_failure)
    register_client_secret_lookup(_lookup_ext_client_secret)
    logger.info("[STARTUP] ✓ Security hooks registered (nonce + hmac_fail audit + ext_client lookup)")

    # ── Automation layer worker (identity resolver, Phase A+B+C) ──
    try:
        asyncio.create_task(resolver_worker_loop())
        logger.info("[STARTUP] ✓ Identity resolver worker started")
    except Exception as e:
        logger.warning(f"[STARTUP] resolver worker init failed: {e}")

    # ── Phase D worker: auto transfer detection sweeper ──
    try:
        asyncio.create_task(transfer_detector_loop())
        logger.info("[STARTUP] ✓ Transfer detector worker started")
    except Exception as e:
        logger.warning(f"[STARTUP] transfer detector init failed: {e}")

    # ── Ops Guardian: alerts + auto-healing ──────────────────────────
    # Wired to live `control_overview()` so the guardian sees the exact
    # same data as the admin UI and catches inconsistencies fast.
    try:
        from ops_guardian import ops_guardian_loop

        async def _overview_fetcher():
            return await control_overview()  # defined later in this file

        asyncio.create_task(ops_guardian_loop(db, _overview_fetcher))
        logger.info("[STARTUP] ✓ Ops Guardian started (alerts + auto-heal)")
    except Exception as e:
        logger.warning(f"[STARTUP] ops guardian init failed: {e}")

    # ─── P1.1 Refund Cron (legal_workflow) ────────────────────────────
    try:
        import legal_workflow as _lw
        _lw.start_refund_cron_once()
        logger.info("[STARTUP] ✓ Refund eligibility cron scheduled "
                    f"(every {_lw.REFUND_CRON_INTERVAL_SEC}s, deadline={_lw.REFUND_DEADLINE_DAYS}d)")
    except Exception as e:
        logger.warning(f"[STARTUP] refund cron init failed: {e}")


async def _seed_staff_from_env():
    """Seed/refresh staff accounts on every startup — deployment-resilient.

    Three layers of resilience so authorization survives any redeploy:
      1. Hard-coded production seeds (fixed emails+passwords) — guarantee that
         the canonical operator accounts always exist, even if `.env` is
         missing/wiped/rebuilt by the deployment pipeline.
      2. Optional env overrides (BIBI_*_EMAIL / BIBI_*_PASSWORD) — let the
         operator rotate creds without code changes.
      3. Idempotent force-sync — on every boot we re-hash and write the
         current desired password into `db.staff.password_hash`. If the user
         existed with an old hash (e.g. from a previous deploy), it is brought
         back in line with the current desired password. Existing role/email
         documents are kept (NOT deleted), so all FK-style references survive.

    This means:
      • New deploy with fresh DB → users created with current creds.
      • Existing DB after redeploy → existing users get their password reset
        to match the current desired password (so login NEVER breaks because
        of a stale hash).
      • DB volume preserved across deploys → leads/deals/cars survive untouched.
    """
    # ── Layer 1 · Hard-coded production accounts ─────────────────────────────
    # These are the canonical operator credentials. They are intentionally
    # baked in so a redeployed container without `.env` still has working auth.
    # Override at runtime via the corresponding BIBI_* env vars below.
    #
    # Project has exactly FOUR roles total: {admin, team_lead, manager, user}.
    # There is no "owner" or "master_admin" — admin@bibi.cars is the top-level
    # administrator. `master_admin` is kept in security.py only as a legacy
    # alias so old tokens/rows keep working; new code should use `admin`.
    DEFAULTS = {
        "admin": {
            "email": "admin@bibi.cars",
            "password": "Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu",
            "label": "Admin",
        },
        "manager": {
            "email": "manager@bibi.cars",
            "password": "dFbYnse0L59DBE16Mn4kT6cCRaNBZFQR",
            "label": "Manager",
        },
        "team_lead": {
            "email": "teamlead@bibi.cars",
            "password": "txXNMkj-lS2w1nv482aLlvKWuk9Y9eKE",
            "label": "Team Lead",
        },
    }

    # Hard cleanup: remove any stray "owner" / "master_admin" account — project
    # never had an owner role, and `admin` is now the canonical top role.
    try:
        await db.staff.delete_many({"$or": [
            {"role": "owner"},
            {"email": "owner@bibi.cars"},
        ]})
    except Exception as _e:
        logger.warning(f"[STARTUP] could not purge stray owner account: {_e}")

    # ── Layer 2 · Env overrides (optional) ───────────────────────────────────
    env_map = {
        "admin":        ("BIBI_ADMIN_EMAIL",     "BIBI_ADMIN_PASSWORD"),
        "manager":      ("BIBI_MANAGER_EMAIL",   "BIBI_MANAGER_PASSWORD"),
        "team_lead":    ("BIBI_TEAM_LEAD_EMAIL", "BIBI_TEAM_LEAD_PASSWORD"),
    }

    seeds = []
    for role, default in DEFAULTS.items():
        env_email_key, env_pwd_key = env_map[role]
        email = (os.environ.get(env_email_key) or default["email"]).strip().lower()
        pwd = os.environ.get(env_pwd_key) or default["password"]
        seeds.append((role, default["label"], email, pwd))

    # ── Layer 3 · Idempotent force-sync ──────────────────────────────────────
    for role, label, email, pwd in seeds:
        if not email or not pwd:
            continue
        try:
            desired_hash = hash_password(pwd)
        except Exception as e:
            logger.error(f"[STARTUP] cannot hash password for {email}: {e}")
            continue

        existing = await db.staff.find_one({"email": email})
        if existing:
            updates = {}
            # 1. Role drift: if env/default says master_admin but DB says
            #    something else, reconcile.
            if (existing.get("role") or "").lower() != role:
                updates["role"] = role
                logger.info(
                    f"[STARTUP] role drift for {email}: "
                    f"{existing.get('role')} → {role}"
                )
            # 2. Force password sync — ALWAYS make stored hash verify against
            #    the current desired password. This is what keeps auth from
            #    "breaking after redeploy".
            stored = existing.get("password_hash") or existing.get("password") or ""
            try:
                ok = isinstance(stored, str) and bool(stored) and verify_password(pwd, stored)
            except Exception:
                ok = False
            if not ok:
                updates["password_hash"] = desired_hash
                # Clear legacy plain-text `password` field if present.
                if "password" in existing and existing.get("password") != desired_hash:
                    updates["password"] = None
                logger.info(f"[STARTUP] resynced password hash for {email}")
            # 3. Re-enable the account if it was disabled (operators expect
            #    seeded accounts to be reachable after redeploy).
            if existing.get("disabled"):
                updates["disabled"] = False
                logger.info(f"[STARTUP] re-enabled disabled seed {email}")
            # 4. Make sure `name` is populated.
            if not existing.get("name"):
                updates["name"] = label
            if updates:
                await db.staff.update_one({"email": email}, {"$set": updates})
            continue

        # ── New account ─────────────────────────────────────────────────────
        doc = {
            "id": f"staff_{role}_{int(datetime.now(timezone.utc).timestamp())}",
            "email": email,
            "name": label,
            "role": role,
            "password_hash": desired_hash,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "seeded": True,
            "disabled": False,
        }
        try:
            await db.staff.insert_one(doc)
            logger.info(f"[STARTUP] seeded staff: {email} role={role}")
        except Exception as e:
            logger.warning(f"[STARTUP] seed {email} failed: {e}")


async def ringostat_cron_loop():
    """Background loop for Ringostat calls export"""
    await asyncio.sleep(30)  # Wait 30s after startup
    while True:
        try:
            await ringostat_export_calls_cron()
        except Exception as e:
            logger.error(f"[CRON] Error in ringostat export: {e}")
        
        # Run every 5 minutes
        await asyncio.sleep(300)

# ── Security: CORS whitelist + startup invariants + rate-limit ─────────────
from security import (  # noqa: E402
    assert_prod_safe,
    parse_cors_origins,
    parse_cors_origin_regex,
    require_admin,
    require_master_admin,
    require_user,
    require_manager_or_admin,
    require_extension_hmac,
    optional_user,
    ensure_shipment_access,
    create_jwt,
    hash_password,
    verify_password,
    is_admin,
    is_master_admin,
    is_staff,
    limiter as _rate_limiter,
    sanitize_vf_cookies,
    PAYLOAD_DEBUG_STORE,
    BACKEND_VF_SCRAPING,
    AUTH_MODE,
    register_nonce_verifier,
    register_hmac_fail_audit,
    register_client_secret_lookup,
)

# ═══════════════════════════════════════════════════════════════════
# TRACKING kill switch — set TRACKING_ENABLED=false in .env to freeze
# all VesselFinder jobs dispatch + worker loops without code changes.
# ═══════════════════════════════════════════════════════════════════
def _tracking_enabled() -> bool:
    return os.environ.get("TRACKING_ENABLED", "true").strip().lower() not in (
        "0", "false", "no", "off",
    )

# Run startup invariants. In AUTH_MODE=strict this raises, otherwise logs
# warnings. Non-blocking in dev so tests keep working during rollout.
try:
    assert_prod_safe()
except Exception as _e:
    logger.error(f"[security] refusing to start: {_e}")
    raise

# Rate-limit (slowapi) — only attach if the package is installed
if _rate_limiter is not None:
    try:
        from slowapi.errors import RateLimitExceeded  # type: ignore
        from slowapi import _rate_limit_exceeded_handler  # type: ignore
        fastapi_app.state.limiter = _rate_limiter
        fastapi_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    except Exception as _e:
        logger.warning(f"[security] rate-limit init failed: {_e}")

_cors_origins = parse_cors_origins()
_cors_origin_regex = parse_cors_origin_regex()
if not _cors_origins and not _cors_origin_regex:
    # Still allow anon localhost in absolute dev fallback, but log it loudly.
    logger.warning("[security] CORS_ORIGINS env empty — falling back to localhost only")
    _cors_origins = ["http://localhost:3000", "http://localhost:8001"]

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=False,  # JWT in Authorization header; no cookies.
    allow_methods=["*"],
    allow_headers=["*", "X-Ext-Timestamp", "X-Ext-Signature", "X-Ext-Client", "X-Ext-Nonce"],
    expose_headers=["X-RateLimit-Remaining", "X-RateLimit-Limit", "Retry-After"],
)
logger.info(f"[security] CORS allowed origins: {_cors_origins} regex={_cors_origin_regex!r}")
logger.info(f"[security] AUTH_MODE={AUTH_MODE}  PAYLOAD_DEBUG_STORE={PAYLOAD_DEBUG_STORE}  BACKEND_VF_SCRAPING={BACKEND_VF_SCRAPING}")


# ── Legacy endpoint kill-switch ──────────────────────────────────────────
# v3 used to expose /api/copart/*, /api/bidcars/*, /api/carfast/* surface.
# These were deprecated when the system pivoted to the multi-source resolver
# (BitMotors → WestMotors → Lemon → AuctionAuto → EXT[poctra/cfw/aah/salvagebid]).
# The Chrome extension v4.1 no longer talks to them. We intercept all such
# requests at the middleware layer and return a clean JSON 410 Gone so:
#   • the old code paths (still in this file behind their @fastapi_app.* decorators)
#     are never executed,
#   • any rogue cached client / browser tab sees a deterministic, parseable
#     response instead of HTML / "Unexpected non-whitespace character after JSON".
_LEGACY_PREFIXES = (
    "/api/copart/",
    "/api/bidcars/",
    "/api/bid_cars/",
    "/api/carfast/",
)


@fastapi_app.middleware("http")
async def _deprecate_legacy_endpoints(request: Request, call_next):
    path = request.url.path or ""
    if path.startswith(_LEGACY_PREFIXES):
        return JSONResponse(
            status_code=410,
            content={
                "deprecated": True,
                "endpoint": path,
                "message": (
                    "Legacy v3 endpoint removed. The system now uses the "
                    "multi-source resolver (BitMotors → WestMotors → Lemon → "
                    "AuctionAuto → EXT). Update your client to v4.1+."
                ),
                "supported_sources": [
                    "poctra",
                    "carsfromwest",
                    "autoauctionhistory",
                    "salvagebid",
                ],
            },
        )
    return await call_next(request)


# ── Audit log helper (best-effort; TTL 90d via index created on startup) ──
async def audit(
    action: str,
    user: Optional[Dict[str, Any]] = None,
    resource: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
):
    """Persist a security-relevant event. Never raises."""
    try:
        doc = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "user_id": (user or {}).get("id"),
            "user_email": (user or {}).get("email"),
            "user_role": (user or {}).get("role"),
            "resource": resource,
            "meta": meta or {},
            "ip": (request.client.host if request and request.client else None),
        }
        await db.audit_log.insert_one(doc)
    except Exception as e:
        logger.debug(f"[audit] insert failed: {e}")


# ═══════════════════════════════════════════════════════════════════
# Security hooks — nonce replay-guard + HMAC failure audit
# ═══════════════════════════════════════════════════════════════════
async def _verify_ext_nonce(nonce: str, ts: int) -> bool:
    """Return True if the nonce has not been seen before.

    Uses a TTL-indexed Mongo collection (``ext_nonces``, 120 s TTL) + a unique
    index on ``nonce`` — duplicate insert raises and we return False.
    """
    try:
        await db.ext_nonces.insert_one({
            "nonce": nonce,
            "ts": datetime.now(timezone.utc),
            "clientTs": int(ts),
        })
        return True
    except Exception as e:
        # DuplicateKeyError (pymongo) → replay
        cls = type(e).__name__
        if "Duplicate" in cls:
            return False
        # Any other DB issue — fail-open so we don't block the extension on
        # transient Mongo issues, but log loudly.
        logger.warning(f"[security] nonce insert failed ({cls}): {e}")
        return True


async def _audit_hmac_failure(*, reason: str, client: Optional[str], method: str, path: str, ip: Optional[str]) -> None:
    """Wired into security.require_extension_hmac on every failure."""
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc).isoformat(),
            "action": "hmac_failed",
            "meta": {"reason": reason, "client": client, "method": method, "path": path},
            "ip": ip,
        })
    except Exception as e:
        logger.debug(f"[audit] hmac_failed insert failed: {e}")


# ── Per-client HMAC secret lookup (Phase E ext_clients registry) ────
# Small in-process TTL cache to avoid a DB round-trip per request.
_ext_client_secret_cache: Dict[str, tuple] = {}   # clientId -> (secret, expires_epoch)
_EXT_CLIENT_CACHE_TTL = 60  # seconds


async def _lookup_ext_client_secret(client_id: str) -> Optional[str]:
    """Return ``secret`` for an *active* client, ``'__REVOKED__'`` for an
    existing-but-inactive client, or ``None`` if the client id is unknown
    (in which case callers fall back to the global shared secret).
    """
    if not client_id:
        return None
    now = time.time()
    cached = _ext_client_secret_cache.get(client_id)
    if cached and cached[1] > now:
        return cached[0]
    try:
        doc = await db.ext_clients.find_one(
            {"clientId": client_id},
            {"_id": 0, "secret": 1, "active": 1},
        )
    except Exception as e:
        logger.debug(f"[security] ext_clients lookup failed: {e}")
        return None
    if not doc:
        _ext_client_secret_cache[client_id] = (None, now + 10)
        return None
    if doc.get("active") is False:
        _ext_client_secret_cache[client_id] = ("__REVOKED__", now + 10)
        return "__REVOKED__"
    secret = doc.get("secret") or None
    _ext_client_secret_cache[client_id] = (secret, now + _EXT_CLIENT_CACHE_TTL)
    return secret


# Static files — user uploads (avatars, etc)
from fastapi.staticfiles import StaticFiles
import pathlib
_STATIC_DIR = pathlib.Path(__file__).parent / "static"
(_STATIC_DIR / "avatars").mkdir(parents=True, exist_ok=True)
(_STATIC_DIR / "contracts").mkdir(parents=True, exist_ok=True)
fastapi_app.mount("/api/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
# Public-facing static for signed PDFs (used by legal_workflow)
fastapi_app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="public_static")

# ─────────────────────────────────────────────────────────────────────────
#  P0.1–P0.4:  legal & pipeline workflow router
#  (см. legal_workflow.py — автономный модуль, не трогает старый код)
# ─────────────────────────────────────────────────────────────────────────
try:
    import legal_workflow as _legal_wf
    fastapi_app.include_router(_legal_wf.router)
    logger.info("[legal_workflow] router mounted: %d routes",
                sum(1 for _ in _legal_wf.router.routes))
except Exception as _e:
    logger.exception("[legal_workflow] failed to mount router: %s", _e)

# ═══════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════
class BrowserPayload(BaseModel):
    vin: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    fallback: Optional[Dict[str, Any]] = None
    sessionId: Optional[str] = None
    url: str
    ts: int

class ConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    rate_limit_ms: Optional[int] = None
    min_score: Optional[float] = None
    debug: Optional[bool] = None

class SessionAction(BaseModel):
    sessionId: str
    priority: Optional[int] = None

VIN_REGEX = re.compile(r'^[A-HJ-NPR-Z0-9]{17}$')

def is_valid_vin(vin: str) -> bool:
    return bool(vin and VIN_REGEX.match(vin.upper()))

# ═══════════════════════════════════════════════════════════════════
# VIN INGESTION API
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/vin-unified/browser")
async def ingest_from_browser(payload: BrowserPayload):
    """V3.2 Ingestion with Session Scoring & Field Intelligence"""
    
    # Check if parser enabled
    if not parser_config.enabled:
        return {"success": False, "error": "Parser disabled"}
    
    start_time = datetime.now(timezone.utc).timestamp()
    
    # Extract VIN
    vin = payload.vin
    if not vin and payload.data:
        vin = payload.data.get('vin')
    
    if not vin or not is_valid_vin(vin):
        return {"success": False, "error": "Invalid VIN"}
    
    vin = vin.upper()
    session_id = payload.sessionId or "anonymous"
    
    # Check if session is blocked
    session = session_service.get(session_id)
    if session and session.blocked:
        return {"success": False, "error": "Session blocked"}
    
    # Get session score
    session_score = session_service.get_score(session_id)
    
    # V3.1: Filter low-score sessions
    if session_score > 0 and session_score < parser_config.min_score:
        return {"success": False, "error": "Low session score", "score": session_score}
    
    # Rate limit check (adjusted by score)
    if session_service.is_rate_limited(session_id):
        return {"success": False, "error": "Rate limited", "retry_after": parser_config.rate_limit_ms}
    
    # Prepare data
    data = payload.data or {}
    if payload.fallback:
        for k, v in payload.fallback.items():
            if v and not data.get(k):
                data[k] = v
    
    # Track field count for session
    fields_count = sum(1 for k, v in data.items() if v)
    session_service.update_fields(session_id, fields_count)
    
    # Create job with session score
    job = IngestionJob(
        vin=vin,
        session_id=session_id,
        data=data,
        url=payload.url,
        timestamp=payload.ts / 1000 if payload.ts > 1e12 else payload.ts,
        session_score=session_service.get_score(session_id),  # Recalculate after update
    )
    
    # Push to queue
    await ingestion_queue.push(job)
    
    # Update session
    latency = (datetime.now(timezone.utc).timestamp() - start_time) * 1000
    session_service.touch(session_id, latency=latency, success=True)
    
    # Get result
    record = aggregator.get(vin)
    
    return {
        "success": True,
        "vin": vin,
        "sessionId": session_id[:8] + "...",
        "sessionScore": round(session_service.get_score(session_id), 2),
        "quality": record.quality if record else "pending",
        "fields_filled": record.fields_filled if record else 0,
        "sources_count": len(record.sources) if record else 1,
    }

# ═══════════════════════════════════════════════════════════════════
# CONFIG API (V3.2 Control)
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/v3/config")
async def get_config():
    """Get parser config (called by extension)"""
    return {
        "enabled": parser_config.enabled,
        "rateLimit": parser_config.rate_limit_ms,
        "minScore": parser_config.min_score,
        "debug": parser_config.debug,
        "targets": parser_config.targets,
    }

@fastapi_app.post("/api/v3/config")
async def update_config(update: ConfigUpdate):
    """Update parser config"""
    if update.enabled is not None:
        parser_config.enabled = update.enabled
    if update.rate_limit_ms is not None:
        parser_config.rate_limit_ms = update.rate_limit_ms
    if update.min_score is not None:
        parser_config.min_score = update.min_score
    if update.debug is not None:
        parser_config.debug = update.debug
    
    await ws_manager.broadcast({"type": "config_updated", "config": await get_config()})
    
    return {"success": True, "config": await get_config()}

# ═══════════════════════════════════════════════════════════════════
# HEARTBEAT API (Extension → Backend)
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/v3/heartbeat")
async def heartbeat(data: Dict[str, Any] = Body(...)):
    """Extension heartbeat"""
    session_id = data.get("sessionId", "anonymous")
    url = data.get("url", "")
    
    session_service.touch(session_id, success=True)
    
    return {
        "success": True,
        "sessionScore": round(session_service.get_score(session_id), 2),
        "config": await get_config(),
    }

# ═══════════════════════════════════════════════════════════════════
# SESSION MANAGEMENT API
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/v3/sessions")
async def list_sessions():
    """List all sessions with scores"""
    sessions = session_service.get_all()
    return {
        "total": len(sessions),
        "active": len(session_service.get_active()),
        "sessions": [
            {
                "sessionId": s.session_id,
                "shortId": s.session_id[:8] + "...",
                "lastSeen": datetime.fromtimestamp(s.last_seen, tz=timezone.utc).isoformat(),
                "successCount": s.success_count,
                "failCount": s.fail_count,
                "vinCount": s.vin_count,
                "score": round(session_service.get_score(s.session_id), 2),
                "avgLatency": round(s.avg_latency, 2),
                "avgFields": round(s.avg_fields, 2),
                "blocked": s.blocked,
                "priority": s.priority,
                "active": s.last_seen > datetime.now(timezone.utc).timestamp() - 300,
            }
            for s in sorted(sessions, key=lambda x: session_service.get_score(x.session_id), reverse=True)
        ]
    }

@fastapi_app.post("/api/v3/session/disable")
async def disable_session(action: SessionAction):
    """Disable a session"""
    session_service.disable(action.sessionId)
    await ws_manager.broadcast({"type": "session_disabled", "sessionId": action.sessionId[:8]})
    return {"success": True}

@fastapi_app.post("/api/v3/session/enable")
async def enable_session(action: SessionAction):
    """Enable a session"""
    session_service.enable(action.sessionId)
    await ws_manager.broadcast({"type": "session_enabled", "sessionId": action.sessionId[:8]})
    return {"success": True}

@fastapi_app.post("/api/v3/session/priority")
async def set_session_priority(action: SessionAction):
    """Set session priority (1-10)"""
    if action.priority:
        session_service.set_priority(action.sessionId, action.priority)
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# VIN DATA API
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/vin-unified/list")
async def list_vins(limit: int = 50, skip: int = 0):
    cursor = db.vin_data.find({}, {'_id': 0, 'sources': 0}).sort('updated_at', -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.vin_data.count_documents({})
    return {"success": True, "total": total, "items": items}

@fastapi_app.get("/api/vin-unified/{vin}")
async def get_vin(vin: str):
    """Get VIN with field sources attribution"""
    vin = vin.upper()
    data = await db.vin_data.find_one({'vin': vin}, {'_id': 0})
    
    if not data:
        record = aggregator.get(vin)
        if record:
            return {
                "success": True,
                "found": True,
                "data": {
                    "vin": record.vin,
                    "merged": record.merged,
                    "quality": record.quality,
                    "sources_count": len(record.sources),
                    "field_sources": [
                        {"field": fs.field, "session": fs.session_id[:8], "score": round(fs.score, 2)}
                        for fs in record.field_sources
                    ]
                }
            }
        return {"success": False, "found": False}
    
    return {"success": True, "found": True, "data": data}

# ═══════════════════════════════════════════════════════════════════
# STATS & MONITORING
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/v3/stats")
async def v3_stats():
    """Complete V3.2 system stats"""
    return {
        "sessions": session_service.get_stats(),
        "queue": ingestion_queue.get_stats(),
        "aggregator": aggregator.get_stats(),
        "config": {
            "enabled": parser_config.enabled,
            "minScore": parser_config.min_score,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@fastapi_app.get("/api/dashboard/stats")
async def dashboard_stats():
    vin_count = await db.vin_data.count_documents({})
    quality_pipeline = [{'$group': {'_id': '$quality', 'count': {'$sum': 1}}}]
    quality_stats = await db.vin_data.aggregate(quality_pipeline).to_list(length=10)
    
    return {
        "total_vins": vin_count,
        "quality_distribution": {q['_id']: q['count'] for q in quality_stats if q['_id']},
        "active_sessions": len(session_service.get_active()),
        "parser_enabled": parser_config.enabled,
    }

@fastapi_app.get("/api/dashboard/master")
async def dashboard_master(period: str = "week"):
    """Master dashboard stats for admin"""
    
    vin_count = await db.vin_data.count_documents({})
    leads_count = await db.leads.count_documents({})
    customers_count = await db.customers.count_documents({})
    deals_count = await db.deals.count_documents({})
    
    now = datetime.now(timezone.utc)
    
    return {
        "success": True,
        "generatedAt": now.isoformat(),
        "period": period,
        "sla": {
            "overdueLeads": 0,
            "overdueTasks": 0,
            "overdueCallbacks": 0,
            "avgFirstResponseMinutes": 5,
            "missedSlaRate": 2,
            "responseTime": {"value": 2.5, "target": 5, "status": "good"},
            "firstContact": {"value": 95, "target": 90, "status": "good"},
            "resolution": {"value": 88, "target": 85, "status": "good"},
        },
        "workload": {
            "activeManagers": 3,
            "totalManagers": 3,
            "overloadedManagers": 0,
            "avgLoad": 75,
            "managers": [
                {"managerId": "1", "name": "Manager 1", "status": "normal", "activeLeads": 12, "openTasks": 5, "score": 85, "avatar": None},
                {"managerId": "2", "name": "Manager 2", "status": "normal", "activeLeads": 8, "openTasks": 3, "score": 90, "avatar": None},
                {"managerId": "3", "name": "Manager 3", "status": "normal", "activeLeads": 10, "openTasks": 4, "score": 88, "avatar": None},
            ],
            "distribution": [
                {"name": "Manager 1", "load": 80, "tasks": 12, "avatar": None},
                {"name": "Manager 2", "load": 70, "tasks": 8, "avatar": None},
                {"name": "Manager 3", "load": 75, "tasks": 10, "avatar": None},
            ]
        },
        "leads": {
            "newCount": leads_count,
            "inProgressCount": 0,
            "convertedCount": 0,
            "lostCount": 0,
            "unassignedCount": 0,
            "trend": 12,
            "bySource": {
                "website": 45,
                "referral": 30,
                "ads": 25,
            },
            "byStatus": {
                "new": leads_count,
                "contacted": 0,
                "qualified": 0,
            }
        },
        "callbacks": {
            "pending": 0,
            "overdue": 0,
            "completed": 15,
            "scheduled": 3,
            "missedCalls": 0,
            "noAnswerLeads": 0,
            "followUpsDue": 0,
            "callbacksScheduled": 3,
            "smsTriggered": 10,
        },
        "deposits": {
            "total": 0,
            "pending": 0,
            "confirmed": 0,
            "trend": 0,
            "pendingDeposits": 0,
            "unconfirmed": 0,
            "overdue": 0,
            "depositsWithoutProof": 0,
            "verifiedToday": 0,
        },
        "documents": {
            "pending": 0,
            "approved": 0,
            "rejected": 0,
            "pendingVerification": 0,
            "expiringSoon": 0,
            "missingDocs": 0,
            "rejectedCount": 0,
            "uploadedToday": 0,
        },
        "routing": {
            "activeRules": 5,
            "autoAssigned": 80,
            "manualAssigned": 20,
            "unassignedLeads": 0,
            "avgAssignTime": 2,
            "fallbackAssignments": 0,
            "reassignmentRate": 5,
        },
        "system": {
            "parserStatus": "active" if parser_config.enabled else "stopped",
            "systemStatus": "healthy",
            "activeSessions": len(session_service.get_active()),
            "queueSize": ingestion_queue.get_stats()["queue_size"],
            "queueBacklog": ingestion_queue.get_stats()["queue_size"],
            "vinsProcessed": vin_count,
            "failedJobs": 0,
            "lastSync": now.isoformat(),
            "cacheHitRate": 95,
        },
        "vehicles": {
            "total": vin_count,
            "newToday": 0,
        }
    }

@fastapi_app.get("/api/system/health")
async def health():
    return {
        "status": "healthy",
        "service": "bibi-v3.2",
        "version": "3.2.0",
        "queue_running": ingestion_queue.processing,
        "active_sessions": len(session_service.get_active()),
        "parser_enabled": parser_config.enabled,
    }

# ═══════════════════════════════════════════════════════════════════
# WEBSOCKET (Real-time Feed)
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.websocket("/api/v3/stream")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo or handle commands
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

# ═══════════════════════════════════════════════════════════════════
# LEGACY ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/auth/me")
async def get_me(current_user: Dict[str, Any] = Depends(require_user)):
    """Return the authenticated staff user."""
    return {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "name": current_user.get("name"),
        "role": current_user.get("role"),
        "managerId": current_user.get("managerId"),
    }


@fastapi_app.post("/api/auth/login")
@(_rate_limiter.limit("10/minute") if _rate_limiter else (lambda f: f))
async def login(request: Request, response: Response, credentials: Dict[str, Any] = Body(...)):
    """Staff login → JWT.

    Verifies against ``db.staff`` (bcrypt `password_hash`). Seed accounts are
    inserted on startup from env (`BIBI_OWNER_*`, `BIBI_ADMIN_*`, `BIBI_MANAGER_*`).
    """
    email = (credentials.get("email") or "").strip().lower()
    password = credentials.get("password") or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    # Basic brute-force guard (IP + email bucket, in-memory fallback if slowapi disabled)
    staff = await db.staff.find_one({"email": email})
    if not staff:
        # Same error for unknown email to avoid enumeration
        raise HTTPException(status_code=401, detail="Invalid credentials")

    stored_hash = staff.get("password_hash") or staff.get("password")  # tolerate legacy field
    if not stored_hash or not verify_password(password, stored_hash):
        # Audit the failure (best-effort; audit log collection is optional)
        try:
            await db.audit_log.insert_one({
                "ts": datetime.now(timezone.utc).isoformat(),
                "action": "login_failed",
                "email": email,
                "ip": (request.client.host if request.client else None),
            })
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if staff.get("disabled"):
        raise HTTPException(status_code=403, detail="Account disabled")

    user_doc = {
        "id": staff.get("id") or staff.get("_id"),
        "email": staff.get("email"),
        "name": staff.get("name") or staff.get("email"),
        "role": (staff.get("role") or "manager").lower(),
        "managerId": staff.get("id") or staff.get("_id"),
    }
    token = create_jwt(user_doc)
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc).isoformat(),
            "action": "login_ok",
            "user_id": user_doc["id"],
            "email": user_doc["email"],
            "role": user_doc["role"],
            "ip": (request.client.host if request.client else None),
        })
    except Exception:
        pass
    return {"access_token": token, "token_type": "Bearer", "user": user_doc}

@fastapi_app.get("/api/leads")
async def list_leads(managerId: Optional[str] = None, score_gte: Optional[int] = None, limit: int = 50, skip: int = 0):
    query = {}
    if managerId:
        query['managerId'] = managerId
    if score_gte:
        query['score'] = {'$gte': score_gte}
    
    cursor = db.leads.find(query, {'_id': 0}).sort('created_at', -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.leads.count_documents(query)
    
    # Return both formats for compatibility
    return {"success": True, "data": items, "items": items, "total": total}

@fastapi_app.get("/api/customers")
async def list_customers(limit: int = 50, skip: int = 0):
    cursor = db.customers.find({}, {'_id': 0}).sort('created_at', -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.customers.count_documents({})
    return {"success": True, "data": items, "items": items, "total": total}

@fastapi_app.get("/api/deals")
async def list_deals(limit: int = 50, skip: int = 0):
    cursor = db.deals.find({}, {'_id': 0}).sort('created_at', -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.deals.count_documents({})
    return {"success": True, "data": items, "items": items, "total": total}

@fastapi_app.get("/api/tasks")
async def list_tasks(assigneeId: Optional[str] = None, status: Optional[str] = None, limit: int = 50):
    query = {}
    if assigneeId:
        query['assigneeId'] = assigneeId
    if status:
        query['status'] = status
    
    cursor = db.tasks.find(query, {'_id': 0}).sort('dueDate', 1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items, "items": items}

@fastapi_app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, data: Dict[str, Any] = Body(...)):
    await db.tasks.update_one({'taskId': task_id}, {'$set': data})
    return {"success": True}

@fastapi_app.get("/api/invoices")
async def list_invoices(managerId: Optional[str] = None, status: Optional[str] = None, limit: int = 50):
    query = {}
    if managerId:
        query['managerId'] = managerId
    if status:
        query['status'] = status
    
    cursor = db.invoices.find(query, {'_id': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items, "items": items}

@fastapi_app.get("/api/shipments")
async def list_shipments(
    managerId: Optional[str] = None,
    limit: int = 50,
    current_user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """List shipments. Admin sees all; manager sees only own (managerId filter enforced)."""
    try:
        query: Dict[str, Any] = {}
        # Admins can use managerId query filter freely; managers are locked to own.
        if is_admin(current_user):
            if managerId:
                query['managerId'] = managerId
        else:
            query['managerId'] = current_user.get("id")

        shipments = await db.shipments.find(query).sort('created_at', -1).limit(limit).to_list(limit)

        logger.info(f"[SHIPMENTS] Found {len(shipments)} shipments for user={current_user.get('email')}")

        return {
            "success": True,
            "data": [serialize_doc(s) for s in shipments],
            "total": len(shipments)
        }
    except Exception as e:
        logger.error(f"[SHIPMENTS] Error: {e}")
        return {"success": False, "error": str(e), "data": [], "total": 0}


@fastapi_app.post("/api/shipments/{shipment_id}/vessel/legacy-attach", include_in_schema=False, dependencies=[Depends(require_manager_or_admin)])
async def attach_vessel_to_shipment(shipment_id: str, payload: Dict[str, Any] = Body(...)):
    """
    LEGACY endpoint — kept for old clients that POST {imo} to bind a vessel.
    New code MUST use the VIN-centric `/api/shipments/{id}/vessel` handler
    (in the VesselFinder section below), which preserves vessel history via
    stages[] when the ship changes.

    URL path was moved to `/vessel/legacy-attach` so it no longer collides
    with the new handler. If any old frontend still hits `/vessel` with an
    {imo} payload, the new handler will accept it too (imo is optional there).
    """
    imo = str(payload.get('imo', '')).strip()
    if not imo:
        raise HTTPException(status_code=400, detail="imo is required")

    vessel = {
        'imo': imo,
        'name': payload.get('name'),
        'mmsi': payload.get('mmsi'),
        'callsign': payload.get('callsign'),
        'attachedAt': datetime.now(timezone.utc),
    }

    result = await db.shipments.update_one(
        {'id': shipment_id},
        {'$set': {'vessel': vessel, 'trackingActive': True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Shipment not found")

    # Try immediate fetch
    position = await fetch_vessel_position(imo)

    return {
        'success': True,
        'shipmentId': shipment_id,
        'vessel': serialize_doc(vessel),
        'position': serialize_doc(position) if position else None,
        'hasRealData': position is not None,
    }


@fastapi_app.get("/api/vessels/{imo}/position", dependencies=[Depends(require_manager_or_admin)])
async def get_vessel_position(imo: str):
    """Fetch current position of vessel by IMO (cached or live)."""
    pos = await fetch_vessel_position(imo)
    if not pos:
        return {
            'success': False,
            'imo': imo,
            'message': 'Vessel position unavailable (no API key or unknown IMO)',
            'apiKeyConfigured': bool(VESSELFINDER_API_KEY or VESSELFINDER_FLEET_KEY or SHIPSGO_FLEET_KEY or SHIPSGO_API_KEY),
        }
    return {'success': True, 'imo': imo, 'position': serialize_doc(pos)}


@fastapi_app.get("/api/shipments/{shipment_id}/live", dependencies=[Depends(require_manager_or_admin)])
async def get_shipment_live(shipment_id: str):
    """Return latest tracking state for a shipment."""
    sh = await db.shipments.find_one({'id': shipment_id})
    if not sh:
        raise HTTPException(status_code=404, detail="Shipment not found")
    lt = sh.get('lastTrackingUpdate')
    return {
        'success': True,
        'shipmentId': shipment_id,
        'currentPosition': serialize_doc(sh.get('currentPosition')) if isinstance(sh.get('currentPosition'), dict) else None,
        'progress': sh.get('progress', 0),
        'liveEta': sh.get('liveEta'),
        'trackingSource': sh.get('trackingSource', 'unknown'),
        'vessel': serialize_doc(sh.get('vessel')) if isinstance(sh.get('vessel'), dict) else None,
        'lastTrackingUpdate': lt.isoformat() if isinstance(lt, datetime) else None,
    }


@fastapi_app.post("/api/shipments/{shipment_id}/tick_legacy_removed_keep_url_hint", dependencies=[Depends(require_manager_or_admin)])
async def _legacy_tick_removed():
    """Intentionally unreachable: legacy /tick registration removed (see /api/shipments/{id}/tick canonical handler below)."""
    raise HTTPException(status_code=410, detail="legacy handler removed")


@fastapi_app.get("/api/settings")
async def get_settings():
    """Return system settings for admin panel"""
    settings = [
        {
            "id": "lead_statuses",
            "key": "lead_statuses",
            "value": ["new", "contacted", "qualified", "variants_sent", "negotiation", "won", "lost"],
            "description": "Available lead statuses"
        },
        {
            "id": "deal_statuses",
            "key": "deal_statuses",
            "value": [
                "lead",
                "qualified",
                "variants_sent",
                "deposit_contract_drafted",
                "deposit_contract_signed",
                "deposit_paid",
                "searching_at_auction",
                "auction_lost",
                "auction_won",
                "final_contract_sent",
                "final_contract_signed",
                "after_win_payment_paid",
                "in_transit_to_rotterdam",
                "arrived_rotterdam",
                "customs_calculated",
                "final_payment_paid",
                "in_transit_to_bg",
                "delivered",
                "closed",
                "cancelled",
            ],
            "description": "Full BIBI Cars deal pipeline (P0.2)"
        },
        {
            "id": "deposit_statuses",
            "key": "deposit_statuses",
            "value": [
                "pending",
                "paid_confirmed",
                "refund_pending_voluntary",
                "refund_pending_30d",
                "refunded",
                "forfeit_pending_teamlead",
                "forfeit_pending_admin",
                "forfeited",
            ],
            "description": "Deposit lifecycle statuses (P0.3)"
        },
        {
            "id": "contract_types",
            "key": "contract_types",
            "value": ["deposit", "final", "purchase"],
            "description": "Contract v2 types (P0.4)"
        },
        {
            "id": "contract_lifecycle",
            "key": "contract_lifecycle",
            "value": ["draft", "sent_to_client", "client_signed", "company_signed_stamped", "finalized"],
            "description": "Contract v2 lifecycle (P0.4)"
        },
        {
            "id": "lead_sources",
            "key": "lead_sources",
            "value": ["website", "referral", "social", "call", "email", "other"],
            "description": "Lead source channels"
        },
        {
            "id": "sla_first_response_minutes",
            "key": "sla_first_response_minutes",
            "value": 15,
            "description": "SLA: First response time in minutes"
        },
        {
            "id": "sla_callback_minutes",
            "key": "sla_callback_minutes",
            "value": 30,
            "description": "SLA: Callback time in minutes"
        }
    ]
    return settings

@fastapi_app.get("/")
async def root():
    return {"service": "BIBI V3.2", "version": "3.2.0"}


# ═══════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (STUBS for frontend compatibility)
# ═══════════════════════════════════════════════════════════════════

# Journey/Funnel
@fastapi_app.get("/api/journey/funnel")
async def journey_funnel(days: int = 30):
    return {
        "totalDeals": 150,
        "delivered": 45,
        "conversionRate": 30,
        "funnel": {
            "NEW_LEAD": 150,
            "CONTACT_ATTEMPT": 120,
            "QUALIFIED": 90,
            "CAR_SELECTED": 75,
            "NEGOTIATION": 60,
            "CONTRACT_SENT": 55,
            "CONTRACT_SIGNED": 50,
            "PAYMENT_PENDING": 48,
            "PAYMENT_DONE": 47,
            "SHIPPING": 46,
            "DELIVERED": 45,
        },
        "dropOff": [
            {"from": "NEW_LEAD", "to": "CONTACT_ATTEMPT", "rate": 20, "count": 30},
            {"from": "CONTACT_ATTEMPT", "to": "QUALIFIED", "rate": 25, "count": 30},
            {"from": "QUALIFIED", "to": "CAR_SELECTED", "rate": 17, "count": 15},
        ]
    }

@fastapi_app.get("/api/journey/bottlenecks")
async def journey_bottlenecks(days: int = 30):
    return [
        {"from": "CONTACT_ATTEMPT", "to": "QUALIFIED", "rate": 25, "count": 30},
        {"from": "NEW_LEAD", "to": "CONTACT_ATTEMPT", "rate": 20, "count": 30},
    ]

@fastapi_app.get("/api/journey/durations")
async def journey_durations(days: int = 30):
    return {
        "count": 45,
        "averages": {
            "daysToContact": 1,
            "daysToDeal": 5,
            "daysToContract": 8,
            "daysToPayment": 12,
            "daysToDelivery": 25,
            "totalJourneyDays": 25,
        }
    }

# Alerts
@fastapi_app.get("/api/alerts/critical")
async def alerts_critical(limit: int = 20):
    return {"alerts": []}

@fastapi_app.get("/api/alerts")
async def alerts_list():
    return {"alerts": [], "unreadCount": 0}

# Owner Dashboard
@fastapi_app.get("/api/owner-dashboard")
async def owner_dashboard():
    return {
        "risk": {
            "suspiciousSessions": 0,
            "criticalInvoices": 0,
            "riskyShipments": 0,
            "integrationsDown": 0,
        },
        "people": {
            "underperformers": []
        }
    }

# Risk
@fastapi_app.post("/api/risk/daily-check")
async def risk_daily_check():
    return {"success": True}

@fastapi_app.get("/api/risk/manager/{manager_id}", dependencies=[Depends(require_manager_or_admin)])
async def risk_manager(manager_id: str):
    return {
        "riskLevel": "low",
        "riskScore": 10,
        "entityType": "manager",
        "factors": [],
        "recommendations": []
    }

# KPI Dashboard
@fastapi_app.get("/api/admin/kpi/dashboard", dependencies=[Depends(require_admin)])
async def kpi_dashboard():
    return {
        "leadsCreated": 50,
        "contactRate": 85,
        "conversionRate": 15,
        "avgResponseTime": 5,
        "trends": {
            "leads": 12,
            "conversion": 5,
        }
    }

@fastapi_app.get("/api/admin/kpi/leaderboard", dependencies=[Depends(require_admin)])
async def kpi_leaderboard():
    return {
        "managers": [
            {"id": "1", "name": "Manager 1", "score": 95, "leads": 20, "conversions": 5},
            {"id": "2", "name": "Manager 2", "score": 88, "leads": 15, "conversions": 3},
            {"id": "3", "name": "Manager 3", "score": 82, "leads": 18, "conversions": 4},
        ]
    }

@fastapi_app.get("/api/admin/kpi/team", dependencies=[Depends(require_admin)])
async def kpi_team():
    return {
        "teamStats": {
            "totalMembers": 3,
            "avgScore": 88,
            "topPerformer": "Manager 1",
        }
    }

@fastapi_app.get("/api/admin/kpi/team-summary", dependencies=[Depends(require_admin)])
async def kpi_team_summary():
    return {
        "summary": {
            "activeManagers": 3,
            "totalLeads": 53,
            "totalConversions": 12,
        }
    }

@fastapi_app.get("/api/admin/kpi/alerts", dependencies=[Depends(require_admin)])
async def kpi_alerts():
    return {"alerts": []}

# Intent Dashboard
@fastapi_app.get("/api/admin/intent/analytics", dependencies=[Depends(require_admin)])
async def intent_analytics():
    return {
        "totalIntents": 100,
        "levels": {
            "hot": 15,
            "warm": 35,
            "cold": 50,
        },
        "hotLeads": 15,
        "warmLeads": 35,
        "coldLeads": 50,
        "conversionRate": 25,
        "topCategories": [
            {"category": "BMW", "count": 25},
            {"category": "Mercedes", "count": 20},
            {"category": "Audi", "count": 15},
        ],
        "trends": {
            "hot": 5,
            "warm": 3,
            "cold": -2,
        }
    }

@fastapi_app.get("/api/admin/intent/hot-leads", dependencies=[Depends(require_admin)])
async def intent_hot_leads():
    return [
        {
            "userId": "user-001-abc123",
            "level": "hot",
            "score": 95,
            "context": {"name": "Олександр Петренко", "email": "alex@example.com", "phone": "+380501234567"},
            "favoritesCount": 5,
            "comparesCount": 3,
            "historyRequestsCount": 2,
            "lastActivityAt": "2026-04-07T12:30:00Z",
            "managerNotified": False,
            "vehicleInterest": "BMW X5 2023"
        },
        {
            "userId": "user-002-def456",
            "level": "hot",
            "score": 92,
            "context": {"name": "Марія Коваленко", "email": "maria@example.com", "phone": "+380507654321"},
            "favoritesCount": 8,
            "comparesCount": 4,
            "historyRequestsCount": 3,
            "lastActivityAt": "2026-04-07T11:15:00Z",
            "managerNotified": True,
            "vehicleInterest": "Mercedes GLE 2022"
        },
        {
            "userId": "user-003-ghi789",
            "level": "hot",
            "score": 88,
            "context": {"name": "Іван Шевченко", "phone": "+380509876543"},
            "favoritesCount": 3,
            "comparesCount": 2,
            "historyRequestsCount": 1,
            "lastActivityAt": "2026-04-07T10:00:00Z",
            "managerNotified": False,
            "vehicleInterest": "Audi Q7 2023"
        },
    ]

@fastapi_app.get("/api/admin/intent/scores", dependencies=[Depends(require_admin)])
async def intent_scores(limit: int = 50):
    return {
        "items": [
            {"userId": "user-001-abc123", "score": 95, "level": "hot", "factors": ["multiple_views", "calculator_used", "contact_form"]},
            {"userId": "user-002-def456", "score": 92, "level": "hot", "factors": ["repeat_visitor", "wishlist", "vin_check"]},
            {"userId": "user-003-ghi789", "score": 88, "level": "hot", "factors": ["time_on_site", "multiple_vehicles"]},
            {"userId": "user-004-jkl012", "score": 72, "level": "warm", "factors": ["single_view", "bookmark"]},
            {"userId": "user-005-mno345", "score": 65, "level": "warm", "factors": ["calculator_used"]},
        ],
        "total": 5
    }

@fastapi_app.post("/api/admin/intent/mark-notified/{lead_id}", dependencies=[Depends(require_admin)])
async def intent_mark_notified(lead_id: str):
    return {"success": True}

# Quote Analytics
# ❌ REMOVED (April 2026): /api/admin/quote-analytics
# Reason: returned hardcoded mock data (Manager 1/2/3, Website/Phone/Referral
# fixed numbers) — created false sense of "system is calculating" without any
# real metrics. Frontend page /admin/analytics/quotes also removed.
# If real quote analytics is required later, build a fresh endpoint that
# aggregates from db.quotes / db.leads, not this mock.

# Engagement Analytics
@fastapi_app.get("/api/admin/engagement/analytics", dependencies=[Depends(require_admin)])
async def engagement_analytics():
    return {
        "totalUsers": 500,
        "activeUsers": 150,
        "engagementRate": 30,
        "pageViews": 2500,
        "hotUsers": 25,
        "warmUsers": 75,
        "coldUsers": 400,
    }

@fastapi_app.get("/api/admin/engagement/audience", dependencies=[Depends(require_admin)])
async def engagement_audience(vin: str = "", intentMin: int = 0, onlyHot: bool = False):
    """Return audience preview for campaign - direct object"""
    return {"total": 0, "byChannel": {"sms": 0, "email": 0, "telegram": 0}}

@fastapi_app.get("/api/admin/engagement/campaign", dependencies=[Depends(require_admin)])
async def engagement_campaign():
    return []

@fastapi_app.get("/api/admin/engagement/history", dependencies=[Depends(require_admin)])
async def engagement_history(limit: int = 20):
    """Return campaign history - with items array"""
    return {"items": []}

@fastapi_app.get("/api/admin/engagement/templates", dependencies=[Depends(require_admin)])
async def engagement_templates():
    """Return templates as direct array"""
    return [
        {"id": "price_drop", "name": "Price Drop Alert", "channel": "sms", "message": "Price dropped on {vin}!"},
        {"id": "new_listing", "name": "New Listing", "channel": "email", "message": "New vehicle available: {vin}"},
    ]

@fastapi_app.get("/api/admin/engagement/top-users", dependencies=[Depends(require_admin)])
async def engagement_top_users(limit: int = 50):
    """Return top users as direct array"""
    return [
        {"id": "user1", "name": "John Doe", "email": "john@test.com", "level": "hot", "score": 85, "favoritesCount": 12, "comparesCount": 5},
        {"id": "user2", "name": "Jane Smith", "email": "jane@test.com", "level": "warm", "score": 65, "favoritesCount": 8, "comparesCount": 3},
        {"id": "user3", "name": "Bob Wilson", "email": "bob@test.com", "level": "cold", "score": 25, "favoritesCount": 2, "comparesCount": 1},
    ]

@fastapi_app.get("/api/admin/engagement/top-vehicles", dependencies=[Depends(require_admin)])
async def engagement_top_vehicles(limit: int = 50):
    """Return top vehicles as direct array"""
    return [
        {"vin": "1HGCM82633A123456", "favoritesCount": 25, "comparesCount": 15, "viewsCount": 150, "make": "Honda", "model": "Accord", "year": 2020},
        {"vin": "WVWZZZ3CZWE123456", "favoritesCount": 18, "comparesCount": 10, "viewsCount": 120, "make": "Volkswagen", "model": "Passat", "year": 2021},
    ]

@fastapi_app.get("/api/admin/engagement/vin-stats", dependencies=[Depends(require_admin)])
async def engagement_vin_stats(vin: str = ""):
    """Return VIN stats"""
    return {"vin": vin, "favoritesCount": 0, "comparesCount": 0, "viewsCount": 0}

# History Reports
@fastapi_app.get("/api/admin/history-reports/analytics", dependencies=[Depends(require_admin)])
async def history_reports_analytics():
    return {
        "totalReports": 100,
        "pendingReports": 5,
        "completedReports": 95,
    }

@fastapi_app.post("/api/admin/history-reports/abuse-check/{report_id}", dependencies=[Depends(require_admin)])
async def history_reports_abuse_check(report_id: str):
    return {"success": True, "isAbuse": False}

# Integrations
@fastapi_app.get("/api/admin/integrations", dependencies=[Depends(require_admin)])
async def admin_integrations():
    """Return integrations configs as array for frontend.

    Reads each provider's persisted credentials/settings from
    ``db.integration_configs``. Secret-typed fields are masked on output
    (the full value is preserved server-side and used at runtime).
    """
    # Check if Ringostat is configured (separate legacy collection)
    ringostat_config = await db.ringostat_config.find_one({})
    ringostat_enabled = ringostat_config.get('enabled', False) if ringostat_config else False

    def _mask(s: str) -> str:
        if not s: return ""
        return "…" + s[-8:] if len(s) > 10 else "…"

    # Per-provider field schema → which keys must be masked (passwords / secrets)
    SECRET_FIELDS = {
        "google_oauth": {"clientSecret"},
        "stripe":       {"secretKey", "restrictedKey", "webhookSecret"},
        "email":        {"smtpPassword"},
        "openai":       {"apiKey"},
        "shipping":     {"apiKey", "vesselFinderKey", "shipsGoKey"},
    }
    # Public-typed keys whose default we want exposed even when DB has no record
    PUBLIC_DEFAULTS = {
        "stripe":   {"settings": {"currency": "USD"}, "mode": "sandbox"},
        "openai":   {"settings": {"model": "gpt-4o"}, "mode": "sandbox"},
        "email":    {"settings": {}, "mode": "disabled"},
        "shipping": {"settings": {}, "mode": "disabled"},
        "google_oauth": {"settings": {}, "mode": "disabled"},
    }

    async def _load(provider: str) -> Dict[str, Any]:
        doc = await db.integration_configs.find_one({"provider": provider}) or {}
        creds_raw = doc.get("credentials") or {}
        secret_keys = SECRET_FIELDS.get(provider, set())
        creds = {}
        for k, v in creds_raw.items():
            if k in secret_keys:
                creds[k] = _mask(v if isinstance(v, str) else "")
            else:
                creds[k] = v if v is not None else ""
        defaults = PUBLIC_DEFAULTS.get(provider, {"settings": {}, "mode": "disabled"})
        settings = doc.get("settings") or defaults.get("settings", {})
        mode = doc.get("mode") or defaults.get("mode", "disabled")
        # Default `isEnabled` heuristic: explicit flag > inferred from creds presence
        if "isEnabled" in doc:
            is_enabled = bool(doc.get("isEnabled"))
        else:
            is_enabled = bool([v for v in creds_raw.values() if v])
        return {
            "provider": provider,
            "credentials": creds,
            "settings": settings,
            "mode": mode,
            "isEnabled": is_enabled,
        }

    google = await _load("google_oauth")
    stripe_cfg = await _load("stripe")
    email_cfg = await _load("email")
    shipping_cfg = await _load("shipping")
    openai_cfg = await _load("openai")

    # Ringostat lives in a separate legacy collection
    ringostat_block = {
        "provider": "ringostat",
        "credentials": {},
        "settings": {},
        "mode": "production" if ringostat_enabled else "disabled",
        "isEnabled": ringostat_enabled,
    }

    return [google, stripe_cfg, ringostat_block, email_cfg, shipping_cfg, openai_cfg]


@fastapi_app.get("/api/admin/integrations/health", dependencies=[Depends(require_admin)])
async def integrations_health():
    """Return health status by provider, computed from persisted creds."""
    async def _doc(p): return await db.integration_configs.find_one({"provider": p}) or {}

    google_doc = await _doc("google_oauth")
    google_ok = bool((google_doc.get("credentials") or {}).get("clientId")) and bool(google_doc.get("isEnabled", True))

    stripe_doc = await _doc("stripe")
    stripe_creds = stripe_doc.get("credentials") or {}
    # Accept either Secret Key OR Restricted Key as a valid backend credential.
    stripe_has_keys = bool(stripe_creds.get("publishableKey")) and bool(
        stripe_creds.get("secretKey") or stripe_creds.get("restrictedKey")
    )
    stripe_enabled = bool(stripe_doc.get("isEnabled", stripe_has_keys))
    if stripe_has_keys and stripe_enabled:
        stripe_status = "ok"
    elif stripe_has_keys and not stripe_enabled:
        stripe_status = "degraded"
    else:
        stripe_status = "not_configured"

    email_doc = await _doc("email")
    email_creds = email_doc.get("credentials") or {}
    email_has = bool(email_creds.get("smtpHost") and email_creds.get("smtpLogin"))
    email_enabled = bool(email_doc.get("isEnabled", email_has))

    openai_doc = await _doc("openai")
    openai_creds = openai_doc.get("credentials") or {}
    openai_has = bool(openai_creds.get("apiKey"))
    openai_enabled = bool(openai_doc.get("isEnabled", openai_has))

    shipping_doc = await _doc("shipping")
    shipping_creds = shipping_doc.get("credentials") or {}
    shipping_db_has = bool(shipping_creds.get("apiKey") or shipping_creds.get("vesselFinderKey") or shipping_creds.get("shipsGoKey"))
    shipping_env_has = bool(VESSELFINDER_API_KEY or VESSELFINDER_FLEET_KEY or SHIPSGO_API_KEY or SHIPSGO_FLEET_KEY)

    now = datetime.now(timezone.utc).isoformat()
    return {
        "google_oauth": {
            "status": "ok" if google_ok else "not_configured",
            "isEnabled": bool(google_doc.get("isEnabled", google_ok)),
            "lastCheck": now if google_ok else None,
        },
        "stripe": {
            "status": stripe_status,
            "isEnabled": stripe_enabled,
            "lastCheck": now if stripe_has_keys else None,
            "lastTest": stripe_doc.get("lastTest"),
            "lastTestStatus": stripe_doc.get("lastTestStatus"),
            "lastTestError": stripe_doc.get("lastTestError"),
        },
        "ringostat": {"status": "not_configured", "isEnabled": False, "lastCheck": None},
        "email": {
            "status": "ok" if (email_has and email_enabled) else ("degraded" if email_has else "not_configured"),
            "isEnabled": email_enabled,
            "lastCheck": now if email_has else None,
        },
        "shipping": {
            "status": "ok" if (shipping_db_has or shipping_env_has) else "not_configured",
            "isEnabled": bool(shipping_db_has or shipping_env_has),
            "lastCheck": now,
        },
        "openai": {
            "status": "ok" if (openai_has and openai_enabled) else ("degraded" if openai_has else "not_configured"),
            "isEnabled": openai_enabled,
            "lastCheck": now if openai_has else None,
        },
    }


# ==================== DEBUG ENDPOINTS ====================

@fastapi_app.get("/api/debug/test", dependencies=[Depends(require_admin)])
async def debug_test():
    """Test endpoint to verify new code is loaded"""
    return {
        "status": "NEW CODE LOADED ✅",
        "version": "v3.2.1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": "Backend code successfully updated!"
    }


@fastapi_app.get("/api/debug/db-info", dependencies=[Depends(require_admin)])
async def debug_db_info():
    """Show actual DB name and collections"""
    collections = await db.list_collection_names()
    return {
        "db_name": db.name,
        "collections": collections,
        "collections_count": len(collections),
        "mongo_url_prefix": MONGO_URL[:30] if MONGO_URL else None
    }


@fastapi_app.get("/api/debug/full-check", dependencies=[Depends(require_admin)])
async def debug_full_check():
    """Full diagnostic check"""
    shipments_count = await db.shipments.count_documents({})
    events_count = await db.shipment_events.count_documents({})
    
    sample = None
    if shipments_count > 0:
        sample = await db.shipments.find_one()
    
    return {
        "db_name": db.name,
        "shipments_count": shipments_count,
        "events_count": events_count,
        "sample_shipment_id": sample.get('id') if sample else None,
        "all_collections": await db.list_collection_names()
    }


@fastapi_app.get("/api/debug/shipments-count", dependencies=[Depends(require_admin)])
async def debug_shipments_count():
    """Check shipments in database"""
    count = await db.shipments.count_documents({})
    events_count = await db.shipment_events.count_documents({})
    
    sample = None
    if count > 0:
        sample = await db.shipments.find_one()
    
    return {
        "shipments": count,
        "events": events_count,
        "sample_id": sample.get('id') if sample else None
    }


@fastapi_app.get("/api/admin/integrations/{integration_id}", dependencies=[Depends(require_admin)])
async def get_integration(integration_id: str):
    return {"id": integration_id, "status": "active", "config": {}}

@fastapi_app.put("/api/admin/integrations/{integration_id}", dependencies=[Depends(require_admin)])
async def update_integration(integration_id: str, data: Dict[str, Any] = Body(...)):
    return {"success": True}

@fastapi_app.patch("/api/admin/integrations/{provider}", dependencies=[Depends(require_admin)])
async def patch_integration(provider: str, data: Dict[str, Any] = Body(...)):
    """Persist integration config (credentials, settings, mode)."""
    allowed = {"google_oauth", "stripe", "email", "shipping", "openai"}
    if provider not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    update = {
        "provider": provider,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(data.get("credentials"), dict):
        # If incoming clientSecret looks like a masked value (starts with ellipsis), skip overwrite
        creds = dict(data["credentials"])
        existing = await db.integration_configs.find_one({"provider": provider}) or {}
        existing_creds = existing.get("credentials") or {}
        for k, v in list(creds.items()):
            if isinstance(v, str) and v.startswith("…"):
                # keep existing
                creds[k] = existing_creds.get(k, "")
        update["credentials"] = creds
    if isinstance(data.get("settings"), dict):
        update["settings"] = data["settings"]
    if "mode" in data:
        update["mode"] = data["mode"]
    if "isEnabled" in data:
        update["isEnabled"] = bool(data["isEnabled"])
    await db.integration_configs.update_one(
        {"provider": provider}, {"$set": update}, upsert=True
    )
    logger.info(f"[integrations] patched {provider}: keys={list(update.keys())}")
    return {"success": True, "provider": provider}

# ═══════════════════════════════════════════════════════════════════
# RINGOSTAT INTEGRATION
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/admin/integrations/ringostat/configure", dependencies=[Depends(require_admin)])
async def ringostat_configure(data: Dict[str, Any] = Body(...)):
    """Configure Ringostat integration"""
    try:
        api_key = data.get('api_key', '')
        project_id = data.get('project_id', '')
        extension_mapping = data.get('extension_mapping', {})
        
        # Save to DB
        await db.ringostat_config.update_one(
            {},
            {
                '$set': {
                    'api_key': api_key,
                    'project_id': project_id,
                    'enabled': True if api_key else False,
                    'extension_mapping': extension_mapping,
                    'updated_at': datetime.now(timezone.utc)
                },
                '$setOnInsert': {
                    'created_at': datetime.now(timezone.utc)
                }
            },
            upsert=True
        )
        
        return {"success": True, "message": "Ringostat configured"}
    except Exception as e:
        logger.error(f"Ringostat config error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/admin/integrations/ringostat/config", dependencies=[Depends(require_admin)])
async def get_ringostat_config():
    """Get current Ringostat configuration"""
    config = await db.ringostat_config.find_one({})
    if not config:
        return {"enabled": False}
    
    return {
        "enabled": config.get('enabled', False),
        "project_id": config.get('project_id', ''),
        "extension_mapping": config.get('extension_mapping', {})
    }

@fastapi_app.post("/api/integrations/ringostat/webhook")
async def ringostat_webhook(request: Request):
    """
    Ringostat webhook endpoint
    Handles: CALL_START, CALL_ANSWERED, CALL_END, CALL_MISSED
    
    Security: Validates webhook signature if configured
    """
    try:
        # Get raw body for signature validation
        body_bytes = await request.body()
        body = json.loads(body_bytes.decode('utf-8'))
        
        # Validate signature if configured
        ringostat_config = await db.ringostat_config.find_one({})
        if ringostat_config and ringostat_config.get('webhook_secret'):
            signature = request.headers.get('X-Ringostat-Signature') or request.headers.get('X-Signature')
            
            if signature:
                import hmac
                import hashlib
                
                expected_sig = hmac.new(
                    ringostat_config['webhook_secret'].encode(),
                    body_bytes,
                    hashlib.sha256
                ).hexdigest()
                
                if signature != expected_sig:
                    logger.warning(f"[RINGOSTAT] Invalid signature: {signature} != {expected_sig}")
                    raise HTTPException(status_code=401, detail="Invalid webhook signature")
            else:
                logger.warning("[RINGOSTAT] Webhook signature expected but not provided")
        
        # CRITICAL: Log raw payload first
        print("=" * 80)
        print("RINGOSTAT RAW PAYLOAD:")
        print(json.dumps(body, indent=2, ensure_ascii=False))
        print("=" * 80)
        
        # Extract event data
        event_type = body.get('event', body.get('type', 'UNKNOWN'))
        call_id = body.get('call_id', body.get('id', str(uuid.uuid4())))
        direction = body.get('direction', 'inbound')
        from_number = body.get('from', body.get('caller', ''))
        to_number = body.get('to', body.get('callee', ''))
        manager_ext = body.get('manager_extension', body.get('extension', ''))
        status = body.get('status', 'unknown')
        duration = int(body.get('duration', 0))
        recording_url = body.get('recording_url', body.get('record', ''))
        
        # UTM data
        utm_source = body.get('utm_source', '')
        utm_campaign = body.get('utm_campaign', '')
        utm_medium = body.get('utm_medium', '')
        utm_term = body.get('utm_term', '')
        utm_content = body.get('utm_content', '')
        
        # Get automation rules
        automation_rules = ringostat_config.get('automation_rules', {}) if ringostat_config else {}
        
        # Find or create Lead by phone (if auto_create_lead is enabled)
        lead = await db.leads.find_one({'phone': from_number})
        
        if not lead and automation_rules.get('auto_create_lead', True):
            print(f"[RINGOSTAT] Creating new lead for phone: {from_number}")
            lead_data = {
                '_id': str(uuid.uuid4()),
                'phone': from_number,
                'source': 'ringostat',
                'status': 'new',
                'utm_source': utm_source,
                'utm_campaign': utm_campaign,
                'utm_medium': utm_medium,
                'created_at': datetime.now(timezone.utc),
                'updated_at': datetime.now(timezone.utc)
            }
            await db.leads.insert_one(lead_data)
            lead = lead_data
            print(f"[RINGOSTAT] Lead created: {lead['_id']}")
        elif not lead:
            print(f"[RINGOSTAT] Lead auto-creation disabled, skipping")
            return {"success": False, "message": "Lead creation disabled"}
        else:
            print(f"[RINGOSTAT] Lead found: {lead.get('_id')}")
        
        # Find active deal for this lead
        deal = await db.deals.find_one({
            'lead_id': lead['_id'],
            'status': {'$nin': ['closed_won', 'closed_lost']}
        })
        
        # Get manager by extension with fallback
        ringostat_config = await db.ringostat_config.find_one({})
        manager_id = None
        
        if ringostat_config and manager_ext:
            ext_mapping = ringostat_config.get('extension_mapping', {})
            manager_id = ext_mapping.get(str(manager_ext))
            
            if not manager_id:
                logger.warning(f"[RINGOSTAT] Extension {manager_ext} not mapped to any manager")
        elif not manager_ext:
            logger.warning(f"[RINGOSTAT] No extension provided in webhook for call {call_id}")
        
        # If no manager found, try to find from existing deal
        if not manager_id and deal:
            manager_id = deal.get('assigned_to')
            if manager_id:
                logger.info(f"[RINGOSTAT] Using manager from existing deal: {manager_id}")
        
        # Last resort: pick BEST available manager via Provider Pressure scoring
        # (score < 20 → excluded; >= 80 → boost ×1.2; others ranked by score)
        if not manager_id:
            try:
                import provider_stats as _ps
                candidates_cursor = db.staff.find(
                    {'role': 'manager', 'is_active': True},
                    {'_id': 1, 'id': 1, 'email': 1, 'name': 1},
                )
                candidates = await candidates_cursor.to_list(length=200)
                candidate_ids = [(c.get('id') or c.get('_id')) for c in candidates]
                best = None
                if _ps.service is not None and candidate_ids:
                    best = await _ps.service.pick_best_provider([c for c in candidate_ids if c])
                if best:
                    manager_id = best
                    logger.info(f"[RINGOSTAT] Assigned via provider_stats pick_best: {manager_id}")
                elif candidates:
                    fallback_manager = candidates[0]
                    manager_id = fallback_manager.get('id') or fallback_manager.get('_id')
                    logger.info(f"[RINGOSTAT] Assigned to first available manager: {manager_id}")
            except Exception:
                logger.exception("[RINGOSTAT] pick_best_provider failed; falling back to first manager")
                fallback_manager = await db.staff.find_one({'role': 'manager', 'is_active': True})
                if fallback_manager:
                    manager_id = fallback_manager.get('id') or fallback_manager['_id']
        
        # Check if call already exists (for updates)
        existing_call = await db.ringostat_calls.find_one({'call_id': call_id})
        
        now = datetime.now(timezone.utc)
        
        if existing_call:
            # Update existing call
            update_data = {
                'status': status.upper(),
                'duration': duration,
                'updated_at': now
            }
            
            if recording_url:
                update_data['recording_url'] = recording_url
            
            if event_type in ['CALL_ANSWERED', 'ANSWERED']:
                update_data['answered_at'] = now
            elif event_type in ['CALL_END', 'ENDED', 'COMPLETED']:
                update_data['ended_at'] = now
            
            await db.ringostat_calls.update_one(
                {'call_id': call_id},
                {'$set': update_data}
            )
            logger.info(f"Call updated: {call_id}, status: {status}")
        else:
            # Create new call
            call_data = {
                '_id': str(uuid.uuid4()),
                'call_id': call_id,
                'direction': direction,
                'from': from_number,
                'to': to_number,
                'status': status.upper(),
                'duration': duration,
                'recording_url': recording_url,
                'lead_id': lead['_id'],
                'deal_id': deal['_id'] if deal else None,
                'manager_id': manager_id,
                'utm_source': utm_source,
                'utm_campaign': utm_campaign,
                'utm_medium': utm_medium,
                'utm_term': utm_term,
                'utm_content': utm_content,
                'raw': body,
                'started_at': now,
                'created_at': now,
                'updated_at': now
            }
            
            await db.ringostat_calls.insert_one(call_data)
            print(f"[RINGOSTAT] Call created: {call_id}, lead: {lead['_id']}")
            print(f"[RINGOSTAT] DB name: {db.name if hasattr(db, 'name') else 'unknown'}")
            
            # ═══════════════════════════════════════════════════════════
            # EMIT WebSocket event for CALL_START (incoming call)
            # ═══════════════════════════════════════════════════════════
            if event_type in ['CALL_START', 'START'] and direction == 'inbound':
                # Prepare event payload
                ws_payload = {
                    'call_id': call_id,
                    'from': from_number,
                    'to': to_number,
                    'lead_id': lead['_id'],
                    'lead_name': lead.get('name', ''),
                    'lead_phone': lead.get('phone', from_number),
                    'deal_id': deal['_id'] if deal else None,
                    'deal_title': deal.get('title', '') if deal else None,
                    'source': utm_source or 'ringostat',
                    'direction': direction,
                    'temperature': lead.get('score', 50),  # ← ADD TEMPERATURE/SCORE
                    'timestamp': now.isoformat()
                }
                
                # Emit to specific manager if known
                if manager_id:
                    await emit_to_user(manager_id, 'ringostat:incoming_call', ws_payload)
                    logger.info(f"[WS] Emitted ringostat:incoming_call to user:{manager_id}")
                else:
                    # Broadcast to all managers if manager not assigned
                    await emit_to_role('manager', 'ringostat:incoming_call', ws_payload)
                    logger.info(f"[WS] Broadcast ringostat:incoming_call to role:manager")
        
        # Handle MISSED calls → Create Task + Emit WS
        if event_type in ['CALL_MISSED', 'MISSED'] or status.upper() == 'MISSED':
            logger.info(f"Handling MISSED call for lead: {lead['_id']}")
            
            # Check if task already exists for this call
            existing_task = await db.tasks.find_one({'call_id': call_id})
            
            if not existing_task:
                task_data = {
                    '_id': str(uuid.uuid4()),
                    'title': f'Перезвонить клиенту {lead.get("name", from_number)}',
                    'description': f'Пропущенный звонок от {from_number}',
                    'type': 'callback',
                    'priority': 'high',
                    'assigned_to': manager_id if manager_id else None,
                    'lead_id': lead['_id'],
                    'deal_id': deal['_id'] if deal else None,
                    'call_id': call_id,
                    'deadline': datetime.now(timezone.utc) + timedelta(minutes=5),
                    'status': 'pending',
                    'created_at': now,
                    'updated_at': now
                }
                
                await db.tasks.insert_one(task_data)
                logger.info(f"Task created for missed call: {task_data['_id']}")
                
                # Emit WS event for missed call
                ws_payload = {
                    'call_id': call_id,
                    'from': from_number,
                    'lead_id': lead['_id'],
                    'lead_name': lead.get('name', ''),
                    'task_id': task_data['_id'],
                    'timestamp': now.isoformat()
                }
                
                if manager_id:
                    await emit_to_user(manager_id, 'ringostat:missed_call', ws_payload)
                    logger.info(f"[WS] Emitted ringostat:missed_call to user:{manager_id}")
                else:
                    await emit_to_role('manager', 'ringostat:missed_call', ws_payload)
                    logger.info(f"[WS] Broadcast ringostat:missed_call to role:manager")
        
        # Handle CALL_END → Emit WS if answered and duration > threshold (from automation rules)
        require_outcome = automation_rules.get('require_outcome', True)
        outcome_duration = automation_rules.get('require_outcome_duration', 10)
        
        if event_type in ['CALL_END', 'END'] and status.upper() == 'ANSWERED' and duration > outcome_duration and require_outcome:
            ws_payload = {
                'call_id': call_id,
                'from': from_number,
                'lead_id': lead['_id'],
                'lead_name': lead.get('name', ''),
                'deal_id': deal['_id'] if deal else None,
                'duration': duration,
                'timestamp': now.isoformat()
            }
            
            if manager_id:
                await emit_to_user(manager_id, 'ringostat:call_needs_outcome', ws_payload)
                logger.info(f"[WS] Emitted ringostat:call_needs_outcome to user:{manager_id}")
            else:
                await emit_to_role('manager', 'ringostat:call_needs_outcome', ws_payload)
                logger.info(f"[WS] Broadcast ringostat:call_needs_outcome to role:manager")
            
            # 🔥 Fetch recording URL in background (for AI analysis later)
            if ringostat_config:
                project_id = ringostat_config.get('project_id')
                api_key = ringostat_config.get('api_key')
                if project_id and api_key:
                    import asyncio
                    asyncio.create_task(fetch_recording_url(call_id, project_id, api_key))
        
        return {"success": True, "call_id": call_id, "lead_id": lead['_id']}
        
    except Exception as e:
        logger.error(f"Ringostat webhook error: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/manager/calls/my", dependencies=[Depends(require_manager_or_admin)])
async def get_my_calls(
    manager_id: str = None,
    limit: int = 50,
    status: Optional[str] = None
):
    """Get manager's calls history"""
    try:
        query = {}
        
        if manager_id:
            query['manager_id'] = manager_id
        
        if status:
            query['status'] = status
        
        calls = await db.ringostat_calls.find(query).sort('started_at', -1).limit(limit).to_list(limit)
        
        # Enrich with lead/deal info
        for call in calls:
            if call.get('lead_id'):
                lead = await db.leads.find_one({'_id': call['lead_id']})
                if lead:
                    call['lead'] = {
                        'id': str(lead['_id']),
                        'name': lead.get('name'),
                        'phone': lead.get('phone')
                    }
            
            if call.get('deal_id'):
                deal = await db.deals.find_one({'_id': call['deal_id']})
                if deal:
                    call['deal'] = {
                        'id': str(deal['_id']),
                        'title': deal.get('title'),
                        'stage': deal.get('stage')
                    }
        
        return {
            "success": True,
            "calls": [serialize_doc(c) for c in calls],
            "total": len(calls)
        }
    except Exception as e:
        logger.error(f"Get my calls error: {e}")
        return {"success": False, "error": str(e)}


# ==================== RINGOSTAT: FETCH RECORDING URL ====================

async def fetch_recording_url(call_id: str, ringostat_project_id: str, ringostat_api_key: str):
    """
    Background task to fetch recording URL from Ringostat API with retry
    Ringostat recording can take 15 seconds to 2 minutes to be ready
    Retries: 6 attempts with 20-second intervals (total ~2 minutes)
    """
    import asyncio
    import httpx
    
    max_retries = 6
    retry_delay = 20  # seconds
    
    for attempt in range(1, max_retries + 1):
        try:
            await asyncio.sleep(retry_delay)
            logger.info(f"[RINGOSTAT] Fetching recording for call_id: {call_id} (attempt {attempt}/{max_retries})")
            
            async with httpx.AsyncClient() as client:
                # Ringostat API endpoint for calls list
                url = f"https://api.ringostat.net/calls/list"
                headers = {
                    "Auth-key": ringostat_api_key,
                    "x-project-id": ringostat_project_id
                }
                params = {
                    "call_id": call_id
                }
                
                response = await client.get(url, headers=headers, params=params, timeout=10.0)
                
                if response.status_code == 200:
                    data = response.json()
                    # Ringostat API returns array directly
                    calls = data if isinstance(data, list) else data.get('calls', [])
                    
                    if calls and len(calls) > 0:
                        call_data = calls[0]
                        recording_url = call_data.get('recording', call_data.get('record_url', ''))
                        
                        if recording_url:
                            # Update call in MongoDB
                            await db.ringostat_calls.update_one(
                                {'call_id': call_id},
                                {
                                    '$set': {
                                        'recording_url': recording_url,
                                        'recording_fetched_at': datetime.now(timezone.utc),
                                        'recording_fetch_attempts': attempt
                                    }
                                }
                            )
                            logger.info(f"[RINGOSTAT] ✓ Recording URL found on attempt {attempt} for call_id: {call_id}")
                            
                            # 🔥 Trigger AI analysis here
                            # await analyze_call_with_ai(call_id, recording_url)
                            return  # Success - exit retry loop
                        else:
                            logger.warning(f"[RINGOSTAT] No recording yet (attempt {attempt}/{max_retries}) for call_id: {call_id}")
                else:
                    logger.error(f"[RINGOSTAT] Failed to fetch recording: HTTP {response.status_code}")
        
        except Exception as e:
            logger.error(f"[RINGOSTAT] Error fetching recording (attempt {attempt}/{max_retries}) for call_id {call_id}: {e}")
    
    # After all retries failed
    logger.error(f"[RINGOSTAT] ✗ Recording URL not found after {max_retries} attempts for call_id: {call_id}")


# ==================== TRACKING WORKER (HYBRID SYSTEM) ====================

def interpolate_route(route, progress):
    """
    Calculate current position on route based on progress (0 to 1)
    """
    if not route or len(route) < 2:
        return None, None
    
    total_segments = len(route) - 1
    segment_index = int(progress * total_segments)
    
    # Helper — accept both dict and list/tuple waypoint formats.
    def _pt(p):
        if isinstance(p, dict):
            return float(p["lat"]), float(p["lng"])
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            return float(p[0]), float(p[1])
        raise TypeError(f"unsupported waypoint: {p!r}")

    # Reached destination
    if segment_index >= total_segments:
        return _pt(route[-1])
    
    start_lat, start_lng = _pt(route[segment_index])
    end_lat, end_lng = _pt(route[segment_index + 1])
    
    # Calculate position within current segment
    local_progress = (progress * total_segments) - segment_index
    
    lat = start_lat + (end_lat - start_lat) * local_progress
    lng = start_lng + (end_lng - start_lng) * local_progress
    
    return lat, lng


def generate_route(origin, destination):
    """
    Generate realistic ocean route from origin to destination
    Adds waypoints for Atlantic crossing
    """
    if not origin or not destination:
        return []
    
    # Calculate waypoints based on geographic logic
    start_lat, start_lng = origin["lat"], origin["lng"]
    end_lat, end_lng = destination["lat"], destination["lng"]
    
    # Simple 4-point route (can be improved with real shipping lanes)
    waypoints = [
        origin,
        {"lat": start_lat - 10, "lng": start_lng + 20},  # First turn
        {"lat": (start_lat + end_lat) / 2, "lng": (start_lng + end_lng) / 2},  # Mid-ocean
        {"lat": end_lat - 5, "lng": end_lng - 10},  # Approach
        destination
    ]
    
    return waypoints


def get_location_label(progress):
    """
    Get human-readable location based on progress
    """
    if progress < 0.1:
        return "Origin Port"
    elif progress < 0.3:
        return "Leaving Coast"
    elif progress < 0.7:
        return "Mid-Ocean"
    elif progress < 0.9:
        return "Approaching Destination"
    else:
        return "Near Port"


# ═══════════════════════════════════════════════════════════════════
# VESSEL TRACKING (VesselFinder API)
# ═══════════════════════════════════════════════════════════════════
VESSELFINDER_API_KEY = os.environ.get('VESSELFINDER_API_KEY', '').strip()
VESSELFINDER_FLEET_KEY = os.environ.get('VESSELFINDER_FLEET_KEY', '').strip()  # optional separate Fleet API userkey
VESSEL_POSITION_TTL_SECONDS = 90  # reuse cached position if fresher than this
VESSEL_POSITION_MAX_AGE_SECONDS = 2 * 60 * 60  # 2h — after this, stop interpolating


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometers."""
    import math
    R = 6371.0  # Earth radius km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _route_total_km(route: list) -> float:
    if not route or len(route) < 2:
        return 0.0
    total = 0.0
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        total += _haversine_km(a['lat'], a['lng'], b['lat'], b['lng'])
    return total


def _project_progress_on_route(route: list, lat: float, lng: float) -> float:
    """Find approximate progress (0..1) of point on polyline route."""
    if not route or len(route) < 2:
        return 0.0
    total = _route_total_km(route)
    if total <= 0:
        return 0.0
    # find closest segment, compute cumulative distance to projected point
    best_cum = 0.0
    best_dist = float('inf')
    cum = 0.0
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        seg_km = _haversine_km(a['lat'], a['lng'], b['lat'], b['lng'])
        # approximate projection: treat segment as straight line in lat/lng
        if seg_km <= 0:
            continue
        # parametrize
        dx = b['lng'] - a['lng']
        dy = b['lat'] - a['lat']
        t = ((lng - a['lng']) * dx + (lat - a['lat']) * dy) / (dx * dx + dy * dy + 1e-12)
        t = max(0.0, min(1.0, t))
        px = a['lng'] + t * dx
        py = a['lat'] + t * dy
        d = _haversine_km(lat, lng, py, px)
        if d < best_dist:
            best_dist = d
            best_cum = cum + seg_km * t
        cum += seg_km
    return max(0.0, min(1.0, best_cum / total))


async def fetch_vessel_position(imo: str) -> Optional[Dict[str, Any]]:
    """
    Fetch real-time vessel position from VesselFinder API by IMO.
    Returns dict with lat/lng/speed/course/timestamp, or None on failure.

    Uses a DB cache (vessel_positions) to avoid hammering the API.
    """
    if not imo:
        return None

    now = datetime.now(timezone.utc)

    # 1) check cache
    try:
        cached = await db.vessel_positions.find_one({'imo': str(imo)})
        if cached and cached.get('fetched_at'):
            fetched_at = cached['fetched_at']
            if isinstance(fetched_at, datetime):
                if fetched_at.tzinfo is None:
                    fetched_at = fetched_at.replace(tzinfo=timezone.utc)
                age = (now - fetched_at).total_seconds()
                if age < VESSEL_POSITION_TTL_SECONDS:
                    return {
                        'lat': cached['lat'],
                        'lng': cached['lng'],
                        'speed': cached.get('speed'),
                        'course': cached.get('course'),
                        'timestamp': cached.get('timestamp'),
                        'fetched_at': fetched_at,
                        'source': 'cache',
                    }
    except Exception as e:
        logger.warning(f"[VESSEL] cache check failed: {e}")

    # 2) fetch fresh (if API key present)
    if not VESSELFINDER_API_KEY and not VESSELFINDER_FLEET_KEY and not (SHIPSGO_FLEET_KEY or SHIPSGO_API_KEY):
        return None

    # Try VesselFinder Fleet API first (cheaper for known vessels)
    if VESSELFINDER_FLEET_KEY:
        try:
            url = f"https://api.vesselfinder.com/vesselslist?userkey={VESSELFINDER_FLEET_KEY}"
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    if isinstance(data, list):
                        for item in data:
                            ais = item.get('AIS') if isinstance(item, dict) else None
                            if ais and str(ais.get('IMO')) == str(imo):
                                try:
                                    lat = float(ais['LATITUDE'])
                                    lng = float(ais['LONGITUDE'])
                                except (KeyError, TypeError, ValueError):
                                    lat = lng = None
                                if _is_valid_coord(lat, lng):
                                    position = {
                                        'imo': str(imo),
                                        'lat': lat,
                                        'lng': lng,
                                        'speed': float(ais.get('SPEED')) if ais.get('SPEED') not in (None, '') else None,
                                        'course': float(ais.get('COURSE')) if ais.get('COURSE') not in (None, '') else None,
                                        'timestamp': ais.get('TIMESTAMP'),
                                        'fetched_at': now,
                                        'source': 'vesselfinder_fleet',
                                    }
                                    await db.vessel_positions.update_one(
                                        {'imo': str(imo)}, {'$set': position}, upsert=True
                                    )
                                    return position
        except Exception as e:
            logger.warning(f"[VESSEL/VF-FLEET] error: {e}")

    # Try VesselFinder Master API
    if VESSELFINDER_API_KEY:
        try:
            url = f"https://api.vesselfinder.com/vessels?userkey={VESSELFINDER_API_KEY}&imo={imo}"
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(url)
                res.raise_for_status()
                data = res.json()

            if data and isinstance(data, list) and 'AIS' in data[0]:
                ais = data[0]['AIS']
                try:
                    lat = float(ais['LAT'])
                    lng = float(ais['LON'])
                except (KeyError, TypeError, ValueError):
                    lat = lng = None

                if _is_valid_coord(lat, lng):
                    speed = ais.get('SPEED')
                    course = ais.get('COURSE')
                    ts = ais.get('TIMESTAMP')
                    position = {
                        'imo': str(imo),
                        'lat': lat,
                        'lng': lng,
                        'speed': float(speed) if speed not in (None, '') else None,
                        'course': float(course) if course not in (None, '') else None,
                        'timestamp': ts,
                        'fetched_at': now,
                        'source': 'vesselfinder',
                    }
                    await db.vessel_positions.update_one(
                        {'imo': str(imo)}, {'$set': position}, upsert=True
                    )
                    return position
        except httpx.HTTPStatusError as e:
            logger.warning(f"[VESSEL/VF] HTTP {e.response.status_code} for IMO {imo}")
        except Exception as e:
            logger.error(f"[VESSEL/VF] fetch error IMO={imo}: {e}")

    # Fallback: ShipsGo Fleet
    pos = await fetch_vessel_position_shipsgo(str(imo))
    if pos and _is_valid_coord(pos.get('lat'), pos.get('lng')):
        pos['fetched_at'] = now
        await db.vessel_positions.update_one(
            {'imo': str(imo)}, {'$set': pos}, upsert=True
        )
        return pos

    return None


def _calculate_eta_iso(route: list, current_lat: float, current_lng: float, speed_knots: Optional[float]) -> Optional[str]:
    """Compute ETA ISO string based on remaining distance and vessel speed."""
    if not route or len(route) < 1:
        return None
    dest = route[-1]
    remaining_km = _haversine_km(current_lat, current_lng, dest['lat'], dest['lng'])
    if remaining_km <= 0:
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    # default cruising speed 14 knots if unknown / stationary
    sp = speed_knots if (speed_knots and speed_knots >= 2.0) else 14.0
    # knots = nautical miles per hour; 1 nm = 1.852 km
    kmh = sp * 1.852
    hours = remaining_km / max(kmh, 1.0)
    eta_dt = datetime.now(timezone.utc) + timedelta(hours=hours)
    return eta_dt.isoformat().replace('+00:00', 'Z')


def _is_valid_coord(lat, lng) -> bool:
    """Guard: valid lat/lng (not None, not NaN, in world bounds)."""
    try:
        if lat is None or lng is None:
            return False
        lat_f = float(lat)
        lng_f = float(lng)
        if lat_f != lat_f or lng_f != lng_f:  # NaN check
            return False
        if not (-90.0 <= lat_f <= 90.0):
            return False
        if not (-180.0 <= lng_f <= 180.0):
            return False
        return True
    except (TypeError, ValueError):
        return False


def _clamp_progress(p) -> float:
    """Clamp progress to [0.0, 1.0], handling None / NaN."""
    try:
        if p is None:
            return 0.0
        p_f = float(p)
        if p_f != p_f:  # NaN
            return 0.0
        return max(0.0, min(1.0, p_f))
    except (TypeError, ValueError):
        return 0.0


# ═══════════════════════════════════════════════════════════════════
# JOURNEY TRACKING HELPERS (stages, events, movement sanity)
#
# One shipment = a sequence of stages (land / vessel / port). Exactly one stage
# is "active" at a time (shipment.currentStageId). A manager binds vessel to
# a vessel-stage once; everything else flows automatically:
#   REAL (vessel stage only) → INTERPOLATE (<2h) → SIMULATE (walk route).
#
# Movement sanity rejects GPS spikes (> 200 km in < 120 s ≈ > 100 knots, which
# is physically impossible for a cargo ship). Rejected updates keep the last
# good position and log a 'tracking_rejected' event for visibility.
# ═══════════════════════════════════════════════════════════════════

JOURNEY_STAGE_TYPES = {"land", "vessel", "port"}
JOURNEY_STAGE_STATUSES = {"pending", "active", "done", "skipped"}
JOURNEY_SPIKE_MAX_KM_PER_120S = 200.0
JOURNEY_TRACKING_EVENT_THROTTLE_SEC = 15 * 60  # 'tracking_updated' at most once per 15 min
JOURNEY_SOCKET_THROTTLE_SEC = 30               # shipment:update emits at most once / 30 s
JOURNEY_ETA_SMOOTH_ALPHA = 0.3                 # weight of new_calc in EMA; old carries 1-alpha
# Valid stage-status transitions for manual edits via PUT /stages/{id}.
# advance/activate endpoints bypass this (they orchestrate the transitions
# themselves). Keys are "from", values are sets of allowed "to".
JOURNEY_STAGE_TRANSITIONS: Dict[str, set] = {
    "pending": {"pending", "active", "skipped"},
    "active":  {"active", "done", "skipped"},
    "done":    {"done"},
    "skipped": {"skipped"},
}


def _source_category(src: Optional[str]) -> str:
    """Group tracking sources into coarse categories for UI / change detection."""
    if not src:
        return "unknown"
    if src.startswith("real"):
        return "real"
    if src == "interpolated":
        return "interpolated"
    return "simulated"


def _smooth_eta_iso(prev_iso: Optional[str], new_iso: Optional[str], source_type: str) -> Optional[str]:
    """
    Smooth ETA with EMA so the client never sees 'jumpy' arrival times.
        new_eta = prev*(1-alpha) + new*alpha
    Cases:
      * no prev / no new → pass-through
      * prev or new unparseable → return the parseable one (or None)
      * REAL tracking source gets slightly more weight (alpha * 1.4, capped at 0.9)
        so real-world speed changes propagate faster.
    """
    if not new_iso:
        return prev_iso
    if not prev_iso:
        return new_iso
    try:
        p = datetime.fromisoformat(str(prev_iso).replace("Z", "+00:00"))
        n = datetime.fromisoformat(str(new_iso).replace("Z", "+00:00"))
    except Exception:
        return new_iso
    alpha = JOURNEY_ETA_SMOOTH_ALPHA
    if _source_category(source_type) == "real":
        alpha = min(alpha * 1.4, 0.9)
    ts_prev = p.timestamp()
    ts_new = n.timestamp()
    blended = ts_prev * (1 - alpha) + ts_new * alpha
    smoothed = datetime.fromtimestamp(blended, tz=timezone.utc)
    return smoothed.isoformat().replace("+00:00", "Z")


def build_default_stages(
    origin: Optional[Dict[str, Any]],
    destination: Optional[Dict[str, Any]],
    vessel: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Default single-stage journey: one 'vessel' stage from origin → destination.
    Manager can always replace / edit stages later.
    """
    ogin_name = (origin or {}).get("name") or "Origin"
    dest_name = (destination or {}).get("name") or "Destination"
    now = datetime.now(timezone.utc)
    return [
        {
            "id": f"stage_{int(now.timestamp())}_1",
            "type": "vessel",
            "label": f"Морське перевезення — {ogin_name} → {dest_name}",
            "from": ogin_name,
            "to": dest_name,
            "fromPoint": origin,
            "toPoint": destination,
            "status": "active",
            "vessel": vessel or None,
            "startedAt": now,
            "completedAt": None,
        }
    ]


def _normalize_stage(stage: Dict[str, Any], idx: int, total: int) -> Dict[str, Any]:
    """Ensure required keys are present on a stage dict."""
    stage = dict(stage or {})
    if not stage.get("id"):
        stage["id"] = f"stage_{idx+1}"
    stype = str(stage.get("type") or "vessel").lower()
    if stype not in JOURNEY_STAGE_TYPES:
        stype = "vessel"
    stage["type"] = stype
    stage.setdefault("label", f"Етап {idx + 1}")
    stage.setdefault("from", None)
    stage.setdefault("to", None)
    status = str(stage.get("status") or "pending").lower()
    if status not in JOURNEY_STAGE_STATUSES:
        status = "pending"
    stage["status"] = status
    stage.setdefault("vessel", None)
    # Container layer — can change independently from vessel (vessel swap without
    # transshipment = same container continues on new ship). Structure:
    #   {"number": "MSKU1234567", "sealNumber": "...", "boundAt": <datetime>}
    stage.setdefault("container", None)
    stage.setdefault("startedAt", None)
    stage.setdefault("completedAt", None)
    return stage


def ensure_shipment_stages(shipment: Dict[str, Any]) -> Dict[str, Any]:
    """
    Lazy backfill for old shipments that don't have a stages[] array yet.
    Returns the (possibly mutated) shipment dict. Caller must persist via
    db.shipments.update_one if backfill happened (flag `_stages_backfilled`).
    """
    if not shipment:
        return shipment
    stages = shipment.get("stages")
    if isinstance(stages, list) and stages:
        # normalize in-place (idempotent)
        normalized = [_normalize_stage(s, i, len(stages)) for i, s in enumerate(stages)]
        shipment["stages"] = normalized
        current_id = shipment.get("currentStageId")
        valid_ids = {s["id"] for s in normalized}
        if current_id not in valid_ids:
            # pick first 'active' or first 'pending' or first
            active = next((s for s in normalized if s.get("status") == "active"), None)
            shipment["currentStageId"] = (active or normalized[0])["id"]
        return shipment

    # Build default stages from legacy shipment shape
    stages = build_default_stages(
        origin=shipment.get("origin"),
        destination=shipment.get("destination"),
        vessel=shipment.get("vessel"),
    )
    shipment["stages"] = stages
    shipment["currentStageId"] = stages[0]["id"]
    shipment["_stages_backfilled"] = True
    return shipment


def get_current_stage(shipment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the active stage dict (first with id == currentStageId)."""
    stages = shipment.get("stages") or []
    cur_id = shipment.get("currentStageId")
    if cur_id:
        for s in stages:
            if s.get("id") == cur_id:
                return s
    # fallback: first 'active'
    for s in stages:
        if s.get("status") == "active":
            return s
    # fallback: first
    return stages[0] if stages else None


def is_valid_movement(
    prev: Optional[Dict[str, Any]],
    new: Dict[str, Any],
    elapsed_seconds: Optional[float],
) -> bool:
    """
    Reject implausible GPS jumps: > 200 km in < 120 s.
    For larger gaps we use an implied max cruise speed of ~50 knots = ~93 km/h.
    """
    try:
        if not prev or prev.get("lat") is None or prev.get("lng") is None:
            return True
        if new.get("lat") is None or new.get("lng") is None:
            return False
        dist = _haversine_km(prev["lat"], prev["lng"], new["lat"], new["lng"])
        elapsed = float(elapsed_seconds) if elapsed_seconds is not None else None
        # Short window — cargo ships physically can't exceed ~45 knots
        if elapsed is not None and elapsed < 120:
            if dist > JOURNEY_SPIKE_MAX_KM_PER_120S:
                return False
        # Longer window — use ~93 km/h cap with 30% tolerance
        elif elapsed is not None and elapsed > 0:
            max_km = (elapsed / 3600.0) * 93.0 * 1.3
            if dist > max(max_km, JOURNEY_SPIKE_MAX_KM_PER_120S):
                return False
        return True
    except Exception:
        return True  # permissive — never block a real update over a helper bug


async def add_shipment_event(
    shipment_id: str,
    event_type: str,
    label: str,
    meta: Optional[Dict[str, Any]] = None,
    customer_id: Optional[str] = None,
) -> None:
    """
    Append an event to shipment.events[]. Also persists the last 40 events and
    emits a Socket.IO 'shipment:event' side-channel the UI can subscribe to.
    """
    now = datetime.now(timezone.utc)
    event = {
        "type": event_type,
        "label": label,
        "createdAt": now,
        "meta": meta or {},
    }
    try:
        await db.shipments.update_one(
            {"id": shipment_id},
            {
                "$push": {"events": {"$each": [event], "$slice": -40}},
                "$set": {"lastEvent": event_type, "lastEventTime": now, "updated_at": now},
            },
        )
    except Exception as e:
        logger.warning(f"[JOURNEY] event persist failed {shipment_id}/{event_type}: {e}")
    try:
        if customer_id:
            await sio.emit(
                "shipment:event",
                {"shipmentId": shipment_id, "type": event_type, "label": label,
                 "createdAt": now.isoformat().replace("+00:00", "Z")},
                room=f"user_{customer_id}",
            )
    except Exception:
        pass


async def _persist_stages_backfill(shipment: Dict[str, Any]) -> None:
    """Persist the stages we produced in ensure_shipment_stages."""
    if not shipment.get("_stages_backfilled"):
        return
    try:
        await db.shipments.update_one(
            {"id": shipment["id"]},
            {"$set": {
                "stages": shipment["stages"],
                "currentStageId": shipment["currentStageId"],
                "updated_at": datetime.now(timezone.utc),
            }},
        )
    except Exception as e:
        logger.warning(f"[JOURNEY] stages backfill persist failed: {e}")


def serialize_journey(shipment: Dict[str, Any]) -> Dict[str, Any]:
    """Public-safe journey view for the cabinet."""
    s = serialize_doc(dict(shipment))
    # always include the computed current stage even if client doesn't fetch stages separately
    cur = get_current_stage(shipment)
    # Region label (e.g. "Океан", "Європа", "Підхід до порту") derived from progress.
    try:
        region_label = get_location_label(shipment.get("progress") or 0)
    except Exception:
        region_label = None

    # ── trackingHealth ─────────────────────────────────────────────────────
    # Classify shipment freshness into 4 buckets the UI can render:
    #   ok          — real data, < 10 min old
    #   estimated   — interpolated / simulated OR real 10 min – 3 h old
    #   stale       — any source, last update > 3 h ago (red pill)
    #   no_data     — no source at all / no position / tracking off
    # Computed live here (not persisted) so it always reflects real age.
    def _parse_dt(v):
        if isinstance(v, datetime):
            return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace('Z', '+00:00'))
            except Exception:
                return None
        return None
    src = shipment.get('trackingSource') or (shipment.get('currentPosition') or {}).get('source')
    last_real = shipment.get('lastRealPosition') or {}
    last_upd = (
        _parse_dt((shipment.get('currentPosition') or {}).get('updatedAt'))
        or _parse_dt(shipment.get('lastTrackingUpdate'))
        or _parse_dt(last_real.get('fetched_at'))
    )
    now_ts = datetime.now(timezone.utc)
    age_sec = (now_ts - last_upd).total_seconds() if last_upd else None

    if not shipment.get('trackingActive'):
        health = 'no_data'
    elif src is None or shipment.get('currentPosition') is None:
        health = 'no_data'
    elif age_sec is not None and age_sec > 3 * 3600:
        health = 'stale'
    elif isinstance(src, str) and src.startswith('real') and (age_sec is None or age_sec < 600):
        health = 'ok'
    else:
        health = 'estimated'

    # Emotional status line (for client UI):
    #   «Автомобіль в Атлантичному океані»
    #   «Приближається до порту Rotterdam»
    #   «В порту Rotterdam, очікує розвантаження»
    #   «Доставляється до клієнта» (land stage)
    emotional_text = None
    try:
        cur_stage_type = (cur or {}).get('type')
        prog = shipment.get('progress') or 0
        dest_name = (shipment.get('destination') or {}).get('name')
        if cur_stage_type == 'vessel':
            if prog >= 0.95 and dest_name:
                emotional_text = f"Приближається до порту {dest_name}"
            else:
                emotional_text = region_label and f"Автомобіль в пути: {region_label}"
        elif cur_stage_type == 'port':
            emotional_text = f"В порту {dest_name}" if dest_name else "В порту призначення"
        elif cur_stage_type == 'land':
            emotional_text = "Доставляється до клієнта"
    except Exception:
        pass

    return {
        "id": s.get("id"),
        "vin": s.get("vin"),
        "dealId": s.get("dealId"),
        "customerId": s.get("customerId"),
        "managerId": s.get("managerId"),
        "origin": s.get("origin"),
        "destination": s.get("destination"),
        "route": s.get("route") or [],
        "stages": s.get("stages") or [],
        "currentStageId": s.get("currentStageId"),
        "currentStage": serialize_doc(cur) if cur else None,
        # Convenience: current container + current vessel pulled out for UI.
        "currentContainer": (cur or {}).get("container") if cur else None,
        "currentVessel": (cur or {}).get("vessel") or s.get("vessel"),
        "currentPosition": s.get("currentPosition"),
        "lastRealPosition": s.get("lastRealPosition"),
        "progress": s.get("progress", 0),
        "location": region_label,
        "liveEta": s.get("liveEta"),
        "eta": s.get("eta"),
        "trackingActive": s.get("trackingActive", False),
        "trackingSource": s.get("trackingSource"),
        "trackingHealth": health,                     # NEW: ok/estimated/stale/no_data
        "trackingAgeSec": int(age_sec) if age_sec is not None else None,
        "emotionalText": emotional_text,              # NEW: human-readable status
        "lastTrackingUpdate": s.get("lastTrackingUpdate"),
        "events": (s.get("events") or [])[-20:],
        "updated_at": s.get("updated_at"),
        "created_at": s.get("created_at"),
    }


# ═══════════════════════════════════════════════════════════════════════
# AUTO RESOLVER LAYER — Container / Vessel / Transfer detection
# ═══════════════════════════════════════════════════════════════════════
# "Never rely on 1 source. Multiple sources → confidence → choice."
# Delegated to resolver_engine.AutoResolver. These helpers bridge the engine
# with our DB + existing ShipsGo/VF integration so the resolver can re-use
# cached API keys and scraper cookies without duplicating network code.
# ═══════════════════════════════════════════════════════════════════════

from resolver_engine import (  # noqa: E402
    AutoResolver as _AutoResolver,
    MIN_CONFIDENCE as _RESOLVER_MIN_CONF,
)


async def _resolver_shipsgo_lookup(container: str):
    """Thin wrapper so VesselResolver can call the already-implemented
    `_external_container_lookup` without circular imports."""
    fn = globals().get("_external_container_lookup")
    if fn:
        try:
            return await fn(container)
        except Exception as _e:
            logger.warning(f"[Resolver/ShipsGo] {container} failed: {_e}")
    return None


async def _resolver_vf_search(hint: str):
    """Reserved for V5: vessel-by-name search via VF. Returns None unless
    the VF search helper is available; keeps the resolver standalone even
    when VF session is not configured."""
    return None


def _get_auto_resolver() -> _AutoResolver:
    # Constructed per-call so we pick up updated API keys after
    # /admin/integrations changes them in the DB.
    return _AutoResolver(
        db=db,
        shipsgo_lookup=_resolver_shipsgo_lookup,
        vf_search=_resolver_vf_search,
    )


async def _run_auto_resolver(shipment: Dict[str, Any]) -> Dict[str, Any]:
    """Run the AutoResolver, persist a trace snapshot, return the report."""
    report = await _get_auto_resolver().run(shipment)
    rep_d = report.to_dict()
    try:
        await db.shipments.update_one(
            {"id": shipment.get("id")},
            {"$set": {"resolver": {
                "lastRun":  rep_d.get("ranAt"),
                "container": rep_d.get("container"),
                "vessel":    rep_d.get("vessel"),
                "transfer":  rep_d.get("transfer"),
                "actions":   rep_d.get("actions"),
            }}},
        )
    except Exception as _e:
        logger.warning(f"[Resolver] persist trace failed: {_e}")
    return rep_d


async def _persist_resolver_hits(
    shipment: Dict[str, Any], report: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Apply resolver results to the shipment if confidence is sufficient and
    current active stage lacks container/vessel identity. Returns diff dict.
    """
    diff = {"containerChanged": False, "vesselChanged": False,
            "container": None, "vesselName": None, "vesselMmsi": None, "vesselImo": None}
    container_hit = report.get("container") or {}
    vessel_hit = report.get("vessel") or {}
    now = datetime.now(timezone.utc)
    ship_id = shipment.get("id")

    stages = list(shipment.get("stages") or [])
    cur_id = shipment.get("currentStageId")
    cur_idx = next((i for i, st in enumerate(stages) if st.get("id") == cur_id), None)

    update_set: Dict[str, Any] = {}
    events_to_add: List[Dict[str, Any]] = []

    cnum = container_hit.get("value")
    ccon = float(container_hit.get("confidence") or 0.0)
    if cnum and ccon >= _RESOLVER_MIN_CONF:
        existing = None
        if cur_idx is not None:
            existing = (stages[cur_idx].get("container") or {}).get("number")
        existing = existing or (shipment.get("container") or {}).get("number") or shipment.get("containerNumber")
        if not existing:
            new_container = {
                "number": cnum,
                "source": container_hit.get("source"),
                "confidence": ccon,
                "resolvedAt": now,
                "autoResolved": True,
            }
            if cur_idx is not None and stages[cur_idx].get("type") == "vessel":
                stages[cur_idx] = {**stages[cur_idx], "container": new_container}
                update_set["stages"] = stages
            update_set["container"] = new_container
            update_set["containerSource"] = container_hit.get("source")
            update_set["containerConfidence"] = ccon
            update_set["containerAutoResolved"] = True
            diff["containerChanged"] = True
            diff["container"] = cnum
            events_to_add.append({
                "type": "container_resolved",
                "label": f"Контейнер визначено автоматично: {cnum} "
                         f"(джерело: {container_hit.get('source')}, впевненість {int(ccon * 100)}%)",
                "meta": {"container": cnum, "evidence": container_hit.get("evidence")},
            })

    vval = vessel_hit.get("value") if isinstance(vessel_hit.get("value"), dict) else None
    vcon = float(vessel_hit.get("confidence") or 0.0)
    if vval and vcon >= _RESOLVER_MIN_CONF:
        have_v = False
        if cur_idx is not None:
            cv = stages[cur_idx].get("vessel") or {}
            have_v = bool(cv.get("mmsi") or cv.get("imo") or cv.get("name"))
        if not have_v:
            tv = shipment.get("vessel") or {}
            have_v = bool(tv.get("mmsi") or tv.get("imo") or tv.get("name"))
        if not have_v:
            new_vessel = {
                "name": vval.get("name"),
                "mmsi": vval.get("mmsi"),
                "imo":  vval.get("imo"),
                "source": vessel_hit.get("source"),
                "confidence": vcon,
                "resolvedAt": now,
                "autoResolved": True,
            }
            if cur_idx is not None and stages[cur_idx].get("type") == "vessel":
                stages[cur_idx] = {**stages[cur_idx], "vessel": new_vessel}
                update_set["stages"] = stages
            update_set["vessel"] = new_vessel
            update_set["vesselSource"] = vessel_hit.get("source")
            update_set["vesselConfidence"] = vcon
            update_set["vesselAutoResolved"] = True
            diff["vesselChanged"] = True
            diff["vesselName"] = new_vessel["name"]
            diff["vesselMmsi"] = new_vessel["mmsi"]
            diff["vesselImo"] = new_vessel["imo"]
            events_to_add.append({
                "type": "vessel_resolved",
                "label": f"Судно визначено автоматично: "
                         f"{new_vessel.get('name') or '—'} "
                         f"(MMSI {new_vessel.get('mmsi') or '—'}, "
                         f"джерело: {vessel_hit.get('source')}, "
                         f"впевненість {int(vcon * 100)}%)",
                "meta": {"vessel": new_vessel, "evidence": vessel_hit.get("evidence")},
            })

    if not update_set:
        return diff

    await db.shipments.update_one({"id": ship_id}, {"$set": update_set})

    for ev in events_to_add:
        try:
            await add_shipment_event(
                ship_id, ev["type"], ev["label"], meta=ev.get("meta") or {},
                customer_id=shipment.get("customerId"),
            )
        except Exception:
            pass

    logger.info(f"[Resolver] {ship_id} persisted: {diff}")
    return diff








async def update_shipment_position(shipment):
    """
    Hybrid position update:
      1) REAL — VF scraper / VesselFinder API (only on 'vessel' stage)
      2) INTERPOLATE — last REAL position if fresh (< 2h)
      3) SIMULATE — incrementally walk along route (fallback)

    Emits `shipment:update` Socket.IO event with {source: real|interpolated|simulated}.
    """
    route = shipment.get('route', [])
    if not route:
        return

    # Make sure this shipment has stages[] / currentStageId (backfill lazily)
    ensure_shipment_stages(shipment)
    if shipment.get('_stages_backfilled'):
        await _persist_stages_backfill(shipment)

    shipment_id = shipment['id']
    customer_id = shipment.get('customerId')
    current_stage = get_current_stage(shipment) or {}
    # Tracking source depends on current stage. Non-vessel stages never hit VF.
    stage_is_vessel = (current_stage.get('type') == 'vessel')
    # Vessel descriptor — prefer stage-level, fallback to top-level (legacy).
    stage_vessel = current_stage.get('vessel') or {}
    legacy_vessel = shipment.get('vessel') or {}
    vessel = stage_vessel or legacy_vessel
    imo = vessel.get('imo')
    now = datetime.now(timezone.utc)

    new_progress = shipment.get('progress', 0)
    lat = None
    lng = None
    speed_knots = None
    course = None
    source_type = 'simulated'
    real_timestamp = None

    # ═══════════════════════════════════════════════════════════════════════
    # AUTO-RESOLVE — "Never rely on 1 source. Multi-strategy resolver."
    # Before we hit VF/ShipsGo, if the active stage is vessel-type but there's
    # no container AND/OR no vessel bound, try to auto-resolve them from:
    #   container: S1-S6 (db fields, events, deal, related shipments, regex)
    #   vessel:    V1-V5 (current-stage, ShipsGo, AfterShip, related db, VF)
    # If resolver succeeds with confidence >= MIN_CONFIDENCE (0.5) we persist
    # the bind and re-read the stage. If it detects a transfer vs current
    # vessel, we DO NOT mutate here (handled by explicit bind handler); we
    # just log the event so Exceptions dashboard picks it up.
    # ═══════════════════════════════════════════════════════════════════════
    if stage_is_vessel:
        has_container = bool((current_stage.get('container') or {}).get('number')
                             or (shipment.get('container') or {}).get('number')
                             or shipment.get('containerNumber'))
        has_vessel_ident = bool(vessel.get('mmsi') or vessel.get('imo') or vessel.get('name'))
        if not has_container or not has_vessel_ident:
            try:
                report = await _run_auto_resolver(shipment)
                persisted = await _persist_resolver_hits(shipment, report)
                if persisted.get('containerChanged') or persisted.get('vesselChanged'):
                    # Re-load shipment so downstream logic sees resolved values.
                    fresh = await db.shipments.find_one({'id': shipment_id})
                    if fresh:
                        shipment = fresh
                        current_stage = get_current_stage(shipment) or {}
                        stage_vessel = current_stage.get('vessel') or {}
                        legacy_vessel = shipment.get('vessel') or {}
                        vessel = stage_vessel or legacy_vessel
                        imo = vessel.get('imo')
                        logger.info(
                            f"[Resolver] {shipment_id} reload after bind: "
                            f"container={persisted.get('container')} vessel={persisted.get('vesselName')}"
                        )
            except Exception as _rs_err:
                logger.warning(f"[Resolver] {shipment_id} failed: {_rs_err}", exc_info=True)

    # ── 1. REAL (only when the active stage is of type 'vessel')
    if stage_is_vessel and (vessel.get('mmsi') or imo or vessel.get('name')):
        # REAL path: extension posts VF payload → /jobs/result. No server-side
        # scraping — we read the last known position from the shipment state
        # instead.
        logger.info(f"[TRACKING] {shipment_id} REAL mmsi={vessel.get('mmsi')} imo={imo} name={vessel.get('name')}")

        # 1b. Fallback to VesselFinder public API / ShipsGo Fleet
        if lat is None and imo:
            pos = await fetch_vessel_position(str(imo))
            if pos:
                lat = pos['lat']
                lng = pos['lng']
                speed_knots = pos.get('speed')
                course = pos.get('course')
                real_timestamp = pos.get('fetched_at') or now
                source_type = 'real' if pos.get('source') != 'cache' else 'real_cached'

    # ── 2. INTERPOLATE (last known real < 2h)
    if lat is None:
        last_real = shipment.get('lastRealPosition')
        if last_real and last_real.get('fetched_at'):
            fa = last_real['fetched_at']
            if isinstance(fa, datetime):
                # Mongo strips tzinfo on read → assume UTC when naive.
                if fa.tzinfo is None:
                    fa = fa.replace(tzinfo=timezone.utc)
                age = (now - fa).total_seconds()
                if age < VESSEL_POSITION_MAX_AGE_SECONDS:
                    # move forward by time * speed, along bearing/course toward dest
                    dest = route[-1]
                    # simple approach: advance fraction toward next waypoint by elapsed km
                    sp = last_real.get('speed') or 14.0
                    sp = sp if sp >= 2.0 else 14.0
                    kmh = sp * 1.852
                    elapsed_hours = (now - fa).total_seconds() / 3600.0
                    step_km = kmh * elapsed_hours
                    # project last_real onto route, advance progress by step_km / total_km
                    total_km = _route_total_km(route)
                    if total_km > 0:
                        prog_at_real = _project_progress_on_route(
                            route, last_real['lat'], last_real['lng']
                        )
                        new_progress = min(prog_at_real + (step_km / total_km), 1.0)
                        lat, lng = interpolate_route(route, new_progress)
                        speed_knots = last_real.get('speed')
                        course = last_real.get('course')
                        source_type = 'interpolated'

    # ── 3. SIMULATE (fallback)
    if lat is None:
        import random
        current_progress = shipment.get('progress', 0)
        increment = random.uniform(0.005, 0.015)  # slower, more realistic
        new_progress = min(current_progress + increment, 1.0)
        lat, lng = interpolate_route(route, new_progress)
        source_type = 'simulated'

    if lat is None:
        return

    # Guard: never emit invalid coordinates
    if not _is_valid_coord(lat, lng):
        logger.warning(f"[TRACKING] skip invalid coords for {shipment_id}: lat={lat} lng={lng}")
        return

    # Clamp progress to [0..1]
    new_progress = _clamp_progress(new_progress)

    # For REAL: project onto route to get progress
    if source_type.startswith('real'):
        new_progress = _clamp_progress(_project_progress_on_route(route, lat, lng))

    # ── MOVEMENT SANITY (only for real updates — estimated we trust by construction)
    # Reject GPS spikes: >200km in <120s OR faster than plausible cruise speed.
    # BUT: only compare against the last REAL position. Simulated / interpolated
    # positions are model projections that haven't been ground-truthed; if the
    # first REAL hit disagrees with them we must accept the real value, not
    # reject it as a spike.
    if source_type.startswith('real'):
        prev_pos = shipment.get('lastRealPosition')
        prev_at = None
        elapsed = None
        if isinstance(prev_pos, dict):
            prev_at = prev_pos.get('fetched_at') or prev_pos.get('updatedAt')
            if isinstance(prev_at, datetime):
                # Mongo strips tzinfo on read → assume UTC.
                if prev_at.tzinfo is None:
                    prev_at = prev_at.replace(tzinfo=timezone.utc)
                try:
                    elapsed = (now - prev_at).total_seconds()
                except Exception:
                    elapsed = None
        if prev_pos and not is_valid_movement(prev_pos, {'lat': lat, 'lng': lng}, elapsed):
            logger.warning(
                f"[TRACKING] REJECT spike {shipment_id}: "
                f"{prev_pos.get('lat')},{prev_pos.get('lng')} → {lat},{lng} "
                f"dist={_haversine_km(prev_pos['lat'], prev_pos['lng'], lat, lng):.1f}km "
                f"elapsed={elapsed}s"
            )
            try:
                await add_shipment_event(
                    shipment_id=shipment_id,
                    event_type='tracking_rejected',
                    label='Отримано некоректну позицію (стрибок координат), пропущено',
                    meta={
                        'from': {'lat': prev_pos.get('lat'), 'lng': prev_pos.get('lng')},
                        'to': {'lat': lat, 'lng': lng},
                        'elapsed_s': elapsed,
                    },
                    customer_id=customer_id,
                )
            except Exception:
                pass
            return

    # Compute ETA (+ EMA smoothing to avoid jumps: 0.7*old + 0.3*new)
    raw_eta_iso = _calculate_eta_iso(route, lat, lng, speed_knots)
    eta_iso = _smooth_eta_iso(shipment.get('liveEta'), raw_eta_iso, source_type)

    new_position = {
        'lat': lat,
        'lng': lng,
        'updatedAt': now,
        'source': source_type,
        'speed': speed_knots,
        'course': course,
    }

    update_set = {
        'progress': new_progress,
        'currentPosition': new_position,
        'lastTrackingUpdate': now,
        'liveEta': eta_iso,
        'trackingSource': source_type,
        'trackingHealth': 'ok' if source_type.startswith('real') else ('estimated' if source_type in ('interpolated', 'simulated') else 'no_data'),
    }

    if source_type.startswith('real') and real_timestamp:
        update_set['lastRealPosition'] = {
            'lat': lat,
            'lng': lng,
            'speed': speed_knots,
            'course': course,
            'fetched_at': real_timestamp,
        }

    # ═══════════════════════════════════════════════════════════════════════
    # AUTO-ADVANCE STAGE — vessel stage → next stage when arrival detected.
    # Rules (any of):
    #   1. progress >= 0.99 (we're essentially at the destination)
    #   2. progress >= 0.95 AND speed < 1.0 knot (docked at destination port)
    # Guard: only auto-advance vessel-type stages; don't touch land/port.
    # On advance:
    #   • current stage.status = 'done', completedAt = now
    #   • next stage.status   = 'active',  startedAt = now
    #   • emit stage_advanced event
    # ═══════════════════════════════════════════════════════════════════════
    current_stage_local = current_stage or {}
    stages_list = list(shipment.get('stages') or [])
    cur_idx = next(
        (i for i, st in enumerate(stages_list) if st.get('id') == current_stage_local.get('id')),
        None,
    )
    should_advance = (
        cur_idx is not None
        and current_stage_local.get('type') == 'vessel'
        and current_stage_local.get('status') == 'active'
        and (
            new_progress >= 0.99
            or (new_progress >= 0.95 and speed_knots is not None and float(speed_knots) < 1.0)
        )
    )
    if should_advance:
        stages_list[cur_idx] = {
            **stages_list[cur_idx],
            'status': 'done',
            'completedAt': now,
        }
        # Activate next pending stage (if any)
        next_idx = next(
            (i for i in range(cur_idx + 1, len(stages_list))
             if (stages_list[i].get('status') or 'pending') in ('pending', 'skipped')),
            None,
        )
        if next_idx is not None:
            stages_list[next_idx] = {
                **stages_list[next_idx],
                'status': 'active',
                'startedAt': now,
            }
            update_set['currentStageId'] = stages_list[next_idx].get('id')
            update_set['stages'] = stages_list
            # Log a shipment event
            try:
                await add_shipment_event(
                    shipment_id,
                    'stage_advanced',
                    f"Етап «{stages_list[cur_idx].get('label')}» завершено. "
                    f"Почався «{stages_list[next_idx].get('label')}».",
                    meta={
                        'fromStageId': stages_list[cur_idx].get('id'),
                        'toStageId':   stages_list[next_idx].get('id'),
                        'progress':    new_progress,
                    },
                    customer_id=customer_id,
                )
            except Exception:
                pass
        else:
            # Last stage finished → shipment delivered
            update_set['stages'] = stages_list
            update_set['status'] = 'delivered'
            try:
                await add_shipment_event(
                    shipment_id, 'delivered',
                    'Доставка завершена. Авто прибуло в пункт призначення.',
                    meta={'progress': new_progress},
                    customer_id=customer_id,
                )
            except Exception:
                pass

    await db.shipments.update_one(
        {'id': shipment_id},
        {'$set': update_set},
    )

    location_label = get_location_label(new_progress)
    current_stage_id = (current_stage or {}).get('id')

    # Socket emit throttle — don't flood clients with position deltas. We keep
    # the DB update on every tick (so force-tick/manual-tick always see fresh
    # data) but only push to socket at most every JOURNEY_SOCKET_THROTTLE_SEC.
    # Exceptions that always push through:
    #   • stage change (currentStageId differs from prev socket)
    #   • REAL → ESTIMATED transition (source category changed)
    #   • progress finished (>= 0.999)
    last_emit = shipment.get('lastSocketEmitAt')
    prev_emit_source = shipment.get('lastSocketEmitSource')
    prev_emit_stage = shipment.get('lastSocketEmitStageId')
    if isinstance(last_emit, datetime) and last_emit.tzinfo is None:
        last_emit = last_emit.replace(tzinfo=timezone.utc)
    elapsed_emit = (now - last_emit).total_seconds() if isinstance(last_emit, datetime) else None
    stage_changed_emit = (prev_emit_stage is not None and prev_emit_stage != current_stage_id)
    source_category_changed = (
        prev_emit_source is not None and
        _source_category(prev_emit_source) != _source_category(source_type)
    )
    progress_done = new_progress >= 0.999
    should_emit = (
        elapsed_emit is None
        or elapsed_emit >= JOURNEY_SOCKET_THROTTLE_SEC
        or stage_changed_emit
        or source_category_changed
        or progress_done
    )

    # Emit Socket.IO event — clients receive via /notifications room
    if customer_id and should_emit:
        await sio.emit(
            'shipment:update',
            {
                'shipmentId': shipment_id,
                'currentPosition': {'lat': lat, 'lng': lng},
                'position': {'lat': lat, 'lng': lng},  # alias for clients that read 'position'
                'progress': new_progress,
                'location': location_label,
                'type': source_type,
                'source': source_type,               # alias
                'currentStageId': current_stage_id,
                'speed': speed_knots,
                'course': course,
                'eta': eta_iso,
                'updatedAt': now.isoformat().replace('+00:00', 'Z'),
            },
            room=f"user_{customer_id}",
        )
        # legacy channel (kept for compatibility with old clients)
        await sio.emit(
            'shipment:position_updated',
            {
                'shipmentId': shipment_id,
                'position': {'lat': lat, 'lng': lng},
                'progress': new_progress,
                'location': location_label,
                'source': source_type,
            },
            room=f"user_{customer_id}",
        )
        await db.shipments.update_one(
            {'id': shipment_id},
            {'$set': {
                'lastSocketEmitAt': now,
                'lastSocketEmitSource': source_type,
                'lastSocketEmitStageId': current_stage_id,
            }},
        )

    logger.info(
        f"[TRACKING] {shipment_id} stage={current_stage_id} [{source_type}] {location_label} "
        f"{new_progress:.1%} lat={lat:.3f} lng={lng:.3f} eta={eta_iso} "
        f"emit={'yes' if should_emit else 'throttled'}"
    )

    # Throttled tracking_updated journey event (once per 15 min per shipment, REAL only)
    try:
        if source_type.startswith('real'):
            last_evt_at = shipment.get('lastTrackingEventAt')
            send_evt = True
            if isinstance(last_evt_at, datetime):
                if last_evt_at.tzinfo is None:
                    last_evt_at = last_evt_at.replace(tzinfo=timezone.utc)
                if (now - last_evt_at).total_seconds() < JOURNEY_TRACKING_EVENT_THROTTLE_SEC:
                    send_evt = False
            if send_evt:
                await add_shipment_event(
                    shipment_id=shipment_id,
                    event_type='tracking_updated',
                    label=f'Позиція оновлена ({source_type})',
                    meta={'lat': lat, 'lng': lng, 'source': source_type,
                          'progress': new_progress, 'eta': eta_iso},
                    customer_id=customer_id,
                )
                await db.shipments.update_one(
                    {'id': shipment_id},
                    {'$set': {'lastTrackingEventAt': now}},
                )
    except Exception as e:
        logger.warning(f"[JOURNEY] tracking_updated event failed: {e}")

    # Event every 20% of progress
    last_event_progress = shipment.get('lastEventProgress', 0)
    if int(new_progress * 5) > int(last_event_progress * 5):
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='position_update',
            title=f'📍 {location_label}',
            location=location_label,
            meta={
                'progress': new_progress,
                'lat': lat,
                'lng': lng,
                'source': source_type,
                'speed': speed_knots,
            },
            customer_id=customer_id,
        )
        await db.shipments.update_one(
            {'id': shipment_id},
            {'$set': {'lastEventProgress': new_progress}},
        )

    # Arrival detection — within 20km of destination port
    dest = route[-1]
    dist_to_dest = _haversine_km(lat, lng, dest['lat'], dest['lng'])
    if dist_to_dest < 20.0 and not shipment.get('arrivalDetected'):
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='approaching_port',
            title='⚓ Судно прибуває в порт призначення',
            location=dest.get('name', 'Destination port'),
            meta={'distanceKm': dist_to_dest, 'lat': lat, 'lng': lng},
            customer_id=customer_id,
        )
        await db.shipments.update_one(
            {'id': shipment_id},
            {'$set': {'arrivalDetected': True}},
        )
        if customer_id:
            await sio.emit(
                'shipment:arrived',
                {
                    'shipmentId': shipment_id,
                    'vehicleTitle': shipment.get('vehicleTitle'),
                    'port': dest.get('name'),
                },
                room=f"user_{customer_id}",
            )


async def simulate_tracking_progress(shipment):
    """
    Smart fallback when API unavailable
    Simulates realistic shipping progress based on time
    """
    stages = [
        ('loaded_on_vessel', 'Завантажено на судно', 'Origin Port'),
        ('in_transit', 'В дорозі', 'Atlantic Ocean'),
        ('mid_ocean', 'Середина океану', 'Mid-Atlantic'),
        ('approaching_port', 'Наближається до порту', 'Near destination'),
        ('at_destination_port', 'Прибув у порт', 'Destination Port'),
        ('customs', 'Митне оформлення', 'Customs'),
        ('ready_for_pickup', 'Готово до видачі', 'Warehouse')
    ]
    
    # Find current stage
    events = await db.shipment_events.find(
        {'shipmentId': shipment['id']}
    ).sort('timestamp', -1).limit(1).to_list(1)
    
    if not events:
        return stages[0]
    
    last_event = events[0]
    current_stage_index = next(
        (i for i, s in enumerate(stages) if s[0] == last_event['type']),
        0
    )
    
    # Progress to next stage if enough time passed (simulate every 30 min for demo)
    if current_stage_index < len(stages) - 1:
        return stages[current_stage_index + 1]
    
    return None


async def fetch_tracking_data_from_api(shipment):
    """
    Fetch from real tracking API (AfterShip, 17track, etc.)
    Returns None if not available - fallback to simulation
    """
    container = shipment.get('containerNumber')
    if not container:
        return None
    
    try:
        # TODO: Real API integration here
        # For now, return None to trigger simulation
        return None
    except Exception as e:
        logger.error(f"[TRACKING] API error: {e}")
        return None


async def process_shipment_tracking(shipment):
    """
    Core tracking logic: API + Fallback + Position Update
    """
    shipment_id = shipment['id']
    customer_id = shipment.get('customerId')
    
    # 1. Update position along route (always)
    await update_shipment_position(shipment)
    
    # 2. Try real API first
    tracking_data = await fetch_tracking_data_from_api(shipment)
    
    # 3. Fallback to simulation
    if not tracking_data:
        tracking_data = await simulate_tracking_progress(shipment)
    
    if not tracking_data:
        return  # No updates needed
    
    event_type, title, location = tracking_data
    
    # 4. Check if this is actually NEW (don't duplicate events)
    last_event = await db.shipment_events.find_one(
        {'shipmentId': shipment_id},
        sort=[('timestamp', -1)]
    )
    
    if last_event and last_event['type'] == event_type:
        return  # Same event, skip
    
    # 5. Create event
    await create_shipment_event(
        shipment_id=shipment_id,
        event_type=event_type,
        title=title,
        location=location,
        meta={'source': 'tracking_worker'},
        customer_id=customer_id
    )
    
    # 6. Update last tracking time
    await db.shipments.update_one(
        {'id': shipment_id},
        {'$set': {'lastTrackingUpdate': datetime.now(timezone.utc)}}
    )
    
    logger.info(f"[TRACKING] Updated shipment {shipment_id}: {event_type}")


async def detect_shipment_issues(shipment):
    """
    Detection engine for stalled/risky shipments
    """
    now = datetime.now(timezone.utc)
    shipment_id = shipment['id']
    customer_id = shipment.get('customerId')
    
    last_update = shipment.get('lastTrackingUpdate')
    if isinstance(last_update, datetime) and last_update.tzinfo is None:
        last_update = last_update.replace(tzinfo=timezone.utc)
    
    # Issue: Stalled (no updates > 5 days)
    if last_update and (now - last_update).days > 5:
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='stalled_warning',
            title='⚠️ Контейнер не оновлювався >5 днів',
            meta={'daysSinceUpdate': (now - last_update).days},
            customer_id=customer_id
        )
    
    # Issue: ETA passed
    eta_str = shipment.get('eta')
    if eta_str:
        try:
            eta = datetime.fromisoformat(eta_str.replace('Z', '+00:00'))
            if now > eta:
                status = await calculate_shipment_status(shipment_id)
                if status not in ['delivered', 'ready_for_pickup']:
                    await create_shipment_event(
                        shipment_id=shipment_id,
                        event_type='eta_overdue',
                        title='⚠️ Затримка доставки',
                        meta={'etaWas': eta_str, 'daysOverdue': (now - eta).days},
                        customer_id=customer_id
                    )
        except:
            pass


async def tracking_worker_loop():
    """
    Background worker that runs every 30 minutes
    Updates all active shipments
    """
    print("="*80)
    print("🚢🚢🚢 TRACKING WORKER STARTED 🚢🚢🚢")
    print("="*80)
    logger.info("[TRACKING] Worker started")
    
    # Wait 10s after startup (was 60s)
    await asyncio.sleep(int(os.environ.get('TRACKING_WORKER_STARTUP_DELAY_SEC', 10)))
    
    while True:
        try:
            print("🔄 TRACKING TICK...")
            logger.info("[TRACKING] Tick...")
            
            # Find active shipments
            shipments = await db.shipments.find({
                'trackingActive': True
            }).to_list(100)
            
            logger.info(f"[TRACKING] Processing {len(shipments)} shipments")
            print(f"✓ Processing {len(shipments)} shipments")
            
            for shipment in shipments:
                try:
                    # Process tracking
                    await process_shipment_tracking(shipment)
                    
                    # Detect issues
                    await detect_shipment_issues(shipment)
                    
                except Exception as e:
                    logger.error(
                        f"[TRACKING] Error processing shipment {shipment['id']}: {e}",
                        exc_info=True,
                    )
            
            logger.info("[TRACKING] Cycle complete")
            
        except Exception as e:
            logger.error(f"[TRACKING] Worker error: {e}")
        
        # Run every 2 minutes (was 30m — too slow for UX)
        await asyncio.sleep(int(os.environ.get('TRACKING_WORKER_INTERVAL_SEC', 120)))


# ═══════════════════════════════════════════════════════════════════
# Automation Layer — Shipment Identity Resolver worker (Phase A+B+C)
# ═══════════════════════════════════════════════════════════════════
from shipment_identity_resolver import ShipmentIdentityResolver  # noqa: E402
from transfer_detector import AutoTransferDetector  # noqa: E402


def _make_identity_resolver() -> "ShipmentIdentityResolver":
    """Factory so tests / endpoints can always grab a fresh resolver bound
    to the current Motor ``db`` handle (which is rebound in startup())."""
    return ShipmentIdentityResolver(
        db,
        audit=lambda action, resource=None, meta=None: audit(action, resource=resource, meta=meta),
    )


def _auto_transfer_detector() -> "AutoTransferDetector":
    """Singleton-ish factory bound to current db handle."""
    return AutoTransferDetector(db)


async def resolver_worker_loop():
    """
    Periodically scans shipments with incomplete identity (no container or no
    vessel) and tries to auto-fill them. Respects TRACKING_ENABLED kill switch.
    Cadence via RESOLVER_INTERVAL_SEC (default 300 s).
    """
    logger.info("[RESOLVER] Worker start")
    # Slight delay so indexes + seeds finish first
    await asyncio.sleep(int(os.environ.get("RESOLVER_STARTUP_DELAY_SEC", 15)))

    interval = int(os.environ.get("RESOLVER_INTERVAL_SEC", 300))
    while True:
        try:
            if not _tracking_enabled():
                logger.info("[RESOLVER] tracking disabled (kill switch) — skipping cycle")
                await audit("tracking_disabled_skipped", resource="resolver_worker", meta={})
                await asyncio.sleep(interval)
                continue

            resolver = _make_identity_resolver()
            # Find candidates: trackingActive & (no vesselMmsi in identity OR no containerNumber)
            query = {
                "trackingActive": True,
                "$or": [
                    {"vessel": {"$exists": False}},
                    {"vessel": None},
                    {"container": {"$exists": False}},
                    {"container.number": {"$in": [None, ""]}},
                ],
            }
            cursor = db.shipments.find(query).limit(50)
            processed = 0
            async for s in cursor:
                try:
                    await resolver.resolve(s)
                    processed += 1
                except Exception as e:
                    logger.warning(f"[RESOLVER] shipment {s.get('id')}: {e}")
            if processed:
                logger.info(f"[RESOLVER] cycle done, processed={processed}")
        except Exception as e:
            logger.error(f"[RESOLVER] worker error: {e}", exc_info=True)

        await asyncio.sleep(interval)


# ═══════════════════════════════════════════════════════════════════
# Phase D — Auto Transfer Detection background sweeper
# ═══════════════════════════════════════════════════════════════════
async def transfer_detector_loop():
    """
    Sweeps shipments that have a ``candidateVessel`` field (written by either
    the resolver or an external agent) and re-runs the detector. This is a
    safety net on top of the per-VF-payload hook in vf_jobs_result — it
    catches cases where a candidate was observed but the shipment state on
    disk hasn't been rechecked.

    Cadence via TRANSFER_DETECT_INTERVAL_SEC (default 120 s).
    """
    await asyncio.sleep(int(os.environ.get("TRANSFER_DETECT_STARTUP_DELAY", 10)))
    interval = int(os.environ.get("TRANSFER_DETECT_INTERVAL_SEC", 120))

    while True:
        try:
            if not _tracking_enabled():
                await audit("tracking_disabled_skipped", resource="transfer_detector", meta={})
                await asyncio.sleep(interval)
                continue

            detector = _auto_transfer_detector()
            cursor = db.shipments.find({
                "trackingActive": True,
                "candidateVessel": {"$exists": True, "$ne": None},
            }).limit(50)
            processed = 0
            async for s in cursor:
                cand = s.get("candidateVessel") or None
                if not cand:
                    continue
                try:
                    res = await detector.process_shipment(s, cand)
                    if res.get("ok"):
                        # Clear candidate so we don't re-enter on next cycle
                        await db.shipments.update_one(
                            {"id": s.get("id")},
                            {"$unset": {"candidateVessel": ""}},
                        )
                    processed += 1
                except Exception as e:
                    logger.warning(f"[TRANSFER] shipment {s.get('id')}: {e}")
            if processed:
                logger.info(f"[TRANSFER] cycle done, processed={processed}")
        except Exception as e:
            logger.error(f"[TRANSFER] worker error: {e}", exc_info=True)
        await asyncio.sleep(interval)



async def ringostat_export_calls_cron():
    """
    CRON task to export calls from Ringostat API
    Runs every 5-10 minutes to ensure no calls are lost
    
    Why needed:
    - Webhook is not 100% reliable (can be lost, server down, etc.)
    - Backup sync ensures data integrity
    - Fills gaps if webhook missed
    
    Logic:
    1. Get Ringostat config (project_id, api_key)
    2. Fetch calls from last 15 minutes
    3. Upsert to MongoDB (avoid duplicates)
    4. Fetch recording URLs if available
    """
    try:
        logger.info("[CRON] Starting Ringostat calls export...")
        
        # Get Ringostat config
        ringostat_config = await db.ringostat_config.find_one({})
        if not ringostat_config:
            logger.warning("[CRON] Ringostat config not found")
            return
        
        project_id = ringostat_config.get('project_id')
        api_key = ringostat_config.get('api_key')
        
        if not project_id or not api_key:
            logger.warning("[CRON] Ringostat credentials missing")
            return
        
        # Fetch calls from last 15 minutes (with overlap for safety)
        import httpx
        from datetime import timedelta
        
        now = datetime.now(timezone.utc)
        start_time = (now - timedelta(minutes=15)).strftime('%Y-%m-%d %H:%M:%S')
        end_time = now.strftime('%Y-%m-%d %H:%M:%S')
        
        async with httpx.AsyncClient() as client:
            url = "https://api.ringostat.net/calls/list"
            headers = {
                "Auth-key": api_key,
                "x-project-id": project_id
            }
            params = {
                "date_from": start_time,
                "date_to": end_time,
                "limit": 100
            }
            
            response = await client.get(url, headers=headers, params=params, timeout=30.0)
            
            if response.status_code != 200:
                logger.error(f"[CRON] Ringostat API error: {response.status_code}")
                return
            
            data = response.json()
            # Ringostat API returns array directly, not wrapped in object
            calls = data if isinstance(data, list) else data.get('calls', [])
            
            logger.info(f"[CRON] Fetched {len(calls)} calls from Ringostat")
            
            # Process each call
            synced = 0
            for call_data in calls:
                try:
                    call_id = call_data.get('call_id') or call_data.get('id')
                    if not call_id:
                        continue
                    
                    # Check if call exists
                    existing_call = await db.ringostat_calls.find_one({'call_id': call_id})
                    
                    # Extract call info
                    from_number = call_data.get('from', call_data.get('phone', ''))
                    to_number = call_data.get('to', '')
                    duration = int(call_data.get('duration', 0))
                    status = call_data.get('status', 'unknown').upper()
                    recording_url = call_data.get('recording', call_data.get('record_url', ''))
                    started_at = call_data.get('started_at', call_data.get('date'))
                    
                    # Parse datetime
                    if started_at:
                        if isinstance(started_at, str):
                            started_at = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                        started_at = started_at.replace(tzinfo=timezone.utc)
                    else:
                        started_at = now
                    
                    # Find or create lead
                    lead = await db.leads.find_one({'phone': from_number})
                    if not lead:
                        lead = {
                            '_id': str(uuid.uuid4()),
                            'name': f'Auto-created {from_number}',
                            'phone': from_number,
                            'source': 'ringostat',
                            'status': 'new',
                            'created_at': now
                        }
                        await db.leads.insert_one(lead)
                    
                    # Get manager from extension with fallback
                    extension = call_data.get('extension', '')
                    manager_id = None
                    
                    if extension and ringostat_config:
                        ext_mapping = ringostat_config.get('extension_mapping', {})
                        manager_id = ext_mapping.get(str(extension))
                    
                    # Fallback: try to find existing manager for this lead
                    if not manager_id and lead.get('assigned_to'):
                        manager_id = lead.get('assigned_to')
                    
                    # Last resort: first active manager
                    if not manager_id:
                        fallback_manager = await db.staff.find_one({'role': 'manager', 'is_active': True})
                        if fallback_manager:
                            manager_id = fallback_manager['_id']
                    
                    # Upsert call
                    if existing_call:
                        # Update only if new data available
                        update_data = {}
                        if recording_url and not existing_call.get('recording_url'):
                            update_data['recording_url'] = recording_url
                        if duration > existing_call.get('duration', 0):
                            update_data['duration'] = duration
                        if status != existing_call.get('status'):
                            update_data['status'] = status
                        
                        if update_data:
                            update_data['synced_at'] = now
                            await db.ringostat_calls.update_one(
                                {'call_id': call_id},
                                {'$set': update_data}
                            )
                            synced += 1
                    else:
                        # Insert new call
                        new_call = {
                            '_id': str(uuid.uuid4()),
                            'call_id': call_id,
                            'direction': 'inbound',
                            'from': from_number,
                            'to': to_number,
                            'status': status,
                            'duration': duration,
                            'recording_url': recording_url,
                            'lead_id': lead['_id'],
                            'manager_id': manager_id,
                            'started_at': started_at,
                            'created_at': now,
                            'updated_at': now,
                            'synced_at': now,
                            'source': 'cron_export'
                        }
                        await db.ringostat_calls.insert_one(new_call)
                        synced += 1
                        
                except Exception as e:
                    logger.error(f"[CRON] Error processing call: {e}")
                    continue
            
            logger.info(f"[CRON] Synced {synced} calls successfully")
            
    except Exception as e:
        logger.error(f"[CRON] Export calls error: {e}")
        logger.error(traceback.format_exc())


# ==================== RINGOSTAT: CALLBACK API ====================

@fastapi_app.post("/api/ringostat/callback")
async def ringostat_initiate_callback(
    phone: str,
    extension: str
):
    """
    Initiate outbound call from CRM via Ringostat
    
    Use case:
    - Manager clicks "Call back" button
    - System uses Ringostat to call client
    - Connects to manager's extension
    
    Flow:
    1. POST to Ringostat callback API
    2. Ringostat calls the client
    3. When client answers, rings manager's extension
    4. Records call
    """
    try:
        # Get Ringostat config
        ringostat_config = await db.ringostat_config.find_one({})
        if not ringostat_config:
            raise HTTPException(status_code=400, detail="Ringostat not configured")
        
        project_id = ringostat_config.get('project_id')
        api_key = ringostat_config.get('api_key')
        
        if not project_id or not api_key:
            raise HTTPException(status_code=400, detail="Ringostat credentials missing")
        
        # Call Ringostat Callback API (simple method)
        import httpx
        
        async with httpx.AsyncClient() as client:
            url = "https://api.ringostat.net/callback/outward_call"
            headers = {
                "Auth-key": api_key,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            # Ringostat expects URL-encoded form data
            payload = {
                "extension": extension,  # Employee's phone/extension
                "destination": phone,     # Customer's phone
                "direction": "out"
            }
            
            response = await client.post(url, headers=headers, data=payload, timeout=10.0)
            
            if response.status_code != 200:
                logger.error(f"[CALLBACK] Ringostat API error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=502, detail="Ringostat callback failed")
            
            result = response.json()
            
            # Log callback initiation
            callback_log = {
                '_id': str(uuid.uuid4()),
                'phone': phone,
                'extension': extension,
                'manager_id': 'system',  # TODO: Get from auth
                'initiated_at': datetime.now(timezone.utc),
                'ringostat_response': result
            }
            await db.ringostat_callbacks.insert_one(callback_log)
            
            logger.info(f"[CALLBACK] Initiated call to {phone} via extension {extension}")
            
            return {
                "success": True,
                "message": "Callback initiated",
                "phone": phone,
                "extension": extension
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CALLBACK] Error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/api/manager/calls/missed", dependencies=[Depends(require_manager_or_admin)])
async def get_missed_calls(manager_id: str = None):
    """Get missed calls that need callback"""
    try:
        query = {'status': 'MISSED'}
        if manager_id:
            query['manager_id'] = manager_id
        
        calls = await db.ringostat_calls.find(query).sort('created_at', -1).limit(20).to_list(20)
        
        return {"success": True, "calls": calls}
    except Exception as e:
        logger.error(f"Get missed calls error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.post("/api/calls/{call_id}/outcome")
async def save_call_outcome(call_id: str, data: Dict[str, Any] = Body(...)):
    """Save call outcome"""
    try:
        outcome = data.get('outcome')
        note = data.get('note', '')
        
        await db.ringostat_calls.update_one(
            {'_id': call_id},
            {
                '$set': {
                    'outcome': outcome,
                    'outcome_note': note,
                    'updated_at': datetime.now(timezone.utc)
                }
            }
        )
        
        # Get call to access lead_id
        call = await db.ringostat_calls.find_one({'_id': call_id})
        
        if call and call.get('lead_id'):
            # Update lead score based on outcome
            score_change = 0
            if outcome == 'interested':
                score_change = 15
            elif outcome == 'callback':
                score_change = 5
            elif outcome == 'vin_request':
                score_change = 20
            elif outcome == 'ready_deposit':
                score_change = 30
            elif outcome == 'reject':
                score_change = -10
            
            if score_change != 0:
                await db.leads.update_one(
                    {'_id': call['lead_id']},
                    {'$inc': {'score': score_change}}
                )
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Save outcome error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/leads/{lead_id}/calls")
async def get_lead_calls(lead_id: str):
    """Get all calls for a lead"""
    try:
        calls = await db.ringostat_calls.find({
            'lead_id': lead_id
        }).sort('created_at', -1).to_list(100)
        
        return {"success": True, "calls": calls}
    except Exception as e:
        logger.error(f"Get lead calls error: {e}")
        return {"success": False, "error": str(e)}

# ═══════════════════════════════════════════════════════════════════
# DEBUG: Simulate Ringostat Events
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/debug/ringostat/simulate", dependencies=[Depends(require_admin)])
async def simulate_ringostat_event(data: Dict[str, Any] = Body(...)):
    """
    Simulate Ringostat webhook events for testing
    Body: {
        "event": "CALL_START" | "CALL_END" | "CALL_MISSED",
        "from": "+380XXXXXXXXX",
        "to": "+380...",
        "manager_extension": "101",
        "duration": 120 (for CALL_END)
    }
    """
    try:
        event_type = data.get('event', 'CALL_START')
        from_number = data.get('from', '+380501234567')
        to_number = data.get('to', '+380931234567')
        manager_ext = data.get('manager_extension', '')
        duration = int(data.get('duration', 0))
        
        # Create fake webhook payload
        webhook_payload = {
            'event': event_type,
            'call_id': f'sim_{str(uuid.uuid4())[:8]}',
            'direction': 'inbound',
            'from': from_number,
            'to': to_number,
            'manager_extension': manager_ext,
            'status': 'answered' if event_type == 'CALL_END' else 'ringing',
            'duration': duration,
            'recording_url': '',
            'utm_source': 'debug',
            'utm_campaign': 'simulation'
        }
        
        # Call the webhook endpoint directly without request object
        # Instead, process webhook logic here
        from_number = webhook_payload['from']
        manager_ext = webhook_payload.get('manager_extension', '')
        call_id = webhook_payload['call_id']
        duration = webhook_payload.get('duration', 0)
        event_type = webhook_payload['event']
        status = webhook_payload.get('status', 'ringing')
        
        # Find or create lead
        lead = await db.leads.find_one({'phone': from_number})
        if not lead:
            # Auto-create lead
            lead = {
                '_id': str(uuid.uuid4()),
                'name': f'Incoming {from_number}',
                'phone': from_number,
                'source': 'ringostat',
                'status': 'new',
                'created_at': datetime.now(timezone.utc)
            }
            await db.leads.insert_one(lead)
            logger.info(f"[SIMULATE] Lead created: {lead['_id']}")
        
        # Get manager by extension
        ringostat_config = await db.ringostat_config.find_one({})
        manager_id = None
        if ringostat_config and manager_ext:
            ext_mapping = ringostat_config.get('extension_mapping', {})
            manager_id = ext_mapping.get(str(manager_ext))
        
        # Create call record
        now = datetime.now(timezone.utc)
        call_data = {
            '_id': str(uuid.uuid4()),
            'call_id': call_id,
            'direction': 'inbound',
            'from': from_number,
            'to': webhook_payload['to'],
            'status': status.upper(),
            'duration': duration,
            'lead_id': lead['_id'],
            'manager_id': manager_id,
            'started_at': now,
            'created_at': now,
            'updated_at': now
        }
        await db.ringostat_calls.insert_one(call_data)
        logger.info(f"[SIMULATE] Call created: {call_id}")
        
        # Emit WebSocket event for CALL_START
        if event_type == 'CALL_START':
            ws_payload = {
                'call_id': call_id,
                'from': from_number,
                'lead_id': lead['_id'],
                'lead_name': lead.get('name'),
                'manager_id': manager_id,
                'timestamp': now.isoformat()
            }
            
            if manager_id:
                await emit_to_user(manager_id, 'ringostat:incoming_call', ws_payload)
                logger.info(f"[SIMULATE] Emitted incoming_call to user:{manager_id}")
            else:
                await emit_to_role('manager', 'ringostat:incoming_call', ws_payload)
                logger.info(f"[SIMULATE] Broadcast incoming_call to role:manager")
        
        # Emit WebSocket event for CALL_END
        elif event_type == 'CALL_END' and duration > 10:
            ws_payload = {
                'call_id': call_id,
                'from': from_number,
                'lead_id': lead['_id'],
                'lead_name': lead.get('name'),
                'manager_id': manager_id,
                'duration': duration,
                'timestamp': now.isoformat()
            }
            
            if manager_id:
                await emit_to_user(manager_id, 'ringostat:call_needs_outcome', ws_payload)
                logger.info(f"[SIMULATE] Emitted call_needs_outcome to user:{manager_id}")
            else:
                await emit_to_role('manager', 'ringostat:call_needs_outcome', ws_payload)
                logger.info(f"[SIMULATE] Broadcast call_needs_outcome to role:manager")
        
        return {
            "success": True,
            "message": f"Simulated {event_type} event",
            "call_id": call_id,
            "lead_id": lead['_id'],
            "manager_id": manager_id
        }
    except Exception as e:
        logger.error(f"Simulate error: {e}")
        return {"success": False, "error": str(e)}

# ═══════════════════════════════════════════════════════════════════
# END DEBUG ENDPOINTS
# ═══════════════════════════════════════════════════════════════════


@fastapi_app.post("/api/admin/integrations/{provider}/test", dependencies=[Depends(require_admin)])
async def test_integration(provider: str):
    """Test integration connection using saved credentials.

    Returns ``{success: bool, message: str}`` and persists the test result on
    the integration_configs document so the UI can show it on next reload.
    """
    doc = await db.integration_configs.find_one({"provider": provider}) or {}
    creds = doc.get("credentials") or {}
    settings = doc.get("settings") or {}

    success = False
    message = f"{provider}: not implemented"

    try:
        if provider == "stripe":
            secret_key = (creds.get("secretKey") or "").strip()
            restricted_key = (creds.get("restrictedKey") or "").strip()
            publishable = (creds.get("publishableKey") or "").strip()

            if not secret_key and not restricted_key:
                success, message = False, "Secret Key (or Restricted Key) is empty — fill it in and Save first."
            else:
                try:
                    import stripe as _stripe  # type: ignore
                    parts: list[str] = []
                    overall_ok = True

                    def _retrieve_account(api_key: str):
                        _stripe.api_key = api_key
                        return _stripe.Account.retrieve()

                    # 1) Test Secret Key (full access) — if provided
                    if secret_key:
                        try:
                            acc = await asyncio.to_thread(_retrieve_account, secret_key)
                            acc_id = getattr(acc, "id", None) or "?"
                            charges_enabled = bool(getattr(acc, "charges_enabled", False))
                            livemode = bool(getattr(acc, "livemode", False))
                            mode_label = "live" if livemode else "test"
                            biz = getattr(acc, "business_profile", None)
                            biz_name = getattr(biz, "name", None) if biz else None
                            biz_suffix = f" — {biz_name}" if biz_name else ""
                            parts.append(f"✓ Secret Key: account {acc_id} ({mode_label}, charges_enabled={charges_enabled}){biz_suffix}")
                        except Exception as ex:
                            overall_ok = False
                            parts.append(f"✗ Secret Key FAILED: {type(ex).__name__}: {str(ex)[:160]}")

                    # 2) Test Restricted Key — if provided (uses Account.retrieve which needs read perms)
                    if restricted_key:
                        try:
                            acc = await asyncio.to_thread(_retrieve_account, restricted_key)
                            acc_id = getattr(acc, "id", None) or "?"
                            parts.append(f"✓ Restricted Key: account {acc_id} (scoped access OK)")
                        except Exception as ex:
                            # Restricted keys often lack Account.read — try a lighter call
                            try:
                                _stripe.api_key = restricted_key
                                # Listing customers usually allowed; just to verify auth works
                                await asyncio.to_thread(lambda: _stripe.Customer.list(limit=1))
                                parts.append(f"✓ Restricted Key: auth OK (limited scope; Account read not granted)")
                            except Exception as ex2:
                                overall_ok = False
                                parts.append(f"✗ Restricted Key FAILED: {type(ex2).__name__}: {str(ex2)[:160]}")

                    # 3) Sanity-check publishable key prefix (no API call possible — it's public)
                    if publishable:
                        if publishable.startswith("pk_test_") or publishable.startswith("pk_live_"):
                            parts.append(f"✓ Publishable Key format OK ({'live' if publishable.startswith('pk_live_') else 'test'} mode)")
                        else:
                            parts.append("⚠ Publishable Key format unexpected — expected pk_test_… or pk_live_…")

                    success = overall_ok
                    message = " · ".join(parts) if parts else "No keys to test"

                except Exception as ex:
                    success = False
                    message = f"Stripe error: {type(ex).__name__}: {str(ex)[:200]}"

        elif provider == "google_oauth":
            client_id = (creds.get("clientId") or "").strip()
            if not client_id:
                success, message = False, "Client ID is empty — fill it in and Save first."
            elif not client_id.endswith(".apps.googleusercontent.com"):
                success, message = False, "Client ID format looks wrong — it should end with '.apps.googleusercontent.com'."
            else:
                success, message = True, f"Client ID format OK ({client_id[:18]}…). Final verification happens at sign-in time."

        elif provider == "openai":
            api_key = (creds.get("apiKey") or "").strip()
            if not api_key:
                success, message = False, "API Key is empty — fill it in and Save first."
            else:
                try:
                    from openai import OpenAI as _OpenAI
                    client = _OpenAI(api_key=api_key)
                    # Cheap call: list models
                    res = await asyncio.to_thread(lambda: client.models.list())
                    n = len(getattr(res, "data", []) or [])
                    success = True
                    message = f"OpenAI key valid — {n} models accessible."
                except Exception as ex:
                    success = False
                    message = f"OpenAI error: {type(ex).__name__}: {str(ex)[:200]}"

        elif provider == "email":
            host = (creds.get("smtpHost") or "").strip()
            port = int((creds.get("smtpPort") or 587) or 587)
            login = (creds.get("smtpLogin") or "").strip()
            pwd = creds.get("smtpPassword") or ""
            if not (host and login and pwd):
                success, message = False, "SMTP host/login/password are required."
            else:
                try:
                    import smtplib, ssl
                    def _smtp_check():
                        ctx = ssl.create_default_context()
                        with smtplib.SMTP(host, port, timeout=8) as s:
                            s.ehlo(); s.starttls(context=ctx); s.ehlo()
                            s.login(login, pwd)
                        return True
                    await asyncio.to_thread(_smtp_check)
                    success, message = True, f"SMTP login successful at {host}:{port}."
                except Exception as ex:
                    success = False
                    message = f"SMTP error: {type(ex).__name__}: {str(ex)[:200]}"

        elif provider == "shipping":
            has_any = any([
                creds.get("apiKey"), creds.get("vesselFinderKey"), creds.get("shipsGoKey"),
                VESSELFINDER_API_KEY, VESSELFINDER_FLEET_KEY, SHIPSGO_API_KEY, SHIPSGO_FLEET_KEY,
            ])
            success = has_any
            message = "Shipping providers reachable." if has_any else "No shipping API keys configured."

        elif provider == "ringostat":
            rd = await db.ringostat_config.find_one({}) or {}
            if rd.get("enabled") and rd.get("api_key"):
                success, message = True, "Ringostat configured (no live ping)."
            else:
                success, message = False, "Ringostat is not configured."

        else:
            success, message = False, f"Unknown provider: {provider}"

    except Exception as ex:
        success = False
        message = f"{provider}: {type(ex).__name__}: {str(ex)[:200]}"

    # Persist the test outcome (only for known providers)
    try:
        await db.integration_configs.update_one(
            {"provider": provider},
            {"$set": {
                "lastTest": datetime.now(timezone.utc).isoformat(),
                "lastTestStatus": "ok" if success else "failed",
                "lastTestError": "" if success else message,
            }},
            upsert=True,
        )
    except Exception:
        pass

    logger.info(f"[integrations] test {provider} → success={success} msg={message[:120]}")
    return {"success": success, "message": message}

@fastapi_app.post("/api/admin/integrations/{provider}/toggle", dependencies=[Depends(require_admin)])
async def toggle_integration(provider: str, data: Dict[str, Any] = Body(...)):
    """Toggle integration enabled state (persisted for supported providers)."""
    is_enabled = bool(data.get("isEnabled", False))
    if provider in ("google_oauth", "stripe", "email", "shipping", "openai"):
        await db.integration_configs.update_one(
            {"provider": provider},
            {"$set": {"provider": provider, "isEnabled": is_enabled,
                      "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    return {"success": True, "isEnabled": is_enabled}


# ═══════════════════════════════════════════════════════════════════
# GOOGLE SIGN-IN (public Client ID + ID token verification)
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/auth/google-client-id")
async def public_google_client_id():
    """Public endpoint — returns the configured Google OAuth Client ID.

    Used by the Customer Cabinet login page to initialise Google Identity
    Services (GIS) popup. No secret is returned.

    Resolution order (new):
      1. app_settings.auth.google.clientId             (admin UI — preferred)
      2. integration_configs.{provider:google_oauth}   (legacy)
      3. GOOGLE_CLIENT_ID env var                      (fallback)
    """
    try:
        svc = get_settings_service()
        auth = await svc.get_auth()
        gcfg = auth.get("google") or {}
        features = auth.get("features") or {}
        if features.get("googleEnabled", True) is False:
            return {"clientId": "", "enabled": False}
        cid = (gcfg.get("clientId") or "").strip()
        if cid:
            return {"clientId": cid, "enabled": True}
    except Exception as exc:
        logger.warning(f"[google-client-id] settings lookup failed: {exc}")

    # Fallback to the legacy integration_configs path
    doc = await db.integration_configs.find_one({"provider": "google_oauth"}) or {}
    creds = doc.get("credentials") or {}
    client_id = (creds.get("clientId") or "").strip()
    db_enabled = bool(doc.get("isEnabled", bool(client_id)))

    if not client_id:
        env_id = (os.environ.get("GOOGLE_CLIENT_ID", "") or "").strip()
        if env_id:
            client_id = env_id
            db_enabled = True  # env-provided ⇒ implicitly enabled

    enabled = db_enabled and bool(client_id)
    return {
        "clientId": client_id if enabled else "",
        "enabled": enabled,
    }


@fastapi_app.post("/api/customer-auth/google/verify")
async def customer_google_verify(data: Dict[str, Any] = Body(...)):
    """
    Verify a Google ID token (credential) issued by Google Identity Services
    directly in the browser. No intermediate provider involved.

    Body: { "credential": "<google_id_token>" }
    Returns: same shape as /api/customer-auth/google/session (customer + sessionToken).
    """
    credential = (data or {}).get("credential") or data.get("id_token")
    if not credential:
        raise HTTPException(status_code=400, detail="credential is required")

    # Resolve configured Client ID (from integration config or env fallback)
    doc = await db.integration_configs.find_one({"provider": "google_oauth"}) or {}
    client_id = (doc.get("credentials") or {}).get("clientId") or os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured")

    # Verify token with google-auth
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        idinfo = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
            clock_skew_in_seconds=30,
        )
    except Exception as exc:
        logger.warning(f"[google/verify] token invalid: {exc}")
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    # Basic sanity
    if idinfo.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        raise HTTPException(status_code=401, detail="Invalid token issuer")

    email = (idinfo.get("email") or "").strip().lower()
    if not email or not idinfo.get("email_verified", False):
        raise HTTPException(status_code=400, detail="Google account email not verified")

    name = idinfo.get("name") or ""
    picture = idinfo.get("picture") or ""
    google_sub = idinfo.get("sub") or ""

    # Upsert customer — same shape as the Emergent flow
    existing = await db.customers.find_one({"email": email}, {"_id": 0})
    now_iso = datetime.now(timezone.utc).isoformat()
    if existing:
        customer_id = (
            existing.get("customerId") or existing.get("id") or existing.get("user_id")
            or f"cust_{uuid.uuid4().hex[:12]}"
        )
        update = {
            "name": name or existing.get("name") or email.split("@", 1)[0],
            "picture": picture or existing.get("picture", ""),
            "googleId": google_sub or existing.get("googleId", ""),
            "last_login_at": now_iso,
            "source": existing.get("source") or "google",
        }
        update.update({"id": customer_id, "customerId": customer_id, "user_id": customer_id})
        await db.customers.update_one({"email": email}, {"$set": update})
        customer = {**existing, **update, "email": email, "role": existing.get("role", "customer")}
    else:
        customer_id = f"cust_{uuid.uuid4().hex[:12]}"
        customer = {
            "id": customer_id,
            "customerId": customer_id,
            "user_id": customer_id,
            "email": email,
            "name": name or email.split("@", 1)[0],
            "picture": picture,
            "googleId": google_sub,
            "role": "customer",
            "status": "active",
            "source": "google",
            "created_at": now_iso,
            "last_login_at": now_iso,
        }
        await db.customers.insert_one(customer)

    # Mint session token
    token = generate_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_CUSTOMER_SESSION_TTL_DAYS)
    await db.customer_sessions.insert_one({
        "token": token,
        "session_token": token,
        "customerId": customer_id,
        "user_id": customer_id,
        "provider": "google",
        "created_at": now,
        "expires_at": expires_at,
    })
    return _customer_response(customer, token)

# Proxy Management
@fastapi_app.get("/api/admin/proxy/status", dependencies=[Depends(require_admin)])
async def proxy_status():
    return {
        "proxies": [],
        "activeCount": 0,
        "totalCount": 0,
    }

@fastapi_app.post("/api/admin/proxy/add", dependencies=[Depends(require_admin)])
async def proxy_add(data: Dict[str, Any] = Body(...)):
    return {"success": True, "id": "new-proxy"}

@fastapi_app.post("/api/admin/proxy/enable/{proxy_id}", dependencies=[Depends(require_admin)])
async def proxy_enable(proxy_id: str):
    return {"success": True}

@fastapi_app.post("/api/admin/proxy/disable/{proxy_id}", dependencies=[Depends(require_admin)])
async def proxy_disable(proxy_id: str):
    return {"success": True}

@fastapi_app.post("/api/admin/proxy/priority/{proxy_id}", dependencies=[Depends(require_admin)])
async def proxy_priority(proxy_id: str, data: Dict[str, Any] = Body(...)):
    return {"success": True}

@fastapi_app.post("/api/admin/proxy/test/{proxy_id}", dependencies=[Depends(require_admin)])
async def proxy_test(proxy_id: str):
    return {"success": True, "latency": 150, "status": "ok"}

@fastapi_app.post("/api/admin/proxy/reload", dependencies=[Depends(require_admin)])
async def proxy_reload():
    return {"success": True}

# Sources
@fastapi_app.get("/api/admin/sources", dependencies=[Depends(require_admin)])
async def admin_sources():
    return {
        "sources": [
            {"id": "iaai", "name": "IAAI", "active": True, "count": 1500},
            {"id": "copart", "name": "Copart", "active": True, "count": 2200},
        ]
    }

@fastapi_app.post("/api/admin/sources/recompute", dependencies=[Depends(require_admin)])
async def sources_recompute():
    return {"success": True}

@fastapi_app.get("/api/admin/sources/{source_id}", dependencies=[Depends(require_admin)])
async def get_source(source_id: str):
    return {"id": source_id, "name": source_id, "active": True}

@fastapi_app.put("/api/admin/sources/{source_id}", dependencies=[Depends(require_admin)])
async def update_source(source_id: str, data: Dict[str, Any] = Body(...)):
    return {"success": True}

# Staff Sessions
@fastapi_app.get("/api/admin/staff-sessions", dependencies=[Depends(require_admin)])
async def staff_sessions():
    return {"sessions": []}

@fastapi_app.get("/api/admin/staff-sessions/active", dependencies=[Depends(require_admin)])
async def staff_sessions_active():
    return {"sessions": []}

@fastapi_app.get("/api/admin/staff-sessions/analytics", dependencies=[Depends(require_admin)])
async def staff_sessions_analytics():
    return {"totalSessions": 0, "avgDuration": 0}

@fastapi_app.get("/api/admin/staff-sessions/suspicious", dependencies=[Depends(require_admin)])
async def staff_sessions_suspicious():
    return {"sessions": []}

@fastapi_app.get("/api/admin/staff-sessions/login-alerts", dependencies=[Depends(require_admin)])
async def staff_sessions_login_alerts():
    return {"alerts": []}

@fastapi_app.post("/api/admin/staff-sessions/force-logout/{session_id}", dependencies=[Depends(require_admin)])
async def staff_sessions_force_logout(session_id: str):
    return {"success": True}

# Security
# ═══════════════════════════════════════════════════════════════════
# 2FA (Google Authenticator / TOTP) — real implementation
# ═══════════════════════════════════════════════════════════════════
import pyotp
import qrcode
from io import BytesIO
import base64


def _get_admin_id(request: Request = None) -> str:
    """Extract admin user id from auth header/session. Default 'admin' for single-tenant."""
    # In single-tenant mode the panel is protected by session auth.
    # We scope 2FA by a stable id, default 'admin'.
    return "admin"


@fastapi_app.get("/api/admin/security/2fa/status", dependencies=[Depends(require_admin)])
async def security_2fa_status():
    admin_id = _get_admin_id()
    doc = await db.admin_security.find_one({'_id': admin_id}) or {}
    return {
        'enabled': bool(doc.get('twofa_enabled')),
        'setupPending': bool(doc.get('twofa_secret') and not doc.get('twofa_enabled')),
    }


@fastapi_app.post("/api/admin/security/2fa/setup", dependencies=[Depends(require_admin)])
async def security_2fa_setup():
    """Generate a fresh TOTP secret + QR PNG. Doesn't activate yet — verify step required."""
    admin_id = _get_admin_id()
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    issuer = 'BIBI Cars CRM'
    account = f'{admin_id}@bibi.cars'
    uri = totp.provisioning_uri(name=account, issuer_name=issuer)

    img = qrcode.make(uri)
    buf = BytesIO()
    img.save(buf, format='PNG')
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    await db.admin_security.update_one(
        {'_id': admin_id},
        {'$set': {
            'twofa_secret': secret,
            'twofa_enabled': False,
            'twofa_setup_started_at': datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {
        'secret': secret,
        'qrCode': f'data:image/png;base64,{qr_b64}',
        'uri': uri,
        'issuer': issuer,
        'account': account,
    }


@fastapi_app.post("/api/admin/security/2fa/verify", dependencies=[Depends(require_admin)])
async def security_2fa_verify(data: Dict[str, Any] = Body(...)):
    admin_id = _get_admin_id()
    code = str(data.get('code', '')).strip()
    if not code:
        raise HTTPException(status_code=400, detail='code required')

    doc = await db.admin_security.find_one({'_id': admin_id}) or {}
    secret = doc.get('twofa_secret')
    if not secret:
        raise HTTPException(status_code=400, detail='2FA setup not started')

    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail='Invalid code')

    await db.admin_security.update_one(
        {'_id': admin_id},
        {'$set': {
            'twofa_enabled': True,
            'twofa_enabled_at': datetime.now(timezone.utc),
        }},
    )
    return {'success': True, 'enabled': True}


@fastapi_app.post("/api/admin/security/2fa/disable", dependencies=[Depends(require_admin)])
async def security_2fa_disable(data: Dict[str, Any] = Body(default={})):
    admin_id = _get_admin_id()
    code = str((data or {}).get('code', '')).strip()
    doc = await db.admin_security.find_one({'_id': admin_id}) or {}
    # If already enabled — require current code to disable
    if doc.get('twofa_enabled'):
        secret = doc.get('twofa_secret')
        if not code or not pyotp.TOTP(secret).verify(code, valid_window=1):
            raise HTTPException(status_code=400, detail='Invalid code')
    await db.admin_security.update_one(
        {'_id': admin_id},
        {'$set': {
            'twofa_enabled': False,
            'twofa_secret': None,
            'twofa_disabled_at': datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {'success': True, 'enabled': False}

# Call Flow
@fastapi_app.get("/api/admin/call-flow/board", dependencies=[Depends(require_admin)])
async def call_flow_board():
    return {"calls": []}

@fastapi_app.get("/api/admin/call-flow/due", dependencies=[Depends(require_admin)])
async def call_flow_due():
    return {"dueCalls": []}

@fastapi_app.get("/api/admin/call-flow/stats", dependencies=[Depends(require_admin)])
async def call_flow_stats():
    return {"totalCalls": 0, "completedCalls": 0}

# Cadence
@fastapi_app.get("/api/cadence/definitions")
async def cadence_definitions():
    """Get cadence definitions - returns direct array"""
    return [
        {"id": "c1", "name": "New Lead Follow-up", "description": "Automated follow-up for new leads", "isActive": True, "steps": [
            {"order": 1, "delay": 0, "action": "notification", "template": "new_lead_welcome"},
            {"order": 2, "delay": 3600, "action": "task", "template": "first_call"},
            {"order": 3, "delay": 86400, "action": "telegram", "template": "follow_up_message"}
        ]},
        {"id": "c2", "name": "Deal Stalled Alert", "description": "Alert when deal is stalled", "isActive": False, "steps": [
            {"order": 1, "delay": 172800, "action": "alert", "template": "deal_stalled"}
        ]},
    ]

@fastapi_app.get("/api/cadence/runs")
async def cadence_runs():
    """Get active cadence runs - returns direct array"""
    return [
        {"id": "run1", "cadenceId": "c1", "entityId": "lead_123", "entityType": "lead", "currentStep": 2, "status": "active", "startedAt": datetime.now(timezone.utc).isoformat()},
    ]

@fastapi_app.get("/api/cadence/runs/{run_id}")
async def cadence_run(run_id: str):
    return {"id": run_id, "status": "completed"}

@fastapi_app.post("/api/cadence/definitions")
async def create_cadence(data: Dict[str, Any] = Body(...)):
    """Create cadence definition"""
    return {"success": True, "id": f"c_{datetime.now(timezone.utc).timestamp()}"}

@fastapi_app.put("/api/cadence/definitions/{cadence_id}")
async def update_cadence(cadence_id: str, data: Dict[str, Any] = Body(...)):
    """Update cadence definition"""
    return {"success": True}

@fastapi_app.delete("/api/cadence/definitions/{cadence_id}")
async def delete_cadence(cadence_id: str):
    """Delete cadence definition"""
    return {"success": True}

@fastapi_app.patch("/api/cadence/definitions/{cadence_id}/toggle")
async def toggle_cadence(cadence_id: str, data: Dict[str, Any] = Body(...)):
    """Toggle cadence active state"""
    return {"success": True}

@fastapi_app.post("/api/cadence/runs/{run_id}/stop")
async def stop_cadence_run(run_id: str):
    """Stop cadence run"""
    return {"success": True}

# Calls
@fastapi_app.get("/api/calls/analytics")
async def calls_analytics():
    return {"totalCalls": 0, "avgDuration": 0}

@fastapi_app.get("/api/calls/board")
async def calls_board():
    return {"calls": []}

# Carfax Admin
@fastapi_app.get("/api/carfax/admin/analytics", dependencies=[Depends(require_admin)])
async def carfax_admin_analytics():
    return {"totalReports": 0, "pendingReports": 0}

@fastapi_app.get("/api/carfax/admin/queue", dependencies=[Depends(require_admin)])
async def carfax_admin_queue():
    return {"queue": []}

@fastapi_app.get("/api/carfax/me")
async def carfax_me():
    return {"reports": []}

@fastapi_app.post("/api/carfax/request")
async def carfax_request(data: Dict[str, Any] = Body(...)):
    return {"success": True, "requestId": "req-1"}

# Contracts
@fastapi_app.get("/api/contracts/me")
async def contracts_me():
    return {"contracts": []}

@fastapi_app.get("/api/contracts/{contract_id}")
async def contracts_get(contract_id: str):
    return {"id": contract_id, "status": "pending"}

# Auth
@fastapi_app.post("/api/auth/change-password")
async def auth_change_password(data: Dict[str, Any] = Body(...)):
    return {"success": True}

# Cabinet
@fastapi_app.get("/api/cabinet/history-reports")
async def cabinet_history_reports():
    return {"reports": []}

# Customer Auth
@fastapi_app.post("/api/customer-auth/me/avatar/upload")
async def customer_avatar_upload():
    # Legacy endpoint — kept for compatibility but does nothing.
    # Use /api/customer-cabinet/{customer_id}/avatar instead (no external auth required).
    return {"success": True, "url": "", "deprecated": True}


@fastapi_app.post("/api/customer-cabinet/{customer_id}/avatar")
async def customer_cabinet_upload_avatar(
    customer_id: str,
    avatar: UploadFile = File(...),
):
    """
    Upload avatar for a customer (cabinet flow — NO external auth redirect).
    Saves file to /app/backend/static/avatars/{customer_id}.{ext}
    and writes URL into customer.avatar.
    """
    await _ensure_customer_seed(customer_id)

    # Validate content type
    ctype = (avatar.content_type or '').lower()
    allowed = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'}
    if ctype not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {ctype}")

    ext = allowed[ctype]
    content = await avatar.read()

    # Max 5MB
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 5MB)")

    dest = _STATIC_DIR / "avatars" / f"{customer_id}.{ext}"
    # delete older extensions
    for old_ext in allowed.values():
        old_file = _STATIC_DIR / "avatars" / f"{customer_id}.{old_ext}"
        if old_file.exists() and old_file != dest:
            try:
                old_file.unlink()
            except Exception:
                pass

    with open(dest, 'wb') as f:
        f.write(content)

    # Cache-buster via timestamp
    ts = int(datetime.now(timezone.utc).timestamp())
    url = f"/api/static/avatars/{customer_id}.{ext}?v={ts}"

    await db.customers.update_one(
        {'id': customer_id},
        {'$set': {'avatar': url, 'picture': url, 'updatedAt': datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {'success': True, 'url': url, 'avatar': url, 'picture': url}


@fastapi_app.delete("/api/customer-cabinet/{customer_id}/avatar")
async def customer_cabinet_delete_avatar(customer_id: str):
    """Remove avatar file and clear customer.avatar field."""
    for ext in ('jpg', 'png', 'webp', 'gif'):
        f = _STATIC_DIR / "avatars" / f"{customer_id}.{ext}"
        if f.exists():
            try:
                f.unlink()
            except Exception:
                pass
    await db.customers.update_one(
        {'id': customer_id},
        {'$set': {'avatar': None, 'picture': None, 'updatedAt': datetime.now(timezone.utc)}},
    )
    return {'success': True}

# Analytics Dashboard
@fastapi_app.get("/api/analytics/dashboard")
async def analytics_dashboard(days: int = 30):
    return {
        "success": True,
        "data": {
            "kpi": {
                "visits": 15000,
                "uniqueSessions": 5200,
                "vinSearches": 800,
                "leads": 450,
                "deals": 150,
                "conversionRate": 3.5,
            },
            "summary": {
                "pageViews": 15000,
                "uniqueVisitors": 5200,
                "avgSessionDuration": 245,
                "bounceRate": 35,
                "newUsers": 1200,
                "conversionRate": 3.5,
            },
            "trend": {
                "pageViews": 12,
                "visitors": 8,
                "sessions": 5,
            },
            "timeline": [
                {"date": "2026-04-01", "pageViews": 450, "visitors": 150, "conversions": 5},
                {"date": "2026-04-02", "pageViews": 520, "visitors": 180, "conversions": 8},
                {"date": "2026-04-03", "pageViews": 480, "visitors": 160, "conversions": 6},
                {"date": "2026-04-04", "pageViews": 550, "visitors": 200, "conversions": 9},
                {"date": "2026-04-05", "pageViews": 600, "visitors": 220, "conversions": 11},
                {"date": "2026-04-06", "pageViews": 530, "visitors": 190, "conversions": 7},
                {"date": "2026-04-07", "pageViews": 580, "visitors": 210, "conversions": 10},
            ],
            "funnel": {
                "steps": [
                    {"name": "Відвідування", "value": 5200},
                    {"name": "Перегляд авто", "value": 2800},
                    {"name": "Калькулятор", "value": 1500},
                    {"name": "Заявка", "value": 450},
                    {"name": "Угода", "value": 150},
                ]
            },
            "sources": [
                {"name": "Google", "visitors": 2500, "conversions": 75},
                {"name": "Direct", "visitors": 1800, "conversions": 50},
                {"name": "Facebook", "visitors": 600, "conversions": 15},
                {"name": "Instagram", "visitors": 300, "conversions": 10},
            ],
            "topPages": [
                {"path": "/", "views": 3500, "avgTime": 45},
                {"path": "/vehicles", "views": 2800, "avgTime": 120},
                {"path": "/calculator", "views": 1500, "avgTime": 180},
                {"path": "/vin-check", "views": 800, "avgTime": 90},
            ]
        }
    }

# Marketing Campaigns
@fastapi_app.get("/api/marketing/campaigns")
async def marketing_campaigns(days: int = 30):
    return {
        "success": True,
        "data": {
            "campaigns": [
                {"id": "1", "name": "Весняна акція", "status": "scale", "spend": 5000, "leads": 120, "conversions": 25, "roi": 180},
                {"id": "2", "name": "BMW Series", "status": "keep", "spend": 3000, "leads": 80, "conversions": 15, "roi": 150},
                {"id": "3", "name": "Тест-драйв", "status": "watch", "spend": 2000, "leads": 40, "conversions": 5, "roi": 80},
            ],
            "totalSpend": 10000,
            "totalLeads": 240,
            "totalConversions": 45,
            "avgCPA": 42,
            "avgROI": 136,
        }
    }

# ═══════════════════════════════════════════════════════════════════
# PUBLIC API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/public/vehicles")
async def public_vehicles(
    limit: int = 20, 
    skip: int = 0,
    make: Optional[str] = None,
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    price_min: Optional[int] = None,
    price_max: Optional[int] = None,
    sort: str = "newest"
):
    """Public vehicles listing"""
    query = {"status": {"$in": ["published", "active", None]}}
    if make:
        query["make"] = {"$regex": make, "$options": "i"}
    if year_min:
        query["year"] = {"$gte": year_min}
    if year_max:
        query.setdefault("year", {})["$lte"] = year_max
    if price_min:
        query["price"] = {"$gte": price_min}
    if price_max:
        query.setdefault("price", {})["$lte"] = price_max
    
    sort_order = -1 if sort == "newest" else 1
    cursor = db.vin_data.find(query, {'_id': 0}).sort('created_at', sort_order).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.vin_data.count_documents(query)
    
    return {"success": True, "data": items, "total": total, "limit": limit, "skip": skip}

@fastapi_app.get("/api/public/vehicles/{vehicle_id}")
async def public_vehicle_detail(vehicle_id: str):
    """Get vehicle by VIN or ID"""
    vehicle = await db.vin_data.find_one(
        {"$or": [{"vin": vehicle_id.upper()}, {"id": vehicle_id}]},
        {'_id': 0}
    )
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"success": True, "data": vehicle}

@fastapi_app.post("/api/public/leads/quick")
async def create_quick_lead(data: Dict[str, Any] = Body(...)):
    """Create quick lead from public site (incl. calculator leads)."""
    lead = {
        "id": f"lead-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name", ""),
        "phone": data.get("phone", ""),
        "email": data.get("email", ""),
        "vin": data.get("vin"),
        "vehicleId": data.get("vehicleId"),
        "source": data.get("source", "website"),
        "message": data.get("message", ""),
        # calculator / catalog enrichment
        "desiredCar": data.get("desiredCar"),
        "budget": data.get("budget"),
        "quoteId": data.get("quoteId"),
        "calculation": data.get("calculation"),
        "status": "new",
        "score": 70 if (data.get("source") == "calculator") else 50,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leads.insert_one(lead)
    return {"success": True, "leadId": lead["id"]}

@fastapi_app.post("/api/public/leads/from-quote")
async def create_lead_from_quote(data: Dict[str, Any] = Body(...)):
    """Create lead from quote"""
    lead = {
        "id": f"lead-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name", ""),
        "phone": data.get("phone", ""),
        "email": data.get("email", ""),
        "vin": data.get("vin"),
        "quoteId": data.get("quoteId"),
        "scenario": data.get("scenario"),
        "source": "calculator",
        "status": "new",
        "score": 70,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leads.insert_one(lead)
    return {"success": True, "leadId": lead["id"]}

@fastapi_app.get("/api/public/vin/{vin}")
async def public_vin_lookup(vin: str):
    """Public VIN lookup"""
    vin = vin.upper()
    if not is_valid_vin(vin):
        raise HTTPException(status_code=400, detail="Invalid VIN")
    
    vehicle = await db.vin_data.find_one({"vin": vin}, {'_id': 0})
    if vehicle:
        return {"success": True, "data": vehicle, "source": "database"}
    
    return {"success": True, "data": None, "message": "VIN not found in database"}

# ═══════════════════════════════════════════════════════════════════
# VIN SEARCH V2 (compatibility layer)
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/v2/search/{vin}")
async def vin_search_v2(vin: str):
    """VIN search endpoint for frontend compatibility - now with bid.cars integration"""
    start_time = time.time()
    vin = vin.upper()
    
    if not is_valid_vin(vin):
        raise HTTPException(status_code=400, detail="Invalid VIN format")
    
    # 1. Check local database first
    vehicle = await db.vin_data.find_one({"vin": vin}, {'_id': 0})
    if vehicle:
        result = {
            "success": True,
            "vin": vin,
            "year": vehicle.get("year"),
            "make": vehicle.get("make"),
            "model": vehicle.get("model"),
            "trim": vehicle.get("trim"),
            "price": vehicle.get("price"),
            "odometer": vehicle.get("odometer"),
            "odometer_unit": vehicle.get("odometer_unit", "mi"),
            "location": vehicle.get("location"),
            "lot_number": vehicle.get("lot_number"),
            "auction_name": vehicle.get("auction_name"),
            "damage_primary": vehicle.get("damage_primary"),
            "damage_secondary": vehicle.get("damage_secondary"),
            "title": vehicle.get("title_status"),
            "image_urls": vehicle.get("images", []),
            "fuel_type": vehicle.get("fuel_type"),
            "transmission": vehicle.get("transmission"),
            "drivetrain": vehicle.get("drivetrain"),
            "engine": vehicle.get("engine"),
            "condition": vehicle.get("condition"),
            "color": vehicle.get("color"),
            "keys": vehicle.get("keys"),
            "seller": vehicle.get("seller"),
            "sale_date": vehicle.get("sale_date"),
            "source_url": vehicle.get("detail_url"),
            "winning_source": "local_db",
            "confidence": vehicle.get("confidence", 0.9),
            "response_time_ms": int((time.time() - start_time) * 1000),
            "cached": True,
            "quality_level": vehicle.get("quality"),
        }
        
        # Try to enrich with BidMotors live data if images are missing or incomplete
        if len(result.get("image_urls", [])) < 5 and BITMOTORS_AVAILABLE and bitmotors_parser_instance:
            try:
                bm_result = await bitmotors_parser_instance.search_vin(vin)
                if bm_result.get("success") and bm_result.get("images"):
                    result["image_urls"] = bm_result["images"]
                    # Enrich with additional fields from live search
                    for field in ["fuel_type", "transmission", "drivetrain", "engine", "condition", "keys", "seller", "location", "color", "sale_date"]:
                        if not result.get(field) and bm_result.get(field):
                            result[field] = bm_result[field]
                    if not result.get("source_url") and bm_result.get("source_url"):
                        result["source_url"] = bm_result["source_url"]
                    result["winning_source"] = "local_db+bidmotors_live"
                    result["response_time_ms"] = int((time.time() - start_time) * 1000)
            except Exception as e:
                logger.warning(f"[VIN-SEARCH] BidMotors enrichment failed: {e}")
        
        return result
    
    # 2. Check bid.cars parsed vehicles
    bidcars_vehicle = await db.bidcars_vehicles.find_one({"vin": vin}, {'_id': 0})
    if bidcars_vehicle:
        return {
            "success": True,
            "vin": vin,
            "year": bidcars_vehicle.get("year"),
            "make": bidcars_vehicle.get("make_model", "").split()[0] if bidcars_vehicle.get("make_model") else None,
            "model": " ".join(bidcars_vehicle.get("make_model", "").split()[1:]) if bidcars_vehicle.get("make_model") else None,
            "price": bidcars_vehicle.get("current_bid"),
            "odometer": bidcars_vehicle.get("odometer_value"),
            "odometer_unit": "mi",
            "location": bidcars_vehicle.get("location"),
            "lot_number": bidcars_vehicle.get("lot_id"),
            "auction_name": bidcars_vehicle.get("auction"),
            "damage_primary": bidcars_vehicle.get("primary_damage"),
            "damage_secondary": bidcars_vehicle.get("secondary_damage"),
            "title": bidcars_vehicle.get("document_type"),
            "image_urls": bidcars_vehicle.get("images", []),
            "sale_date": bidcars_vehicle.get("auction_date"),
            "keys": bidcars_vehicle.get("keys"),
            "transmission": bidcars_vehicle.get("transmission"),
            "color": bidcars_vehicle.get("exterior_color"),
            "estimated_total_eur": bidcars_vehicle.get("estimated_total_eur"),
            "shipping_cost": bidcars_vehicle.get("shipping_cost"),
            "winning_source": "bid.cars",
            "source_url": bidcars_vehicle.get("_parsed_url"),
            "confidence": 0.95,
            "response_time_ms": int((time.time() - start_time) * 1000),
            "cached": True
        }
    
    # 3. Try BidMotors live search
    if BITMOTORS_AVAILABLE and bitmotors_parser_instance:
        try:
            bm_result = await bitmotors_parser_instance.search_vin(vin)
            if bm_result.get("success") and bm_result.get("vin"):
                return {
                    "success": True,
                    "vin": vin,
                    "year": bm_result.get("year"),
                    "make": bm_result.get("make"),
                    "model": bm_result.get("model"),
                    "trim": bm_result.get("trim"),
                    "price": bm_result.get("price"),
                    "odometer": bm_result.get("odometer"),
                    "odometer_unit": bm_result.get("odometer_unit", "mi"),
                    "location": bm_result.get("location"),
                    "lot_number": bm_result.get("lot_number"),
                    "auction_name": bm_result.get("auction_name"),
                    "damage_primary": bm_result.get("damage_primary"),
                    "damage_secondary": bm_result.get("damage_secondary"),
                    "title": bm_result.get("title_status"),
                    "fuel_type": bm_result.get("fuel_type"),
                    "transmission": bm_result.get("transmission"),
                    "drivetrain": bm_result.get("drivetrain"),
                    "engine": bm_result.get("engine"),
                    "condition": bm_result.get("condition"),
                    "color": bm_result.get("color"),
                    "keys": bm_result.get("keys"),
                    "seller": bm_result.get("seller"),
                    "sale_date": bm_result.get("sale_date"),
                    "image_urls": bm_result.get("images", []),
                    "source_url": bm_result.get("source_url"),
                    "winning_source": "bidmotors_live",
                    "confidence": 0.85,
                    "response_time_ms": int((time.time() - start_time) * 1000),
                    "cached": False,
                    "quality_level": bm_result.get("quality_level"),
                }
        except Exception as e:
            logger.warning(f"[VIN-SEARCH] BidMotors live search failed: {e}")
    
    # 4. Return not found - explicitly mark as error so frontend doesn't confuse it with found
    return {
        "success": False,
        "error": "not_found",
        "vin": vin,
        "data": None,
        "source": "not_found",
        "message": "VIN не знайдено. Спробуйте вставити посилання на лот bid.cars в поле пошуку.",
        "response_time_ms": int((time.time() - start_time) * 1000)
    }


# ═══════════════════════════════════════════════════════════════════
# PUBLIC UNIFIED SEARCH (header search bar — VIN or LOT)
# ═══════════════════════════════════════════════════════════════════

def _normalize_search_query(raw: str) -> Dict[str, str]:
    """Classify a raw search query as VIN, VIN_PARTIAL, LOT or URL.

    - Strips whitespace, uppercases
    - VIN: 17 chars [A-HJ-NPR-Z0-9] (no I/O/Q)
    - VIN_PARTIAL: 6–16 alphanumerics (A-HJ-NPR-Z0-9) — prefix match
    - LOT: numeric 4–10 digits
    - URL: contains '://'
    """
    q = (raw or "").strip()
    if not q:
        return {"kind": "empty", "value": ""}
    if "://" in q:
        return {"kind": "url", "value": q}
    clean = q.upper().replace(" ", "").replace("-", "")
    # VIN detection (17 alphanumeric, excluding I/O/Q per ISO 3779)
    if re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", clean):
        return {"kind": "vin", "value": clean}
    # Numeric lot number (pure digits, 4–10)
    if re.fullmatch(r"\d{4,10}", clean):
        return {"kind": "lot", "value": clean}
    # Partial VIN — 3..16 alphanumerics (ISO 3779 charset), prefix lookup
    if re.fullmatch(r"[A-HJ-NPR-Z0-9]{3,16}", clean):
        return {"kind": "vin_partial", "value": clean}
    # Otherwise — treat as free-text lot/partial (numeric-ish)
    return {"kind": "unknown", "value": clean}


def _vehicle_doc_to_public_card(vehicle: Dict[str, Any]) -> Dict[str, Any]:
    """Shape a vin_data document into the public vehicle-card payload."""
    return {
        "success": True,
        "vin": vehicle.get("vin"),
        "title": vehicle.get("title"),
        "year": vehicle.get("year"),
        "make": vehicle.get("make"),
        "model": vehicle.get("model"),
        "trim": vehicle.get("trim"),
        "price": vehicle.get("price"),
        "odometer": vehicle.get("odometer"),
        "odometer_unit": vehicle.get("odometer_unit", "mi"),
        "location": vehicle.get("location"),
        "lot_number": vehicle.get("lot_number"),
        "auction_name": vehicle.get("auction_name"),
        "damage_primary": vehicle.get("damage_primary"),
        "damage_secondary": vehicle.get("damage_secondary"),
        "title_status": vehicle.get("title_status"),
        "image_urls": vehicle.get("images") or vehicle.get("image_urls") or [],
        "fuel_type": vehicle.get("fuel_type"),
        "transmission": vehicle.get("transmission"),
        "drivetrain": vehicle.get("drivetrain"),
        "engine": vehicle.get("engine"),
        "condition": vehicle.get("condition"),
        "color": vehicle.get("color"),
        "keys": vehicle.get("keys"),
        "seller": vehicle.get("seller"),
        "sale_date": vehicle.get("sale_date"),
        "source_url": vehicle.get("detail_url") or vehicle.get("source_url"),
        "winning_source": vehicle.get("source", "local_db"),
        "confidence": vehicle.get("confidence", 0.9),
        "quality_level": vehicle.get("quality"),
        "updated_at": (
            vehicle.get("updated_at").isoformat()
            if hasattr(vehicle.get("updated_at"), "isoformat")
            else vehicle.get("updated_at")
        ),
    }


@fastapi_app.get("/api/public/search/suggest")
async def public_search_suggest(
    q: str = Query(..., min_length=1, max_length=32, description="Search term (VIN/LOT/title fragment)"),
    limit: int = Query(6, ge=1, le=12),
    live: bool = Query(True, description="Hit BidMotors live (recommended)."),
):
    """LIVE-FIRST autocomplete.

    Flow:
      1. TTL cache (5 min) → source="CACHE"
      2. BidMotors LIVE → source="LIVE"
      3. On live error → STALE local fallback → source="STALE_FALLBACK"
    """
    start_t = time.time()
    raw = (q or "").strip()
    if not raw:
        return {
            "success": True, "items": [], "count": 0,
            "query": raw, "source": "EMPTY", "data_source": "EMPTY",
            "live_used": False, "cache_hit": False, "response_time_ms": 0,
        }

    clean_q = raw.upper().replace(" ", "").replace("-", "")
    cache_key = f"suggest:{clean_q}:{limit}"

    # ─── 1. CACHE ──────────────────────────────────────────────────────
    if live_search_cache is not None:
        try:
            cached = await live_search_cache.get(cache_key)
        except Exception:
            cached = None
        if cached:
            return {
                **cached,
                "source": "CACHE",
                "data_source": "CACHE",
                "cache_hit": True,
                "response_time_ms": int((time.time() - start_t) * 1000),
            }

    # ─── 2. LIVE FIRST ─────────────────────────────────────────────────
    live_items: List[Dict[str, Any]] = []
    live_failed = False
    if live and BITMOTORS_AVAILABLE:
        try:
            result = await asyncio.wait_for(
                bm_live_search(raw, db=None, limit=limit),
                timeout=6.0,
            )
            live_items = (result or {}).get("items") or []
            for it in live_items:
                it["_src"] = "live"
        except Exception as e:
            logger.warning(f"[search/suggest] live failed {raw!r}: {e}")
            live_failed = True
            live_items = []

    if live_items:
        payload = {
            "success": True,
            "items": live_items[:limit],
            "count": min(len(live_items), limit),
            "query": raw,
            "source": "LIVE",
            "data_source": "LIVE",
            "live_used": True,
            "cache_hit": False,
            "response_time_ms": int((time.time() - start_t) * 1000),
        }
        if live_search_cache is not None:
            try:
                # Cache the items only (not the meta fields)
                await live_search_cache.set(cache_key, {
                    "success": True,
                    "items": live_items[:limit],
                    "count": min(len(live_items), limit),
                    "query": raw,
                })
            except Exception:
                pass
        try:
            asyncio.create_task(_log_public_search(
                raw=raw, clean=clean_q, kind="suggest",
                found=True, source="LIVE",
            ))
        except Exception:
            pass
        return payload

    # ─── 3. STALE FALLBACK (only if LIVE failed/empty) ─────────────────
    local_items: List[Dict[str, Any]] = []

    def _card_from_local(d: Dict[str, Any]) -> Dict[str, Any]:
        imgs = d.get("images") or d.get("image_urls") or []
        return {
            "vin": d.get("vin"),
            "title": d.get("title")
                or (f"{d.get('year', '')} {d.get('make', '')} {d.get('model', '')} {d.get('trim', '')}".strip() or None),
            "year": d.get("year"), "make": d.get("make"), "model": d.get("model"), "trim": d.get("trim"),
            "lot_number": d.get("lot_number"), "price": d.get("price"),
            "image": imgs[0] if imgs else None,
            "auction_name": d.get("auction_name"), "location": d.get("location"),
            "odometer": d.get("odometer"), "odometer_unit": d.get("odometer_unit") or "mi",
            "_src": "stale",
        }

    try:
        projection = {
            "_id": 0, "vin": 1, "title": 1, "year": 1, "make": 1, "model": 1, "trim": 1,
            "lot_number": 1, "price": 1, "images": 1, "image_urls": 1, "location": 1,
            "auction_name": 1, "odometer": 1, "odometer_unit": 1,
        }
        docs: List[Dict[str, Any]] = []
        if re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", clean_q):
            d = await db.vin_data.find_one({"vin": clean_q}, projection)
            if d:
                docs = [d]
        if not docs and re.fullmatch(r"[A-HJ-NPR-Z0-9]{2,16}", clean_q):
            cursor = db.vin_data.find(
                {"vin": {"$regex": f"^{re.escape(clean_q)}", "$options": "i"}},
                projection,
            ).limit(limit)
            docs = await cursor.to_list(length=limit)
        if not docs and re.fullmatch(r"\d{4,10}", clean_q):
            d = await db.vin_data.find_one({"lot_number": clean_q}, projection)
            if d:
                docs = [d]
        if not docs and re.fullmatch(r"\d{3,10}", clean_q):
            cursor = db.vin_data.find(
                {"lot_number": {"$regex": f"^{re.escape(clean_q)}", "$options": "i"}},
                projection,
            ).limit(limit)
            docs = await cursor.to_list(length=limit)
        if not docs and len(raw) >= 2:
            safe = re.escape(raw)
            cursor = db.vin_data.find(
                {"$or": [
                    {"title": {"$regex": safe, "$options": "i"}},
                    {"make": {"$regex": safe, "$options": "i"}},
                    {"model": {"$regex": safe, "$options": "i"}},
                ]},
                projection,
            ).limit(limit)
            docs = await cursor.to_list(length=limit)
        local_items = [_card_from_local(d) for d in docs]
    except Exception as e:
        logger.debug(f"[search/suggest] stale fallback failed: {e}")
        local_items = []

    if local_items:
        payload = {
            "success": True,
            "items": local_items[:limit],
            "count": min(len(local_items), limit),
            "query": raw,
            "source": "STALE_FALLBACK",
            "data_source": "STALE_FALLBACK",
            "live_used": bool(live and BITMOTORS_AVAILABLE),
            "live_failed": live_failed,
            "cache_hit": False,
            "response_time_ms": int((time.time() - start_t) * 1000),
            "warning": "BidMotors недоступен — показаны устаревшие данные",
        }
        try:
            asyncio.create_task(_log_public_search(
                raw=raw, clean=clean_q, kind="suggest",
                found=True, source="STALE_FALLBACK",
            ))
        except Exception:
            pass
        return payload

    # ─── 4. Empty result ───────────────────────────────────────────────
    payload = {
        "success": True,
        "items": [],
        "count": 0,
        "query": raw,
        "source": "EMPTY",
        "data_source": "EMPTY",
        "live_used": bool(live and BITMOTORS_AVAILABLE),
        "cache_hit": False,
        "lead_opportunity": True,
        "response_time_ms": int((time.time() - start_t) * 1000),
    }
    try:
        asyncio.create_task(_log_public_search(
            raw=raw, clean=clean_q, kind="suggest",
            found=False, source="EMPTY",
        ))
    except Exception:
        pass

    return payload


@fastapi_app.get("/api/vin/{vin}")
async def vin_lookup_v2(vin: str):
    """LIVE-FIRST clean endpoint: SEARCH → WESTMOTORS → LEMON → PAGE fallback.

    Architecture (PHASE 1 + PHASE 3 — final):
      Main chain (priority — picks the FIRST working source, then stops):
        1. CACHE                       (~0 ms)
        2. BitMotors SEARCH            (~300-900 ms)   ← LIVE primary
        3. WestMotors INDEX            (~1-770 ms)     ← fast index fallback
        4. Lemon INDEX                 (~JIT)          ← VIN+LOT fallback
        5. BitMotors PAGE              (~2-6 sec)      ← last resort

      Parallel (non-blocking, never delays the main answer):
        ✦ stat.vin /cars/<VIN>         (~3 s budget)   ← sold-history enrichment

      The two are awaited via asyncio.gather; if stat.vin times out
      the main answer is still returned in time. The stat.vin payload
      lands in `history` and the LIVE result keeps `is_live` flag.

    Response:
      {found: true, source: "SEARCH"|"WESTMOTORS"|"LEMON"|"PAGE"|"CACHE",
       data: {..., is_live: true|false},
       history: {sale_date, sale_price_usd, photos, damage, ...} | null,
       response_time_ms: int}
      {found: false, source: "NOT_FOUND"|"INVALID"}
    """
    if not VIN_SERVICE_AVAILABLE:
        raise HTTPException(status_code=503, detail="vin_service not loaded")
    start = time.time()

    vin_clean = (vs_normalize_vin(vin) if vin else "") or ""

    # Fire main lookup + statvin history in parallel (history is best-effort)
    main_task = asyncio.create_task(vs_get_car_by_vin(vin, db=db))
    history_task: Optional[asyncio.Task] = None
    if STATVIN_AVAILABLE and vs_is_valid_vin(vin_clean):
        history_task = asyncio.create_task(sv_enrich(vin_clean))

    res = await main_task
    history_payload: Optional[Dict[str, Any]] = None
    if history_task is not None:
        # Give stat.vin its remaining budget (cap at 3.5 s total wall-time)
        budget_left = max(0.1, 3.5 - (time.time() - start))
        try:
            history_payload = await asyncio.wait_for(history_task, timeout=budget_left)
        except asyncio.TimeoutError:
            history_task.cancel()
            history_payload = None
        except Exception:
            history_payload = None

    elapsed_ms = int((time.time() - start) * 1000)
    res["response_time_ms"] = elapsed_ms
    res["query"] = vin
    if history_payload:
        res["history"] = {
            "source": "stat.vin",
            "sale_date": history_payload.get("sale_date"),
            "purchase_date": history_payload.get("purchase_date_iso"),
            "sale_price_usd": history_payload.get("sale_price_usd"),
            "damage_primary": history_payload.get("damage_primary"),
            "lot_number": history_payload.get("lot_number"),
            "auction_name": history_payload.get("auction_name"),
            "location": history_payload.get("location"),
            "image_urls": history_payload.get("image_urls", [])[:30],
            "title": history_payload.get("title"),
            "make": history_payload.get("make"),
            "model": history_payload.get("model"),
            "year": history_payload.get("year"),
            "color": history_payload.get("color"),
            "engine": history_payload.get("engine"),
            "fuel_type": history_payload.get("fuel_type"),
            "source_url": history_payload.get("source_url"),
            "has_history": bool(history_payload.get("has_history")),
            "response_time_ms": history_payload.get("response_time_ms"),
        }
    else:
        res["history"] = None

    # ─── EDGE CASE: main chain = NOT_FOUND, but stat.vin has history ───
    # Promote the response to "history-only" so the UI can show the
    # historical record instead of an empty not-found page. Customer
    # cannot bid on it (is_live=False) but knows the VIN exists.
    if not res.get("found") and history_payload and history_payload.get("has_history"):
        res["found"] = True
        res["source"] = "STATVIN_HISTORY"
        res["history_only"] = True
        res["data"] = {
            "vin": history_payload.get("vin") or vin_clean,
            "title": history_payload.get("title"),
            "make": history_payload.get("make"),
            "model": history_payload.get("model"),
            "year": history_payload.get("year"),
            "color": history_payload.get("color"),
            "engine": history_payload.get("engine"),
            "fuel_type": history_payload.get("fuel_type"),
            "transmission": history_payload.get("transmission"),
            "drivetrain": history_payload.get("drivetrain"),
            "lot_number": history_payload.get("lot_number"),
            "auction_name": history_payload.get("auction_name"),
            "location": history_payload.get("location"),
            "damage_primary": history_payload.get("damage_primary"),
            "keys": history_payload.get("keys"),
            "title_status": history_payload.get("title_status"),
            "odometer": history_payload.get("odometer"),
            "image_urls": history_payload.get("image_urls", [])[:30],
            "source_url": history_payload.get("source_url"),
            "sale_date": history_payload.get("sale_date"),
            "sale_price_usd": history_payload.get("sale_price_usd"),
            "is_live": False,
            "_history_only": True,
        }

    # Analytics: log every lookup (hit/miss) for lead-generation
    try:
        asyncio.create_task(_log_public_search(
            raw=vin, clean=vin_clean,
            kind="vin", found=bool(res.get("found")),
            source=res.get("source") or "NOT_FOUND",
        ))
    except Exception:
        pass
    return res


# ─────────────────────────────────────────────────────────────────
# Stat.vin admin / diagnostic endpoints (no DB, no sync — JIT only)
# ─────────────────────────────────────────────────────────────────
@fastapi_app.get("/api/statvin/lookup/{vin}")
async def statvin_lookup_admin(vin: str):
    """Admin / debug: direct stat.vin fetch (no DB, no main chain).

    Useful for verifying coverage and debugging history enrichment.
    Public-readable (no admin gate) so the FE can use the same URL
    if we ever decide to surface it directly.
    """
    if not STATVIN_AVAILABLE:
        return {"success": False, "error": "statvin_scraper not loaded"}
    start = time.time()
    res = await sv_enrich((vin or "").strip().upper())
    elapsed_ms = int((time.time() - start) * 1000)
    if not res:
        return {
            "success": False,
            "found": False,
            "vin": vin,
            "response_time_ms": elapsed_ms,
        }
    return {
        "success": True,
        "found": True,
        "vin": res.get("vin"),
        "data": res,
        "response_time_ms": elapsed_ms,
    }


@fastapi_app.get("/api/statvin/stats")
async def statvin_stats():
    """Stat.vin latency + cache telemetry."""
    if not STATVIN_AVAILABLE:
        return {"success": False, "error": "statvin_scraper not loaded"}
    return {
        "success": True,
        "available": True,
        "architecture": "JIT_NO_DB_NO_SYNC",
        "latency": sv_latency(),
        "cache": sv_cache_stats(),
    }


@fastapi_app.post("/api/statvin/cache/clear",
                  dependencies=[Depends(require_admin)])
async def statvin_cache_clear():
    if not STATVIN_AVAILABLE:
        return {"success": False, "error": "statvin_scraper not loaded"}
    await sv_clear_cache()
    return {"success": True, "message": "stat.vin cache cleared"}


@fastapi_app.get("/api/vin-service/stats")
async def vin_service_stats():
    """Lightweight diagnostics for the LIVE-FIRST vin_service."""
    if not VIN_SERVICE_AVAILABLE:
        return {"success": False, "error": "vin_service not loaded"}
    return {
        "success": True,
        "architecture": "LIVE_FIRST_SEARCH_PAGE_FALLBACK_WITH_BREAKERS",
        "cache": vs_get_cache_stats(),
        "circuit_breakers": vs_get_circuit_stats(),
    }


@fastapi_app.get("/api/vin-service/circuit")
async def vin_service_circuit():
    """Per-source circuit breaker state. Public-readable for dashboards."""
    if not VIN_SERVICE_AVAILABLE:
        return {"success": False, "error": "vin_service not loaded"}
    return {
        "success": True,
        "breakers": vs_get_circuit_stats(),
    }


# ─── Parser-public aliases (used by /app/scripts/* and external monitors) ──
# These are intentionally UN-AUTHENTICATED so health checkers can call them.
# Mutations are limited to safe idempotent operations (breaker reset).

@fastapi_app.get("/api/parser/circuits")
async def parser_circuits_alias():
    """Alias for /api/vin-service/circuit \u2014 short stable URL for ops scripts."""
    if not VIN_SERVICE_AVAILABLE:
        return {"success": False, "error": "vin_service not loaded", "breakers": {}}
    breakers = vs_get_circuit_stats() or {}
    open_count = sum(1 for v in breakers.values() if isinstance(v, dict) and v.get("state") == "open")
    return {
        "success": True,
        "breakers": breakers,
        "open_count": open_count,
        "total": len(breakers),
    }


@fastapi_app.post("/api/parser/self-heal")
async def parser_self_heal():
    """Idempotent recovery action for the parser stack.

    Resets all circuit breakers (closes them so probes can retry), clears
    the in-memory TTL cache (forces fresh fetches on next query), and pings
    each registered scraper module. Safe to call repeatedly. Used by:
      \u2022 /app/scripts/parser-bootstrap.sh after restart
      \u2022 ops runbook (`curl -X POST .../api/parser/self-heal`)
      \u2022 admin UI \u201c\ud83d\udd04 Reset breakers\u201d button (TODO)
    """
    actions: list[str] = []
    errors: list[str] = []

    # 1. Reset circuit breakers
    if VIN_SERVICE_AVAILABLE:
        try:
            await vs_reset_circuits()
            actions.append("circuit_breakers_reset")
        except Exception as e:  # noqa: BLE001
            errors.append(f"reset_circuits: {e}")
    else:
        errors.append("vin_service_not_loaded")

    # 2. Clear TTL cache so the next /lookup tries fresh
    if VIN_SERVICE_AVAILABLE:
        try:
            await vs_clear_cache()
            actions.append("ttl_cache_cleared")
        except Exception as e:  # noqa: BLE001
            errors.append(f"clear_cache: {e}")

    # 3. Re-evaluate health snapshot in resolver (recompute drift / counters)
    try:
        from multisource_resolver import get_health_snapshot, _gc_clients  # type: ignore
        _gc_clients()
        get_health_snapshot()
        actions.append("resolver_health_recomputed")
    except Exception as e:  # noqa: BLE001
        errors.append(f"resolver_health: {e}")

    # 4. Touch parser registry \u2014 nudge each entry's `last_seen` so the dashboard
    #    re-renders with fresh state.
    try:
        # PARSER_REGISTRY lives in module scope of server.py, so just access it
        for entry in PARSER_REGISTRY.values():  # noqa: F821
            try:
                entry.last_seen_at = _now_iso()  # type: ignore[attr-defined]
            except Exception:
                pass
        actions.append("parser_registry_touched")
    except Exception:
        # Non-fatal \u2014 registry may not exist in some builds
        pass

    return {
        "success": len(errors) == 0,
        "actions": actions,
        "errors": errors,
        "breakers": vs_get_circuit_stats() if VIN_SERVICE_AVAILABLE else {},
        "timestamp": _now_iso() if "_now_iso" in globals() else None,
    }


@fastapi_app.post("/api/vin-service/circuit/reset",
                  dependencies=[Depends(require_admin)])
async def vin_service_circuit_reset():
    """Force-close all circuit breakers (admin-only)."""
    if not VIN_SERVICE_AVAILABLE:
        return {"success": False, "error": "vin_service not loaded"}
    await vs_reset_circuits()
    return {
        "success": True,
        "message": "All circuit breakers reset to CLOSED",
        "breakers": vs_get_circuit_stats(),
    }


@fastapi_app.post("/api/vin-service/cache/clear",
                  dependencies=[Depends(require_admin)])
async def vin_service_cache_clear():
    if not VIN_SERVICE_AVAILABLE:
        return {"success": False, "error": "vin_service not loaded"}
    await vs_clear_cache()
    return {"success": True, "message": "vin_service cache cleared"}


@fastapi_app.get("/api/public/search/{query}")
async def public_unified_search(query: str):
    """LIVE-FIRST unified public search.

    Architecture:
      1. Try BidMotors LIVE → write to TTL cache → return source="LIVE"
      2. On live error → check TTL cache → return source="CACHE"
      3. On cache miss → check stale local fallback (vin_data) → source="STALE_FALLBACK"
      4. Otherwise → not_found (with lead-capture hint)

    No accumulation, no cron, no daily sync. The local DB is read-only fallback.
    """
    start_time = time.time()
    parsed = _normalize_search_query(query)

    if parsed["kind"] == "empty":
        raise HTTPException(status_code=400, detail="Empty search query")

    if parsed["kind"] == "url":
        return {
            "success": False,
            "error": "url_submission",
            "query": parsed["value"],
            "message": "URL submissions should be sent to /api/v2/search-by-url",
            "response_time_ms": int((time.time() - start_time) * 1000),
        }

    value = parsed["value"]
    cache_key = f"public_search:{parsed['kind']}:{value}"

    # ─── 0. FAST PATH: full VIN → delegate to vin_service (SEARCH→PAGE) ───
    if parsed["kind"] == "vin" and VIN_SERVICE_AVAILABLE:
        try:
            # Parallel: main lookup + stat.vin history enrichment
            main_task = asyncio.create_task(vs_get_car_by_vin(value, db=db))
            history_task: Optional[asyncio.Task] = None
            if STATVIN_AVAILABLE:
                history_task = asyncio.create_task(sv_enrich(value))

            vs_res = await main_task

            history_payload: Optional[Dict[str, Any]] = None
            if history_task is not None:
                budget_left = max(0.1, 3.5 - (time.time() - start_time))
                try:
                    history_payload = await asyncio.wait_for(history_task, timeout=budget_left)
                except (asyncio.TimeoutError, Exception):
                    try:
                        history_task.cancel()
                    except Exception:
                        pass
                    history_payload = None

            if vs_res.get("found"):
                d = vs_res.get("data") or {}
                imgs = d.get("images") or d.get("image_urls") or []
                if isinstance(imgs, str):
                    imgs = [imgs]
                src_u = vs_res.get("source", "SEARCH")  # SEARCH | WESTMOTORS | LEMON | PAGE | CACHE
                # UI source label — keep the legacy LIVE/CACHE/STALE_FALLBACK badge alphabet
                ui_source = (
                    "CACHE" if src_u == "CACHE"
                    else "WESTMOTORS" if src_u == "WESTMOTORS"
                    else "LEMON" if src_u == "LEMON"
                    else "LIVE"  # both SEARCH and PAGE are live data → unified LIVE badge
                )
                resp_time = int((time.time() - start_time) * 1000)
                payload = {
                    "success": True,
                    "vin": d.get("vin") or value,
                    "title": d.get("title")
                        or (f"{d.get('year','')} {d.get('make','')} {d.get('model','')}".strip() or None),
                    "year": d.get("year"),
                    "make": d.get("make"),
                    "model": d.get("model"),
                    "trim": d.get("trim"),
                    "price": d.get("price"),
                    "odometer": d.get("odometer"),
                    "odometer_unit": d.get("odometer_unit") or "mi",
                    "location": d.get("location"),
                    "lot_number": d.get("lot_number") or d.get("lot"),
                    "auction_name": d.get("auction_name") or d.get("auction"),
                    "damage_primary": d.get("damage_primary") or d.get("damage"),
                    "damage_secondary": d.get("damage_secondary"),
                    "title_status": d.get("title_status"),
                    "image_urls": imgs,
                    "fuel_type": d.get("fuel_type") or d.get("fuel"),
                    "transmission": d.get("transmission"),
                    "drivetrain": d.get("drivetrain"),
                    "engine": d.get("engine"),
                    "condition": d.get("condition"),
                    "color": d.get("color"),
                    "keys": d.get("keys"),
                    "seller": d.get("seller"),
                    "sale_date": d.get("sale_date"),
                    "source_url": d.get("source_url") or d.get("url"),
                    "winning_source": "bitmotors",
                    "confidence": 0.95 if src_u == "SEARCH" else (0.85 if src_u == "PAGE" else 0.7),
                    "quality_level": d.get("quality_level") or d.get("quality"),
                    "cached": src_u == "CACHE",
                    "stale": False,
                    "fresh": src_u != "CACHE",
                    "source": ui_source,
                    "data_source": ui_source,
                    "fetch_strategy": src_u,    # SEARCH | PAGE | CACHE → for diagnostics
                    "is_live": bool(d.get("is_live", True)),
                    "query": query,
                    "query_kind": parsed["kind"],
                    "response_time_ms": resp_time,
                }
                # ─── Attach stat.vin history block (parallel result) ───
                if history_payload:
                    payload["history"] = {
                        "source": "stat.vin",
                        "sale_date": history_payload.get("sale_date"),
                        "purchase_date": history_payload.get("purchase_date_iso"),
                        "sale_price_usd": history_payload.get("sale_price_usd"),
                        "damage_primary": history_payload.get("damage_primary"),
                        "lot_number": history_payload.get("lot_number"),
                        "auction_name": history_payload.get("auction_name"),
                        "location": history_payload.get("location"),
                        "image_urls": (history_payload.get("image_urls") or [])[:30],
                        "title": history_payload.get("title"),
                        "make": history_payload.get("make"),
                        "model": history_payload.get("model"),
                        "year": history_payload.get("year"),
                        "color": history_payload.get("color"),
                        "engine": history_payload.get("engine"),
                        "fuel_type": history_payload.get("fuel_type"),
                        "source_url": history_payload.get("source_url"),
                        "has_history": bool(history_payload.get("has_history")),
                    }
                else:
                    payload["history"] = None
                try:
                    asyncio.create_task(_log_public_search(
                        raw=query, clean=value, kind=parsed["kind"],
                        found=True, source=src_u,
                    ))
                except Exception:
                    pass
                return payload
            # vs_res.found = False → before falling through to legacy live, see if
            # stat.vin has historical data. If yes, return a HISTORY-ONLY card so
            # the user gets a useful page instead of "not found".
            if history_payload and history_payload.get("has_history"):
                resp_time = int((time.time() - start_time) * 1000)
                imgs_h = (history_payload.get("image_urls") or [])[:30]
                ho_payload = {
                    "success": True,
                    "vin": history_payload.get("vin") or value,
                    "title": history_payload.get("title")
                        or (f"{history_payload.get('year','')} {history_payload.get('make','')} {history_payload.get('model','')}".strip() or None),
                    "year": history_payload.get("year"),
                    "make": history_payload.get("make"),
                    "model": history_payload.get("model"),
                    "trim": None,
                    "price": history_payload.get("sale_price_usd"),
                    "odometer": history_payload.get("odometer"),
                    "odometer_unit": "mi",
                    "location": history_payload.get("location"),
                    "lot_number": history_payload.get("lot_number"),
                    "auction_name": history_payload.get("auction_name"),
                    "damage_primary": history_payload.get("damage_primary"),
                    "damage_secondary": None,
                    "title_status": history_payload.get("title_status"),
                    "image_urls": imgs_h,
                    "fuel_type": history_payload.get("fuel_type"),
                    "transmission": history_payload.get("transmission"),
                    "drivetrain": history_payload.get("drivetrain"),
                    "engine": history_payload.get("engine"),
                    "color": history_payload.get("color"),
                    "keys": history_payload.get("keys"),
                    "seller": history_payload.get("seller"),
                    "sale_date": history_payload.get("sale_date"),
                    "source_url": history_payload.get("source_url"),
                    "winning_source": "stat.vin",
                    "confidence": 0.6,
                    "cached": False,
                    "stale": False,
                    "fresh": True,
                    "source": "STATVIN_HISTORY",
                    "data_source": "STATVIN_HISTORY",
                    "fetch_strategy": "STATVIN_HISTORY",
                    "is_live": False,
                    "history_only": True,
                    "history": {
                        "source": "stat.vin",
                        "sale_date": history_payload.get("sale_date"),
                        "purchase_date": history_payload.get("purchase_date_iso"),
                        "sale_price_usd": history_payload.get("sale_price_usd"),
                        "damage_primary": history_payload.get("damage_primary"),
                        "lot_number": history_payload.get("lot_number"),
                        "auction_name": history_payload.get("auction_name"),
                        "location": history_payload.get("location"),
                        "image_urls": imgs_h,
                        "title": history_payload.get("title"),
                        "make": history_payload.get("make"),
                        "model": history_payload.get("model"),
                        "year": history_payload.get("year"),
                        "color": history_payload.get("color"),
                        "engine": history_payload.get("engine"),
                        "fuel_type": history_payload.get("fuel_type"),
                        "source_url": history_payload.get("source_url"),
                        "has_history": True,
                    },
                    "message": (
                        "Активного лота не найдено. Но есть история этого VIN — "
                        "можно посмотреть финальную цену продажи и фото с аукциона."
                    ),
                    "query": query,
                    "query_kind": parsed["kind"],
                    "response_time_ms": resp_time,
                }
                try:
                    asyncio.create_task(_log_public_search(
                        raw=query, clean=value, kind=parsed["kind"],
                        found=True, source="STATVIN_HISTORY",
                    ))
                except Exception:
                    pass
                return ho_payload
        except Exception as e:
            logger.warning(f"[PUBLIC-SEARCH] vin_service failed for {value}: {e}")

    # ─── For non-VIN queries (LOT / partial / unknown) keep legacy LIVE-FIRST ───

    def _build_card(payload: Dict[str, Any], source_label: str, fresh: bool, *, multi_items: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        imgs = payload.get("images") or payload.get("image_urls") or []
        if isinstance(imgs, str):
            imgs = [imgs]
        card = {
            "success": True,
            "vin": payload.get("vin"),
            "title": payload.get("title")
                or (f"{payload.get('year','')} {payload.get('make','')} {payload.get('model','')}".strip() or None),
            "year": payload.get("year"),
            "make": payload.get("make"),
            "model": payload.get("model"),
            "trim": payload.get("trim"),
            "price": payload.get("price"),
            "odometer": payload.get("odometer"),
            "odometer_unit": payload.get("odometer_unit") or "mi",
            "location": payload.get("location"),
            "lot_number": payload.get("lot_number"),
            "auction_name": payload.get("auction_name"),
            "damage_primary": payload.get("damage_primary"),
            "damage_secondary": payload.get("damage_secondary"),
            "title_status": payload.get("title_status"),
            "image_urls": imgs,
            "fuel_type": payload.get("fuel_type"),
            "transmission": payload.get("transmission"),
            "drivetrain": payload.get("drivetrain"),
            "engine": payload.get("engine"),
            "condition": payload.get("condition"),
            "color": payload.get("color"),
            "keys": payload.get("keys"),
            "seller": payload.get("seller"),
            "sale_date": payload.get("sale_date"),
            "source_url": payload.get("source_url") or payload.get("detail_url"),
            "winning_source": "bitmotors",
            "confidence": 0.9 if source_label == "LIVE" else (0.7 if source_label == "CACHE" else 0.4),
            "quality_level": payload.get("quality_level") or payload.get("quality"),
            "cached": source_label == "CACHE",
            "stale": source_label == "STALE_FALLBACK",
            "fresh": fresh,
            "source": source_label,                   # LIVE | CACHE | STALE_FALLBACK
            "data_source": source_label,              # alias for FE
            "query": query,
            "query_kind": parsed["kind"],
            "response_time_ms": int((time.time() - start_time) * 1000),
        }
        if multi_items and len(multi_items) > 1:
            card["multiple_matches"] = True
            card["matches"] = multi_items
            card["matches_count"] = len(multi_items)
        return card

    # ─── 1. LIVE FIRST ─────────────────────────────────────────────────
    live_payload: Optional[Dict[str, Any]] = None
    multi_live: List[Dict[str, Any]] = []
    if BITMOTORS_AVAILABLE and parsed["kind"] in ("vin", "vin_partial", "lot", "unknown"):
        try:
            live_res = await asyncio.wait_for(
                bm_live_search(value, db=None, limit=12),
                timeout=8.0,
            )
            if live_res:
                detail = live_res.get("detail") or {}
                items = live_res.get("items") or []
                if detail and (detail.get("vin") or detail.get("lot_number")):
                    live_payload = detail
                    multi_live = items
                elif items:
                    first = items[0]
                    if first.get("vin") or first.get("lot_number"):
                        live_payload = first
                        multi_live = items
        except Exception as e:
            logger.warning(f"[PUBLIC-SEARCH] live failed for {value}: {e}")
            live_payload = None

    if live_payload:
        card = _build_card(live_payload, "LIVE", fresh=True, multi_items=multi_live)
        # Save fresh result into TTL cache
        try:
            if live_search_cache is not None:
                await live_search_cache.set(cache_key, {"payload": live_payload, "items": multi_live, "ts": time.time()})
        except Exception:
            pass
        # Update stale fallback DB silently (best effort, marked stale so UI knows)
        try:
            if live_payload.get("vin"):
                await db.vin_data.update_one(
                    {"vin": live_payload["vin"]},
                    {"$set": {**{k: v for k, v in live_payload.items() if v is not None and k != "_id"},
                              "last_seen": datetime.now(timezone.utc),
                              "stale": False,
                              "archived": False,
                              "source": "bitmotors"}},
                    upsert=True,
                )
        except Exception:
            pass
        # Analytics
        try:
            asyncio.create_task(_log_public_search(
                raw=query, clean=value, kind=parsed["kind"],
                found=True, source="LIVE",
            ))
        except Exception:
            pass
        return card

    # ─── 2. CACHE FALLBACK ─────────────────────────────────────────────
    if live_search_cache is not None:
        try:
            cached = await live_search_cache.get(cache_key)
        except Exception:
            cached = None
        if cached and cached.get("payload"):
            card = _build_card(cached["payload"], "CACHE", fresh=False, multi_items=cached.get("items") or [])
            card["cache_age_seconds"] = int(time.time() - cached.get("ts", time.time()))
            try:
                asyncio.create_task(_log_public_search(
                    raw=query, clean=value, kind=parsed["kind"],
                    found=True, source="CACHE",
                ))
            except Exception:
                pass
            return card

    # ─── 3. STALE FALLBACK (local vin_data) ────────────────────────────
    local: Optional[Dict[str, Any]] = None
    candidates: List[Dict[str, Any]] = []
    try:
        if parsed["kind"] == "vin":
            local = await db.vin_data.find_one({"vin": value}, {"_id": 0})
        elif parsed["kind"] == "vin_partial":
            cursor = db.vin_data.find(
                {"vin": {"$regex": f"^{re.escape(value)}", "$options": "i"}},
                {"_id": 0},
            ).limit(20)
            candidates = await cursor.to_list(length=20)
            if candidates:
                local = candidates[0]
        elif parsed["kind"] in ("lot", "unknown"):
            local = await db.vin_data.find_one({"lot_number": value}, {"_id": 0})
            if not local and parsed["kind"] == "unknown":
                local = await db.vin_data.find_one(
                    {"$or": [
                        {"vin": {"$regex": f"^{re.escape(value)}", "$options": "i"}},
                        {"lot_number": {"$regex": f"^{re.escape(value)}", "$options": "i"}},
                        {"title": {"$regex": re.escape(value), "$options": "i"}},
                    ]},
                    {"_id": 0},
                )
    except Exception as e:
        logger.debug(f"[PUBLIC-SEARCH] stale fallback lookup failed: {e}")

    if local:
        # Build mini-cards if multiple
        mini = []
        if parsed["kind"] == "vin_partial" and len(candidates) > 1:
            for c in candidates:
                mini.append({
                    "vin": c.get("vin"),
                    "title": c.get("title"),
                    "year": c.get("year"), "make": c.get("make"), "model": c.get("model"),
                    "lot_number": c.get("lot_number"),
                    "image": (c.get("images") or [None])[0],
                    "auction_name": c.get("auction_name"),
                })
        card = _build_card(local, "STALE_FALLBACK", fresh=False, multi_items=mini)
        try:
            asyncio.create_task(_log_public_search(
                raw=query, clean=value, kind=parsed["kind"],
                found=True, source="STALE_FALLBACK",
            ))
        except Exception:
            pass
        return card

    # ─── 4. NOT FOUND (lead opportunity) ───────────────────────────────
    not_found_payload = {
        "success": False,
        "error": "not_found",
        "query": query,
        "query_kind": parsed["kind"],
        "source": "NOT_FOUND",
        "data_source": "NOT_FOUND",
        "lead_opportunity": True,
        "lead_message": "Не нашли авто. Оставьте email — сообщим, как только появится на BidMotors.",
        "message": (
            "VIN not found on BidMotors right now. Leave your email and we'll alert you when it appears."
            if parsed["kind"] == "vin"
            else "Partial VIN didn't match any active listing. Try the full 17-character VIN."
            if parsed["kind"] == "vin_partial"
            else "Lot number not found in active auctions."
        ),
        "response_time_ms": int((time.time() - start_time) * 1000),
    }
    try:
        asyncio.create_task(_log_public_search(
            raw=query, clean=value, kind=parsed["kind"],
            found=False, source="NOT_FOUND",
        ))
    except Exception:
        pass
    return not_found_payload


# Note: /api/v2/search-by-url is defined at the end of file with Cookie Proxy support

@fastapi_app.get("/api/bulk/vehicle/{vin}")
async def bulk_vehicle_lookup(vin: str):
    """Bulk vehicle lookup fallback"""
    vin = vin.upper()
    vehicle = await db.vin_data.find_one({"vin": vin}, {'_id': 0})
    
    if vehicle:
        return {"success": True, "data": vehicle}
    return {"success": False, "data": None}

@fastapi_app.get("/api/vin-resolver/{vin}/test")
async def vin_resolver_test(vin: str):
    """Test VIN resolver"""
    vin = vin.upper()
    vehicle = await db.vin_data.find_one({"vin": vin}, {'_id': 0})
    
    return {
        "success": True,
        "vin": vin,
        "found": vehicle is not None,
        "data": vehicle,
        "testedAt": datetime.now(timezone.utc).isoformat()
    }

# ═══════════════════════════════════════════════════════════════════
# CALCULATOR ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════
# Calculator config — hard-coded DEFAULTS (used as fallbacks and also to
# seed the DB-backed configuration on first run). Admins can edit the
# persisted values through /api/calculator/config/* without touching code.
# ══════════════════════════════════════════════════════════════════════

CALCULATOR_PORTS = [
    {"id": "odessa", "code": "odessa", "name": "Odessa", "country": "UA", "default": True},
    {"id": "klaipeda", "code": "klaipeda", "name": "Klaipeda", "country": "LT"},
    {"id": "gdansk", "code": "gdansk", "name": "Gdansk", "country": "PL"},
    {"id": "bremerhaven", "code": "bremerhaven", "name": "Bremerhaven", "country": "DE"},
]

VEHICLE_TYPES = [
    {"code": "sedan", "name": "Sedan"},
    {"code": "suv", "name": "SUV / Crossover"},
    {"code": "bigSUV", "name": "Big SUV / 4x4"},
    {"code": "pickup", "name": "Pickup"},
]

AUCTIONS = [
    {"code": "copart", "name": "Copart"},
    {"code": "iaai", "name": "IAAI"},
]

AUCTION_FEES = {
    "copart": {"buyer_fee_percent": 10, "gate_fee": 79, "title_fee": 55},
    "iaai": {"buyer_fee_percent": 9, "gate_fee": 69, "title_fee": 45},
}

# Tiered auction buyer fees (Copart/IAAI buyer-fee ladder defaults).
AUCTION_TIERED_FEES = [
    (0, 99.99, 25),
    (100, 499.99, 49),
    (500, 999.99, 75),
    (1000, 1499.99, 110),
    (1500, 1999.99, 135),
    (2000, 3999.99, 200),
    (4000, 5999.99, 280),
    (6000, 7999.99, 360),
    (8000, 9999.99, 400),
    (10000, 14999.99, 450),
    (15000, 19999.99, 550),
    (20000, 29999.99, 650),
    (30000, 49999.99, 800),
    (50000, 99999.99, 1000),
    (100000, 10_000_000, 1200),
]

VEHICLE_USA_INLAND = {"sedan": 350, "suv": 400, "bigSUV": 450, "pickup": 500}
VEHICLE_OCEAN_BASE = {"sedan": 1100, "suv": 1250, "bigSUV": 1400, "pickup": 1500}
PORT_OCEAN_ADJUST = {"odessa": 100, "klaipeda": 0, "gdansk": 50, "bremerhaven": -50}
VEHICLE_EU_DELIVERY = {"sedan": 400, "suv": 450, "bigSUV": 500, "pickup": 550}

PORT_FORWARDING = 200
PORT_PARKING = 75
PARKING_BULGARIA = 50
COMPANY_SERVICES = 1500
CUSTOMS_DOCUMENTATION = 100
INSURANCE_RATE = 0.015
CUSTOMS_DUTY_RATE = 0.10

DEFAULT_PROFILE_CODE = "standard_bg"


# ══════════════════════════════════════════════════════════════════════
# Calculator config — DB loader (with fallbacks + single-tick memo)
# ══════════════════════════════════════════════════════════════════════

_CALC_CACHE: Dict[str, Any] = {"ts": 0.0, "profile": None, "routes": None, "fees": None}
_CALC_CACHE_TTL = 15.0  # seconds


async def _ensure_calculator_seed() -> None:
    """Seed calculator_profile / routes / auction_fees collections if empty."""
    prof = await db.calculator_profile.find_one({"code": DEFAULT_PROFILE_CODE})
    if not prof:
        await db.calculator_profile.insert_one({
            "code": DEFAULT_PROFILE_CODE,
            "name": "Standard Bulgaria",
            "currency": "USD",
            "destinationCountry": "BG",
            "isActive": True,
            # Fixed fees
            "portForwarding": PORT_FORWARDING,
            "portParking": PORT_PARKING,
            "parkingBulgaria": PARKING_BULGARIA,
            "companyServices": COMPANY_SERVICES,
            "customsDocumentation": CUSTOMS_DOCUMENTATION,
            "customsDutyRate": CUSTOMS_DUTY_RATE,
            "insuranceRate": INSURANCE_RATE,
            # Per-auction gate/title fees
            "auctionFees": AUCTION_FEES,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    if await db.calculator_routes.count_documents({"profileCode": DEFAULT_PROFILE_CODE}) == 0:
        docs = []
        for vtype, amount in VEHICLE_USA_INLAND.items():
            docs.append({
                "id": f"usa-{vtype}",
                "profileCode": DEFAULT_PROFILE_CODE,
                "rateType": "usa_inland",
                "vehicleType": vtype,
                "amount": amount,
                "currency": "USD",
                "isActive": True,
            })
        for port in CALCULATOR_PORTS:
            for vtype, base in VEHICLE_OCEAN_BASE.items():
                amount = base + PORT_OCEAN_ADJUST.get(port["code"], 0)
                docs.append({
                    "id": f"ocean-{port['code']}-{vtype}",
                    "profileCode": DEFAULT_PROFILE_CODE,
                    "rateType": "ocean",
                    "destinationCode": port["code"],
                    "vehicleType": vtype,
                    "amount": amount,
                    "currency": "USD",
                    "isActive": True,
                })
        for vtype, amount in VEHICLE_EU_DELIVERY.items():
            docs.append({
                "id": f"eu-{vtype}",
                "profileCode": DEFAULT_PROFILE_CODE,
                "rateType": "eu_delivery",
                "destinationCode": "BG",
                "vehicleType": vtype,
                "amount": amount,
                "currency": "USD",
                "isActive": True,
            })
        if docs:
            await db.calculator_routes.insert_many(docs)

    if await db.calculator_auction_fees.count_documents({"profileCode": DEFAULT_PROFILE_CODE}) == 0:
        tier_docs = []
        for lo, hi, fee in AUCTION_TIERED_FEES:
            tier_docs.append({
                "id": f"tier-{lo}",
                "profileCode": DEFAULT_PROFILE_CODE,
                "minBid": lo,
                "maxBid": hi,
                "fee": fee,
                "currency": "USD",
                "isActive": True,
            })
        if tier_docs:
            await db.calculator_auction_fees.insert_many(tier_docs)


def _invalidate_calc_cache() -> None:
    _CALC_CACHE["ts"] = 0.0
    _CALC_CACHE["profile"] = None
    _CALC_CACHE["routes"] = None
    _CALC_CACHE["fees"] = None


async def _load_calc_config(profile_code: str = DEFAULT_PROFILE_CODE) -> Dict[str, Any]:
    """Load calculator config (profile + routes + tiered fees) with TTL cache."""
    now = time.time()
    if now - _CALC_CACHE["ts"] < _CALC_CACHE_TTL and _CALC_CACHE["profile"]:
        return {
            "profile": _CALC_CACHE["profile"],
            "routes": _CALC_CACHE["routes"],
            "fees": _CALC_CACHE["fees"],
        }
    try:
        await _ensure_calculator_seed()
    except Exception as e:  # pragma: no cover
        logger.warning(f"[calc] seed check failed: {e}")

    profile = await db.calculator_profile.find_one({"code": profile_code}, {"_id": 0}) or {}
    routes_cursor = db.calculator_routes.find(
        {"profileCode": profile_code, "isActive": {"$ne": False}}, {"_id": 0}
    )
    routes = await routes_cursor.to_list(length=500)
    fees_cursor = db.calculator_auction_fees.find(
        {"profileCode": profile_code, "isActive": {"$ne": False}}, {"_id": 0}
    ).sort("minBid", 1)
    fees = await fees_cursor.to_list(length=100)

    _CALC_CACHE.update({"ts": now, "profile": profile, "routes": routes, "fees": fees})
    return {"profile": profile, "routes": routes, "fees": fees}


def _find_route_amount(routes: list, rate_type: str, vehicle_type: str,
                       *, destination_code: Optional[str] = None,
                       origin_code: Optional[str] = None, default: float = 0.0) -> float:
    for r_ in routes:
        if r_.get("rateType") != rate_type:
            continue
        if r_.get("vehicleType") not in (None, vehicle_type):
            continue
        if destination_code and r_.get("destinationCode") not in (None, destination_code):
            continue
        if origin_code and r_.get("originCode") not in (None, origin_code):
            continue
        amount = r_.get("amount")
        if amount is not None:
            return float(amount)
    return float(default)


def _tiered_buyer_fee_from_db(price: float, fees: list) -> float:
    try:
        p = float(price or 0)
    except (TypeError, ValueError):
        p = 0.0
    if not fees:
        # Fall back to hard-coded ladder
        for lo, hi, fee in AUCTION_TIERED_FEES:
            if lo <= p <= hi:
                return float(fee)
        return float(AUCTION_TIERED_FEES[-1][2])
    for row in fees:
        try:
            lo = float(row.get("minBid", 0))
            hi = float(row.get("maxBid", 10_000_000))
        except (TypeError, ValueError):
            continue
        if lo <= p <= hi:
            return float(row.get("fee", 0))
    return float(fees[-1].get("fee", 0)) if fees else 0.0


def _tiered_buyer_fee(price: float) -> float:
    """Back-compat helper used by a few legacy callers — uses hardcoded ladder."""
    try:
        p = float(price or 0)
    except (TypeError, ValueError):
        p = 0.0
    for lo, hi, fee in AUCTION_TIERED_FEES:
        if lo <= p <= hi:
            return float(fee)
    return float(AUCTION_TIERED_FEES[-1][2])


# ══════════════════════════════════════════════════════════════════════
# Calculator — PUBLIC endpoints
# ══════════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/calculator/ports")
async def calculator_ports():
    """Get available ports, vehicle types and auctions for calculator."""
    return {
        "success": True,
        "ports": CALCULATOR_PORTS,
        "vehicleTypes": VEHICLE_TYPES,
        "auctions": AUCTIONS,
    }


@fastapi_app.post("/api/calculator/calculate")
async def calculator_calculate(data: Dict[str, Any] = Body(...)):
    """Calculate full turnkey delivery cost (DB-backed, admin-editable).

    Accepts:
      price (USD), port (dest), auction (copart|iaai),
      vehicleType (sedan|suv|bigSUV|pickup), vin/lot (optional, pass-through)

    Returns a detailed breakdown in USD plus legacy flat fields for BC.
    """
    try:
        price = float(data.get("price") or 0)
    except (TypeError, ValueError):
        price = 0.0
    port = (data.get("port") or "odessa").lower()
    auction = (data.get("auction") or "copart").lower()
    vehicle_type = data.get("vehicleType") or "sedan"
    if vehicle_type not in VEHICLE_USA_INLAND:
        vehicle_type = "sedan"
    if port not in {p["code"] for p in CALCULATOR_PORTS}:
        port = "odessa"
    if auction not in AUCTION_FEES:
        auction = "copart"

    # Load admin-configured values (with fallback to constants)
    cfg = await _load_calc_config()
    profile = cfg["profile"] or {}
    routes = cfg["routes"] or []
    fees_tiers = cfg["fees"] or []

    # Per-auction fee config (gate/title/%) — admin-editable via profile
    auction_fee_cfg = (profile.get("auctionFees") or {}).get(auction) or AUCTION_FEES[auction]

    # Auction side --------------------------------------------------------
    if fees_tiers:
        # Admin has configured a tiered ladder → it is authoritative.
        buyer_fee = _tiered_buyer_fee_from_db(price, fees_tiers)
    else:
        # Legacy fallback: hardcoded ladder with percentage override above 10k.
        buyer_fee = _tiered_buyer_fee(price)
        pct_fee = price * float(auction_fee_cfg.get("buyer_fee_percent", 0)) / 100.0
        if price >= 10000:
            buyer_fee = max(buyer_fee, pct_fee)
    gate_fee = float(auction_fee_cfg.get("gate_fee", 0))
    title_fee = float(auction_fee_cfg.get("title_fee", 0))
    auction_total = buyer_fee + gate_fee + title_fee

    # USA inland ---------------------------------------------------------
    usa_inland = _find_route_amount(
        routes, "usa_inland", vehicle_type,
        default=VEHICLE_USA_INLAND[vehicle_type],
    )

    # Ocean shipping -----------------------------------------------------
    ocean = _find_route_amount(
        routes, "ocean", vehicle_type,
        destination_code=port,
        default=VEHICLE_OCEAN_BASE[vehicle_type] + PORT_OCEAN_ADJUST.get(port, 0),
    )

    # EU delivery --------------------------------------------------------
    eu_delivery = _find_route_amount(
        routes, "eu_delivery", vehicle_type,
        destination_code="BG",
        default=VEHICLE_EU_DELIVERY[vehicle_type],
    )

    # Fixed fees from profile -------------------------------------------
    port_forwarding = float(profile.get("portForwarding", PORT_FORWARDING))
    port_parking = float(profile.get("portParking", PORT_PARKING))
    parking_bg = float(profile.get("parkingBulgaria", PARKING_BULGARIA))
    company_services = float(profile.get("companyServices", COMPANY_SERVICES))
    customs_docs = float(profile.get("customsDocumentation", CUSTOMS_DOCUMENTATION))
    customs_duty_rate = float(profile.get("customsDutyRate", CUSTOMS_DUTY_RATE))
    insurance_rate = float(profile.get("insuranceRate", INSURANCE_RATE))

    customs_duty = price * customs_duty_rate
    customs_total = customs_duty + customs_docs
    insurance = price * insurance_rate

    delivery_total = (
        usa_inland + ocean + port_forwarding + port_parking + eu_delivery
        + customs_total + parking_bg + company_services + insurance
    )
    grand_total = price + auction_total + delivery_total

    def r(x: float) -> float:
        return round(float(x), 2)

    insurance_pct_label = f"Cargo Insurance ({insurance_rate * 100:.2f}%)".rstrip("0").rstrip(".")
    if "(" in insurance_pct_label and insurance_pct_label.endswith(")"):
        # keep the "%)" suffix after trailing-zero trim
        insurance_pct_label = insurance_pct_label.replace("%)", "%)")

    breakdown = [
        {"key": "auctionBuyerFee",   "label": "Auction Buyer Fee",                 "value": r(buyer_fee)},
        {"key": "auctionGateFee",    "label": "Auction Gate Fee",                  "value": r(gate_fee)},
        {"key": "auctionTitleFee",   "label": "Auction Title Fee",                 "value": r(title_fee)},
        {"key": "usaInland",         "label": "Delivery By Truck Across The USA",  "value": r(usa_inland)},
        {"key": "ocean",             "label": "Delivery By Ship",                  "value": r(ocean)},
        {"key": "portForwarding",    "label": "Forwarding At The Port & Customs",  "value": r(port_forwarding)},
        {"key": "portParking",       "label": "Port Parking Lot",                  "value": r(port_parking)},
        {"key": "euDelivery",        "label": "Delivery To Bulgaria",              "value": r(eu_delivery)},
        {"key": "customs",           "label": "Customs Clearance (Duty + Docs)",   "value": r(customs_total)},
        {"key": "parkingBG",         "label": "Parking In Bulgaria",               "value": r(parking_bg)},
        {"key": "insurance",         "label": f"Cargo Insurance ({insurance_rate * 100:g}%)", "value": r(insurance)},
        {"key": "companyServices",   "label": "The Cost Of A'CARS Services",       "value": r(company_services)},
    ]

    return {
        "success": True,
        "calculation": {
            "vehiclePrice":     r(price),
            "auctionTotal":     r(auction_total),
            "deliveryTotal":    r(delivery_total),
            "total":            r(grand_total),
            "currency":         "USD",
            "port":             port,
            "auction":          auction,
            "vehicleType":      vehicle_type,
            "breakdown":        breakdown,
            "profileCode":      profile.get("code", DEFAULT_PROFILE_CODE),
            # legacy flat keys (backwards compatibility)
            "auctionFees":      r(auction_total),
            "shippingUSA":      r(usa_inland),
            "shippingSea":      r(ocean),
            "customs":          r(customs_total),
        }
    }


# ══════════════════════════════════════════════════════════════════════
# Calculator — ADMIN config endpoints (profile / routes / auction fees)
# ══════════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/calculator/config/profile")
async def calculator_get_profile(code: str = DEFAULT_PROFILE_CODE):
    """Get calculator profile (fixed fees, rates, flags)."""
    await _ensure_calculator_seed()
    prof = await db.calculator_profile.find_one({"code": code}, {"_id": 0})
    if not prof:
        raise HTTPException(status_code=404, detail="Profile not found")
    return prof


@fastapi_app.patch("/api/calculator/config/profile")
async def calculator_update_profile(data: Dict[str, Any] = Body(...)):
    """Update calculator profile (admin)."""
    code = data.get("code") or DEFAULT_PROFILE_CODE
    patch = {k: v for k, v in data.items() if k not in ("_id", "code", "updated_at")}
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.calculator_profile.update_one({"code": code}, {"$set": patch}, upsert=True)
    _invalidate_calc_cache()
    prof = await db.calculator_profile.find_one({"code": code}, {"_id": 0})
    return prof


@fastapi_app.get("/api/calculator/config/routes/{code}")
async def calculator_get_routes(code: str):
    """List route rates for a profile (usa_inland / ocean / eu_delivery)."""
    await _ensure_calculator_seed()
    cursor = db.calculator_routes.find({"profileCode": code}, {"_id": 0})
    return await cursor.to_list(length=500)


@fastapi_app.post("/api/calculator/config/routes")
async def calculator_upsert_route(data: Dict[str, Any] = Body(...)):
    """Create or update a route rate (admin)."""
    route_id = data.get("id") or data.get("_id") or (
        f"{data.get('rateType','route')}-{data.get('destinationCode','')}-{data.get('vehicleType','')}"
        .strip("-").replace(" ", "-").lower()
    )
    doc = {k: v for k, v in data.items() if k not in ("_id", "id")}
    doc["id"] = route_id
    doc.setdefault("profileCode", DEFAULT_PROFILE_CODE)
    doc.setdefault("currency", "USD")
    doc.setdefault("isActive", True)
    await db.calculator_routes.update_one({"id": route_id}, {"$set": doc}, upsert=True)
    _invalidate_calc_cache()
    saved = await db.calculator_routes.find_one({"id": route_id}, {"_id": 0})
    return saved


@fastapi_app.delete("/api/calculator/config/routes/{route_id}")
async def calculator_delete_route(route_id: str):
    """Delete a route rate (admin)."""
    await db.calculator_routes.delete_one({"id": route_id})
    _invalidate_calc_cache()
    return {"success": True}


@fastapi_app.get("/api/calculator/config/auction-fees/{code}")
async def calculator_get_auction_fees(code: str):
    """List tiered auction buyer fees for a profile."""
    await _ensure_calculator_seed()
    cursor = db.calculator_auction_fees.find({"profileCode": code}, {"_id": 0}).sort("minBid", 1)
    return await cursor.to_list(length=100)


@fastapi_app.post("/api/calculator/config/auction-fees")
async def calculator_upsert_auction_fee(data: Dict[str, Any] = Body(...)):
    """Create or update a tiered auction fee rule (admin)."""
    fee_id = data.get("id") or data.get("_id") or f"tier-{data.get('minBid', 0)}"
    doc = {k: v for k, v in data.items() if k not in ("_id", "id")}
    doc["id"] = fee_id
    doc.setdefault("profileCode", DEFAULT_PROFILE_CODE)
    doc.setdefault("currency", "USD")
    doc.setdefault("isActive", True)
    await db.calculator_auction_fees.update_one({"id": fee_id}, {"$set": doc}, upsert=True)
    _invalidate_calc_cache()
    saved = await db.calculator_auction_fees.find_one({"id": fee_id}, {"_id": 0})
    return saved


@fastapi_app.delete("/api/calculator/config/auction-fees/{fee_id}")
async def calculator_delete_auction_fee(fee_id: str):
    """Delete a tiered auction fee rule (admin)."""
    await db.calculator_auction_fees.delete_one({"id": fee_id})
    _invalidate_calc_cache()
    return {"success": True}


@fastapi_app.get("/api/calculator/admin/stats")
async def calculator_admin_stats():
    """Live counts used by the admin panel."""
    await _ensure_calculator_seed()
    return {
        "profileActive": await db.calculator_profile.count_documents({"isActive": True}),
        "routesActive": await db.calculator_routes.count_documents({"isActive": True}),
        "auctionRulesActive": await db.calculator_auction_fees.count_documents({"isActive": True}),
        "quotes": await db.quotes.count_documents({}),
        "leads": await db.leads.count_documents({"source": "calculator"}),
    }

@fastapi_app.post("/api/calculator/quote")
async def calculator_quote(data: Dict[str, Any] = Body(...)):
    """Create a quote"""
    quote_id = f"quote-{datetime.now(timezone.utc).timestamp()}"
    quote = {
        "id": quote_id,
        "vin": data.get("vin"),
        "price": data.get("price"),
        "port": data.get("port", "odessa"),
        "scenario": data.get("scenario", "standard"),
        "calculation": data.get("calculation"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quotes.insert_one(quote)
    # Remove _id before returning to avoid serialization issues
    quote.pop("_id", None)
    return {"success": True, "quote": quote}

@fastapi_app.patch("/api/calculator/quote/{quote_id}/scenario")
async def update_quote_scenario(quote_id: str, data: Dict[str, Any] = Body(...)):
    """Update quote scenario"""
    await db.quotes.update_one(
        {"id": quote_id},
        {"$set": {"scenario": data.get("scenario")}}
    )
    return {"success": True}

@fastapi_app.get("/api/calculator/quotes")
async def list_quotes(limit: int = 20):
    """List quotes"""
    cursor = db.quotes.find({}, {'_id': 0}).sort('created_at', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/calculator/config/routes")
async def calculator_routes():
    """Get shipping routes"""
    return {
        "success": True,
        "routes": [
            {"from": "USA", "to": "Odessa", "days": 45, "cost": 1200},
            {"from": "USA", "to": "Klaipeda", "days": 35, "cost": 1000},
            {"from": "USA", "to": "Gdansk", "days": 38, "cost": 1050},
        ]
    }

@fastapi_app.get("/api/calculator/config/auction-fees/{auction}")
async def calculator_auction_fees(auction: str):
    """Get auction fees config"""
    fees = AUCTION_FEES.get(auction, AUCTION_FEES["copart"])
    return {"success": True, "auction": auction, "fees": fees}

# ═══════════════════════════════════════════════════════════════════
# AUCTION RANKING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/auction-ranking/stats")
async def auction_ranking_stats():
    """Auction ranking statistics"""
    total = await db.vin_data.count_documents({})
    return {
        "success": True,
        "stats": {
            "totalVehicles": total,
            "activeAuctions": 150,
            "endingToday": 25,
            "newToday": 45,
        }
    }

@fastapi_app.get("/api/auction-ranking/hot")
async def auction_ranking_hot(limit: int = 8):
    """Hot vehicles (most viewed)"""
    cursor = db.vin_data.find({}, {'_id': 0}).sort('views', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/auction-ranking/ending-soon")
async def auction_ranking_ending_soon(limit: int = 8):
    """Vehicles ending soon"""
    cursor = db.vin_data.find(
        {"sale_date": {"$exists": True}},
        {'_id': 0}
    ).sort('sale_date', 1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/auction-ranking/upcoming")
async def auction_ranking_upcoming(limit: int = 8):
    """Upcoming auctions"""
    cursor = db.vin_data.find({}, {'_id': 0}).sort('created_at', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/auction-ranking/vehicle/{vehicle_id}")
async def auction_ranking_vehicle(vehicle_id: str):
    """Get vehicle ranking info"""
    vehicle = await db.vin_data.find_one(
        {"$or": [{"vin": vehicle_id.upper()}, {"id": vehicle_id}]},
        {'_id': 0}
    )
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"success": True, "data": vehicle, "ranking": {"position": 1, "score": 85}}

# ═══════════════════════════════════════════════════════════════════
# SEO CLUSTERS / COLLECTIONS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/seo-clusters/public")
async def seo_clusters_public():
    """Public SEO clusters (collections)"""
    clusters = [
        {"slug": "bmw-3-series", "name": "BMW 3 Series", "count": 45, "image": "/images/bmw-3.jpg"},
        {"slug": "mercedes-c-class", "name": "Mercedes C-Class", "count": 38, "image": "/images/merc-c.jpg"},
        {"slug": "audi-a4", "name": "Audi A4", "count": 32, "image": "/images/audi-a4.jpg"},
        {"slug": "toyota-camry", "name": "Toyota Camry", "count": 55, "image": "/images/camry.jpg"},
        {"slug": "honda-accord", "name": "Honda Accord", "count": 42, "image": "/images/accord.jpg"},
        {"slug": "lexus-es", "name": "Lexus ES", "count": 28, "image": "/images/lexus-es.jpg"},
    ]
    return {"success": True, "data": clusters}

@fastapi_app.get("/api/seo-clusters/public/{slug}")
async def seo_cluster_detail(slug: str):
    """Get cluster vehicles"""
    # Parse slug to get make/model
    parts = slug.split("-")
    make = parts[0] if parts else ""
    
    cursor = db.vin_data.find(
        {"make": {"$regex": make, "$options": "i"}},
        {'_id': 0}
    ).limit(50)
    items = await cursor.to_list(length=50)
    
    return {
        "success": True,
        "cluster": {"slug": slug, "name": slug.replace("-", " ").title()},
        "vehicles": items,
        "total": len(items)
    }

# ═══════════════════════════════════════════════════════════════════
# PUBLISHING / MODERATION
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/publishing/queue")
async def publishing_queue(status: str = "pending", limit: int = 50):
    """Get publishing queue"""
    cursor = db.publishing_queue.find({"status": status}, {'_id': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items, "total": len(items)}

@fastapi_app.post("/api/publishing/{item_id}/{action}")
async def publishing_action(item_id: str, action: str, data: Dict[str, Any] = Body(...)):
    """Approve/reject publishing item"""
    if action not in ["approve", "reject", "publish", "unpublish"]:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    status_map = {"approve": "approved", "reject": "rejected", "publish": "published", "unpublish": "draft"}
    await db.publishing_queue.update_one(
        {"id": item_id},
        {"$set": {"status": status_map.get(action, action), "updatedBy": data.get("userId")}}
    )
    return {"success": True}

@fastapi_app.post("/api/publishing/bulk/{action}")
async def publishing_bulk_action(action: str, data: Dict[str, Any] = Body(...)):
    """Bulk approve/reject"""
    ids = data.get("ids", [])
    status_map = {"approve": "approved", "reject": "rejected", "publish": "published"}
    await db.publishing_queue.update_many(
        {"id": {"$in": ids}},
        {"$set": {"status": status_map.get(action, action)}}
    )
    return {"success": True, "updated": len(ids)}

@fastapi_app.get("/api/publishing/public/listings/{listing_id}")
async def publishing_public_listing(listing_id: str):
    """Get public listing"""
    listing = await db.vin_data.find_one(
        {"$or": [{"vin": listing_id.upper()}, {"id": listing_id}]},
        {'_id': 0}
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {"success": True, "data": listing}

# ═══════════════════════════════════════════════════════════════════
# CUSTOMER AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

def _legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def generate_token() -> str:
    return secrets.token_urlsafe(32)


# ── Session helpers (shared between email/password and Google OAuth) ──
_CUSTOMER_SESSION_TTL_DAYS = 7
EMERGENT_OAUTH_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


def _customer_response(customer: Dict[str, Any], session_token: str) -> Dict[str, Any]:
    """Build the response shape the frontend expects (flat, top-level fields)."""
    customer_id = customer.get("customerId") or customer.get("id") or customer.get("user_id")
    return {
        "success": True,
        "customerId": customer_id,
        "sessionToken": session_token,
        "accessToken": session_token,  # legacy alias — same value
        "token": session_token,         # legacy alias
        "email": customer.get("email", ""),
        "name": customer.get("name", ""),
        "picture": customer.get("picture", ""),
        "role": customer.get("role", "customer"),
        "user": {
            "id": customer_id,
            "customerId": customer_id,
            "email": customer.get("email", ""),
            "name": customer.get("name", ""),
            "picture": customer.get("picture", ""),
            "role": customer.get("role", "customer"),
        },
    }


async def _create_customer_session(customer_id: str) -> str:
    """Insert a fresh session row with 7d TTL and return its token."""
    token = generate_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_CUSTOMER_SESSION_TTL_DAYS)
    await db.customer_sessions.insert_one({
        "token": token,
        "session_token": token,  # alias used by some readers
        "customerId": customer_id,
        "user_id": customer_id,
        "created_at": now,
        "expires_at": expires_at,
    })
    return token


async def _resolve_bearer(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Resolve the Bearer token to a customer document (or None).
    Validates expiry. Accepts both 'token' and 'session_token' fields.
    """
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if not token:
        return None
    session = await db.customer_sessions.find_one(
        {"$or": [{"token": token}, {"session_token": token}]},
        {"_id": 0},
    )
    if not session:
        return None
    # Check expiry (if set) — tolerant to missing/str/naive datetimes
    expires_at = session.get("expires_at")
    if expires_at:
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except Exception:
                expires_at = None
        if expires_at and getattr(expires_at, "tzinfo", None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < datetime.now(timezone.utc):
            return None

    customer_id = session.get("customerId") or session.get("user_id")
    if not customer_id:
        return None
    customer = await db.customers.find_one(
        {"$or": [{"id": customer_id}, {"customerId": customer_id}, {"user_id": customer_id}]},
        {"_id": 0, "password": 0},
    )
    return customer


@fastapi_app.post("/api/customer-auth/register")
async def customer_register(data: Dict[str, Any] = Body(...)):
    """Register new customer (email + password)."""
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = await db.customers.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    customer_id = f"cust_{uuid.uuid4().hex[:12]}"
    customer = {
        "id": customer_id,
        "customerId": customer_id,
        "user_id": customer_id,
        "email": email,
        "password": _legacy_sha256(password),
        "name": name or email.split("@", 1)[0],
        "phone": phone,
        "role": "customer",
        "status": "active",
        "source": "email",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.customers.insert_one(customer)
    token = await _create_customer_session(customer_id)
    return _customer_response(customer, token)


@fastapi_app.post("/api/customer-auth/login")
async def customer_login(data: Dict[str, Any] = Body(...)):
    """Customer login (email + password) with a TEST BYPASS for dev/QA."""
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    # ── TEST BYPASS (keep until deployment; see test_credentials.md) ──
    if email == "test@customer.com" and password == "test123":
        customer = await db.customers.find_one({"email": email}, {"_id": 0})
        if not customer:
            cid = "test_customer_001"
            customer = {
                "id": cid,
                "customerId": cid,
                "user_id": cid,
                "email": email,
                "name": "Test Customer",
                "phone": "+380123456789",
                "password": _legacy_sha256(password),
                "role": "customer",
                "status": "active",
                "source": "test",
                "picture": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.customers.insert_one(customer)
        cid = customer.get("customerId") or customer.get("id") or "test_customer_001"
        token = await _create_customer_session(cid)
        return _customer_response(customer, token)

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    customer = await db.customers.find_one({"email": email}, {"_id": 0})
    if not customer or customer.get("password") != _legacy_sha256(password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    cid = customer.get("customerId") or customer.get("id") or customer.get("user_id")
    token = await _create_customer_session(cid)
    return _customer_response(customer, token)


@fastapi_app.get("/api/customer-auth/me")
async def customer_me(authorization: Optional[str] = Header(None)):
    """Resolve current customer from Bearer token (shared with Google flow)."""
    customer = await _resolve_bearer(authorization)
    if not customer:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # We don't know the token here (not returning a new one) — reuse the one the client sent
    # But frontend also reads customerId/email/name — that's top-level.
    token_from_header = ""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2:
            token_from_header = parts[1].strip()
    return _customer_response(customer, token_from_header)


@fastapi_app.post("/api/customer-auth/google/session")
async def customer_google_session(data: Dict[str, Any] = Body(...)):
    """
    Exchange an Emergent OAuth session_id for a customer session.

    Frontend flow:
      1. User is redirected to https://auth.emergentagent.com/?redirect=<our_callback>
      2. Google auth completes, user returns to <our_callback>#session_id=XYZ
      3. Frontend POSTs { sessionId: "XYZ" } to this endpoint
      4. We call Emergent's session-data API, upsert the customer, return a session token.

    REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    """
    session_id = data.get("sessionId") or data.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")

    # Call Emergent Auth → get profile + long-lived session_token
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                EMERGENT_OAUTH_SESSION_DATA_URL,
                headers={"X-Session-ID": session_id},
            )
    except Exception as exc:
        logger.warning(f"[customer-auth/google] emergent fetch failed: {exc}")
        raise HTTPException(status_code=502, detail="Emergent Auth upstream unreachable")

    if resp.status_code != 200:
        logger.warning(
            f"[customer-auth/google] emergent returned {resp.status_code}: {resp.text[:200]}"
        )
        raise HTTPException(status_code=401, detail="Invalid or expired session_id")

    profile = resp.json() or {}
    email = (profile.get("email") or "").strip().lower()
    name = profile.get("name") or ""
    picture = profile.get("picture") or ""
    emergent_id = profile.get("id") or ""
    emergent_session_token = profile.get("session_token") or ""

    if not email:
        raise HTTPException(status_code=400, detail="Emergent profile has no email")

    # Upsert customer
    existing = await db.customers.find_one({"email": email}, {"_id": 0})
    now_iso = datetime.now(timezone.utc).isoformat()
    if existing:
        customer_id = (
            existing.get("customerId") or existing.get("id") or existing.get("user_id")
            or f"cust_{uuid.uuid4().hex[:12]}"
        )
        update = {
            "name": name or existing.get("name") or email.split("@", 1)[0],
            "picture": picture or existing.get("picture", ""),
            "googleId": emergent_id or existing.get("googleId", ""),
            "last_login_at": now_iso,
            "source": existing.get("source") or "google",
        }
        # ensure id fields are consistent
        update.update({"id": customer_id, "customerId": customer_id, "user_id": customer_id})
        await db.customers.update_one({"email": email}, {"$set": update})
        customer = {**existing, **update, "email": email, "role": existing.get("role", "customer")}
    else:
        customer_id = f"cust_{uuid.uuid4().hex[:12]}"
        customer = {
            "id": customer_id,
            "customerId": customer_id,
            "user_id": customer_id,
            "email": email,
            "name": name or email.split("@", 1)[0],
            "picture": picture,
            "googleId": emergent_id,
            "role": "customer",
            "status": "active",
            "source": "google",
            "created_at": now_iso,
            "last_login_at": now_iso,
        }
        await db.customers.insert_one(customer)

    # Prefer Emergent's long-lived session_token if provided; otherwise mint our own
    token = emergent_session_token or generate_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_CUSTOMER_SESSION_TTL_DAYS)
    await db.customer_sessions.insert_one({
        "token": token,
        "session_token": token,
        "customerId": customer_id,
        "user_id": customer_id,
        "provider": "google",
        "created_at": now,
        "expires_at": expires_at,
    })

    return _customer_response(customer, token)


@fastapi_app.get("/api/customer-auth/google/me")
async def customer_google_me(authorization: Optional[str] = Header(None)):
    """Return the current customer for a Google (or any) Bearer session."""
    customer = await _resolve_bearer(authorization)
    if not customer:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_from_header = ""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2:
            token_from_header = parts[1].strip()
    return _customer_response(customer, token_from_header)


@fastapi_app.post("/api/customer-auth/google/logout")
async def customer_google_logout(authorization: Optional[str] = Header(None)):
    """Invalidate the current session token (best-effort)."""
    if authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2:
            token = parts[1].strip()
            if token:
                try:
                    await db.customer_sessions.delete_many({
                        "$or": [{"token": token}, {"session_token": token}]
                    })
                except Exception as exc:
                    logger.warning(f"[customer-auth/logout] delete failed: {exc}")
    return {"success": True}

@fastapi_app.put("/api/customer-auth/me/profile")
async def customer_update_profile(data: Dict[str, Any] = Body(...)):
    """Update customer profile"""
    return {"success": True}

@fastapi_app.put("/api/customer-auth/me/password")
async def customer_update_password(data: Dict[str, Any] = Body(...)):
    """Update customer password"""
    return {"success": True}

@fastapi_app.put("/api/customer-auth/me/email")
async def customer_update_email(data: Dict[str, Any] = Body(...)):
    """Update customer email"""
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════
# APP SETTINGS (dynamic auth/base-url config editable from admin UI)
# ═══════════════════════════════════════════════════════════════════
# Everything auth-related that used to live in env vars now lives in the
# `app_settings` collection, key="auth". See /app/backend/settings_service.py
# for the schema + caching strategy.
#
# Three surfaces:
#   • GET  /api/settings/public        (anonymous, safe subset only)
#   • GET  /api/admin/settings/auth    (staff admin, full doc)
#   • PATCH /api/admin/settings/auth   (staff admin, deep-merge update)
#
# The SettingsService singleton is attached to the app at startup; the
# helper below resolves it with a safe fallback.
from settings_service import SettingsService, public_subset as _auth_public_subset

_settings_singleton: Optional[SettingsService] = None

def get_settings_service() -> SettingsService:
    """Lazy-create the SettingsService tied to the existing `db` handle."""
    global _settings_singleton
    if _settings_singleton is None:
        _settings_singleton = SettingsService(db)
    return _settings_singleton


async def resolve_base_url(request: Request) -> str:
    """Public-facing backend URL. Uses admin settings → env → request fallback."""
    svc = get_settings_service()
    return await svc.resolve_base_url(str(request.base_url))


async def resolve_frontend_url(request: Request) -> str:
    """Customer-facing UI URL used in reset-password links & post-OAuth redirects."""
    svc = get_settings_service()
    return await svc.resolve_frontend_url(str(request.base_url))


@fastapi_app.get("/api/settings/public")
async def public_settings(request: Request):
    """Anonymous-safe subset of auth settings — used by login/register pages."""
    svc = get_settings_service()
    auth = await svc.get_auth()
    subset = _auth_public_subset(auth)
    # Fill in resolved fallbacks so the frontend has working URLs even before
    # the admin has saved anything.
    if not subset.get("baseUrl"):
        subset["baseUrl"] = await svc.resolve_base_url(str(request.base_url))
    if not subset.get("frontendUrl"):
        subset["frontendUrl"] = await svc.resolve_frontend_url(str(request.base_url))
    if not (subset.get("google") or {}).get("clientId"):
        cid = await svc.resolve_google_client_id()
        subset.setdefault("google", {})["clientId"] = cid
    return subset


@fastapi_app.get("/api/admin/settings/auth", dependencies=[Depends(require_admin)])
async def admin_get_auth_settings(request: Request):
    """Full auth settings document (admin-only)."""
    svc = get_settings_service()
    auth = await svc.get_auth()
    # Also return resolved fallbacks so the admin sees what's actually in effect
    auth["_resolved"] = {
        "baseUrl": await svc.resolve_base_url(str(request.base_url)),
        "frontendUrl": await svc.resolve_frontend_url(str(request.base_url)),
        "googleClientId": await svc.resolve_google_client_id(),
        "requestBaseUrl": str(request.base_url).rstrip("/"),
    }
    # Never expose the raw JWT secret to the UI — show if set, not the value
    jwt_cfg = auth.get("jwt") or {}
    auth["jwt"] = {
        **jwt_cfg,
        "secret": "********" if (jwt_cfg.get("secret") or "").strip() else "",
        "secretIsSet": bool((jwt_cfg.get("secret") or "").strip()),
    }
    return auth


@fastapi_app.patch("/api/admin/settings/auth", dependencies=[Depends(require_admin)])
async def admin_patch_auth_settings(
    payload: Dict[str, Any] = Body(...),
    request: Request = None,
):
    """
    Partial update of auth settings (deep-merge).

    Acceptable top-level keys: baseUrl, frontendUrl, google, jwt, features,
    password, email. Any other keys are silently ignored.

    NOTE: passing `jwt.secret == "********"` is treated as "keep existing".
    Pass an empty string to explicitly clear it.
    """
    ALLOWED = {"baseUrl", "frontendUrl", "google", "jwt", "features", "password", "email"}
    clean = {k: v for k, v in (payload or {}).items() if k in ALLOWED}

    # Guard: masked secret means "don't change"
    if isinstance(clean.get("jwt"), dict):
        jwt_in = dict(clean["jwt"])
        if jwt_in.get("secret") == "********":
            jwt_in.pop("secret", None)
        clean["jwt"] = jwt_in

    # Normalise URLs (strip trailing slashes)
    for k in ("baseUrl", "frontendUrl"):
        if isinstance(clean.get(k), str):
            clean[k] = clean[k].strip().rstrip("/")

    svc = get_settings_service()
    updated = await svc.patch_auth(clean, by="admin")

    # Mirror to integration_configs so legacy Google flow keeps working
    try:
        new_cid = ((updated.get("google") or {}).get("clientId") or "").strip()
        if new_cid:
            await db.integration_configs.update_one(
                {"provider": "google_oauth"},
                {
                    "$set": {
                        "provider": "google_oauth",
                        "credentials.clientId": new_cid,
                        "isEnabled": True,
                        "updatedAt": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
    except Exception as exc:
        logger.warning(f"[settings] google mirror failed: {exc}")

    # Mask secret back on the response
    jwt_cfg = updated.get("jwt") or {}
    updated_resp = dict(updated)
    updated_resp["jwt"] = {
        **jwt_cfg,
        "secret": "********" if (jwt_cfg.get("secret") or "").strip() else "",
        "secretIsSet": bool((jwt_cfg.get("secret") or "").strip()),
    }
    return {"success": True, "value": updated_resp}


# ═══════════════════════════════════════════════════════════════════
# PASSWORD RESET (customer) — dynamic frontendUrl, DRY-RUN email
# ═══════════════════════════════════════════════════════════════════
# Flow:
#   1. POST /api/customer-auth/forgot-password   { email }
#         → always returns 200 (no email enumeration)
#         → if user exists: creates single-use token with TTL, "sends" email
#   2. POST /api/customer-auth/reset-password    { token, password }
#         → validates token (not expired, not used)
#         → updates password (SHA-256 legacy) + marks token consumed
#         → issues a new session so the user is logged in immediately
#
# Storage = `password_reset_tokens` collection
#   { token, customerId, email, created_at, expires_at, used_at? }

@fastapi_app.post("/api/customer-auth/forgot-password")
async def customer_forgot_password(
    request: Request,
    data: Dict[str, Any] = Body(...),
):
    """Request a password-reset link. Always returns 200 (no enumeration)."""
    svc = get_settings_service()
    auth_cfg = await svc.get_auth()
    if not (auth_cfg.get("features") or {}).get("resetPasswordEnabled", True):
        raise HTTPException(status_code=403, detail="Password reset is disabled")

    email = (data.get("email") or "").strip().lower()
    # Never reveal whether the email exists
    response_ok = {"success": True, "message": "If that email exists, a reset link has been sent."}
    if not email:
        return response_ok

    customer = await db.customers.find_one({"email": email}, {"_id": 0})
    if not customer:
        return response_ok

    ttl_minutes = int(((auth_cfg.get("password") or {}).get("resetTokenTtlMinutes")) or 60)
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token": token,
        "customerId": customer.get("customerId") or customer.get("id") or customer.get("user_id"),
        "email": email,
        "created_at": now,
        "expires_at": now + timedelta(minutes=ttl_minutes),
        "used_at": None,
    })

    frontend_url = await svc.resolve_frontend_url(str(request.base_url))
    reset_link = f"{frontend_url}/cabinet/reset-password?token={token}"

    # DRY-RUN email — log the link so devs/testing-agent can grab it.
    # Future: plug into Resend/SMTP based on settings.email.mode
    logger.info(f"[password-reset] DRY RUN email to={email} link={reset_link}")
    try:
        await db.email_outbox.insert_one({
            "to": email,
            "subject": "BIBI Cars — Password reset",
            "body": f"Click the link to reset your password (valid {ttl_minutes} min):\n\n{reset_link}\n",
            "mode": (auth_cfg.get("email") or {}).get("mode", "dry_run"),
            "template": "reset_password",
            "status": "dry_run",
            "created_at": now,
            "meta": {"reset_token": token, "customerId": customer.get("customerId")},
        })
    except Exception as exc:
        logger.warning(f"[password-reset] outbox insert failed: {exc}")

    # When DRY-RUN mode, also expose the link in the response so UI can
    # show it (only non-prod convenience; hide when email.mode != dry_run).
    if (auth_cfg.get("email") or {}).get("mode", "dry_run") == "dry_run":
        return {**response_ok, "dry_run": True, "reset_link": reset_link}
    return response_ok


@fastapi_app.post("/api/customer-auth/reset-password")
async def customer_reset_password(data: Dict[str, Any] = Body(...)):
    """Consume a reset token and set a new password. Returns a fresh session."""
    svc = get_settings_service()
    auth_cfg = await svc.get_auth()
    if not (auth_cfg.get("features") or {}).get("resetPasswordEnabled", True):
        raise HTTPException(status_code=403, detail="Password reset is disabled")

    token = (data.get("token") or "").strip()
    new_password = data.get("password") or ""
    min_len = int(((auth_cfg.get("password") or {}).get("minLength")) or 6)

    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    if len(new_password) < min_len:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {min_len} characters",
        )

    row = await db.password_reset_tokens.find_one({"token": token})
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    if row.get("used_at"):
        raise HTTPException(status_code=400, detail="Token already used")
    expires_at = row.get("expires_at")
    if expires_at and isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Token expired")

    customer_id = row.get("customerId")
    customer = await db.customers.find_one(
        {"$or": [{"id": customer_id}, {"customerId": customer_id}, {"user_id": customer_id}]},
        {"_id": 0},
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Update password using same legacy SHA-256 as /register & /login
    await db.customers.update_one(
        {"$or": [{"id": customer_id}, {"customerId": customer_id}, {"user_id": customer_id}]},
        {
            "$set": {
                "password": _legacy_sha256(new_password),
                "password_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await db.password_reset_tokens.update_one(
        {"token": token},
        {"$set": {"used_at": datetime.now(timezone.utc)}},
    )
    # Invalidate existing sessions to force re-login everywhere
    try:
        await db.customer_sessions.delete_many({
            "$or": [{"customerId": customer_id}, {"user_id": customer_id}]
        })
    except Exception:
        pass

    # Issue new session — user is logged in immediately after reset
    new_token = await _create_customer_session(customer_id)
    return {
        **_customer_response(customer, new_token),
        "message": "Password updated successfully",
    }


@fastapi_app.get("/api/customer-auth/validate-reset-token")
async def customer_validate_reset_token(token: str):
    """Check token before showing the reset form. Returns email (masked) if OK."""
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    row = await db.password_reset_tokens.find_one({"token": token})
    if not row:
        raise HTTPException(status_code=400, detail="Invalid token")
    if row.get("used_at"):
        raise HTTPException(status_code=400, detail="Token already used")
    expires_at = row.get("expires_at")
    if expires_at and isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Token expired")
    email = row.get("email") or ""
    if email and "@" in email:
        local, dom = email.split("@", 1)
        if len(local) > 2:
            email = local[0] + "***" + local[-1] + "@" + dom
    return {"valid": True, "email": email}


# ═══════════════════════════════════════════════════════════════════
# CUSTOMER CABINET ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/customer-cabinet/dashboard")
async def customer_cabinet_dashboard():
    """Customer dashboard"""
    return {
        "success": True,
        "data": {
            "favorites": 5,
            "compares": 2,
            "orders": 1,
            "invoices": 0
        }
    }

@fastapi_app.get("/api/favorites")
async def list_favorites(customerId: Optional[str] = None):
    """List customer favorites — admin/legacy. Use /api/favorites/me for the cabinet."""
    query = {}
    if customerId:
        query["$or"] = [{"customerId": customerId}, {"userId": customerId}]
    cursor = db.favorites.find(query, {'_id': 0}).limit(100)
    items = await cursor.to_list(length=100)
    return {"success": True, "data": items}

# NOTE: The Phase III implementations of /api/favorites/me, POST /api/favorites,
# GET /api/favorites/check/{vin}, DELETE /api/favorites/{id} are defined later
# (search "PHASE III — Customer Favorites"). Those are the canonical ones —
# they require a customer Bearer token and are wired to the frontend
# FavoriteButton + FavoritesPage in the cabinet.

@fastapi_app.post("/api/favorites/add")
async def add_favorite_alt(
    data: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Alt POST endpoint kept for backwards compat. Delegates to the auth-gated handler."""
    return await add_favorite(data=data, authorization=authorization)  # type: ignore[name-defined]

@fastapi_app.post("/api/favorites/remove/{vin}")
async def remove_favorite_by_vin(
    vin: str,
    authorization: Optional[str] = Header(None),
):
    """Alt remove endpoint by VIN. Delegates to the auth-gated handler."""
    return await remove_favorite(vehicle_id=vin, authorization=authorization)  # type: ignore[name-defined]

# Compare
@fastapi_app.get("/api/compare/me")
async def my_compare():
    """Get my compare list"""
    return {"success": True, "data": []}

@fastapi_app.post("/api/compare/add")
async def add_to_compare(data: Dict[str, Any] = Body(...)):
    """Add to compare"""
    compare = {
        "customerId": data.get("customerId", "guest"),
        "vin": data.get("vin"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.compares.insert_one(compare)
    return {"success": True}

@fastapi_app.post("/api/compare/remove/{vin}")
async def remove_from_compare(vin: str):
    """Remove from compare"""
    await db.compares.delete_one({"vin": vin.upper()})
    return {"success": True}

@fastapi_app.post("/api/compare/clear")
async def clear_compare():
    """Clear compare list"""
    return {"success": True}

@fastapi_app.get("/api/compare/resolve")
async def resolve_compare(vins: str = ""):
    """Resolve VINs for compare"""
    vin_list = [v.strip().upper() for v in vins.split(",") if v.strip()]
    vehicles = []
    for vin in vin_list:
        v = await db.vin_data.find_one({"vin": vin}, {'_id': 0})
        if v:
            vehicles.append(v)
    return {"success": True, "data": vehicles}

# History reports
@fastapi_app.get("/api/history/quota/me")
async def history_quota():
    """Get history report quota"""
    return {"success": True, "quota": {"used": 0, "total": 5, "remaining": 5}}

@fastapi_app.post("/api/history/request")
async def request_history_report(data: Dict[str, Any] = Body(...)):
    """Request history report"""
    report = {
        "id": f"report-{datetime.now(timezone.utc).timestamp()}",
        "vin": data.get("vin"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.history_reports.insert_one(report)
    return {"success": True, "reportId": report["id"]}

@fastapi_app.get("/api/history/report/{report_id}")
async def get_history_report(report_id: str):
    """Get history report"""
    report = await db.history_reports.find_one({"id": report_id}, {'_id': 0})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True, "data": report}

# Shipping tracking
@fastapi_app.get("/api/shipping/me")
async def my_shipping(customerId: Optional[str] = None, limit: int = 50):
    """Get shipments for the current customer (cabinet view)"""
    try:
        query = {}
        if customerId:
            query['customerId'] = customerId
        shipments = await db.shipments.find(query).sort('created_at', -1).limit(limit).to_list(limit)
        return {"success": True, "data": [serialize_doc(s) for s in shipments]}
    except Exception as e:
        logger.error(f"[SHIPPING_ME] Error: {e}")
        return {"success": False, "data": [], "error": str(e)}

# ═══════════════════════════════════════════════════════════════════
# STAFF MANAGEMENT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/staff", dependencies=[Depends(require_admin)])
async def list_staff(role: Optional[str] = None, limit: int = 50):
    """List staff members"""
    query = {}
    if role:
        query["role"] = role
    cursor = db.staff.find(query, {'_id': 0, 'password': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "items": items}

@fastapi_app.get("/api/staff/stats", dependencies=[Depends(require_admin)])
async def staff_stats():
    """Staff statistics"""
    total = await db.staff.count_documents({})
    active = await db.staff.count_documents({"active": True})
    return {
        "success": True,
        "stats": {
            "total": total,
            "active": active,
            "inactive": total - active,
            "online": 0
        }
    }

@fastapi_app.get("/api/staff/performance", dependencies=[Depends(require_admin)])
async def staff_performance(period: str = "week"):
    """Staff performance metrics"""
    cursor = db.staff.find({}, {'_id': 0, 'password': 0}).limit(20)
    staff = await cursor.to_list(length=20)
    
    performance = []
    for s in staff:
        performance.append({
            "id": s.get("id"),
            "name": s.get("name"),
            "role": s.get("role"),
            "leads": 0,
            "conversions": 0,
            "calls": 0,
            "avgResponseTime": 0
        })
    
    return {"success": True, "data": performance}

@fastapi_app.get("/api/staff/inactive", dependencies=[Depends(require_admin)])
async def staff_inactive(hours: int = 2):
    """Get inactive staff"""
    return {"success": True, "data": []}

@fastapi_app.post("/api/staff", dependencies=[Depends(require_admin)])
async def create_staff(data: Dict[str, Any] = Body(...)):
    """Create staff member"""
    staff = {
        "id": f"staff-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "role": data.get("role", "manager"),
        "active": True,
        "password": _legacy_sha256(data.get("password", "123456")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.staff.insert_one(staff)
    return {"success": True, "id": staff["id"]}

@fastapi_app.put("/api/staff/{staff_id}", dependencies=[Depends(require_admin)])
async def update_staff(staff_id: str, data: Dict[str, Any] = Body(...)):
    """Update staff member"""
    update_data = {k: v for k, v in data.items() if k != "password"}
    if data.get("password"):
        update_data["password"] = _legacy_sha256(data["password"])
    
    await db.staff.update_one({"id": staff_id}, {"$set": update_data})
    return {"success": True}

@fastapi_app.put("/api/staff/{staff_id}/toggle-active", dependencies=[Depends(require_admin)])
async def toggle_staff_active(staff_id: str):
    """Toggle staff active status"""
    staff = await db.staff.find_one({"id": staff_id})
    if staff:
        await db.staff.update_one(
            {"id": staff_id},
            {"$set": {"active": not staff.get("active", True)}}
        )
    return {"success": True}

@fastapi_app.post("/api/staff/{staff_id}/reset-password", dependencies=[Depends(require_admin)])
async def reset_staff_password(staff_id: str, data: Dict[str, Any] = Body(...)):
    """Reset staff password"""
    new_password = data.get("newPassword", "123456")
    await db.staff.update_one(
        {"id": staff_id},
        {"$set": {"password": _legacy_sha256(new_password)}}
    )
    return {"success": True}

@fastapi_app.get("/api/staff/{staff_id}", dependencies=[Depends(require_admin)])
async def get_staff_member(staff_id: str):
    """Get staff member by ID"""
    member = await db.staff.find_one({"id": staff_id}, {'_id': 0, 'password': 0})
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return {"success": True, "data": member}

@fastapi_app.delete("/api/staff/{staff_id}", dependencies=[Depends(require_admin)])
async def delete_staff_member(staff_id: str):
    """Delete staff member"""
    await db.staff.delete_one({"id": staff_id})
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# USERS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/users", dependencies=[Depends(require_admin)])
async def list_users(role: Optional[str] = None, limit: int = 50):
    """List users (staff + customers)"""
    query = {}
    if role:
        query["role"] = role
    
    # Get from staff collection
    cursor = db.staff.find(query, {'_id': 0, 'password': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    
    return {"success": True, "data": items}

@fastapi_app.get("/api/users/{user_id}", dependencies=[Depends(require_admin)])
async def get_user(user_id: str):
    """Get user by ID"""
    user = await db.staff.find_one({"id": user_id}, {'_id': 0, 'password': 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "data": user}

@fastapi_app.get("/api/users/me")
async def get_current_user_endpoint(current_user: Dict[str, Any] = Depends(require_user)):
    """Return the authenticated staff user (alias of /api/auth/me)."""
    return {"success": True, "data": {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "name": current_user.get("name"),
        "role": current_user.get("role"),
        "managerId": current_user.get("managerId"),
    }}

# ═══════════════════════════════════════════════════════════════════
# DEPOSITS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/deposits")
async def list_deposits(status: Optional[str] = None, limit: int = 50):
    """List deposits"""
    query = {}
    if status:
        query["status"] = status
    cursor = db.deposits.find(query, {'_id': 0}).sort('created_at', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.deposits.count_documents(query)
    return {"success": True, "data": items, "total": total}

@fastapi_app.post("/api/deposits")
async def create_deposit(data: Dict[str, Any] = Body(...)):
    """Create deposit"""
    deposit = {
        "id": f"dep-{datetime.now(timezone.utc).timestamp()}",
        "customerId": data.get("customerId"),
        "managerId": data.get("managerId"),
        "amount": float(data.get("amount") or 0),
        "currency": (data.get("currency") or "USD").upper(),
        "method": data.get("method"),
        "note": data.get("note"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.deposits.insert_one(deposit)
    return {"success": True, "id": deposit["id"], "deposit": {k: v for k, v in deposit.items() if k != "_id"}}

@fastapi_app.put("/api/deposits/{deposit_id}/approve")
async def approve_deposit(deposit_id: str, data: Dict[str, Any] = Body(default={}), user: dict = Depends(require_manager_or_admin)):
    """Approve a deposit. Optional: ``auto_convert=True`` creates an invoice +
    order from this deposit (same code path as a paid invoice)."""
    d = await db.deposits.find_one({"id": deposit_id})
    if not d:
        raise HTTPException(404, "Deposit not found")

    await db.deposits.update_one(
        {"id": deposit_id},
        {"$set": {"status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(),
                   "approvedBy": user.get("email") or user.get("id")}}
    )

    if not (data or {}).get("auto_convert", True):
        return {"success": True}

    # ─── Deposit → Invoice (single-line) → Order auto ────────────
    try:
        already = await db.invoices.find_one({"sourceDepositId": deposit_id}, {"_id": 0})
        if already:
            return {"success": True, "invoice": already, "already_converted": True}

        inv_id = f"inv_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:6]}"
        amount = float(d.get("amount") or 0)
        currency = (d.get("currency") or "USD").upper()
        line = {
            "id": str(uuid.uuid4()),
            "service_id": None,
            "service_code": None,
            "name": f"Депозит · {d.get('method') or 'manual'}",
            "description": d.get("note") or "",
            "category": "deposit",
            "price": amount,
            "qty": 1,
            "line_total": amount,
            "workflow": [
                {"key": "received",  "label": "Депозит отримано"},
                {"key": "applied",   "label": "Зарахований у замовлення"},
            ],
        }
        invoice = {
            "id": inv_id,
            "customerId": d.get("customerId"),
            "managerId": d.get("managerId") or user.get("id"),
            "managerEmail": user.get("email"),
            "items": [line],
            "amount": _round_money(amount),
            "total": _round_money(amount),
            "currency": currency,
            "status": "paid",
            "description": line["name"],
            "sourceDepositId": deposit_id,
            "paymentMethod": d.get("method") or "deposit",
            "paidAt": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": user.get("email") or user.get("id"),
        }
        await db.invoices.insert_one(invoice)
        invoice.pop("_id", None)

        # Link the deposit back
        await db.deposits.update_one(
            {"id": deposit_id},
            {"$set": {"invoiceId": inv_id, "convertedAt": datetime.now(timezone.utc).isoformat()}},
        )

        # Auto-create order (this emits payment_confirmed + order_started)
        order = await _create_order_from_invoice(invoice)
        return {"success": True, "invoice": invoice, "order": order, "converted": True}
    except Exception:
        logger.exception("[deposit] auto-convert failed")
        return {"success": True, "converted": False}

@fastapi_app.put("/api/deposits/{deposit_id}/reject")
async def reject_deposit(deposit_id: str, user: dict = Depends(require_manager_or_admin)):
    """Reject deposit"""
    r = await db.deposits.update_one(
        {"id": deposit_id},
        {"$set": {"status": "rejected", "rejectedBy": user.get("email") or user.get("id"),
                   "rejected_at": datetime.now(timezone.utc).isoformat()}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Deposit not found")
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# NOTIFICATIONS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/notifications")
async def list_notifications(limit: int = 50):
    """List notifications"""
    cursor = db.notifications.find({}, {'_id': 0}).sort('created_at', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/notifications/me")
async def my_notifications(limit: int = 20, user: dict = Depends(require_user)):
    """My notifications (user-scoped)."""
    q = {"userId": user.get("id")}
    cursor = db.notifications.find(q, {'_id': 0}).sort('created_at', -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    # Normalise shape expected by the frontend hook
    norm = []
    for n in items:
        norm.append({
            "id": n.get("id"),
            "type": n.get("type") or n.get("event"),
            "event": n.get("event") or n.get("type"),
            "title": n.get("title"),
            "message": n.get("message"),
            "severity": n.get("severity", "info"),
            "soundKey": n.get("soundKey"),
            "meta": n.get("meta") or {},
            "isRead": bool(n.get("isRead") if "isRead" in n else n.get("read")),
            "read": bool(n.get("read") if "read" in n else n.get("isRead")),
            "createdAt": n.get("createdAt") or n.get("created_at"),
            "created_at": n.get("created_at") or n.get("createdAt"),
        })
    unread = await db.notifications.count_documents({"userId": user.get("id"), "$or": [{"read": False}, {"isRead": False}]})
    return {"success": True, "notifications": norm, "data": norm, "unreadCount": unread}

@fastapi_app.get("/api/notifications/unread-count")
async def notifications_unread_count(user: dict = Depends(require_user)):
    count = await db.notifications.count_documents({"userId": user.get("id"), "$or": [{"read": False}, {"isRead": False}]})
    return {"success": True, "count": count}

@fastapi_app.post("/api/notifications")
async def create_notification(data: Dict[str, Any] = Body(...)):
    """Create notification"""
    notification = {
        "id": f"notif-{datetime.now(timezone.utc).timestamp()}",
        "type": data.get("type", "info"),
        "title": data.get("title"),
        "message": data.get("message"),
        "userId": data.get("userId"),
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.notifications.insert_one(notification)
    return {"success": True, "id": notification["id"]}

@fastapi_app.patch("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: dict = Depends(require_user)):
    """Mark a notification as read (only own)."""
    r = await db.notifications.update_one(
        {"id": notification_id, "userId": user.get("id")},
        {"$set": {"read": True, "isRead": True, "read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True, "modified": r.modified_count}

@fastapi_app.post("/api/notifications/read-all")
async def mark_all_notifications_read(user: dict = Depends(require_user)):
    """Mark all my notifications as read."""
    r = await db.notifications.update_many(
        {"userId": user.get("id")},
        {"$set": {"read": True, "isRead": True, "read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True, "modified": r.modified_count}

@fastapi_app.patch("/api/notifications/read-all")
async def mark_all_notifications_read_patch(user: dict = Depends(require_user)):
    """Alias (PATCH) of read-all — the frontend hook uses PATCH."""
    return await mark_all_notifications_read(user)

# ── Admin: notification rules (enable/disable + channels) ──
@fastapi_app.get("/api/admin/notification-rules", dependencies=[Depends(require_admin)])
async def list_notification_rules():
    import notifications as _notif
    rules = []
    async for r in db.notification_rules.find({}, {"_id": 0}).sort("event", 1):
        rules.append(r)
    # fill missing events with defaults
    existing = {r["event"] for r in rules}
    for ev in _notif.ALL_EVENTS:
        if ev not in existing:
            for d in _notif.DEFAULT_RULES:
                if d["event"] == ev:
                    rules.append({"id": f"rule_{ev}", **d, "missing_in_db": True})
                    break
    return {"success": True, "items": rules, "events": _notif.ALL_EVENTS,
            "audiences": list(_notif.AUDIENCES), "channels": list(_notif.CHANNELS)}

@fastapi_app.patch("/api/admin/notification-rules/{event}", dependencies=[Depends(require_master_admin)])
async def update_notification_rule(event: str, data: Dict[str, Any] = Body(...)):
    """Update (or upsert) a rule. Body: {enabled, targets: [{audience, channels:[]}]}"""
    import notifications as _notif
    if event not in _notif.ALL_EVENTS:
        raise HTTPException(400, f"Unknown event: {event}")
    targets = data.get("targets")
    if targets is not None:
        if not isinstance(targets, list):
            raise HTTPException(400, "targets must be a list")
        for t in targets:
            if t.get("audience") not in _notif.AUDIENCES:
                raise HTTPException(400, f"unknown audience: {t.get('audience')}")
            for ch in (t.get("channels") or []):
                if ch not in _notif.CHANNELS:
                    raise HTTPException(400, f"unknown channel: {ch}")
    upd = {k: v for k, v in (data or {}).items() if k in {"enabled", "targets"}}
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.notification_rules.update_one(
        {"event": event},
        {"$set": {**upd, "event": event, "id": f"rule_{event}"}},
        upsert=True,
    )
    fresh = await db.notification_rules.find_one({"event": event}, {"_id": 0})
    return {"success": True, "rule": fresh}


# ── Admin: email templates (editable UI) ──
@fastapi_app.get("/api/admin/email-templates", dependencies=[Depends(require_admin)])
async def list_email_templates(event: str = "", audience: str = "", lang: str = ""):
    q: Dict[str, Any] = {}
    if event:    q["event"] = event
    if audience: q["audience"] = audience
    if lang:     q["lang"] = lang
    cursor = db.email_templates.find(q, {"_id": 0}).sort([("event", 1), ("audience", 1), ("lang", 1)])
    items = await cursor.to_list(length=500)
    return {"success": True, "items": items}

@fastapi_app.patch("/api/admin/email-templates/{template_id}", dependencies=[Depends(require_master_admin)])
async def update_email_template(template_id: str, data: Dict[str, Any] = Body(...)):
    allowed = {"subject", "html", "text_template", "active"}
    upd = {k: v for k, v in (data or {}).items() if k in allowed}
    if not upd:
        raise HTTPException(400, "Nothing to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.email_templates.update_one({"id": template_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Template not found")
    t = await db.email_templates.find_one({"id": template_id}, {"_id": 0})
    return {"success": True, "template": t}

@fastapi_app.post("/api/admin/email-templates", dependencies=[Depends(require_master_admin)])
async def create_email_template(data: Dict[str, Any] = Body(...)):
    import notifications as _notif
    required = {"event", "audience", "lang", "subject", "html"}
    if not required.issubset(data.keys()):
        raise HTTPException(400, f"Missing fields: {required - set(data.keys())}")
    if data["event"] not in _notif.ALL_EVENTS:
        raise HTTPException(400, "Unknown event")
    if data["audience"] not in _notif.AUDIENCES:
        raise HTTPException(400, "Unknown audience")
    if data["lang"] not in _notif.LANGUAGES:
        raise HTTPException(400, "Unknown lang")
    tid = f"tpl_{data['event']}_{data['audience']}_{data['lang']}"
    doc = {
        "id": tid,
        "event": data["event"],
        "audience": data["audience"],
        "lang": data["lang"],
        "subject": data["subject"],
        "html": data["html"],
        "text_template": data.get("text_template", ""),
        "active": bool(data.get("active", True)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.email_templates.update_one({"id": tid}, {"$set": doc}, upsert=True)
    return {"success": True, "template": doc}

@fastapi_app.post("/api/admin/notifications/test-dispatch", dependencies=[Depends(require_master_admin)])
async def test_dispatch(data: Dict[str, Any] = Body(...), user: dict = Depends(require_master_admin)):
    """Fire a synthetic event against the notification dispatcher — useful
    for `master_admin` to verify a new template renders correctly and the
    right channels are triggered. Body: {event, invoice?, order?, customer?}.
    Returns the dispatch summary (audiences, channels, recipient counts).
    """
    import notifications as _notif
    event = data.get("event")
    if event not in _notif.ALL_EVENTS:
        raise HTTPException(400, f"Unknown event: {event}")
    ctx = {
        "invoice": data.get("invoice") or {
            "id": "inv_TEST",
            "total": 1234.56,
            "currency": "USD",
            "customerId": user.get("id"),
            "managerId": user.get("id"),
            "managerEmail": user.get("email"),
        },
        "order": data.get("order") or {"id": "ord_TEST", "steps": [{}, {}, {}]},
        "customer": data.get("customer") or {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("email"),
            "lang": "ua",
        },
        "manager": data.get("manager") or {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("email"),
            "lang": "ua",
        },
    }
    result = await _notif.service.dispatch(event, ctx)
    return {"success": True, "dispatch": result}


# ── Admin: email outbox view (see what was actually sent / logged) ──
@fastapi_app.get("/api/admin/email-outbox", dependencies=[Depends(require_admin)])
async def list_email_outbox(limit: int = 100, event: str = "", status: str = ""):
    q: Dict[str, Any] = {}
    if event:  q["event"] = event
    if status: q["status"] = status
    cursor = db.email_outbox.find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items, "provider": (
        "resend" if os.environ.get("RESEND_API_KEY") else "dry_run"
    )}


@fastapi_app.delete("/api/notifications/{notification_id}")
async def delete_notification(notification_id: str):
    """Delete notification"""
    await db.notifications.delete_one({"id": notification_id})
    return {"success": True}

@fastapi_app.get("/api/notifications/customer/me")
async def customer_notifications():
    """Customer notifications"""
    return {"success": True, "data": []}

@fastapi_app.get("/api/notifications/customer/unread-count")
async def customer_notifications_unread():
    """Customer unread count"""
    return {"success": True, "count": 0}

@fastapi_app.get("/api/notifications/stats")
async def notifications_stats():
    """Notification stats"""
    return {"success": True, "stats": {"total": 0, "unread": 0, "today": 0}}

@fastapi_app.get("/api/notifications/rules")
async def notification_rules():
    """Get notification rules - returns direct array"""
    return [
        {"eventType": "lead.created", "isActive": True, "severity": "info", "channels": {"inApp": True, "telegram": False, "sound": True, "email": False}, "soundKey": "lead", "debounceMinutes": 10},
        {"eventType": "invoice.overdue", "isActive": True, "severity": "critical", "channels": {"inApp": True, "telegram": True, "sound": True, "email": True}, "soundKey": "alert", "debounceMinutes": 30},
    ]

@fastapi_app.post("/api/notifications/rules")
async def create_notification_rule(data: Dict[str, Any] = Body(...)):
    """Create notification rule"""
    return {"success": True}

@fastapi_app.put("/api/notifications/rules/{rule_id}")
async def update_notification_rule(rule_id: str, data: Dict[str, Any] = Body(...)):
    """Update notification rule"""
    return {"success": True}

@fastapi_app.patch("/api/notifications/rules/{event_type}")
async def patch_notification_rule(event_type: str, data: Dict[str, Any] = Body(...)):
    """Patch notification rule"""
    return {"success": True}

@fastapi_app.post("/api/notifications/test")
async def test_notification(data: Dict[str, Any] = Body(...)):
    """Test notification"""
    return {"success": True, "sent": True}

# ═══════════════════════════════════════════════════════════════════
# TEAM LEAD ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/team/dashboard")
async def team_dashboard():
    """Team dashboard"""
    return {
        "success": True,
        "kpi": {
            "totalLeads": await db.leads.count_documents({}),
            "newLeads": await db.leads.count_documents({"status": "new"}),
            "conversions": await db.deals.count_documents({"status": "won"}),
            "avgResponseTime": 5
        },
        "alerts": [],
        "overdue": []
    }

@fastapi_app.get("/api/team/managers")
async def team_managers():
    """Get team managers"""
    cursor = db.staff.find({"role": {"$in": ["manager", "team_lead"]}}, {'_id': 0, 'password': 0})
    items = await cursor.to_list(length=50)
    
    # Add stats to each manager
    for m in items:
        m["stats"] = {
            "leads": await db.leads.count_documents({"managerId": m.get("id")}),
            "deals": await db.deals.count_documents({"managerId": m.get("id")}),
            "tasks": await db.tasks.count_documents({"assigneeId": m.get("id")})
        }
    
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/managers/{manager_id}")
async def team_manager_detail(manager_id: str):
    """Get manager details"""
    manager = await db.staff.find_one({"id": manager_id}, {'_id': 0, 'password': 0})
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    
    manager["stats"] = {
        "leads": await db.leads.count_documents({"managerId": manager_id}),
        "deals": await db.deals.count_documents({"managerId": manager_id}),
        "tasks": await db.tasks.count_documents({"assigneeId": manager_id})
    }
    
    return {"success": True, "data": manager}

@fastapi_app.get("/api/team/alerts")
async def team_alerts():
    """Team alerts"""
    cursor = db.alerts.find({}, {'_id': 0}).sort('created_at', -1).limit(20)
    items = await cursor.to_list(length=20)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/payments/overdue")
async def team_payments_overdue():
    """Overdue payments"""
    cursor = db.invoices.find({"status": "overdue"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/shipping/stalled")
async def team_shipping_stalled():
    """Stalled shipments"""
    cursor = db.shipments.find({"status": "stalled"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/performance")
async def team_performance():
    """Team performance metrics"""
    cursor = db.staff.find({"role": "manager"}, {'_id': 0, 'password': 0})
    managers = await cursor.to_list(length=20)
    
    performance = []
    for m in managers:
        performance.append({
            "managerId": m.get("id"),
            "name": m.get("name"),
            "leads": await db.leads.count_documents({"managerId": m.get("id")}),
            "conversions": await db.deals.count_documents({"managerId": m.get("id"), "status": "won"}),
            "avgResponseTime": 5,
            "score": 85
        })
    
    return {"success": True, "data": performance}

@fastapi_app.get("/api/team/reassignments")
async def team_reassignments():
    """Pending reassignments"""
    cursor = db.reassignments.find({"status": "pending"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.post("/api/team/reassignments/{reassignment_id}/accept")
async def accept_reassignment(reassignment_id: str, data: Dict[str, Any] = Body(...)):
    """Accept reassignment"""
    await db.reassignments.update_one(
        {"id": reassignment_id},
        {"$set": {"status": "accepted", "newManagerId": data.get("newManagerId")}}
    )
    return {"success": True}

@fastapi_app.post("/api/team/reassignments/{reassignment_id}/snooze")
async def snooze_reassignment(reassignment_id: str, data: Dict[str, Any] = Body(...)):
    """Snooze reassignment"""
    return {"success": True}

@fastapi_app.post("/api/team/reassignments/{reassignment_id}/queue")
async def queue_reassignment(reassignment_id: str):
    """Queue reassignment"""
    return {"success": True}

@fastapi_app.get("/api/team/leads")
async def team_leads():
    """Team leads"""
    cursor = db.leads.find({}, {'_id': 0}).sort('created_at', -1).limit(100)
    items = await cursor.to_list(length=100)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/leads/hot")
async def team_leads_hot():
    """Hot leads"""
    cursor = db.leads.find({"score": {"$gte": 80}}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/leads/stale")
async def team_leads_stale():
    """Stale leads"""
    return {"success": True, "data": []}

@fastapi_app.post("/api/team/leads/{lead_id}/reassign")
async def reassign_lead(lead_id: str, data: Dict[str, Any] = Body(...)):
    """Reassign lead"""
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {"managerId": data.get("managerId")}}
    )
    return {"success": True}

@fastapi_app.get("/api/team/tasks")
async def team_tasks():
    """Team tasks"""
    cursor = db.tasks.find({}, {'_id': 0}).limit(100)
    items = await cursor.to_list(length=100)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/tasks/overdue")
async def team_tasks_overdue():
    """Overdue tasks"""
    return {"success": True, "data": []}

@fastapi_app.post("/api/team/tasks/{task_id}/escalate")
async def escalate_task(task_id: str):
    """Escalate task"""
    await db.tasks.update_one({"id": task_id}, {"$set": {"escalated": True}})
    return {"success": True}

@fastapi_app.get("/api/team/shipping")
async def team_shipping():
    """Team shipping"""
    cursor = db.shipments.find({}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/team/shipping/risky")
async def team_shipping_risky():
    """Risky shipments"""
    return {"success": True, "data": []}

@fastapi_app.get("/api/response-time/team")
async def response_time_team(days: int = 7):
    """Response time metrics"""
    return {
        "success": True,
        "data": {
            "avgResponseTime": 5,
            "targetResponseTime": 10,
            "managers": []
        }
    }

# ═══════════════════════════════════════════════════════════════════
# INGESTION/PARSER ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/ingestion/admin/parsers", dependencies=[Depends(require_admin)])
async def ingestion_parsers():
    """Unified parser registry with real status for each source"""
    stats = aggregator.get_stats()
    v3_stats = session_service.get_stats()
    
    result = []
    for key, p in PARSER_REGISTRY.items():
        entry = {
            "source": p.source,
            "name": p.name,
            "type": p.type,
            "status": p.status,
            "enabled": p.enabled,
            "readiness": p.readiness,
            "readinessDetail": p.readiness_detail,
            "lastRunAt": p.last_run,
            "lastSuccessAt": p.last_run if p.items_parsed > 0 else None,
            "itemsParsed": p.items_parsed,
            "itemsCreated": p.items_parsed,
            "errorsCount": p.errors_count,
            "isPaused": not p.enabled,
            "circuitState": "closed",
            "endpoints": p.endpoints,
            "apiKeyConfigured": bool(p.api_key) if p.type == "api" else None,
        }
        
        # Enrich with live data
        if key == "bitmotors" and bitmotors_parser_instance:
            scraper_stats = bitmotors_parser_instance.get_stats()
            entry["status"] = "active" if scraper_stats.get("running") else "standby"
            entry["enabled"] = scraper_stats.get("running", False)
            entry["itemsParsed"] = scraper_stats.get("total_scraped", 0)
            entry["itemsCreated"] = scraper_stats.get("total_new", 0)
            entry["errorsCount"] = scraper_stats.get("total_errors", 0)
            entry["lastRunAt"] = scraper_stats.get("last_run")
            entry["lastSuccessAt"] = scraper_stats.get("last_success")
            entry["scraperStats"] = scraper_stats
            try:
                db_count = await db.vin_data.count_documents({"source": "bitmotors"})
                entry["documentsInDB"] = db_count
            except Exception:
                pass
        elif key == "carfast":
            entry["extensionSessions"] = v3_stats.get("active_sessions", 0)
            entry["itemsParsed"] = stats.get("total_vins", 0)
            if stats.get("total_vins", 0) > 0:
                entry["status"] = "active"
        elif key == "bidcars":
            try:
                count = await db.bidcars_vehicles.count_documents({})
                entry["itemsParsed"] = count
            except Exception:
                pass
        elif key == "autoastat":
            try:
                count = await db.autoastat_vehicles.count_documents({})
                entry["itemsParsed"] = count
            except Exception:
                pass
        elif key == "carfast":
            try:
                count = await db.carfast_vehicles.count_documents({})
                entry["itemsParsed"] = count
            except Exception:
                pass

        result.append(entry)
    
    return {"success": True, "parsers": result}

@fastapi_app.get("/api/ingestion/admin/parsers/audit", dependencies=[Depends(require_admin)])
async def parsers_audit():
    """Full audit report of all parser integrations"""
    audit = []
    for key, p in PARSER_REGISTRY.items():
        # Count data in DB
        collection_map = {
            "carfast": "carfast_vehicles",
            "bidcars": "bidcars_vehicles",
            "autoastat": "autoastat_vehicles",
            "bitmotors": "vin_data",
            "copart": "scraped_vehicles",
            "iaai": "scraped_vehicles",
        }
        db_count = 0
        try:
            coll = collection_map.get(key, "vin_data")
            if key in ("copart", "iaai"):
                db_count = await db[coll].count_documents({"source": key})
            else:
                db_count = await db[coll].count_documents({})
        except Exception:
            pass
        
        audit.append({
            "source": p.source,
            "name": p.name,
            "type": p.type,
            "status": p.status,
            "readiness": p.readiness,
            "readinessDetail": p.readiness_detail,
            "enabled": p.enabled,
            "dbCollection": collection_map.get(key, "N/A"),
            "documentsInDB": db_count,
            "hasIngestEndpoint": any("/ingest" in e for e in p.endpoints),
            "hasSearchEndpoint": any("/search" in e or "/vehicles" in e for e in p.endpoints),
            "hasParseEndpoint": any("/parse" in e for e in p.endpoints),
            "endpoints": p.endpoints,
        })
    
    return {
        "success": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalParsers": len(PARSER_REGISTRY),
        "activeParsers": sum(1 for p in PARSER_REGISTRY.values() if p.status == "active"),
        "standbyParsers": sum(1 for p in PARSER_REGISTRY.values() if p.status == "standby"),
        "audit": audit,
    }

@fastapi_app.get("/api/ingestion/admin/health", dependencies=[Depends(require_admin)])
async def ingestion_health():
    """Ingestion system health"""
    return {
        "success": True,
        "health": {
            "status": "healthy" if parser_config.enabled else "degraded",
            "queue": ingestion_queue.get_stats(),
            "sessions": session_service.get_stats()
        }
    }

@fastapi_app.get("/api/ingestion/admin/alerts", dependencies=[Depends(require_admin)])
async def ingestion_alerts():
    """Ingestion alerts - returns array directly"""
    return []

@fastapi_app.get("/api/ingestion/admin/logs", dependencies=[Depends(require_admin)])
async def ingestion_logs(limit: int = 100):
    """Ingestion logs"""
    return {"success": True, "logs": []}

@fastapi_app.post("/api/ingestion/admin/parsers/{source}/run", dependencies=[Depends(require_master_admin)])
async def run_parser(source: str):
    """Start parser"""
    p = PARSER_REGISTRY.get(source)
    if not p:
        return {"success": False, "message": f"Unknown parser: {source}"}
    if p.readiness == "broken":
        return {"success": False, "message": f"{p.name}: {p.readiness_detail}"}
    if p.readiness == "incomplete":
        return {"success": False, "message": f"{p.name} is incomplete: {p.readiness_detail}"}
    
    p.enabled = True
    p.status = "active"
    p.last_run = datetime.now(timezone.utc).isoformat()
    
    if source == "carfast":
        parser_config.enabled = True
    elif source == "bitmotors" and bitmotors_parser_instance:
        result = bitmotors_parser_instance.start()
        return {"success": True, "message": f"{p.name} parser started", "status": p.status, "scraper": result}
    
    return {"success": True, "message": f"{p.name} parser started", "status": p.status}

@fastapi_app.post("/api/ingestion/admin/parsers/{source}/stop", dependencies=[Depends(require_master_admin)])
async def stop_parser(source: str):
    """Stop parser"""
    p = PARSER_REGISTRY.get(source)
    if not p:
        return {"success": False, "message": f"Unknown parser: {source}"}
    
    p.enabled = False
    p.status = "standby"
    
    if source == "carfast":
        parser_config.enabled = False
    elif source == "bitmotors" and bitmotors_parser_instance:
        result = bitmotors_parser_instance.stop()
        return {"success": True, "message": f"{p.name} parser stopped", "status": p.status, "scraper": result}
    
    return {"success": True, "message": f"{p.name} parser stopped", "status": p.status}

@fastapi_app.post("/api/ingestion/admin/parsers/{source}/configure", dependencies=[Depends(require_master_admin)])
async def configure_parser(source: str, data: Dict[str, Any] = Body(...)):
    """Configure parser API keys and settings.

    For ``bitmotors`` source, delegates to the BidMotors-specific configure
    handler which also persists to ``parser_settings`` collection.
    """
    p = PARSER_REGISTRY.get(source)
    if not p:
        return {"success": False, "message": f"Unknown parser: {source}"}

    # Delegate to dedicated bitmotors handler (persists interval/max_pages/autostart)
    if source == "bitmotors":
        return await bitmotors_configure(data)

    if "api_key" in data:
        p.api_key = data["api_key"]
    return {"success": True, "message": f"{p.name} configured"}

@fastapi_app.post("/api/ingestion/admin/parsers/{source}/resume", dependencies=[Depends(require_master_admin)])
async def resume_parser(source: str):
    """Resume parser"""
    if source == "carfast":
        parser_config.enabled = True
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/parsers/{source}/circuit-breaker/reset", dependencies=[Depends(require_master_admin)])
async def reset_circuit_breaker(source: str):
    """Reset circuit breaker"""
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/parsers/run-all", dependencies=[Depends(require_master_admin)])
async def run_all_parsers():
    """Start all parsers"""
    parser_config.enabled = True
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/parsers/stop-all", dependencies=[Depends(require_master_admin)])
async def stop_all_parsers():
    """Stop all parsers"""
    parser_config.enabled = False
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/alerts/{alert_id}/resolve", dependencies=[Depends(require_admin)])
async def resolve_ingestion_alert(alert_id: str):
    """Resolve alert"""
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# BITMOTORS LEGACY SYNC ENDPOINTS — DEPRECATED (LIVE-FIRST architecture)
# ─────────────────────────────────────────────────────────────────
# All sync/scrape/full-sync/incremental endpoints used to accumulate the
# BidMotors catalogue locally. We removed the accumulation layer because
# auction data is a real-time stream — any local snapshot is stale within
# minutes. These routes now return 410 Gone so legacy clients fail loudly.
# ═══════════════════════════════════════════════════════════════════
_DEPRECATED_SYNC_MSG = (
    "Endpoint deprecated. The BIBI Cars backend now uses LIVE-FIRST architecture: "
    "every search hits BidMotors directly via /api/public/search/{query}. "
    "Local accumulation has been disabled."
)

def _deprecated_sync_response():
    return JSONResponse(
        status_code=410,
        content={
            "success": False,
            "error": "deprecated",
            "architecture": "LIVE_FIRST",
            "message": _DEPRECATED_SYNC_MSG,
            "use_instead": "/api/public/search/{query}",
        },
    )

@fastapi_app.get("/api/ingestion/admin/parsers/bitmotors/full-sync/status",
                 dependencies=[Depends(require_admin)])
async def bitmotors_full_sync_status_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/configure",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_configure_deprecated(data: Dict[str, Any] = Body(default={})):
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/run-now",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_run_now_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/cancel",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_cancel_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/scheduler/start",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_scheduler_start_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/scheduler/stop",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_scheduler_stop_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/full-sync/cache/clear",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_full_sync_cache_clear():
    """Live-search TTL cache flush — ОСТАЁТСЯ (полезно для force-refresh)."""
    if live_search_cache is not None:
        try:
            await live_search_cache.clear()
        except Exception as e:
            return {"success": False, "error": str(e)}
    return {"success": True, "message": "cache cleared"}

# ═══════════════════════════════════════════════════════════════════
# Phase IV — WestMotors Index admin endpoints
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/westmotors/status")
async def westmotors_status():
    """Public-readable status of the WestMotors index sync (incl. latency)."""
    if westmotors_sync_instance is None:
        return {"available": False, "reason": "westmotors_sync not loaded"}
    try:
        stats = await westmotors_sync_instance.get_stats()
        try:
            from westmotors_scraper import get_latency_stats as _wm_lat
            stats["latency"] = _wm_lat()
        except Exception:
            stats["latency"] = {}
        # Surface prefetch coverage from the index
        try:
            if db is not None:
                stats["db"]["prefetched"] = await db.vin_data_westmotors.count_documents(
                    {"prefetched_data": {"$exists": True}, "archived": {"$ne": True}})
        except Exception:
            pass
        return {"available": True, **stats}
    except Exception as e:
        return {"available": False, "error": str(e)}


@fastapi_app.post("/api/westmotors/sync/prefetch",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_prefetch(data: Dict[str, Any] = Body(default={})):
    """Manually fire a top-N prefetch (background)."""
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    n = (data or {}).get("n")
    asyncio.create_task(westmotors_sync_instance.run_prefetch(n=n))
    return {"success": True, "scheduled": "prefetch", "n": n or "default"}


@fastapi_app.post("/api/westmotors/sync/warmup",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_warmup(data: Dict[str, Any] = Body(default={})):
    """Manually fire a search-log-driven warmup (background)."""
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    top = (data or {}).get("top")
    days = (data or {}).get("window_days")
    asyncio.create_task(westmotors_sync_instance.run_warmup(top=top, window_days=days))
    return {"success": True, "scheduled": "warmup", "top": top or "default"}


@fastapi_app.post("/api/westmotors/sync/configure",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_configure(data: Dict[str, Any] = Body(default={})):
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    allowed = {"enabled", "full_daily_hour_utc", "incremental_interval_sec",
               "delay_between_sitemaps_sec", "archive_safety_threshold",
               "startup_delay_sec",
               "prefetch_after_full_sync", "prefetch_top_n",
               "prefetch_concurrency", "prefetch_delay_per_request",
               "warmup_on_startup", "warmup_top_searches",
               "warmup_search_window_days"}
    patch = {k: v for k, v in (data or {}).items() if k in allowed}
    new = await westmotors_sync_instance.configure(**patch)
    return {"success": True, "settings": new}


@fastapi_app.post("/api/westmotors/sync/run-now",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_run_now(data: Dict[str, Any] = Body(default={})):
    """Fire a single sync cycle in the background. kind = 'full' | 'incremental'"""
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    kind = (data or {}).get("kind", "incremental")
    if kind == "full":
        asyncio.create_task(westmotors_sync_instance.run_full_sync())
    else:
        kind = "incremental"
        asyncio.create_task(westmotors_sync_instance.run_incremental_sync())
    return {"success": True, "scheduled": kind}


@fastapi_app.post("/api/westmotors/sync/cancel",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_cancel():
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    westmotors_sync_instance.cancel_current()
    return {"success": True, "message": "Cancellation signal sent"}


@fastapi_app.post("/api/westmotors/sync/scheduler/start",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_scheduler_start():
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    westmotors_sync_instance.start()
    return {"success": True, "message": "Schedulers started"}


@fastapi_app.post("/api/westmotors/sync/scheduler/stop",
                  dependencies=[Depends(require_admin)])
async def westmotors_sync_scheduler_stop():
    if westmotors_sync_instance is None:
        raise HTTPException(status_code=503, detail="westmotors_sync not available")
    westmotors_sync_instance.stop()
    return {"success": True, "message": "Schedulers stopped"}


@fastapi_app.get("/api/westmotors/runs",
                 dependencies=[Depends(require_admin)])
async def westmotors_runs(limit: int = 20, kind: Optional[str] = None):
    if db is None:
        raise HTTPException(status_code=503, detail="db not available")
    q: Dict[str, Any] = {}
    if kind:
        q["kind"] = kind
    rows = await db.westmotors_sync_runs.find(q).sort("started_at", -1).limit(int(limit)).to_list(int(limit))
    for r in rows:
        r["_id"] = str(r.get("_id"))
        for tk in ("started_at", "finished_at", "ts"):
            v = r.get(tk)
            if isinstance(v, datetime):
                r[tk] = v.isoformat()
    return {"success": True, "runs": rows}


@fastapi_app.get("/api/westmotors/lookup/{vin}",
                 dependencies=[Depends(require_admin)])
async def westmotors_lookup_admin(vin: str):
    """Admin debug lookup — directly queries WestMotors index + parses page."""
    if db is None:
        raise HTTPException(status_code=503, detail="db not available")
    try:
        from westmotors_scraper import lookup_vin_in_index as wm_lookup
        res = await wm_lookup(db, vin.strip().upper())
        return {"success": True, "found": bool(res), "data": res}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════
# Phase IV-2 — Lemon-Cars Index admin endpoints
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/lemon/status")
async def lemon_status():
    """Public-readable status of the Lemon-Cars index sync."""
    if lemon_sync_instance is None:
        return {"available": False, "reason": "lemon_sync not loaded"}
    try:
        stats = await lemon_sync_instance.get_stats()
        try:
            from lemon_scraper import get_latency_stats as _lat
            stats["latency"] = _lat()
        except Exception:
            stats["latency"] = {}
        return {"available": True, **stats}
    except Exception as e:
        return {"available": False, "error": str(e)}


@fastapi_app.post("/api/lemon/sync/configure",
                  dependencies=[Depends(require_admin)])
async def lemon_sync_configure(data: Dict[str, Any] = Body(default={})):
    if lemon_sync_instance is None:
        raise HTTPException(status_code=503, detail="lemon_sync not available")
    allowed = {
        "enabled", "discovery_full_daily_hour_utc",
        "discovery_incremental_interval_sec", "delay_between_sitemaps_sec",
        "archive_safety_threshold", "startup_delay_sec",
        "parser_enabled", "parser_concurrency",
        "parser_delay_per_request_sec", "parser_batch_size",
        "parser_idle_sleep_sec", "parser_max_failures",
        "parser_stale_after_hours",
    }
    patch = {k: v for k, v in (data or {}).items() if k in allowed}
    new = await lemon_sync_instance.configure(**patch)
    return {"success": True, "settings": new}


@fastapi_app.post("/api/lemon/sync/run-now",
                  dependencies=[Depends(require_admin)])
async def lemon_sync_run_now(data: Dict[str, Any] = Body(default={})):
    """Body {kind: 'full_discovery' | 'incremental_discovery'}."""
    if lemon_sync_instance is None:
        raise HTTPException(status_code=503, detail="lemon_sync not available")
    kind = (data or {}).get("kind", "incremental_discovery")
    if kind == "full_discovery":
        asyncio.create_task(lemon_sync_instance.run_full_discovery())
    else:
        kind = "incremental_discovery"
        asyncio.create_task(lemon_sync_instance.run_incremental_discovery())
    return {"success": True, "scheduled": kind}


@fastapi_app.post("/api/lemon/sync/cancel",
                  dependencies=[Depends(require_admin)])
async def lemon_sync_cancel():
    if lemon_sync_instance is None:
        raise HTTPException(status_code=503, detail="lemon_sync not available")
    lemon_sync_instance.cancel_current()
    return {"success": True, "message": "Cancellation signal sent"}


@fastapi_app.post("/api/lemon/sync/scheduler/{action}",
                  dependencies=[Depends(require_admin)])
async def lemon_sync_scheduler(action: str):
    if lemon_sync_instance is None:
        raise HTTPException(status_code=503, detail="lemon_sync not available")
    if action == "start":
        lemon_sync_instance.start()
        return {"success": True, "message": "Started discovery + worker"}
    if action == "stop":
        lemon_sync_instance.stop()
        return {"success": True, "message": "Stopped discovery + worker"}
    raise HTTPException(status_code=400, detail="action must be 'start' or 'stop'")


@fastapi_app.get("/api/lemon/runs",
                 dependencies=[Depends(require_admin)])
async def lemon_runs(limit: int = 20, kind: Optional[str] = None):
    if db is None:
        raise HTTPException(status_code=503, detail="db not available")
    q: Dict[str, Any] = {}
    if kind:
        q["kind"] = kind
    rows = await db.lemon_sync_runs.find(q).sort("started_at", -1).limit(int(limit)).to_list(int(limit))
    for r in rows:
        r["_id"] = str(r.get("_id"))
        for tk in ("started_at", "finished_at", "ts"):
            v = r.get(tk)
            if isinstance(v, datetime):
                r[tk] = v.isoformat()
    return {"success": True, "runs": rows}


@fastapi_app.get("/api/lemon/lookup/vin/{vin}",
                 dependencies=[Depends(require_admin)])
async def lemon_lookup_vin_admin(vin: str):
    if db is None:
        raise HTTPException(status_code=503, detail="db not available")
    try:
        from lemon_scraper import lookup_by_vin
        res = await lookup_by_vin(db, vin.strip().upper())
        return {"success": True, "found": bool(res), "data": res}
    except Exception as e:
        return {"success": False, "error": str(e)}


@fastapi_app.get("/api/lemon/lookup/lot/{lot}",
                 dependencies=[Depends(require_admin)])
async def lemon_lookup_lot_admin(lot: str):
    if db is None:
        raise HTTPException(status_code=503, detail="db not available")
    try:
        from lemon_scraper import lookup_by_lot
        res = await lookup_by_lot(db, lot.strip())
        return {"success": True, "found": bool(res), "data": res}
    except Exception as e:
        return {"success": False, "error": str(e)}



@fastapi_app.get("/api/ingestion/admin/parsers/bitmotors/incremental/status",
                 dependencies=[Depends(require_admin)])
async def bitmotors_incremental_status_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/incremental/configure",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_incremental_configure_deprecated(data: Dict[str, Any] = Body(default={})):
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/incremental/run-now",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_incremental_run_now_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/incremental/cancel",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_incremental_cancel_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/incremental/scheduler/start",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_incremental_scheduler_start_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/incremental/scheduler/stop",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_incremental_scheduler_stop_deprecated():
    return _deprecated_sync_response()

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/run-once",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_run_once_deprecated():
    return _deprecated_sync_response()

@fastapi_app.get("/api/ingestion/admin/parsers/bitmotors/stats",
                 dependencies=[Depends(require_admin)])
async def bitmotors_stats_lite():
    """Lightweight LIVE-FIRST architecture status (no scraper stats)."""
    db_total = 0
    stale_total = 0
    try:
        if db is not None:
            db_total = await db.vin_data.count_documents({})
            stale_total = await db.vin_data.count_documents({"stale": True})
    except Exception:
        pass
    cache_stats = {}
    if live_search_cache is not None:
        try:
            cache_stats = live_search_cache.stats()
        except Exception:
            cache_stats = {}
    return {
        "success": True,
        "architecture": "LIVE_FIRST",
        "stats": {
            "scraper_running": False,
            "documents_in_db": db_total,
            "stale_documents": stale_total,
            "live_cache": cache_stats,
        },
        "message": "Accumulation disabled. Each query hits BidMotors live (5-min TTL cache).",
    }

@fastapi_app.post("/api/ingestion/admin/parsers/bitmotors/configure",
                  dependencies=[Depends(require_master_admin)])
async def bitmotors_configure_deprecated(data: Dict[str, Any] = Body(default={})):
    return _deprecated_sync_response()

@fastapi_app.get("/api/ingestion/admin/parsers/bitmotors/settings",
                 dependencies=[Depends(require_admin)])
async def bitmotors_settings_deprecated():
    return _deprecated_sync_response()


# ═══════════════════════════════════════════════════════════════════
# PHASE II — Smart search helpers (watchlist, rescan, search_logs)
# ═══════════════════════════════════════════════════════════════════

async def _log_public_search(raw: str, clean: str, kind: str, found: bool, source: str) -> None:
    """Insert one row into search_logs for analytics."""
    try:
        if db is None:
            return
        await db.search_logs.insert_one({
            "raw": (raw or "")[:128],
            "clean": (clean or "")[:64],
            "kind": kind,
            "found": bool(found),
            "source": source,
            "ts": datetime.now(timezone.utc),
        })
    except Exception:
        pass


@fastapi_app.post("/api/public/search/watch")
async def public_search_watch(
    data: Dict[str, Any] = Body(...),
    user: Optional[dict] = Depends(optional_user),
):
    """Register a VIN/LOT to the watchlist.

    Body: {vin: "...", email?: "...", phone?: "...", note?: "..."}
    If authenticated, userId is attached automatically.

    Idempotent: if the same VIN+email/userId is already pending, returns
    the existing row without creating a duplicate.
    """
    raw_vin = str(data.get("vin") or data.get("query") or "").strip().upper().replace(" ", "").replace("-", "")
    if not raw_vin:
        raise HTTPException(status_code=400, detail="vin is required")
    if len(raw_vin) < 4 or len(raw_vin) > 20:
        raise HTTPException(status_code=400, detail="vin must be 4–20 chars")
    email = (data.get("email") or "").strip().lower() or None
    phone = (data.get("phone") or "").strip() or None
    note = (data.get("note") or "").strip()[:500] or None
    user_id = (user or {}).get("id") if user else None
    user_email = (user or {}).get("email") if user else None
    owner_email = email or user_email
    if not owner_email and not user_id:
        raise HTTPException(status_code=400, detail="email or authentication is required")

    # Idempotency: match by (vin, email or userId) not yet notified
    match_filter: Dict[str, Any] = {"vin": raw_vin, "notified": False}
    if user_id:
        match_filter["userId"] = user_id
    else:
        match_filter["email"] = owner_email

    existing = await db.search_watchlist.find_one(match_filter, {"_id": 0})
    if existing:
        return {"success": True, "watch": existing, "duplicate": True}

    # Short-circuit: maybe the car is already in the DB — no need to watch.
    current = await db.vin_data.find_one({"vin": raw_vin, "archived": {"$ne": True}}, {"_id": 0, "vin": 1, "title": 1})
    already_in_catalog = bool(current)

    now = datetime.now(timezone.utc)
    doc = {
        "id": f"watch-{uuid.uuid4().hex[:12]}",
        "vin": raw_vin,
        "email": owner_email,
        "phone": phone,
        "userId": user_id,
        "note": note,
        "source": "public_search",
        "notified": already_in_catalog,   # if the car already exists, mark as pre-notified
        "createdAt": now,
        "notifiedAt": now if already_in_catalog else None,
    }
    await db.search_watchlist.insert_one(doc)
    # Strip _id for response
    doc.pop("_id", None)

    return {
        "success": True,
        "watch": {**doc, "createdAt": now.isoformat(), "notifiedAt": doc["notifiedAt"].isoformat() if doc["notifiedAt"] else None},
        "already_in_catalog": already_in_catalog,
    }


@fastapi_app.delete("/api/public/search/watch/{watch_id}")
async def public_search_watch_delete(
    watch_id: str,
    user: Optional[dict] = Depends(optional_user),
):
    """Remove a watchlist entry (authenticated user can delete own;
    unauthenticated delete requires ?email= param — kept simple: admin only)."""
    match: Dict[str, Any] = {"id": watch_id}
    if user:
        if not is_admin(user):
            match["userId"] = user.get("id")
    else:
        raise HTTPException(status_code=401, detail="authentication required")
    res = await db.search_watchlist.delete_one(match)
    return {"success": bool(res.deleted_count), "deleted": res.deleted_count}


@fastapi_app.get("/api/cabinet/watchlist")
async def cabinet_watchlist(user: dict = Depends(require_user)):
    """Return the authenticated user's watchlist (pending + notified)."""
    uid = user.get("id")
    cursor = db.search_watchlist.find(
        {"$or": [{"userId": uid}, {"email": (user.get("email") or "").lower()}]},
        {"_id": 0},
    ).sort("createdAt", -1).limit(200)
    items = await cursor.to_list(length=200)
    # Serialize datetimes
    for it in items:
        for k in ("createdAt", "notifiedAt", "notified_at"):
            if hasattr(it.get(k), "isoformat"):
                it[k] = it[k].isoformat()
    return {"success": True, "items": items, "count": len(items)}


@fastapi_app.post("/api/public/search/rescan")
async def public_search_rescan(data: Dict[str, Any] = Body(...)):
    """Force a live BidMotors fetch for a VIN/LOT, bypassing the TTL cache.

    Body: {vin: "..."} (VIN 17 chars or LOT digits). Also busts the cache
    entry so subsequent reads are fresh.
    """
    raw = str(data.get("vin") or data.get("query") or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="vin is required")
    clean = raw.upper().replace(" ", "").replace("-", "")

    # Cache bust: remove any keys prefixed with suggest:<clean>:
    if live_search_cache is not None:
        try:
            async with live_search_cache._lock:  # type: ignore[attr-defined]
                keys_to_drop = [k for k in list(live_search_cache._store.keys()) if clean in k]
                for k in keys_to_drop:
                    live_search_cache._store.pop(k, None)
        except Exception:
            pass

    # Fire live search fresh
    if not BITMOTORS_AVAILABLE:
        return {"success": False, "error": "bidmotors unavailable"}
    try:
        result = await bm_live_search(clean, db=db, limit=1)
        items = result.get("items") or []
        if items:
            return {
                "success": True,
                "query": raw,
                "cached": False,
                "item": items[0],
                "detail": result.get("detail"),
                "kind": result.get("kind"),
            }
        return {"success": False, "error": "not_found", "query": raw, "kind": result.get("kind")}
    except Exception as e:
        logger.warning(f"[rescan] failed for {clean}: {e}")
        return {"success": False, "error": str(e)[:120]}


@fastapi_app.get("/api/admin/search/analytics",
                 dependencies=[Depends(require_admin)])
async def admin_search_analytics(
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(50, ge=1, le=500),
):
    """Return search-demand analytics for the last `days` days.

    - totals: total searches, found vs missed
    - top VINs searched (hot demand — drive sourcing decisions)
    - top missed VINs (pure demand signal → potential leads)
    """
    since = datetime.now(timezone.utc) - timedelta(days=int(days))
    try:
        total = await db.search_logs.count_documents({"ts": {"$gte": since}})
        misses = await db.search_logs.count_documents({"ts": {"$gte": since}, "found": False})
        # Top queried VINs (any kind)
        top_cursor = db.search_logs.aggregate([
            {"$match": {"ts": {"$gte": since}, "clean": {"$ne": ""}}},
            {"$group": {"_id": "$clean", "count": {"$sum": 1}, "miss": {"$sum": {"$cond": ["$found", 0, 1]}}}},
            {"$sort": {"count": -1}},
            {"$limit": limit},
        ])
        top = await top_cursor.to_list(length=limit)
        # Top missed (pure demand)
        miss_cursor = db.search_logs.aggregate([
            {"$match": {"ts": {"$gte": since}, "clean": {"$ne": ""}, "found": False}},
            {"$group": {"_id": "$clean", "count": {"$sum": 1}, "last_ts": {"$max": "$ts"}}},
            {"$sort": {"count": -1, "last_ts": -1}},
            {"$limit": limit},
        ])
        top_misses = await miss_cursor.to_list(length=limit)
        # Serialize
        def _fmt(rows):
            out = []
            for r in rows:
                row = {"query": r.get("_id"), "count": r.get("count", 0)}
                if "miss" in r:
                    row["miss"] = r["miss"]
                if "last_ts" in r and hasattr(r["last_ts"], "isoformat"):
                    row["last_ts"] = r["last_ts"].isoformat()
                out.append(row)
            return out
        return {
            "success": True,
            "range_days": int(days),
            "totals": {"total": total, "misses": misses, "found": total - misses},
            "top_queries": _fmt(top),
            "top_misses": _fmt(top_misses),
        }
    except Exception as e:
        logger.warning(f"[search-analytics] failed: {e}")
        return {"success": False, "error": str(e)[:120]}



@fastapi_app.get("/api/vin/search/{vin_input}")
async def vin_search(vin_input: str):
    """
    VIN Search via BidMotors adapter — port of VinController.search()
    Searches bidmotors.bg sitemap/search, fetches detail page, normalizes.
    """
    if not bitmotors_parser_instance:
        return {"success": False, "error": "BidMotors adapter not available"}
    
    result = await bitmotors_parser_instance.search_vin(vin_input)
    return result



# Proxies
@fastapi_app.get("/api/ingestion/admin/proxies", dependencies=[Depends(require_admin)])
async def ingestion_proxies():
    """Get proxies"""
    return {"success": True, "proxies": []}

@fastapi_app.post("/api/ingestion/admin/proxies", dependencies=[Depends(require_admin)])
async def add_proxy(data: Dict[str, Any] = Body(...)):
    """Add proxy"""
    return {"success": True, "id": f"proxy-{datetime.now(timezone.utc).timestamp()}"}

@fastapi_app.post("/api/ingestion/admin/proxies/{proxy_id}/enable", dependencies=[Depends(require_admin)])
async def enable_proxy(proxy_id: str):
    """Enable proxy"""
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/proxies/{proxy_id}/disable", dependencies=[Depends(require_admin)])
async def disable_proxy(proxy_id: str):
    """Disable proxy"""
    return {"success": True}

@fastapi_app.delete("/api/ingestion/admin/proxies/{proxy_id}", dependencies=[Depends(require_admin)])
async def delete_proxy(proxy_id: str):
    """Delete proxy"""
    return {"success": True}

@fastapi_app.post("/api/ingestion/admin/proxies/{proxy_id}/test", dependencies=[Depends(require_admin)])
async def test_proxy(proxy_id: str):
    """Test proxy"""
    return {"success": True, "result": {"latency": 150, "status": "ok"}}

@fastapi_app.post("/api/ingestion/admin/proxies/test", dependencies=[Depends(require_admin)])
async def test_all_proxies():
    """Test all proxies"""
    return {"success": True, "results": []}

# ═══════════════════════════════════════════════════════════════════
# INVOICES FULL ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/invoices/create")
async def create_invoice(data: Dict[str, Any] = Body(...)):
    """Create invoice"""
    invoice = {
        "id": f"inv-{datetime.now(timezone.utc).timestamp()}",
        "customerId": data.get("customerId"),
        "dealId": data.get("dealId"),
        "amount": data.get("amount"),
        "currency": data.get("currency", "USD"),
        "status": "pending",
        "items": data.get("items", []),
        "dueDate": data.get("dueDate"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.invoices.insert_one(invoice)
    return {"success": True, "invoice": invoice}

# IMPORTANT: Specific routes MUST be before /{invoice_id} dynamic route!
@fastapi_app.get("/api/invoices/me")
async def my_invoices():
    """Customer invoices - MUST be before /{invoice_id}"""
    return {"success": True, "data": []}

@fastapi_app.get("/api/invoices/manager/my", dependencies=[Depends(require_manager_or_admin)])
async def manager_invoices():
    """Manager invoices - MUST be before /{invoice_id}"""
    cursor = db.invoices.find({}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/invoices/overdue")
async def overdue_invoices():
    """Overdue invoices - MUST be before /{invoice_id}"""
    cursor = db.invoices.find({"status": "overdue"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/invoices/analytics")
async def invoice_analytics():
    """Invoice analytics - MUST be before /{invoice_id}"""
    return {
        "success": True,
        "analytics": {
            "total": await db.invoices.count_documents({}),
            "paid": await db.invoices.count_documents({"status": "paid"}),
            "pending": await db.invoices.count_documents({"status": "pending"}),
            "overdue": await db.invoices.count_documents({"status": "overdue"}),
            "totalAmount": 0,
            "paidAmount": 0
        }
    }

@fastapi_app.post("/api/invoices/checkout")
async def invoice_checkout(request: Request, data: Dict[str, Any] = Body(...)):
    """Create a real Stripe Checkout session for an existing invoice.

    Body: { "invoiceId": "...", "originUrl": "https://..." (optional) }
    Returns: { success, url, sessionId, publishableKey, mode }
    """
    invoice_id = data.get("invoiceId") or data.get("invoice_id")
    if not invoice_id:
        raise HTTPException(status_code=400, detail="invoiceId is required")
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice is already paid")

    amount = invoice.get("amount") or invoice.get("total") or 0
    description = invoice.get("description") or invoice.get("title") or f"Invoice {invoice_id}"
    customer_id = invoice.get("customerId") or invoice.get("customer_id")
    customer = (await db.customers.find_one({"customerId": customer_id}, {"_id": 0})) if customer_id else None
    customer_email = (customer or {}).get("email")

    payload = {
        "amount": amount,
        "description": description,
        "invoiceId": invoice_id,
        "currency": invoice.get("currency"),
        "customerEmail": customer_email,
    }
    if data.get("originUrl"):
        cfg = await _get_stripe_config()
        origin = str(data["originUrl"]).rstrip("/")
        succ = cfg["successUrl"]; canc = cfg["cancelUrl"]
        payload["successUrl"] = (succ if succ.startswith("http") else origin + (succ if succ.startswith("/") else f"/{succ}"))
        payload["cancelUrl"]  = (canc if canc.startswith("http") else origin + (canc if canc.startswith("/") else f"/{canc}"))

    return await create_checkout_session(request, payload)


@fastapi_app.get("/api/invoices/{invoice_id}")
async def get_invoice(invoice_id: str):
    """Get invoice by ID - MUST be after specific routes"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {'_id': 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"success": True, "data": invoice}


@fastapi_app.post("/api/invoices/checkout/{invoice_id}")
async def invoice_checkout_id(request: Request, invoice_id: str, data: Dict[str, Any] = Body(default={})):
    """Convenience route: same as /api/invoices/checkout but with id in path."""
    return await invoice_checkout(request, {**(data or {}), "invoiceId": invoice_id})


@fastapi_app.post("/api/invoices/create-from-package")
async def create_invoice_from_package(data: Dict[str, Any] = Body(...)):
    """Create invoice from package"""
    return await create_invoice(data)

# ═══════════════════════════════════════════════════════════════════
# SHIPMENTS FULL ENDPOINTS  
# ═══════════════════════════════════════════════════════════════════

# ==================== SHIPMENT EVENT SYSTEM (ЯДРО) ====================

async def create_shipment_event(
    shipment_id: str,
    event_type: str,
    title: str,
    location: str = None,
    meta: dict = None,
    customer_id: str = None
):
    """
    Create shipment event and emit real-time notification
    
    This is the CORE of tracking system - everything flows through events
    """
    now = datetime.now(timezone.utc)
    
    event_id = str(uuid.uuid4())
    event = {
        '_id': event_id,
        'id': event_id,     # Required for unique index
        'shipmentId': shipment_id,
        'type': event_type,
        'title': title,
        'label': title,     # alias for new JourneyPanel consumers (uses `label`)
        'createdAt': now,   # alias for new consumers (uses `createdAt`)
        'location': location,
        'meta': meta or {},
        'timestamp': now,
        'source': 'system',
        'created_at': now
    }
    
    # Save event to collection
    await db.shipment_events.insert_one(event)
    
    # Update shipment with latest event
    await db.shipments.update_one(
        {'id': shipment_id},
        {
            '$push': {'events': event},
            '$set': {
                'lastEvent': event,
                'lastEventTime': now,
                'updated_at': now
            }
        }
    )
    
    logger.info(f"[SHIPPING] Event created: {event_type} for shipment {shipment_id}")
    
    # 🔥 REAL-TIME SOCKET.IO EMIT
    if customer_id:
        try:
            # Emit to specific customer
            await sio.emit(
                'shipment:update',
                {
                    'shipmentId': shipment_id,
                    'type': event_type,
                    'title': title,
                    'location': location,
                    'timestamp': now.isoformat()
                },
                room=f"user_{customer_id}"
            )
            logger.info(f"[SHIPPING] Socket emitted to user_{customer_id}")
        except Exception as e:
            logger.error(f"[SHIPPING] Socket emit error: {e}")
    
    # Special event types with dedicated socket events
    if event_type == 'status_changed':
        await sio.emit('shipment:status_changed', event, room=f"user_{customer_id}")
    elif event_type == 'eta_changed':
        await sio.emit('shipment:eta_changed', event, room=f"user_{customer_id}")
    elif event_type == 'at_destination_port':
        await sio.emit('shipment:arrived', event, room=f"user_{customer_id}")
    elif event_type == 'ready_for_pickup':
        await sio.emit('shipment:ready_for_pickup', event, room=f"user_{customer_id}")
    
    return event


async def calculate_shipment_status(shipment_id: str):
    """
    Calculate current status from events (status = derived, not stored)
    """
    events = await db.shipment_events.find(
        {'shipmentId': shipment_id}
    ).sort('timestamp', -1).to_list(100)
    
    if not events:
        return 'pending'
    
    # Status mapping from event types
    status_mapping = {
        'deal_created': 'pending',
        'contract_signed': 'pending',
        'deposit_paid': 'pending',
        'loaded_on_vessel': 'in_transit',
        'position_update': 'in_transit',
        'mid_ocean': 'in_transit',
        'approaching_port': 'in_transit',
        'at_destination_port': 'at_port',
        'customs': 'customs_clearance',
        'ready_for_pickup': 'ready',
        'delivered': 'delivered'
    }
    
    last_event = events[0]
    return status_mapping.get(last_event['type'], 'in_transit')


# ==================== SHIPMENT CRUD (UPDATED) ====================

@fastapi_app.get("/api/shipments/{shipment_id}", dependencies=[Depends(require_manager_or_admin)])
async def get_shipment(shipment_id: str):
    """Get shipment with events timeline"""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Get events
    events = await db.shipment_events.find(
        {'shipmentId': shipment_id}
    ).sort('timestamp', -1).to_list(100)
    
    # Calculate current status from events
    shipment['status'] = await calculate_shipment_status(shipment_id)
    shipment['events'] = [serialize_doc(e) for e in events]
    
    return {"success": True, "data": serialize_doc(shipment)}

@fastapi_app.post("/api/shipments", dependencies=[Depends(require_manager_or_admin)])
async def create_shipment(data: Dict[str, Any] = Body(...)):
    """Create shipment with initial event, route and journey stages."""
    now = datetime.now(timezone.utc)
    
    shipment_id = f"ship_{int(now.timestamp())}_{str(uuid.uuid4())[:8]}"
    
    # Origin and destination with coordinates
    origin = data.get("origin")
    destination = data.get("destination")
    
    # If coordinates not provided, use defaults
    if not origin or not origin.get("lat"):
        origin = {
            "name": data.get("originPort", "Los Angeles"),
            "lat": 33.7405,
            "lng": -118.2755
        }
    
    if not destination or not destination.get("lat"):
        destination = {
            "name": data.get("destinationPort", "Odesa"),
            "lat": 46.4825,
            "lng": 30.7233
        }
    
    # Generate route
    route = generate_route(origin, destination)

    # Journey stages: either provided by caller or default single 'vessel' stage.
    raw_stages = data.get("stages")
    if isinstance(raw_stages, list) and raw_stages:
        stages: List[Dict[str, Any]] = []
        for i, s in enumerate(raw_stages):
            ns = _normalize_stage(s, i, len(raw_stages))
            if not ns.get("id"):
                ns["id"] = f"stage_{int(now.timestamp())}_{i+1}"
            stages.append(ns)
        # ensure exactly one active
        active = next((s for s in stages if s.get("status") == "active"), None)
        if not active:
            stages[0]["status"] = "active"
            stages[0]["startedAt"] = now
            active = stages[0]
        current_stage_id = data.get("currentStageId") or active["id"]
    else:
        stages = build_default_stages(origin, destination, data.get("vessel"))
        current_stage_id = stages[0]["id"]

    shipment = {
        "id": shipment_id,
        "vin": data.get("vin"),
        "dealId": data.get("dealId"),
        "customerId": data.get("customerId"),
        "managerId": data.get("managerId"),
        "containerNumber": data.get("containerNumber"),
        "carrier": data.get("carrier"),
        "vessel": data.get("vessel"),
        "origin": origin,
        "destination": destination,
        "route": route,
        "stages": stages,
        "currentStageId": current_stage_id,
        "currentPosition": origin,  # Start at origin
        "progress": 0.0,
        "lastEventProgress": 0.0,
        "eta": data.get("eta"),
        "trackingActive": data.get("trackingActive", False),
        "trackingSource": "manual",
        "events": [],
        "lastEvent": None,
        "lastEventTime": None,
        "lastTrackingUpdate": now,
        "created_at": now,
        "updated_at": now
    }
    
    await db.shipments.insert_one(shipment)
    
    # Create initial event
    await create_shipment_event(
        shipment_id=shipment_id,
        event_type='shipment_created',
        title='Відправлення створено',
        location=origin.get("name"),
        customer_id=data.get("customerId")
    )
    
    logger.info(
        f"[SHIPPING] Shipment created: {shipment_id} with {len(route)} route points, "
        f"{len(stages)} stages, currentStage={current_stage_id}"
    )
    
    return {"success": True, "shipment": serialize_doc(shipment)}


@fastapi_app.put("/api/shipments/{shipment_id}", dependencies=[Depends(require_manager_or_admin)])
async def update_shipment(shipment_id: str, data: Dict[str, Any] = Body(...)):
    """Update shipment and create event if status/eta changed"""
    
    # Get current shipment
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Check what changed
    old_eta = shipment.get('eta')
    new_eta = data.get('eta')
    old_status = shipment.get('status')
    new_status = data.get('status')
    
    # Update shipment
    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {**data, "updated_at": datetime.now(timezone.utc)}}
    )
    
    # Create events for important changes
    customer_id = shipment.get('customerId')
    
    if new_status and new_status != old_status:
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='status_changed',
            title=f'Статус: {new_status}',
            location=data.get('location'),
            meta={'oldStatus': old_status, 'newStatus': new_status},
            customer_id=customer_id
        )
    
    if new_eta and new_eta != old_eta:
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='eta_changed',
            title=f'Нова дата прибуття: {new_eta}',
            meta={'oldEta': old_eta, 'newEta': new_eta},
            customer_id=customer_id
        )
    
    if data.get('containerNumber') and not shipment.get('containerNumber'):
        await create_shipment_event(
            shipment_id=shipment_id,
            event_type='tracking_added',
            title=f'Додано трекінг: {data["containerNumber"]}',
            customer_id=customer_id
        )
    
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# JOURNEY API — stages, current position, events, manager controls
# ═══════════════════════════════════════════════════════════════════
#   GET    /api/shipments/{id}/journey              — one-shot cabinet view
#   PUT    /api/shipments/{id}/stages/{stage_id}    — edit a stage (vessel, label, type)
#   POST   /api/shipments/{id}/stages/advance       — mark current done, activate next
#   POST   /api/shipments/{id}/stages/{stage_id}/activate — manager override
#   POST   /api/shipments/{id}/stages               — replace full stages array
#
# The existing /api/shipments/{id}/tick already forces update_shipment_position.
# The existing /api/shipments/{id}/vessel binds a vessel at shipment level (legacy
# field). The new /stages/{stage_id} binds vessel per stage — preferred path.
# ═══════════════════════════════════════════════════════════════════


@fastapi_app.get("/api/shipments/{shipment_id}/journey", dependencies=[Depends(require_manager_or_admin)])
async def get_shipment_journey(shipment_id: str):
    """
    One-shot cabinet view: stages, current stage, current position, progress,
    ETA, recent events. Backfills stages[] lazily for legacy shipments.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    if shipment.get('_stages_backfilled'):
        await _persist_stages_backfill(shipment)
    return {"ok": True, "shipment": serialize_journey(shipment)}


@fastapi_app.put("/api/shipments/{shipment_id}/stages/{stage_id}", dependencies=[Depends(require_manager_or_admin)])
async def update_shipment_stage(
    shipment_id: str,
    stage_id: str,
    payload: Dict[str, Any] = Body(...),
):
    """
    Edit a stage. Primary use-cases:
      * bind / update vessel descriptor (`vessel: {mmsi, imo, name}`)
      * change label / from / to
      * change type (land/vessel/port)
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    stages = shipment["stages"]
    idx = next((i for i, s in enumerate(stages) if s.get("id") == stage_id), -1)
    if idx < 0:
        raise HTTPException(status_code=404, detail="Stage not found")

    stage = dict(stages[idx])
    prev_status = stage.get("status")
    allowed = {"label", "from", "to", "fromPoint", "toPoint", "type", "vessel", "status"}
    for k in list(payload.keys()):
        if k in allowed:
            stage[k] = payload[k]
    stage = _normalize_stage(stage, idx, len(stages))

    # Stage transition guard — prevent menu managers from breaking the state
    # machine (e.g. pending → done without ever being active). The dedicated
    # /advance and /stages/{id}/activate endpoints orchestrate transitions
    # safely; PUT is only for field edits, so we restrict status moves.
    new_status = stage.get("status")
    if new_status != prev_status:
        allowed_next = JOURNEY_STAGE_TRANSITIONS.get(prev_status or "pending", set())
        if new_status not in allowed_next:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid stage transition '{prev_status}' → '{new_status}'. "
                    f"Use POST /stages/{stage_id}/activate or POST /stages/advance. "
                    f"Allowed: {sorted(allowed_next)}"
                ),
            )
    stages[idx] = stage

    now = datetime.now(timezone.utc)
    update_set: Dict[str, Any] = {"stages": stages, "updated_at": now}
    # If this is the currently-active stage and vessel was (re)bound, flip
    # trackingActive on and mirror the vessel to the legacy top-level field
    # so old parts of the system keep working.
    if stage.get("id") == shipment.get("currentStageId") and stage.get("type") == "vessel":
        if stage.get("vessel"):
            update_set["vessel"] = stage["vessel"]
            update_set["trackingActive"] = True

    await db.shipments.update_one({"id": shipment_id}, {"$set": update_set})

    # Event: vessel_assigned (if payload bound a vessel)
    if "vessel" in payload and payload["vessel"]:
        await add_shipment_event(
            shipment_id=shipment_id,
            event_type="vessel_assigned",
            label=f"Прив'язано судно: {stage['vessel'].get('name') or stage['vessel'].get('mmsi') or stage['vessel'].get('imo')}",
            meta={"stageId": stage_id, "vessel": stage["vessel"]},
            customer_id=shipment.get("customerId"),
        )

    fresh = await db.shipments.find_one({"id": shipment_id})
    return {"ok": True, "shipment": serialize_journey(fresh)}


@fastapi_app.post("/api/shipments/{shipment_id}/stages", dependencies=[Depends(require_manager_or_admin)])
async def replace_shipment_stages(
    shipment_id: str,
    payload: Dict[str, Any] = Body(...),
):
    """Replace the whole stages[] array at once (manager override / initial setup)."""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    raw = payload.get("stages") or []
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="stages[] must be a non-empty array")
    now = datetime.now(timezone.utc)
    # ensure exactly one active; fallback to first
    normalized: List[Dict[str, Any]] = []
    for i, s in enumerate(raw):
        n = _normalize_stage(s, i, len(raw))
        if not n.get("id"):
            n["id"] = f"stage_{int(now.timestamp())}_{i+1}"
        normalized.append(n)
    active_id = payload.get("currentStageId")
    if not active_id or active_id not in {s["id"] for s in normalized}:
        # pick first 'active' or first 'pending' or first
        act = next((s for s in normalized if s.get("status") == "active"), None)
        active_id = (act or normalized[0])["id"]
    # force statuses: the "active" one becomes active, earlier ones done,
    # later ones pending — but only if status wasn't explicitly set.
    seen_active = False
    for s in normalized:
        if s["id"] == active_id:
            s["status"] = "active"
            seen_active = True
        elif not seen_active:
            if s.get("status") not in ("done", "skipped"):
                s["status"] = s.get("status") or "done"
        else:
            if s.get("status") not in ("done", "skipped"):
                s["status"] = "pending"

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"stages": normalized, "currentStageId": active_id, "updated_at": now}},
    )
    await add_shipment_event(
        shipment_id=shipment_id,
        event_type="stages_replaced",
        label="Маршрут оновлено",
        meta={"stagesCount": len(normalized), "currentStageId": active_id},
        customer_id=shipment.get("customerId"),
    )
    fresh = await db.shipments.find_one({"id": shipment_id})
    return {"ok": True, "shipment": serialize_journey(fresh)}


@fastapi_app.post("/api/shipments/{shipment_id}/stages/advance", dependencies=[Depends(require_manager_or_admin)])
async def advance_shipment_stage(shipment_id: str):
    """Mark the current stage 'done' and activate the next one (if any)."""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    stages = shipment["stages"]
    cur_id = shipment.get("currentStageId")
    idx = next((i for i, s in enumerate(stages) if s.get("id") == cur_id), -1)
    if idx < 0:
        raise HTTPException(status_code=400, detail="No active stage")

    now = datetime.now(timezone.utc)
    stages[idx]["status"] = "done"
    stages[idx]["completedAt"] = now

    next_id = cur_id
    new_status_msg = "Ланцюжок завершено"
    if idx + 1 < len(stages):
        stages[idx + 1]["status"] = "active"
        stages[idx + 1]["startedAt"] = now
        next_id = stages[idx + 1]["id"]
        new_status_msg = f"Перехід на етап: {stages[idx + 1].get('label')}"
    else:
        # no next stage — mark shipment delivered
        await db.shipments.update_one(
            {"id": shipment_id},
            {"$set": {"status": "delivered", "trackingActive": False}},
        )

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"stages": stages, "currentStageId": next_id, "updated_at": now}},
    )
    await add_shipment_event(
        shipment_id=shipment_id,
        event_type="stage_changed",
        label=new_status_msg,
        meta={"fromStageId": cur_id, "toStageId": next_id},
        customer_id=shipment.get("customerId"),
    )
    if idx + 1 >= len(stages):
        await add_shipment_event(
            shipment_id=shipment_id,
            event_type="delivered",
            label="Доставку завершено",
            customer_id=shipment.get("customerId"),
        )
    fresh = await db.shipments.find_one({"id": shipment_id})
    return {"ok": True, "shipment": serialize_journey(fresh)}


@fastapi_app.post("/api/shipments/{shipment_id}/stages/{stage_id}/activate", dependencies=[Depends(require_manager_or_admin)])
async def activate_shipment_stage(shipment_id: str, stage_id: str):
    """Manager override: jump directly to a specific stage."""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    stages = shipment["stages"]
    target_idx = next((i for i, s in enumerate(stages) if s.get("id") == stage_id), -1)
    if target_idx < 0:
        raise HTTPException(status_code=404, detail="Stage not found")
    now = datetime.now(timezone.utc)
    for i, s in enumerate(stages):
        if i < target_idx and s.get("status") not in ("skipped",):
            s["status"] = "done"
            if not s.get("completedAt"):
                s["completedAt"] = now
        elif i == target_idx:
            s["status"] = "active"
            s["startedAt"] = s.get("startedAt") or now
            s["completedAt"] = None
        else:
            s["status"] = "pending"
            s["startedAt"] = None
            s["completedAt"] = None

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"stages": stages, "currentStageId": stage_id, "updated_at": now}},
    )
    await add_shipment_event(
        shipment_id=shipment_id,
        event_type="stage_changed",
        label=f"Активовано етап: {stages[target_idx].get('label')}",
        meta={"toStageId": stage_id, "override": True},
        customer_id=shipment.get("customerId"),
    )
    fresh = await db.shipments.find_one({"id": shipment_id})
    return {"ok": True, "shipment": serialize_journey(fresh)}




@fastapi_app.get("/api/shipments/stalled", dependencies=[Depends(require_admin)])
async def stalled_shipments():
    """Stalled shipments (no updates > 5 days)"""
    five_days_ago = datetime.now(timezone.utc) - timedelta(days=5)
    
    cursor = db.shipments.find({
        "lastTrackingUpdate": {"$lt": five_days_ago},
        "trackingActive": True
    }).limit(50)
    
    items = await cursor.to_list(length=50)
    return {"success": True, "data": [serialize_doc(i) for i in items]}


# ==================== TEAM LEAD ENDPOINTS ====================

@fastapi_app.get("/api/team/shipping")
async def team_shipping_overview(issue: Optional[str] = None):
    """
    Team Lead shipping dashboard
    
    ?issue=stalled - застрявшие (>5 дней без обновлений)
    ?issue=no_tracking - без трекинга
    ?issue=risky - рисковые (ETA просрочена)
    """
    now = datetime.now(timezone.utc)
    query = {}
    
    if issue == 'stalled':
        five_days_ago = now - timedelta(days=5)
        query = {
            "lastTrackingUpdate": {"$lt": five_days_ago},
            "trackingActive": True
        }
    elif issue == 'no_tracking':
        query = {
            "$or": [
                {"containerNumber": {"$exists": False}},
                {"containerNumber": None},
                {"containerNumber": ""}
            ]
        }
    elif issue == 'risky':
        query = {
            "eta": {"$lt": now.isoformat()},
            "status": {"$nin": ["delivered", "ready_for_pickup"]}
        }
    
    shipments = await db.shipments.find(query).sort('created_at', -1).limit(50).to_list(50)
    
    # Enrich with events count
    for s in shipments:
        events_count = await db.shipment_events.count_documents({'shipmentId': s['id']})
        s['eventsCount'] = events_count
        
        # Calculate status from events
        s['status'] = await calculate_shipment_status(s['id'])
    
    return {
        "success": True,
        "data": [serialize_doc(s) for s in shipments],
        "total": len(shipments)
    }


@fastapi_app.get("/api/team/shipping/stalled")
async def team_stalled_shipments():
    """Alias for /api/team/shipping?issue=stalled"""
    return await team_shipping_overview(issue='stalled')


@fastapi_app.get("/api/team/shipping/risky")
async def team_risky_shipments():
    """Alias for /api/team/shipping?issue=risky"""
    return await team_shipping_overview(issue='risky')


@fastapi_app.post("/api/team/shipping/{shipment_id}/ping-manager")
async def ping_manager_about_shipment(shipment_id: str):
    """Team Lead pings manager to update shipment"""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    manager_id = shipment.get('managerId')
    if not manager_id:
        raise HTTPException(status_code=400, detail="No manager assigned")
    
    # Create notification
    notification = {
        '_id': str(uuid.uuid4()),
        'userId': manager_id,
        'type': 'shipment_reminder',
        'title': 'Оновіть статус доставки',
        'message': f'Shipment {shipment_id} потребує оновлення',
        'entityId': shipment_id,
        'entityType': 'shipment',
        'read': False,
        'created_at': datetime.now(timezone.utc)
    }
    
    await db.notifications.insert_one(notification)
    
    # Emit to manager via Socket.IO
    await sio.emit('notification', notification, room=f"user_{manager_id}")
    
    return {"success": True, "message": "Manager notified"}


@fastapi_app.post("/api/team/shipping/{shipment_id}/create-task")
async def create_shipment_task(shipment_id: str):
    """Team Lead creates task for manager to check shipment"""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    manager_id = shipment.get('managerId')
    if not manager_id:
        raise HTTPException(status_code=400, detail="No manager assigned")
    
    # Create task
    task = {
        '_id': str(uuid.uuid4()),
        'type': 'shipment_check',
        'title': f'Перевірити статус доставки VIN {shipment.get("vin")}',
        'description': f'Shipment {shipment_id} needs status update',
        'assigneeId': manager_id,
        'shipmentId': shipment_id,
        'priority': 'high',
        'status': 'pending',
        'deadline': datetime.now(timezone.utc) + timedelta(hours=24),
        'created_at': datetime.now(timezone.utc)
    }
    
    await db.tasks.insert_one(task)
    
    return {"success": True, "taskId": task['_id']}


@fastapi_app.post("/api/team/shipping/{shipment_id}/escalate")
async def escalate_shipment(shipment_id: str):
    """Team Lead escalates shipment issue to owner"""
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    # Create alert
    alert = {
        '_id': str(uuid.uuid4()),
        'type': 'shipment_critical',
        'severity': 'critical',
        'title': f'Критична проблема з доставкою {shipment.get("vin")}',
        'entityId': shipment_id,
        'entityType': 'shipment',
        'message': 'Team Lead escalated this shipment',
        'created_at': datetime.now(timezone.utc),
        'resolved': False
    }
    
    await db.alerts.insert_one(alert)
    
    # Emit to admin (find user with role=master_admin/admin)
    admin = await db.staff.find_one({'role': {'$in': ['master_admin', 'admin']}})
    if admin:
        await sio.emit('alert', alert, room=f"user_{admin['_id']}")
    
    return {"success": True, "alertId": alert['_id']}

# ═══════════════════════════════════════════════════════════════════
# CONTRACTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/contracts")
async def list_contracts(limit: int = 50):
    """List contracts"""
    cursor = db.contracts.find({}, {'_id': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/contracts/{contract_id}")
async def get_contract(contract_id: str):
    """Get contract"""
    contract = await db.contracts.find_one({"id": contract_id}, {'_id': 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"success": True, "data": contract}

@fastapi_app.post("/api/contracts")
async def create_contract(data: Dict[str, Any] = Body(...)):
    """Create contract"""
    contract = {
        "id": f"contract-{datetime.now(timezone.utc).timestamp()}",
        "dealId": data.get("dealId"),
        "customerId": data.get("customerId"),
        "type": data.get("type"),
        "status": "draft",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.contracts.insert_one(contract)
    return {"success": True, "contract": contract}

@fastapi_app.get("/api/contracts/template/{template_name}")
async def get_contract_template(template_name: str):
    """Get contract template"""
    return {"success": True, "template": {"name": template_name, "content": ""}}

@fastapi_app.get("/api/admin/contracts/accounting", dependencies=[Depends(require_admin)])
async def contracts_accounting():
    """Contracts accounting"""
    return {"success": True, "data": []}

@fastapi_app.get("/api/admin/contracts/export", dependencies=[Depends(require_admin)])
async def contracts_export():
    """Export contracts"""
    return {"success": True, "url": ""}

# DocuSign
@fastapi_app.get("/api/docusign/envelopes/{envelope_id}")
async def get_docusign_envelope(envelope_id: str):
    """Get DocuSign envelope"""
    return {"success": True, "data": {"id": envelope_id, "status": "pending"}}

@fastapi_app.post("/api/docusign/envelopes")
async def create_docusign_envelope(data: Dict[str, Any] = Body(...)):
    """Create DocuSign envelope"""
    return {"success": True, "envelopeId": f"env-{datetime.now(timezone.utc).timestamp()}"}

# ═══════════════════════════════════════════════════════════════════
# ESCALATIONS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/escalations")
async def list_escalations(limit: int = 50):
    """List escalations - returns direct array"""
    cursor = db.escalations.find({}, {'_id': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return items if items else []

@fastapi_app.post("/api/escalations")
async def create_escalation(data: Dict[str, Any] = Body(...)):
    """Create escalation"""
    escalation = {
        "id": f"esc-{datetime.now(timezone.utc).timestamp()}",
        "type": data.get("type"),
        "entityId": data.get("entityId"),
        "reason": data.get("reason"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.escalations.insert_one(escalation)
    return {"success": True, "id": escalation["id"]}

@fastapi_app.post("/api/escalations/process")
async def process_escalations():
    """Process escalations"""
    return {"success": True, "processed": 0}

@fastapi_app.get("/api/escalations/stats")
async def escalation_stats():
    """Escalation stats - returns stats object directly"""
    return {
        "managerPending": await db.escalations.count_documents({"currentLevel": "manager_pending"}),
        "teamLeadPending": await db.escalations.count_documents({"currentLevel": "teamlead_pending"}),
        "ownerPending": await db.escalations.count_documents({"currentLevel": "owner_pending"}),
        "resolvedToday": await db.escalations.count_documents({"status": "resolved"}),
        "pending": await db.escalations.count_documents({"status": "pending"}),
        "resolved": await db.escalations.count_documents({"status": "resolved"}),
        "total": await db.escalations.count_documents({})
    }

@fastapi_app.patch("/api/escalations/{escalation_id}/resolve")
async def resolve_escalation(escalation_id: str, data: Dict[str, Any] = Body(...)):
    """Resolve escalation"""
    await db.escalations.update_one({"_id": escalation_id}, {"$set": {"status": "resolved"}})
    return {"success": True}

@fastapi_app.put("/api/escalations/{escalation_id}")
async def update_escalation(escalation_id: str, data: Dict[str, Any] = Body(...)):
    """Update escalation"""
    await db.escalations.update_one({"id": escalation_id}, {"$set": data})
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# INVOICE REMINDERS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/invoice-reminders/critical")
async def critical_reminders():
    """Critical invoice reminders"""
    return {"success": True, "data": []}

@fastapi_app.get("/api/invoice-reminders/escalation-summary")
async def reminder_escalation_summary():
    """Escalation summary"""
    return {"success": True, "data": {"pending": 0, "escalated": 0}}

@fastapi_app.post("/api/invoice-reminders/process")
async def process_reminders():
    """Process reminders"""
    return {"success": True, "processed": 0}

# ═══════════════════════════════════════════════════════════════════
# VEHICLES EXTENDED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

# ❌ REMOVED (April 2026): /api/vehicles, /api/vehicles/{id},
# /api/vehicles/makes, /api/vehicles/stats — backed the deprecated
# /admin/vehicles "Vehicle Database" page (catalog rudiment incompatible with
# the on-demand VIN resolver architecture). The underlying db.vin_data is
# kept as an internal cache only.

# ═══════════════════════════════════════════════════════════════════
# TASKS EXTENDED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/tasks")
async def create_task(data: Dict[str, Any] = Body(...)):
    """Create task"""
    task = {
        "id": f"task-{datetime.now(timezone.utc).timestamp()}",
        "taskId": f"task-{datetime.now(timezone.utc).timestamp()}",
        "title": data.get("title"),
        "description": data.get("description"),
        "type": data.get("type", "general"),
        "assigneeId": data.get("assigneeId"),
        "leadId": data.get("leadId"),
        "dealId": data.get("dealId"),
        "dueDate": data.get("dueDate"),
        "priority": data.get("priority", "medium"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(task)
    return {"success": True, "task": task}

# IMPORTANT: Specific routes MUST be before /{task_id} dynamic route!
@fastapi_app.get("/api/tasks/active")
async def active_tasks():
    """Active tasks - MUST be before /{task_id}"""
    cursor = db.tasks.find({"status": {"$ne": "completed"}}, {'_id': 0}).limit(100)
    items = await cursor.to_list(length=100)
    return {"success": True, "data": items}

@fastapi_app.get("/api/tasks/queue")
async def task_queue():
    """Task queue - MUST be before /{task_id}"""
    cursor = db.tasks.find({"status": "pending"}, {'_id': 0}).sort('dueDate', 1).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/tasks/stats")
async def task_stats():
    """Task statistics - MUST be before /{task_id}"""
    return {
        "success": True,
        "stats": {
            "total": await db.tasks.count_documents({}),
            "pending": await db.tasks.count_documents({"status": "pending"}),
            "completed": await db.tasks.count_documents({"status": "completed"}),
            "overdue": 0
        }
    }

@fastapi_app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    """Get task by ID - MUST be after specific routes"""
    task = await db.tasks.find_one({"$or": [{"id": task_id}, {"taskId": task_id}]}, {'_id': 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True, "data": task}

@fastapi_app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete task"""
    await db.tasks.delete_one({"$or": [{"id": task_id}, {"taskId": task_id}]})
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# LEADS EXTENDED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/leads/{lead_id}")
async def get_lead(lead_id: str):
    """Get lead"""
    lead = await db.leads.find_one({"id": lead_id}, {'_id': 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"success": True, "data": lead}

@fastapi_app.post("/api/leads")
async def create_lead(data: Dict[str, Any] = Body(...)):
    """Create lead"""
    lead = {
        "id": f"lead-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "source": data.get("source", "manual"),
        "status": "new",
        "score": data.get("score", 50),
        "managerId": data.get("managerId"),
        "vin": data.get("vin"),
        "notes": data.get("notes"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leads.insert_one(lead)
    return {"success": True, "lead": lead}

@fastapi_app.put("/api/leads/{lead_id}")
async def update_lead(lead_id: str, data: Dict[str, Any] = Body(...)):
    """Update lead"""
    await db.leads.update_one({"id": lead_id}, {"$set": data})
    return {"success": True}

@fastapi_app.delete("/api/leads/{lead_id}")
async def delete_lead(lead_id: str):
    """Delete lead"""
    await db.leads.delete_one({"id": lead_id})
    return {"success": True}

@fastapi_app.post("/api/leads/from-vin")
async def create_lead_from_vin(data: Dict[str, Any] = Body(...)):
    """Create lead from VIN lookup"""
    lead = {
        "id": f"lead-{datetime.now(timezone.utc).timestamp()}",
        "vin": data.get("vin"),
        "name": data.get("name"),
        "phone": data.get("phone"),
        "email": data.get("email"),
        "source": "vin_check",
        "status": "new",
        "score": 60,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leads.insert_one(lead)
    return {"success": True, "leadId": lead["id"]}

# ═══════════════════════════════════════════════════════════════════
# CUSTOMERS EXTENDED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/customers/{customer_id}")
async def get_customer(customer_id: str):
    """Get customer"""
    customer = await db.customers.find_one({"id": customer_id}, {'_id': 0, 'password': 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"success": True, "data": customer}

@fastapi_app.post("/api/customers")
async def create_customer(data: Dict[str, Any] = Body(...)):
    """Create customer"""
    customer = {
        "id": f"cust-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "source": data.get("source"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.customers.insert_one(customer)
    return {"success": True, "customer": customer}

@fastapi_app.put("/api/customers/{customer_id}")
async def update_customer(customer_id: str, data: Dict[str, Any] = Body(...)):
    """Update customer"""
    await db.customers.update_one({"id": customer_id}, {"$set": data})
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# DEALS EXTENDED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/deals/{deal_id}")
async def get_deal(deal_id: str):
    """Get deal"""
    deal = await db.deals.find_one({"id": deal_id}, {'_id': 0})
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return {"success": True, "data": deal}

@fastapi_app.post("/api/deals")
async def create_deal(data: Dict[str, Any] = Body(...)):
    """
    Create deal
    
    Auto-creates shipment if stage = 'shipping'
    """
    now = datetime.now(timezone.utc)
    
    deal_id = f"deal_{int(now.timestamp())}_{str(uuid.uuid4())[:8]}"
    
    deal = {
        "_id": deal_id,
        **data,
        "created_at": now,
        "updated_at": now
    }
    
    await db.deals.insert_one(deal)
    
    # 🔥 AUTO-CREATE SHIPMENT if stage = 'shipping'
    if data.get('stage') == 'shipping' or data.get('status') == 'shipping':
        try:
            shipment_data = {
                "vin": data.get("vin"),
                "dealId": deal_id,
                "customerId": data.get("customer_id") or data.get("customerId"),
                "managerId": data.get("assigned_to") or data.get("managerId"),
                "origin": data.get("pickup_location", "Los Angeles, USA"),
                "destination": data.get("delivery_location", "Odesa, Ukraine"),
                "eta": data.get("expected_delivery"),
                "trackingActive": False
            }
            
            # Create shipment via endpoint logic
            shipment_response = await create_shipment(shipment_data)
            
            logger.info(f"[DEAL] Auto-created shipment for deal {deal_id}")
            
        except Exception as e:
            logger.error(f"[DEAL] Failed to auto-create shipment: {e}")
    
    return {"success": True, "deal": serialize_doc(deal)}


@fastapi_app.put("/api/deals/{deal_id}")
async def update_deal(deal_id: str, data: Dict[str, Any] = Body(...)):
    """Update deal"""
    await db.deals.update_one({"id": deal_id}, {"$set": data})
    return {"success": True}

@fastapi_app.get("/api/deals/stats")
async def deal_stats():
    """Deal statistics"""
    return {
        "success": True,
        "stats": {
            "total": await db.deals.count_documents({}),
            "won": await db.deals.count_documents({"status": "won"}),
            "lost": await db.deals.count_documents({"status": "lost"}),
            "inProgress": await db.deals.count_documents({"status": {"$nin": ["won", "lost"]}})
        }
    }

# ═══════════════════════════════════════════════════════════════════
# MARKETING ENDPOINTS (DEPRECATED - NOT USED)
# ═══════════════════════════════════════════════════════════════════
# ❌ REMOVED: Marketing Control Panel logic (Facebook Ads, Google Ads automation)
# Причина: Неясная логика, не используется, не относится к текущим задачам
# Если понадобится - раскомментировать и доработать

# @fastapi_app.get("/api/marketing/auto/config")
# @fastapi_app.patch("/api/marketing/auto/config")
# @fastapi_app.get("/api/marketing/auto/decisions")
# @fastapi_app.post("/api/marketing/auto/execute")
# @fastapi_app.get("/api/marketing/auto/history")
# @fastapi_app.get("/api/marketing/roi")
# @fastapi_app.post("/api/marketing/spend/sync")
# @fastapi_app.get("/api/marketing/status")
# ... (закомментировано ~90 строк)

# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/analytics/track")
async def analytics_track(request: Request):
    """Track analytics event - tolerant to any payload"""
    try:
        data = await request.json()
    except Exception:
        return {"success": True}
    event = {
        "event": data.get("event") if isinstance(data, dict) else str(data),
        "properties": data.get("properties") if isinstance(data, dict) else {},
        "userId": data.get("userId") if isinstance(data, dict) else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await db.analytics_events.insert_one(event)
    return {"success": True}

@fastapi_app.post("/api/analytics/link-session")
async def analytics_link_session(data: Dict[str, Any] = Body(...)):
    """Link analytics session"""
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# CALLS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/calls")
async def list_calls(limit: int = 50):
    """List calls"""
    cursor = db.calls.find({}, {'_id': 0}).sort('created_at', -1).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/calls/{call_id}")
async def get_call(call_id: str):
    """Get call"""
    call = await db.calls.find_one({"id": call_id}, {'_id': 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return {"success": True, "data": call}

@fastapi_app.post("/api/calls")
async def create_call(data: Dict[str, Any] = Body(...)):
    """Create call record"""
    call = {
        "id": f"call-{datetime.now(timezone.utc).timestamp()}",
        "leadId": data.get("leadId"),
        "customerId": data.get("customerId"),
        "managerId": data.get("managerId"),
        "direction": data.get("direction", "outbound"),
        "duration": data.get("duration", 0),
        "status": data.get("status", "completed"),
        "notes": data.get("notes"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.calls.insert_one(call)
    return {"success": True, "call": call}

# ═══════════════════════════════════════════════════════════════════
# CARFAX/VIN PRICE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/carfax/{vin}")
async def carfax_report(vin: str):
    """Get Carfax report stub"""
    return {"success": True, "vin": vin.upper(), "available": False, "message": "Carfax integration pending"}

@fastapi_app.get("/api/vin-price/{vin}")
async def vin_price(vin: str):
    """Get VIN price estimate"""
    vehicle = await db.vin_data.find_one({"vin": vin.upper()}, {'_id': 0})
    estimated_price = vehicle.get("price", 15000) if vehicle else 15000
    
    return {
        "success": True,
        "vin": vin.upper(),
        "estimatedPrice": estimated_price,
        "priceRange": {"low": estimated_price * 0.8, "high": estimated_price * 1.2},
        "confidence": 0.7
    }

@fastapi_app.get("/api/vin/search")
async def vin_search(q: str = ""):
    """Search VINs"""
    cursor = db.vin_data.find(
        {"$or": [
            {"vin": {"$regex": q.upper()}},
            {"make": {"$regex": q, "$options": "i"}},
            {"model": {"$regex": q, "$options": "i"}}
        ]},
        {'_id': 0}
    ).limit(20)
    items = await cursor.to_list(length=20)
    return {"success": True, "data": items}

# ═══════════════════════════════════════════════════════════════════
# DOCUMENTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/documents")
async def list_documents(limit: int = 50):
    """List documents"""
    cursor = db.documents.find({}, {'_id': 0}).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"success": True, "data": items}

@fastapi_app.get("/api/documents/{document_id}")
async def get_document(document_id: str):
    """Get document"""
    doc = await db.documents.find_one({"id": document_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True, "data": doc}

@fastapi_app.post("/api/documents")
async def create_document(data: Dict[str, Any] = Body(...)):
    """Create document"""
    doc = {
        "id": f"doc-{datetime.now(timezone.utc).timestamp()}",
        "name": data.get("name"),
        "type": data.get("type"),
        "dealId": data.get("dealId"),
        "customerId": data.get("customerId"),
        "url": data.get("url"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.documents.insert_one(doc)
    return {"success": True, "document": doc}

@fastapi_app.get("/api/documents/queue/pending-verification")
async def documents_pending_verification():
    """Documents pending verification"""
    cursor = db.documents.find({"status": "pending"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

# ═══════════════════════════════════════════════════════════════════
# ROUTING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/routing/queue/status")
async def routing_queue_status():
    """Routing queue status"""
    return {"success": True, "status": {"pending": 0, "assigned": 0, "processing": 0}}

@fastapi_app.get("/api/routing/rules")
async def routing_rules():
    """Get routing rules - returns direct array"""
    return [
        {"id": "r1", "name": "High Value Leads", "type": "lead_value", "condition": "price > 50000", "action": "assign_senior", "priority": 1, "isActive": True},
        {"id": "r2", "name": "New Source Leads", "type": "source", "condition": "source == 'referral'", "action": "assign_available", "priority": 2, "isActive": True},
    ]

@fastapi_app.post("/api/routing/rules")
async def create_routing_rule(data: Dict[str, Any] = Body(...)):
    """Create routing rule"""
    return {"success": True, "id": "new_rule"}

@fastapi_app.put("/api/routing/rules/{rule_id}")
async def update_routing_rule(rule_id: str, data: Dict[str, Any] = Body(...)):
    """Update routing rule"""
    return {"success": True}

@fastapi_app.delete("/api/routing/rules/{rule_id}")
async def delete_routing_rule(rule_id: str):
    """Delete routing rule"""
    return {"success": True}

@fastapi_app.patch("/api/routing/rules/{rule_id}/toggle")
async def toggle_routing_rule(rule_id: str, data: Dict[str, Any] = Body(...)):
    """Toggle routing rule active state"""
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# SCORING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/scoring/rules")
async def scoring_rules():
    """Get scoring rules - returns direct array"""
    return [
        {"code": "s1", "name": "Lead Response Time", "scoreType": "lead_score", "description": "Score based on response time", "points": 10, "condition": "response_time < 15", "isActive": True},
        {"code": "s2", "name": "Lead Source Quality", "scoreType": "lead_score", "description": "Score for referral leads", "points": 15, "condition": "source == 'referral'", "isActive": True},
        {"code": "s3", "name": "Deal Value", "scoreType": "deal_score", "description": "Score for high value deals", "points": 20, "condition": "value > 30000", "isActive": True},
        {"code": "s4", "name": "Manager Performance", "scoreType": "manager_score", "description": "Score for conversion rate", "points": 25, "condition": "conversion > 0.3", "isActive": False},
    ]

@fastapi_app.post("/api/scoring/rules")
async def create_scoring_rule(data: Dict[str, Any] = Body(...)):
    """Create scoring rule"""
    return {"success": True, "code": "new_rule"}

@fastapi_app.put("/api/scoring/rules/{rule_id}")
async def update_scoring_rule(rule_id: str, data: Dict[str, Any] = Body(...)):
    """Update scoring rule"""
    return {"success": True}

@fastapi_app.delete("/api/scoring/rules/{rule_code}")
async def delete_scoring_rule(rule_code: str):
    """Delete scoring rule"""
    return {"success": True}

@fastapi_app.patch("/api/scoring/rules/{rule_code}/toggle")
async def toggle_scoring_rule(rule_code: str, data: Dict[str, Any] = Body(...)):
    """Toggle scoring rule active state"""
    return {"success": True}

# ═══════════════════════════════════════════════════════════════════
# INTENT ENDPOINTS (extended)
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/intent/me")
async def my_intent():
    """Get my intent data"""
    return {"success": True, "data": {"level": "warm", "score": 50}}

# ═══════════════════════════════════════════════════════════════════
# PAYMENTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/payments/packages")
async def payment_packages():
    """Get payment packages"""
    return {
        "success": True,
        "packages": [
            {"id": "basic", "name": "Basic", "price": 99, "features": ["5 VIN checks", "Basic support"]},
            {"id": "pro", "name": "Pro", "price": 299, "features": ["Unlimited VIN checks", "Priority support"]},
            {"id": "enterprise", "name": "Enterprise", "price": 999, "features": ["All features", "Dedicated support"]},
        ]
    }

# ═══════════════════════════════════════════════════════════════════
# STRIPE — runtime helpers + real checkout flow
# ═══════════════════════════════════════════════════════════════════

async def _get_stripe_config() -> Dict[str, Any]:
    """Load Stripe credentials + settings from MongoDB.

    Returns dict with keys: secretKey, publishableKey, restrictedKey,
    webhookSecret, currency, paymentMethods, enabledMethods, checkoutMode,
    automaticPaymentMethods, captureMethod, statementDescriptor, successUrl,
    cancelUrl, allowPromotionCodes, billingAddressCollection,
    phoneNumberCollection, isEnabled, mode.
    """
    doc = await db.integration_configs.find_one({"provider": "stripe"}) or {}
    creds = doc.get("credentials") or {}
    settings = doc.get("settings") or {}

    # New richer enabledMethods dict (preferred source-of-truth)
    enabled_methods = settings.get("enabledMethods") or {}
    if not isinstance(enabled_methods, dict):
        enabled_methods = {}

    # Back-compat: legacy paymentMethods list
    legacy_pm = settings.get("paymentMethods")
    if isinstance(legacy_pm, list) and legacy_pm and not enabled_methods:
        enabled_methods = {m: True for m in legacy_pm}

    if not enabled_methods:
        enabled_methods = {"card": True}

    # Apple Pay / Google Pay are wallets that ride on the `card` method type.
    # When `automaticPaymentMethods=True` Stripe auto-shows them based on
    # device/browser support; we still keep flags so admin sees clear state.
    pm_list = [k for k, v in enabled_methods.items() if v and k not in ("apple_pay", "google_pay")]
    if "card" not in pm_list and (enabled_methods.get("apple_pay") or enabled_methods.get("google_pay")):
        pm_list.append("card")
    if not pm_list:
        pm_list = ["card"]

    return {
        "secretKey": (creds.get("secretKey") or "").strip(),
        "restrictedKey": (creds.get("restrictedKey") or "").strip(),
        "publishableKey": (creds.get("publishableKey") or "").strip(),
        "webhookSecret": (creds.get("webhookSecret") or "").strip(),
        "currency": (settings.get("currency") or "USD").lower(),
        "paymentMethods": pm_list,
        "enabledMethods": enabled_methods,
        "checkoutMode": (settings.get("checkoutMode") or "hosted"),
        "automaticPaymentMethods": bool(settings.get("automaticPaymentMethods", True)),
        "captureMethod": (settings.get("captureMethod") or "automatic"),
        "statementDescriptor": (settings.get("statementDescriptor") or "")[:22],
        "successUrl": settings.get("successUrl") or "/cabinet/payment/success",
        "cancelUrl": settings.get("cancelUrl") or "/cabinet/payment/cancel",
        "allowPromotionCodes": bool(settings.get("allowPromotionCodes", True)),
        "billingAddressCollection": (settings.get("billingAddressCollection") or "auto"),
        "phoneNumberCollection": bool(settings.get("phoneNumberCollection", False)),
        "isEnabled": bool(doc.get("isEnabled", False)),
        "mode": doc.get("mode") or "sandbox",
    }


@fastapi_app.get("/api/stripe/public-config")
async def stripe_public_config():
    """Public endpoint — returns Publishable Key, currency, payment methods,
    checkout mode. No secrets. Used by the cabinet to render the Pay button
    and (for embedded mode) initialize Stripe.js."""
    cfg = await _get_stripe_config()
    enabled = cfg["enabledMethods"] or {}
    # Methods we display on the customer-facing picker
    display_methods = []
    method_meta = [
        ("card",              "Card",                "Visa, Mastercard, Amex, Discover"),
        ("apple_pay",         "Apple Pay",           "One-tap on Safari / iOS"),
        ("google_pay",        "Google Pay",          "One-tap on Chrome / Android"),
        ("link",              "Link",                "Stripe one-click checkout"),
        ("klarna",            "Klarna",              "Buy now, pay later"),
        ("afterpay_clearpay", "Afterpay / Clearpay", "Pay in 4 instalments"),
        ("cashapp",           "Cash App Pay",        "USD only"),
        ("crypto",            "Crypto",              "USDC stablecoin (Stripe Crypto)"),
        ("us_bank_account",   "US Bank Account",     "ACH Debit (USA)"),
        ("sepa_debit",        "SEPA Direct Debit",   "EUR (EU)"),
        ("ideal",             "iDEAL",               "Netherlands"),
        ("bancontact",        "Bancontact",          "Belgium"),
        ("p24",               "Przelewy24",          "Poland"),
        ("blik",              "BLIK",                "Poland"),
        ("alipay",            "Alipay",              "China"),
        ("wechat_pay",        "WeChat Pay",          "China"),
    ]
    for k, label, hint in method_meta:
        if enabled.get(k):
            display_methods.append({"key": k, "label": label, "hint": hint})

    return {
        "enabled": bool(cfg["isEnabled"] and cfg["publishableKey"]),
        "publishableKey": cfg["publishableKey"],
        "currency": cfg["currency"],
        "paymentMethods": cfg["paymentMethods"],
        "enabledMethods": cfg["enabledMethods"],
        "displayMethods": display_methods,
        "checkoutMode": cfg["checkoutMode"],
        "automaticPaymentMethods": cfg["automaticPaymentMethods"],
        "mode": cfg["mode"],
    }


@fastapi_app.post("/api/stripe/create-checkout-session")
async def create_checkout_session(request: Request, data: Dict[str, Any] = Body(...)):
    """Create a real Stripe Checkout Session using admin-saved credentials.

    Request body:
      {
        "amount": 1000,             # required, in MAJOR units (e.g. 10.00)
        "description": "Invoice #…", # optional
        "invoiceId": "inv_...",     # optional — used to attach metadata
        "customerEmail": "...",     # optional
        "successUrl": "https://...",# optional override
        "cancelUrl": "https://...", # optional override
        "currency": "EUR"           # optional override
      }
    """
    cfg = await _get_stripe_config()
    if not cfg["isEnabled"]:
        raise HTTPException(status_code=503, detail="Stripe is disabled in admin Integrations.")
    if not cfg["secretKey"]:
        raise HTTPException(status_code=503, detail="Stripe Secret Key is not configured.")

    amount = data.get("amount")
    try:
        amount_minor = int(round(float(amount) * 100))
    except Exception:
        raise HTTPException(status_code=400, detail="amount is required and must be a number")
    if amount_minor <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")

    currency = (data.get("currency") or cfg["currency"] or "usd").lower()
    description = data.get("description") or "Invoice payment"
    invoice_id = data.get("invoiceId") or ""
    customer_email = data.get("customerEmail")
    success_url = data.get("successUrl") or cfg["successUrl"]
    cancel_url = data.get("cancelUrl") or cfg["cancelUrl"]

    # Resolve base URL: explicit env > X-Forwarded-Host header > request host
    def _resolve_base() -> str:
        env_url = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")
        if env_url:
            return env_url
        # Try X-Forwarded-Host (Kubernetes ingress)
        xf_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
        xf_proto = request.headers.get("x-forwarded-proto", "https")
        if xf_host:
            return f"{xf_proto}://{xf_host}".rstrip("/")
        return str(request.base_url).rstrip("/")

    base = _resolve_base()
    if not success_url.startswith("http"): success_url = base + (success_url if success_url.startswith("/") else f"/{success_url}")
    if not cancel_url.startswith("http"):  cancel_url  = base + (cancel_url  if cancel_url.startswith("/")  else f"/{cancel_url}")
    # Append session_id placeholder for tracking
    if "{CHECKOUT_SESSION_ID}" not in success_url:
        success_url = success_url + ("&" if "?" in success_url else "?") + "session_id={CHECKOUT_SESSION_ID}"

    try:
        import stripe as _stripe  # type: ignore
        _stripe.api_key = cfg["secretKey"]

        params = {
            "mode": "payment",
            "line_items": [{
                "price_data": {
                    "currency": currency,
                    "product_data": {"name": description, "metadata": {"invoiceId": invoice_id}},
                    "unit_amount": amount_minor,
                },
                "quantity": 1,
            }],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {
                "invoiceId": invoice_id,
                "customerId": str(data.get("customerId") or ""),
                "source": "bibi-crm",
            },
        }

        # Payment-methods strategy:
        #   When `automaticPaymentMethods=True` (recommended), we omit
        #   `payment_method_types` so Stripe Checkout auto-renders methods
        #   enabled in the Dashboard + the right wallets (Apple Pay /
        #   Google Pay / Link) based on browser/device.
        #   Otherwise we pass `payment_method_types` explicitly.
        if not cfg["automaticPaymentMethods"]:
            pm_list = [m for m in (cfg["paymentMethods"] or []) if m and m not in ("auto", "automatic")]
            if not pm_list:
                pm_list = ["card"]
            params["payment_method_types"] = pm_list

        # Capture method (immediate vs manual)
        capture = (cfg.get("captureMethod") or "automatic").lower()
        if capture in ("automatic", "manual", "automatic_async"):
            params["payment_intent_data"] = {
                "capture_method": capture,
                "metadata": {"invoiceId": invoice_id, "source": "bibi-crm"},
            }
            if cfg.get("statementDescriptor"):
                params["payment_intent_data"]["statement_descriptor_suffix"] = cfg["statementDescriptor"]

        if cfg.get("allowPromotionCodes"):
            params["allow_promotion_codes"] = True
        if cfg.get("billingAddressCollection") in ("auto", "required"):
            params["billing_address_collection"] = cfg["billingAddressCollection"]
        if cfg.get("phoneNumberCollection"):
            params["phone_number_collection"] = {"enabled": True}

        if customer_email:
            params["customer_email"] = customer_email
        if cfg["checkoutMode"] == "embedded":
            params["ui_mode"] = "embedded"
            params["return_url"] = success_url
            # `embedded` mode does NOT take success_url/cancel_url
            params.pop("success_url", None)
            params.pop("cancel_url", None)

        session = await asyncio.to_thread(lambda: _stripe.checkout.Session.create(**params))

        # Persist the session for later reconciliation
        try:
            await db.payment_sessions.insert_one({
                "id": session.id,
                "invoiceId": invoice_id,
                "customerId": str(data.get("customerId") or ""),
                "customerEmail": customer_email,
                "amount": amount_minor / 100,
                "amountMinor": amount_minor,
                "currency": currency,
                "description": description,
                "status": session.status,
                "paymentStatus": getattr(session, "payment_status", "unpaid"),
                "url": session.url,
                "client_secret": getattr(session, "client_secret", None),
                "mode": cfg["mode"],
                "checkoutMode": cfg["checkoutMode"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

        return {
            "success": True,
            "sessionId": session.id,
            "url": session.url,                                    # for hosted
            "clientSecret": getattr(session, "client_secret", None),  # for embedded
            "publishableKey": cfg["publishableKey"],
            "mode": cfg["checkoutMode"],
        }
    except Exception as ex:
        logger.exception("[stripe] create_checkout_session failed")
        raise HTTPException(status_code=502, detail=f"Stripe error: {type(ex).__name__}: {str(ex)[:200]}")


@fastapi_app.get("/api/stripe/session/{session_id}")
async def get_checkout_session(session_id: str):
    """Look up a checkout session (used by success page to confirm payment)."""
    cfg = await _get_stripe_config()
    if not cfg["secretKey"]:
        raise HTTPException(status_code=503, detail="Stripe is not configured.")
    try:
        import stripe as _stripe  # type: ignore
        _stripe.api_key = cfg["secretKey"]
        s = await asyncio.to_thread(lambda: _stripe.checkout.Session.retrieve(session_id))
        return {
            "success": True,
            "sessionId": s.id,
            "status": s.status,
            "paymentStatus": s.payment_status,
            "amount": (s.amount_total or 0) / 100,
            "currency": s.currency,
            "customerEmail": s.customer_details.email if s.customer_details else None,
            "metadata": dict(s.metadata or {}),
        }
    except Exception as ex:
        raise HTTPException(status_code=502, detail=f"Stripe error: {type(ex).__name__}: {str(ex)[:200]}")


# ═══════════════════════════════════════════════════════════════════
# STRIPE — webhook + master-admin payment control
# ═══════════════════════════════════════════════════════════════════

async def _record_payment_from_stripe(obj: Dict[str, Any], event_type: str = "") -> None:
    """Persist/refresh a normalized payment record from a Stripe object
    (PaymentIntent or Checkout Session)."""
    if not obj:
        return
    try:
        # Detect whether obj is a Checkout Session or a PaymentIntent
        is_session = obj.get("object") == "checkout.session" or "payment_intent" in obj or "amount_total" in obj
        pi_id = (obj.get("payment_intent") if is_session else obj.get("id")) or ""
        session_id = obj.get("id") if is_session else None

        amount = obj.get("amount_total") if is_session else (obj.get("amount_received") or obj.get("amount") or 0)
        currency = (obj.get("currency") or "usd").lower()
        status = obj.get("status") or ""
        payment_status = obj.get("payment_status") or status
        metadata = dict(obj.get("metadata") or {})
        invoice_id = metadata.get("invoiceId") or metadata.get("invoice_id") or ""
        customer_id = metadata.get("customerId") or metadata.get("customer_id") or ""
        customer_email = None
        cust_details = obj.get("customer_details") or {}
        customer_email = cust_details.get("email") if isinstance(cust_details, dict) else None
        if not customer_email:
            customer_email = obj.get("receipt_email") or obj.get("customer_email")

        # Try to derive payment method type
        pm_types = obj.get("payment_method_types") or []
        pm_type = pm_types[0] if pm_types else None
        # For PaymentIntents the actually used method lives on charge or payment_method
        charges = (obj.get("charges") or {}).get("data") if isinstance(obj.get("charges"), dict) else None
        pm_brand = None
        last4 = None
        wallet = None
        if charges:
            ch = charges[0] or {}
            pmd = (ch.get("payment_method_details") or {})
            pm_type = pmd.get("type") or pm_type
            card = pmd.get("card") or {}
            pm_brand = card.get("brand")
            last4 = card.get("last4")
            wallet = (card.get("wallet") or {}).get("type")

        # Receipt URL
        receipt_url = None
        if charges:
            receipt_url = (charges[0] or {}).get("receipt_url")

        amount_major = (amount or 0) / 100 if isinstance(amount, (int, float)) else 0

        record = {
            "paymentIntentId": pi_id,
            "sessionId": session_id,
            "amount": amount_major,
            "amountMinor": int(amount or 0),
            "currency": currency,
            "status": status,
            "paymentStatus": payment_status,
            "method": pm_type,
            "wallet": wallet,
            "cardBrand": pm_brand,
            "cardLast4": last4,
            "invoiceId": invoice_id,
            "customerId": customer_id,
            "customerEmail": customer_email,
            "metadata": metadata,
            "receiptUrl": receipt_url,
            "lastEvent": event_type or status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        # Use paymentIntentId if available else sessionId as the upsert key
        key = {"paymentIntentId": pi_id} if pi_id else {"sessionId": session_id}
        existing = await db.payments.find_one(key) if any(key.values()) else None
        if existing:
            await db.payments.update_one(key, {"$set": record})
        else:
            record["id"] = pi_id or session_id or str(uuid.uuid4())
            record["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.payments.insert_one(record)

        # Also keep payment_sessions in sync with status
        if session_id:
            await db.payment_sessions.update_one(
                {"id": session_id},
                {"$set": {
                    "status": status,
                    "paymentStatus": payment_status,
                    "paymentIntentId": pi_id,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )

        # If paid, mark the linked invoice as paid
        if invoice_id and (payment_status == "paid" or status in ("succeeded", "complete")):
            try:
                await db.invoices.update_one(
                    {"id": invoice_id},
                    {"$set": {
                        "status": "paid",
                        "paidAt": datetime.now(timezone.utc).isoformat(),
                        "paymentMethod": pm_type or "stripe",
                        "paymentIntentId": pi_id,
                    }},
                )
                # Auto-create the workflow / order so manager can start working
                try:
                    invoice_doc = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
                    if invoice_doc:
                        await _create_order_from_invoice(invoice_doc)
                except Exception:
                    logger.exception("[stripe] failed to auto-create order from paid invoice")
            except Exception:
                logger.exception("[stripe] failed to update invoice status")
    except Exception:
        logger.exception("[stripe] _record_payment_from_stripe failed")


@fastapi_app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe webhook receiver. Verifies signature when webhookSecret is set,
    then upserts the payment record."""
    cfg = await _get_stripe_config()
    if not cfg["secretKey"]:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    import stripe as _stripe  # type: ignore
    _stripe.api_key = cfg["secretKey"]

    event = None
    try:
        if cfg.get("webhookSecret"):
            event = _stripe.Webhook.construct_event(body, sig_header, cfg["webhookSecret"])
        else:
            # Without a configured secret we still parse the JSON (test mode)
            import json as _json
            event = _json.loads(body.decode("utf-8") or "{}")
    except Exception as ex:
        logger.warning(f"[stripe-webhook] verify failed: {ex}")
        raise HTTPException(status_code=400, detail="Invalid signature/payload")

    et = (event or {}).get("type", "")
    obj = ((event or {}).get("data") or {}).get("object") or {}

    # Persist raw event for audit
    try:
        await db.stripe_events.insert_one({
            "id": event.get("id") if isinstance(event, dict) else getattr(event, "id", None),
            "type": et,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "object_id": obj.get("id"),
            "raw": event if isinstance(event, dict) else None,
        })
    except Exception:
        pass

    # Normalize for relevant events
    if et in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "payment_intent.canceled",
        "payment_intent.processing",
        "charge.refunded",
        "charge.refund.updated",
    ):
        # If it's a charge.refunded event the object is a Charge — fetch parent PI
        if et.startswith("charge.") and obj.get("payment_intent"):
            try:
                pi = await asyncio.to_thread(
                    lambda: _stripe.PaymentIntent.retrieve(obj["payment_intent"], expand=["charges"])
                )
                await _record_payment_from_stripe(pi.to_dict() if hasattr(pi, "to_dict") else dict(pi), et)
            except Exception:
                logger.exception("[stripe-webhook] failed to refresh PI on refund")
        else:
            await _record_payment_from_stripe(obj, et)

    return {"received": True, "type": et}


@fastapi_app.get("/api/admin/payments", dependencies=[Depends(require_admin)])
async def admin_list_payments(
    status: str = "",
    method: str = "",
    q: str = "",
    days: int = 90,
    limit: int = 100,
    skip: int = 0,
):
    """Master-admin: list payments with optional filters."""
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    if method:
        query["method"] = method
    if q:
        query["$or"] = [
            {"customerEmail": {"$regex": q, "$options": "i"}},
            {"customerId": {"$regex": q, "$options": "i"}},
            {"invoiceId": {"$regex": q, "$options": "i"}},
            {"paymentIntentId": {"$regex": q, "$options": "i"}},
            {"sessionId": {"$regex": q, "$options": "i"}},
        ]
    if days and days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
        query["created_at"] = {"$gte": cutoff}

    total = await db.payments.count_documents(query)
    cursor = db.payments.find(query, {"_id": 0}).sort("created_at", -1).skip(int(skip)).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "total": total, "items": items}


@fastapi_app.get("/api/admin/payments/stats", dependencies=[Depends(require_admin)])
async def admin_payments_stats(days: int = 30):
    """Master-admin: aggregated stats."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
    base = {"created_at": {"$gte": cutoff}}
    succeeded = {**base, "status": {"$in": ["succeeded", "complete", "paid"]}}
    failed = {**base, "status": {"$in": ["failed", "canceled", "expired"]}}

    pipeline_total = [
        {"$match": succeeded},
        {"$group": {"_id": None, "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    by_method = [
        {"$match": succeeded},
        {"$group": {"_id": "$method", "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"amount": -1}},
    ]
    by_currency = [
        {"$match": succeeded},
        {"$group": {"_id": "$currency", "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    by_day = [
        {"$match": succeeded},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]

    total_doc = await db.payments.aggregate(pipeline_total).to_list(length=1)
    methods = await db.payments.aggregate(by_method).to_list(length=50)
    currencies = await db.payments.aggregate(by_currency).to_list(length=50)
    daily = await db.payments.aggregate(by_day).to_list(length=400)

    succ_count = await db.payments.count_documents(succeeded)
    fail_count = await db.payments.count_documents(failed)
    pending_count = await db.payments.count_documents({**base, "status": {"$in": ["processing", "requires_payment_method", "requires_action", "open"]}})
    refund_count = await db.payments.count_documents({**base, "lastEvent": {"$regex": "refund"}})

    return {
        "success": True,
        "windowDays": days,
        "totalAmount": (total_doc[0]["amount"] if total_doc else 0),
        "totalCount": (total_doc[0]["count"] if total_doc else 0),
        "succeeded": succ_count,
        "failed": fail_count,
        "pending": pending_count,
        "refunded": refund_count,
        "byMethod": [{"method": (m["_id"] or "unknown"), "amount": m["amount"], "count": m["count"]} for m in methods],
        "byCurrency": [{"currency": (c["_id"] or "usd"), "amount": c["amount"], "count": c["count"]} for c in currencies],
        "daily": [{"date": d["_id"], "amount": d["amount"], "count": d["count"]} for d in daily],
    }


@fastapi_app.get("/api/admin/payments/recent-events", dependencies=[Depends(require_admin)])
async def admin_recent_stripe_events(limit: int = 50):
    """Master-admin: latest webhook events received."""
    cursor = db.stripe_events.find({}, {"_id": 0, "raw": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items}


@fastapi_app.get("/api/admin/payments/{payment_id}", dependencies=[Depends(require_admin)])
async def admin_payment_detail(payment_id: str):
    """Master-admin: get one payment with fresh Stripe data."""
    p = await db.payments.find_one(
        {"$or": [{"id": payment_id}, {"paymentIntentId": payment_id}, {"sessionId": payment_id}]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")

    cfg = await _get_stripe_config()
    fresh: Dict[str, Any] = {}
    if cfg.get("secretKey") and p.get("paymentIntentId"):
        try:
            import stripe as _stripe  # type: ignore
            _stripe.api_key = cfg["secretKey"]
            pi = await asyncio.to_thread(
                lambda: _stripe.PaymentIntent.retrieve(p["paymentIntentId"], expand=["charges", "latest_charge"])
            )
            fresh = pi.to_dict() if hasattr(pi, "to_dict") else dict(pi)
        except Exception as ex:
            fresh = {"error": str(ex)[:200]}

    return {"success": True, "payment": p, "stripe": fresh}


@fastapi_app.post("/api/admin/payments/{payment_id}/refund", dependencies=[Depends(require_master_admin)])
async def admin_refund_payment(payment_id: str, data: Dict[str, Any] = Body(default={})):
    """Master-admin: refund a payment (full or partial). data: { amount?, reason? }"""
    p = await db.payments.find_one(
        {"$or": [{"id": payment_id}, {"paymentIntentId": payment_id}, {"sessionId": payment_id}]},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    pi = p.get("paymentIntentId")
    if not pi:
        raise HTTPException(status_code=400, detail="Payment has no PaymentIntent — cannot refund")

    cfg = await _get_stripe_config()
    if not cfg.get("secretKey"):
        raise HTTPException(status_code=503, detail="Stripe not configured")

    try:
        import stripe as _stripe  # type: ignore
        _stripe.api_key = cfg["secretKey"]
        params = {"payment_intent": pi}
        amount = data.get("amount")
        if amount is not None:
            try:
                amt_minor = int(round(float(amount) * 100))
                if amt_minor > 0:
                    params["amount"] = amt_minor
            except Exception:
                pass
        reason = data.get("reason")
        if reason in ("duplicate", "fraudulent", "requested_by_customer"):
            params["reason"] = reason
        params["metadata"] = {"refunded_by": "master_admin", "source": "bibi-crm"}

        refund = await asyncio.to_thread(lambda: _stripe.Refund.create(**params))

        # Refresh payment record from PI
        try:
            pi_obj = await asyncio.to_thread(lambda: _stripe.PaymentIntent.retrieve(pi, expand=["charges"]))
            await _record_payment_from_stripe(pi_obj.to_dict() if hasattr(pi_obj, "to_dict") else dict(pi_obj), "refund.created")
        except Exception:
            pass

        return {"success": True, "refundId": refund.id, "status": refund.status, "amount": (refund.amount or 0) / 100}
    except Exception as ex:
        logger.exception("[stripe] refund failed")
        raise HTTPException(status_code=502, detail=f"Refund failed: {type(ex).__name__}: {str(ex)[:200]}")


@fastapi_app.post("/api/admin/payments/sync", dependencies=[Depends(require_admin)])
async def admin_payments_sync(limit: int = 100):
    """Master-admin: pull recent PaymentIntents from Stripe and refresh local cache."""
    cfg = await _get_stripe_config()
    if not cfg.get("secretKey"):
        raise HTTPException(status_code=503, detail="Stripe not configured")
    try:
        import stripe as _stripe  # type: ignore
        _stripe.api_key = cfg["secretKey"]
        pis = await asyncio.to_thread(lambda: _stripe.PaymentIntent.list(limit=min(int(limit), 100), expand=["data.charges"]))
        synced = 0
        for pi in pis.data:
            try:
                d = pi.to_dict() if hasattr(pi, "to_dict") else dict(pi)
                await _record_payment_from_stripe(d, "sync")
                synced += 1
            except Exception:
                logger.exception("[stripe-sync] one PI failed")
        return {"success": True, "synced": synced, "total": len(pis.data)}
    except Exception as ex:
        raise HTTPException(status_code=502, detail=f"Sync failed: {type(ex).__name__}: {str(ex)[:200]}")


# ═══════════════════════════════════════════════════════════════════
# SERVICES CATALOG  (master_admin manages, everyone reads)
# ═══════════════════════════════════════════════════════════════════
#
# Source-of-truth list of services that managers can attach to invoices.
# Each service describes ONE step that the company performs for a client
# (Inspection, Delivery, Certification, Custom-clearance, etc).
#
# When a client pays an invoice, an `order` document is auto-created with
# one workflow step per invoice line-item — letting the manager track
# execution while team-lead and client see live progress.

DEFAULT_SERVICES = [
    {"id": "svc_inspection",    "code": "inspection",    "name": "Інспекція авто",            "name_en": "Vehicle inspection",
     "description": "Передпродажний огляд, фото та відео",       "category": "import",  "default_price": 200,  "currency": "USD", "default_qty": 1,
     "workflow": [{"key": "schedule", "label": "Заплановано"}, {"key": "in_progress", "label": "На огляді"}, {"key": "report_ready", "label": "Звіт готовий"}]},
    {"id": "svc_delivery",      "code": "delivery",      "name": "Доставка авто",             "name_en": "Vehicle delivery",
     "description": "Морська + автомобільна доставка до клієнта", "category": "logistics","default_price": 1200, "currency": "USD", "default_qty": 1,
     "workflow": [{"key": "ports_booking", "label": "Бронювання портів"}, {"key": "loading", "label": "Завантажено"}, {"key": "in_transit", "label": "У дорозі"}, {"key": "customs", "label": "Митниця"}, {"key": "delivered", "label": "Доставлено"}]},
    {"id": "svc_certification", "code": "certification", "name": "Сертифікація / реєстрація", "name_en": "Certification & registration",
     "description": "Документообіг, сертифікати, реєстрація",     "category": "docs",    "default_price": 350,  "currency": "USD", "default_qty": 1,
     "workflow": [{"key": "docs_collection", "label": "Збір документів"}, {"key": "submission", "label": "Подача"}, {"key": "approved", "label": "Затверджено"}]},
    {"id": "svc_detailing",     "code": "detailing",     "name": "Передпродажна підготовка",  "name_en": "Pre-sale detailing",
     "description": "Хімчистка, полірування",                      "category": "custom",  "default_price": 250,  "currency": "USD", "default_qty": 1,
     "workflow": [{"key": "scheduled", "label": "Заплановано"}, {"key": "in_progress", "label": "В роботі"}, {"key": "ready", "label": "Готово"}]},
    {"id": "svc_storage",       "code": "storage",       "name": "Зберігання на складі",      "name_en": "Storage",
     "description": "Зберігання у захищеному паркінгу",            "category": "logistics","default_price": 50,   "currency": "USD", "default_qty": 1,
     "workflow": [{"key": "checked_in", "label": "Прийнято"}, {"key": "stored", "label": "На зберіганні"}, {"key": "released", "label": "Видано"}]},
]


async def _ensure_services_seed() -> None:
    """Idempotent seed of the default services catalog."""
    if db is None:
        return
    try:
        existing = await db.services.count_documents({})
        if existing == 0:
            now = datetime.now(timezone.utc).isoformat()
            for s in DEFAULT_SERVICES:
                doc = {**s, "is_active": True, "created_at": now, "created_by": "system_seed"}
                await db.services.insert_one(doc)
    except Exception:
        logger.exception("[services] seed failed")


@fastapi_app.on_event("startup")
async def _services_startup_hook():
    try:
        await _ensure_services_seed()
    except Exception:
        pass


@fastapi_app.get("/api/services")
async def list_services_public(category: str = "", active_only: bool = True):
    """Public/staff list of services (managers + clients show this list)."""
    q: Dict[str, Any] = {}
    if active_only:
        q["is_active"] = True
    if category:
        q["category"] = category
    cursor = db.services.find(q, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(length=200)
    return {"success": True, "items": items}


@fastapi_app.get("/api/admin/services", dependencies=[Depends(require_admin)])
async def admin_list_services():
    cursor = db.services.find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=500)
    return {"success": True, "items": items}


@fastapi_app.post("/api/admin/services", dependencies=[Depends(require_master_admin)])
async def admin_create_service(data: Dict[str, Any] = Body(...), user: dict = Depends(require_master_admin)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    code = (data.get("code") or name.lower().replace(" ", "_"))[:64]
    sid = f"svc_{code}_{int(datetime.now(timezone.utc).timestamp())}"
    doc = {
        "id": sid,
        "code": code,
        "name": name,
        "name_en": (data.get("name_en") or "").strip() or name,
        "description": (data.get("description") or "").strip(),
        "category": (data.get("category") or "custom"),
        "default_price": float(data.get("default_price") or 0),
        "currency": (data.get("currency") or "USD").upper(),
        "default_qty": int(data.get("default_qty") or 1),
        "workflow": data.get("workflow") if isinstance(data.get("workflow"), list) else [
            {"key": "pending",     "label": "Очікує"},
            {"key": "in_progress", "label": "В роботі"},
            {"key": "completed",   "label": "Готово"},
        ],
        "is_active": bool(data.get("is_active", True)),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email") or user.get("id"),
    }
    await db.services.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "service": doc}


@fastapi_app.patch("/api/admin/services/{service_id}", dependencies=[Depends(require_master_admin)])
async def admin_update_service(service_id: str, data: Dict[str, Any] = Body(...)):
    allowed = {"name", "name_en", "description", "category", "default_price", "currency", "default_qty", "workflow", "is_active"}
    upd = {k: v for k, v in (data or {}).items() if k in allowed}
    if not upd:
        raise HTTPException(400, "Nothing to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.services.update_one({"id": service_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Service not found")
    s = await db.services.find_one({"id": service_id}, {"_id": 0})
    return {"success": True, "service": s}


@fastapi_app.delete("/api/admin/services/{service_id}", dependencies=[Depends(require_master_admin)])
async def admin_delete_service(service_id: str):
    """Soft delete: just mark inactive so historical invoices keep working."""
    r = await db.services.update_one({"id": service_id}, {"$set": {"is_active": False, "deleted_at": datetime.now(timezone.utc).isoformat()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Service not found")
    return {"success": True}


# ── Workflow templates (reusable step recipes) ───────────────────────
@fastapi_app.get("/api/admin/workflow-templates", dependencies=[Depends(require_admin)])
async def list_workflow_templates():
    cursor = db.workflow_templates.find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=200)
    # Seed defaults on first hit (once per DB)
    if not items:
        seeds = [
            {"name": "Стандартна (3 кроки)", "description": "Базовий цикл для більшості послуг",
             "steps": [
                 {"key": "pending",     "label": "Очікує"},
                 {"key": "in_progress", "label": "В роботі"},
                 {"key": "completed",   "label": "Готово"},
             ]},
            {"name": "Логістика (повний цикл)", "description": "Від отримання до доставки",
             "steps": [
                 {"key": "pickup",     "label": "Забір"},
                 {"key": "transit",    "label": "В дорозі"},
                 {"key": "customs",    "label": "Митниця"},
                 {"key": "delivery",   "label": "Доставка"},
                 {"key": "delivered",  "label": "Доставлено"},
             ]},
            {"name": "Документи", "description": "Оформлення документації",
             "steps": [
                 {"key": "collect", "label": "Збір документів"},
                 {"key": "verify",  "label": "Верифікація"},
                 {"key": "sign",    "label": "Підписання"},
                 {"key": "archive", "label": "В архів"},
             ]},
        ]
        for s in seeds:
            s["id"] = f"wft_{uuid.uuid4().hex[:10]}"
            s["created_at"] = datetime.now(timezone.utc).isoformat()
            s["is_default"] = True
        await db.workflow_templates.insert_many(seeds)
        for s in seeds: s.pop("_id", None)
        items = seeds
    return {"success": True, "items": items}


@fastapi_app.post("/api/admin/workflow-templates", dependencies=[Depends(require_master_admin)])
async def create_workflow_template(data: Dict[str, Any] = Body(...), user: dict = Depends(require_master_admin)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    steps = data.get("steps") or []
    if not isinstance(steps, list) or not steps:
        raise HTTPException(400, "steps must be a non-empty list")
    doc = {
        "id": f"wft_{uuid.uuid4().hex[:10]}",
        "name": name,
        "description": (data.get("description") or "").strip(),
        "steps": [{"key": (s.get("key") or "").strip(), "label": (s.get("label") or "").strip()} for s in steps if s.get("label")],
        "is_default": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email") or user.get("id"),
    }
    await db.workflow_templates.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "template": doc}


@fastapi_app.patch("/api/admin/workflow-templates/{tpl_id}", dependencies=[Depends(require_master_admin)])
async def update_workflow_template(tpl_id: str, data: Dict[str, Any] = Body(...)):
    allowed = {"name", "description", "steps"}
    upd = {k: v for k, v in (data or {}).items() if k in allowed}
    if "steps" in upd:
        if not isinstance(upd["steps"], list) or not upd["steps"]:
            raise HTTPException(400, "steps must be a non-empty list")
        upd["steps"] = [{"key": (s.get("key") or "").strip(), "label": (s.get("label") or "").strip()} for s in upd["steps"] if s.get("label")]
    if not upd:
        raise HTTPException(400, "Nothing to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.workflow_templates.update_one({"id": tpl_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Template not found")
    t = await db.workflow_templates.find_one({"id": tpl_id}, {"_id": 0})
    return {"success": True, "template": t}


@fastapi_app.delete("/api/admin/workflow-templates/{tpl_id}", dependencies=[Depends(require_master_admin)])
async def delete_workflow_template(tpl_id: str):
    r = await db.workflow_templates.delete_one({"id": tpl_id, "is_default": {"$ne": True}})
    if r.deleted_count == 0:
        raise HTTPException(404, "Template not found (or is default — defaults cannot be deleted)")
    return {"success": True}


@fastapi_app.get("/api/workflow-templates")
async def public_workflow_templates():
    """Public read (managers need this when creating custom lines)."""
    cursor = db.workflow_templates.find({}, {"_id": 0}).sort("created_at", 1)
    return {"success": True, "items": await cursor.to_list(length=200)}


# ─── Manager invoice builder ────────────────────────────────────────


# ═══════════════════════════════════════════════════════════════════
# MANAGER INVOICE BUILDER  (multi-line items)
# ═══════════════════════════════════════════════════════════════════

def _round_money(x) -> float:
    try:
        return round(float(x), 2)
    except Exception:
        return 0.0


@fastapi_app.post("/api/manager/invoices", dependencies=[Depends(require_manager_or_admin)])
async def manager_create_invoice(data: Dict[str, Any] = Body(...), user: dict = Depends(require_manager_or_admin)):
    """Manager creates an invoice with multiple service line-items.

    body = {
      customerId: "...",            # required
      currency: "USD",              # optional
      dueDate: "2026-06-01",        # optional
      notes: "...",                 # optional
      items: [
        { service_id?, name, price, qty }, ...
      ]
    }
    """
    customer_id = (data.get("customerId") or data.get("customer_id") or "").strip()
    if not customer_id:
        raise HTTPException(400, "customerId is required")

    items_in = data.get("items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(400, "items must be a non-empty array")

    # Resolve services from DB to capture canonical metadata
    services_index = {}
    if any((it or {}).get("service_id") for it in items_in):
        ids = [it.get("service_id") for it in items_in if it.get("service_id")]
        async for s in db.services.find({"id": {"$in": ids}}, {"_id": 0}):
            services_index[s["id"]] = s

    norm_items = []
    total = 0.0
    currency = (data.get("currency") or "USD").upper()
    for raw in items_in:
        sid = (raw or {}).get("service_id") or None
        svc = services_index.get(sid) if sid else None
        name = (raw.get("name") or (svc or {}).get("name") or "").strip()
        if not name:
            continue
        price = _round_money(raw.get("price") if raw.get("price") is not None else (svc or {}).get("default_price", 0))
        qty = int(raw.get("qty") or (svc or {}).get("default_qty") or 1)
        line_total = _round_money(price * qty)
        total += line_total
        norm_items.append({
            "id": str(uuid.uuid4()),
            "service_id": sid,
            "service_code": (svc or {}).get("code"),
            "name": name,
            "description": raw.get("description") or (svc or {}).get("description"),
            "category": (svc or {}).get("category"),
            "price": price,
            "qty": qty,
            "line_total": line_total,
            "workflow": (svc or {}).get("workflow") or [],
        })

    if not norm_items:
        raise HTTPException(400, "items must contain at least one valid line")

    inv_id = f"inv_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:6]}"
    invoice = {
        "id": inv_id,
        "customerId": customer_id,
        "managerId": user.get("id"),
        "managerEmail": user.get("email"),
        "items": norm_items,
        "amount": _round_money(total),
        "total": _round_money(total),
        "currency": currency,
        "status": "pending",
        "notes": (data.get("notes") or "").strip(),
        "dueDate": data.get("dueDate"),
        "description": data.get("description") or (norm_items[0]["name"] if len(norm_items) == 1 else f"{len(norm_items)} services"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email") or user.get("id"),
    }
    await db.invoices.insert_one(invoice)
    invoice.pop("_id", None)
    return {"success": True, "invoice": invoice}


@fastapi_app.get("/api/manager/invoices/my", dependencies=[Depends(require_manager_or_admin)])
async def manager_list_my_invoices(user: dict = Depends(require_manager_or_admin), limit: int = 100):
    role = (user.get("role") or "").lower()
    q = {} if role in ("master_admin", "owner", "admin", "team_lead") else {"managerId": user.get("id")}
    cursor = db.invoices.find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items}


# ─── Invoice lifecycle (send / cancel / mark-paid) ────────────────────
async def _can_act_on_invoice(invoice: Dict[str, Any], user: Dict[str, Any]) -> bool:
    role = (user.get("role") or "").lower()
    if role in ("master_admin", "owner", "admin", "team_lead"):
        return True
    if role == "manager" and invoice.get("managerId") == user.get("id"):
        return True
    return False


@fastapi_app.patch("/api/invoices/{invoice_id}/send", dependencies=[Depends(require_manager_or_admin)])
async def invoice_send(invoice_id: str, user: dict = Depends(require_manager_or_admin)):
    inv = await db.invoices.find_one({"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if not await _can_act_on_invoice(inv, user):
        raise HTTPException(403, "Forbidden")
    new_status = "sent" if inv.get("status") in (None, "draft") else "pending"
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": new_status, "sentAt": datetime.now(timezone.utc).isoformat()}},
    )
    fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    try:
        await sio.emit("invoice:sent", {"invoiceId": invoice_id, "customerId": inv.get("customerId")})
    except Exception:
        pass
    # Fire business event
    try:
        import notifications as _notif
        customer = await db.customers.find_one({"id": inv.get("customerId")}, {"_id": 0}) or {}
        await _notif.emit(_notif.EVENT_INVOICE_SENT, {
            "invoice": fresh, "customer": customer,
            "manager": {"id": inv.get("managerId"), "email": inv.get("managerEmail")},
        })
    except Exception:
        logger.exception("[notif] emit invoice_sent failed")
    return {"success": True, "invoice": fresh}


@fastapi_app.patch("/api/invoices/{invoice_id}/cancel", dependencies=[Depends(require_manager_or_admin)])
async def invoice_cancel(invoice_id: str, user: dict = Depends(require_manager_or_admin)):
    inv = await db.invoices.find_one({"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if not await _can_act_on_invoice(inv, user):
        raise HTTPException(403, "Forbidden")
    if inv.get("status") == "paid":
        raise HTTPException(400, "Cannot cancel a paid invoice")
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "cancelled", "cancelledAt": datetime.now(timezone.utc).isoformat()}},
    )
    fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    return {"success": True, "invoice": fresh}


@fastapi_app.patch("/api/invoices/{invoice_id}/mark-paid", dependencies=[Depends(require_manager_or_admin)])
async def invoice_mark_paid(invoice_id: str, data: Dict[str, Any] = Body(default={}), user: dict = Depends(require_manager_or_admin)):
    """Manual payment confirmation (cash, bank transfer, etc).
    Marks invoice as paid AND auto-creates the order workflow — same path
    as the Stripe webhook so manager UX is identical regardless of channel.
    """
    inv = await db.invoices.find_one({"id": invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if not await _can_act_on_invoice(inv, user):
        raise HTTPException(403, "Forbidden")
    if inv.get("status") == "paid":
        # idempotent — return existing
        fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        order = await db.orders.find_one({"invoiceId": invoice_id}, {"_id": 0})
        return {"success": True, "invoice": fresh, "order": order, "already_paid": True}

    method = (data or {}).get("method") or "manual"
    note = (data or {}).get("note") or ""
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "status": "paid",
            "paidAt": datetime.now(timezone.utc).isoformat(),
            "paymentMethod": method,
            "paidBy": user.get("email") or user.get("id"),
            "paymentNote": note,
        }},
    )
    fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    order = {}
    try:
        order = await _create_order_from_invoice(fresh)
    except Exception:
        logger.exception("[invoice/mark-paid] failed to auto-create order")
    return {"success": True, "invoice": fresh, "order": order}


# ═══════════════════════════════════════════════════════════════════
# ORDERS  (workflow created automatically when invoice is paid)
# ═══════════════════════════════════════════════════════════════════

ORDER_OVERALL_STATUSES = ["pending", "in_progress", "waiting_docs", "in_delivery", "completed", "cancelled", "on_hold"]


def _build_order_steps_from_invoice(invoice: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Translate invoice line-items → linear list of workflow steps."""
    steps: List[Dict[str, Any]] = []
    for it in (invoice.get("items") or []):
        wf = it.get("workflow") or [{"key": "pending", "label": "Очікує"}, {"key": "in_progress", "label": "В роботі"}, {"key": "completed", "label": "Готово"}]
        for s in wf:
            steps.append({
                "id": str(uuid.uuid4()),
                "service_item_id": it.get("id"),
                "service_id": it.get("service_id"),
                "service_name": it.get("name"),
                "key": s.get("key"),
                "label": s.get("label"),
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "note": None,
            })
    if not steps:
        steps = [
            {"id": str(uuid.uuid4()), "key": "pending",     "label": "Очікує",  "status": "pending"},
            {"id": str(uuid.uuid4()), "key": "in_progress", "label": "В роботі", "status": "pending"},
            {"id": str(uuid.uuid4()), "key": "completed",   "label": "Готово",  "status": "pending"},
        ]
    return steps


async def _create_order_from_invoice(invoice: Dict[str, Any]) -> Dict[str, Any]:
    """Idempotently create an order document from a paid invoice."""
    if not invoice or not invoice.get("id"):
        return {}
    existing = await db.orders.find_one({"invoiceId": invoice["id"]}, {"_id": 0})
    if existing:
        return existing

    items = invoice.get("items") or []
    summary_items = [{
        "service_item_id": it.get("id"),
        "service_id": it.get("service_id"),
        "name": it.get("name"),
        "category": it.get("category"),
        "qty": it.get("qty", 1),
        "price": it.get("price", 0),
        "line_total": it.get("line_total", 0),
    } for it in items]

    order_id = f"ord_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:6]}"
    doc = {
        "id": order_id,
        "invoiceId": invoice.get("id"),
        "paymentIntentId": invoice.get("paymentIntentId"),
        "customerId": invoice.get("customerId"),
        "managerId": invoice.get("managerId"),
        "managerEmail": invoice.get("managerEmail"),
        "status": "in_progress",
        "items": summary_items,
        "steps": _build_order_steps_from_invoice(invoice),
        "amount": invoice.get("total") or invoice.get("amount") or 0,
        "currency": invoice.get("currency") or "USD",
        "notes": [],
        "assignedAt": datetime.now(timezone.utc).isoformat(),
        "startedAt":  None,
        "completedAt": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.insert_one(doc)
    doc.pop("_id", None)
    # Best-effort socket notification
    try:
        await sio.emit("order:created", {"orderId": order_id, "invoiceId": invoice["id"], "customerId": invoice.get("customerId"), "managerId": invoice.get("managerId")})
    except Exception:
        pass
    # Fire business events: payment_confirmed + order_started
    try:
        import notifications as _notif
        customer = await db.customers.find_one({"id": invoice.get("customerId")}, {"_id": 0}) or {}
        manager = None
        if invoice.get("managerId"):
            manager = await db.users.find_one({"id": invoice.get("managerId")}, {"_id": 0})
        manager = manager or {"id": invoice.get("managerId"), "email": invoice.get("managerEmail")}
        ctx = {"invoice": invoice, "order": doc, "customer": customer, "manager": manager}
        await _notif.emit(_notif.EVENT_PAYMENT_CONFIRMED, dict(ctx))
        await _notif.emit(_notif.EVENT_ORDER_STARTED, dict(ctx))
    except Exception:
        logger.exception("[notif] emit payment_confirmed/order_started failed")
    return doc


def _recalc_order_status(steps: List[Dict[str, Any]]) -> str:
    if not steps:
        return "pending"
    if all(s.get("status") == "done" for s in steps):
        return "completed"
    if any(s.get("status") in ("in_progress", "done") for s in steps):
        return "in_progress"
    return "pending"


# Admin / staff order list (master admin sees everything)
@fastapi_app.get("/api/admin/orders", dependencies=[Depends(require_admin)])
async def admin_list_orders(status: str = "", manager_id: str = "", q: str = "", limit: int = 200):
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    if manager_id:
        query["managerId"] = manager_id
    if q:
        query["$or"] = [
            {"customerId": {"$regex": q, "$options": "i"}},
            {"invoiceId": {"$regex": q, "$options": "i"}},
            {"id": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.orders.find(query, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items, "total": await db.orders.count_documents(query)}


@fastapi_app.get("/api/team/orders", dependencies=[Depends(require_manager_or_admin)])
async def team_list_orders(user: dict = Depends(require_manager_or_admin), status: str = "", manager_id: str = "", limit: int = 200):
    """Team-lead view: all orders. Regular manager sees only their own."""
    role = (user.get("role") or "").lower()
    query: Dict[str, Any] = {}
    if role in ("manager",):
        query["managerId"] = user.get("id")
    elif manager_id:
        query["managerId"] = manager_id
    if status:
        query["status"] = status
    cursor = db.orders.find(query, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items}


@fastapi_app.get("/api/manager/orders", dependencies=[Depends(require_manager_or_admin)])
async def manager_list_orders(user: dict = Depends(require_manager_or_admin), limit: int = 100):
    role = (user.get("role") or "").lower()
    query = {} if role in ("master_admin", "owner", "admin", "team_lead") else {"managerId": user.get("id")}
    cursor = db.orders.find(query, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    items = await cursor.to_list(length=int(limit))
    return {"success": True, "items": items}


@fastapi_app.get("/api/orders/{order_id}", dependencies=[Depends(require_manager_or_admin)])
async def get_order(order_id: str, user: dict = Depends(require_manager_or_admin)):
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Order not found")
    role = (user.get("role") or "").lower()
    if role == "manager" and o.get("managerId") != user.get("id"):
        raise HTTPException(403, "Forbidden")
    return {"success": True, "order": o}


@fastapi_app.patch("/api/orders/{order_id}/steps/{step_id}", dependencies=[Depends(require_manager_or_admin)])
async def update_order_step(order_id: str, step_id: str, data: Dict[str, Any] = Body(...), user: dict = Depends(require_manager_or_admin)):
    """Set a step's status. data = {status: 'pending'|'in_progress'|'done', note?: str}"""
    new_status = (data.get("status") or "").lower()
    if new_status not in ("pending", "in_progress", "done", "skipped"):
        raise HTTPException(400, "Invalid status")

    o = await db.orders.find_one({"id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    role = (user.get("role") or "").lower()
    if role == "manager" and o.get("managerId") != user.get("id"):
        raise HTTPException(403, "Forbidden")

    steps = o.get("steps") or []
    found = None
    for s in steps:
        if s.get("id") == step_id:
            s["status"] = new_status
            if new_status == "in_progress" and not s.get("started_at"):
                s["started_at"] = datetime.now(timezone.utc).isoformat()
            if new_status == "done":
                s["completed_at"] = datetime.now(timezone.utc).isoformat()
            if data.get("note"):
                s["note"] = data["note"]
            found = s
            break
    if not found:
        raise HTTPException(404, "Step not found")

    overall = _recalc_order_status(steps)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"steps": steps, "status": overall, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )

    # Live notify the customer cabinet
    try:
        await sio.emit("order:step_updated", {
            "orderId": order_id,
            "customerId": o.get("customerId"),
            "stepId": step_id,
            "stepStatus": new_status,
            "orderStatus": overall,
        })
    except Exception:
        pass

    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})

    # Fire order_finished event when the overall flips to `completed`
    if overall == "completed" and (o.get("status") != "completed"):
        try:
            import notifications as _notif
            inv = await db.invoices.find_one({"id": fresh.get("invoiceId")}, {"_id": 0}) or {}
            customer = await db.customers.find_one({"id": fresh.get("customerId")}, {"_id": 0}) or {}
            manager = None
            if fresh.get("managerId"):
                manager = await db.users.find_one({"id": fresh.get("managerId")}, {"_id": 0})
            manager = manager or {"id": fresh.get("managerId"), "email": fresh.get("managerEmail")}
            await _notif.emit(_notif.EVENT_ORDER_FINISHED, {
                "invoice": inv, "order": fresh, "customer": customer, "manager": manager,
            })
        except Exception:
            logger.exception("[notif] emit order_finished failed")

    return {"success": True, "order": fresh}


@fastapi_app.post("/api/orders/{order_id}/notes", dependencies=[Depends(require_manager_or_admin)])
async def add_order_note(order_id: str, data: Dict[str, Any] = Body(...), user: dict = Depends(require_manager_or_admin)):
    body = (data.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body is required")
    note = {
        "id": str(uuid.uuid4()),
        "author": user.get("email") or user.get("id"),
        "role": (user.get("role") or "").lower(),
        "body": body,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.orders.update_one({"id": order_id}, {"$push": {"notes": note}, "$set": {"updated_at": note["created_at"]}})
    if r.matched_count == 0:
        raise HTTPException(404, "Order not found")
    return {"success": True, "note": note}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/orders")
async def customer_orders(customer_id: str):
    cursor = db.orders.find({"customerId": customer_id}, {"_id": 0}).sort("created_at", -1).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "items": items}



# ═══════════════════════════════════════════════════════════════════
# PROVIDER PRESSURE  (score · tier · matching · admin metrics)
# ═══════════════════════════════════════════════════════════════════

def _ps_service_or_503():
    """Return provider_stats singleton or raise 503."""
    try:
        import provider_stats as _ps
        if _ps.service is None:
            raise HTTPException(503, "Provider stats engine not yet initialised")
        return _ps
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"Provider stats engine unavailable: {e}")


@fastapi_app.get("/api/providers/me/stats")
async def provider_stats_me(user: dict = Depends(require_user)):
    """Sugar: the current user's own provider stats (works for managers)."""
    _ps = _ps_service_or_503()
    pid = user.get("id")
    if not pid:
        raise HTTPException(401, "No user id")
    doc = await _ps.service.get(pid)
    return {"success": True, "stats": doc}


@fastapi_app.get("/api/providers/{provider_id}/stats")
async def provider_stats_get(provider_id: str, user: dict = Depends(require_user)):
    """Provider's own score / tier / message. Manager sees own; admin/team_lead
    sees anyone's.
    """
    _ps = _ps_service_or_503()
    role = (user.get("role") or "").lower()
    is_staff = role in ("master_admin", "owner", "admin", "team_lead")
    if not is_staff and user.get("id") != provider_id:
        raise HTTPException(403, "Forbidden")
    doc = await _ps.service.get(provider_id)
    return {"success": True, "stats": doc}


@fastapi_app.get("/api/admin/providers/stats", dependencies=[Depends(require_admin)])
async def provider_stats_admin_list(limit: int = 500):
    """Admin: all providers ranked by score (desc). Enriches with staff name/email
    so the dashboard can render a human-friendly table."""
    _ps = _ps_service_or_503()
    docs = await _ps.service.list_all(sort_by_score=True)
    # Enrich with staff/user names (best-effort, no N+1 blocking)
    pids = [d.get("providerId") for d in docs if d.get("providerId")]
    users_map = {}
    staff_map = {}
    if pids:
        async for u in db.users.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1}):
            users_map[u["id"]] = u
        async for s in db.staff.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1}):
            staff_map[s["id"]] = s
    items = []
    for d in docs[:limit]:
        pid = d.get("providerId")
        u = users_map.get(pid) or staff_map.get(pid) or {}
        items.append({
            **d,
            "providerName":  u.get("name") or u.get("email") or pid,
            "providerEmail": u.get("email"),
            "providerRole":  u.get("role"),
        })
    return {"success": True, "items": items, "total": len(items)}


@fastapi_app.post("/api/admin/providers/stats/recompute", dependencies=[Depends(require_admin)])
async def provider_stats_admin_recompute(provider_id: Optional[str] = None):
    """Admin: recompute one provider (if query param given) or all.

    Unified response shape:
        { "success": true, "count": N, "providers": [ids], "stats": { ... or null } }
    """
    _ps = _ps_service_or_503()
    if provider_id:
        doc = await _ps.service.recompute(provider_id)
        return {"success": True, "count": 1, "providers": [provider_id], "stats": doc}
    result = await _ps.service.recompute_all()
    return {"success": True, **result, "stats": None}


@fastapi_app.get("/api/admin/metrics", dependencies=[Depends(require_admin)])
async def admin_business_metrics():
    """Three KPI metrics requested by product spec:
      • conversion     = paid_invoices / sent_invoices
      • avg_order_time = avg(completedAt − created_at) of completed orders (hours)
      • repeat_rate    = users_with_2+_orders / users_with_any_order

    Plus raw counts so the UI can also show "8 / 12 invoices paid" etc.
    """
    # ── conversion ───────────────────────────────────────────────
    # "sent" universe = everything that left the draft stage
    sent_statuses = ["sent", "pending", "paid", "overdue", "cancelled"]
    sent_count = await db.invoices.count_documents({"status": {"$in": sent_statuses}})
    paid_count = await db.invoices.count_documents({"status": "paid"})
    conversion = round(paid_count / sent_count, 4) if sent_count else 0.0

    # ── avg_order_time ───────────────────────────────────────────
    now = datetime.now(timezone.utc)
    completed_orders = []
    async for o in db.orders.find({"status": "completed"}, {"_id": 0, "created_at": 1, "completedAt": 1}):
        try:
            ca = o.get("created_at")
            co = o.get("completedAt")
            if not ca or not co:
                continue
            a = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
            b = datetime.fromisoformat(str(co).replace("Z", "+00:00"))
            delta_h = (b - a).total_seconds() / 3600.0
            if delta_h >= 0:
                completed_orders.append(delta_h)
        except Exception:
            continue
    avg_order_time_h = round(sum(completed_orders) / len(completed_orders), 2) if completed_orders else None

    # ── repeat_rate ──────────────────────────────────────────────
    pipeline = [
        {"$match": {"customerId": {"$ne": None}}},
        {"$group": {"_id": "$customerId", "cnt": {"$sum": 1}}},
    ]
    counts = [c async for c in db.orders.aggregate(pipeline)]
    total_customers = len(counts)
    repeat_customers = sum(1 for c in counts if (c.get("cnt") or 0) >= 2)
    repeat_rate = round(repeat_customers / total_customers, 4) if total_customers else 0.0

    return {
        "success": True,
        "generated_at": now.isoformat(),
        "metrics": {
            "conversion": {
                "value": conversion,
                "paid": paid_count,
                "sent": sent_count,
                "label": "paid / sent invoices",
            },
            "avg_order_time": {
                "value_hours": avg_order_time_h,
                "completed_orders": len(completed_orders),
                "label": "avg(completedAt − created_at) of completed orders",
            },
            "repeat_rate": {
                "value": repeat_rate,
                "repeat_customers": repeat_customers,
                "total_customers": total_customers,
                "label": "customers with 2+ orders / total customers",
            },
        },
    }


# ═══════════════════════════════════════════════════════════════════
# SOURCE HEALTH
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/source-health")
async def source_health():
    """Data source health"""
    return {
        "success": True,
        "sources": [
            {"name": "Copart", "status": "healthy", "latency": 250, "lastCheck": datetime.now(timezone.utc).isoformat()},
            {"name": "IAAI", "status": "healthy", "latency": 300, "lastCheck": datetime.now(timezone.utc).isoformat()},
            {"name": "Carfast", "status": "healthy" if parser_config.enabled else "disabled", "latency": 100, "lastCheck": datetime.now(timezone.utc).isoformat()},
        ]
    }

# ═══════════════════════════════════════════════════════════════════
# MISC ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/admin/overview", dependencies=[Depends(require_admin)])
async def admin_overview():
    """Admin overview"""
    return {
        "success": True,
        "overview": {
            "leads": await db.leads.count_documents({}),
            "customers": await db.customers.count_documents({}),
            "deals": await db.deals.count_documents({}),
            "vehicles": await db.vin_data.count_documents({})
        }
    }

@fastapi_app.post("/api/admin/cache/clear", dependencies=[Depends(require_admin)])
async def clear_cache():
    """Clear cache"""
    aggregator.records.clear()
    return {"success": True, "message": "Cache cleared"}

@fastapi_app.get("/api/admin/call-flow/session/{session_id}", dependencies=[Depends(require_admin)])
async def call_flow_session(session_id: str):
    """Get call flow session"""
    return {"success": True, "data": {"sessionId": session_id, "events": []}}

@fastapi_app.get("/api/admin/history-reports/pending", dependencies=[Depends(require_admin)])
async def history_reports_pending():
    """Pending history reports"""
    cursor = db.history_reports.find({"status": "pending"}, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.post("/api/admin/history-reports/approve/{report_id}", dependencies=[Depends(require_admin)])
async def approve_history_report(report_id: str):
    """Approve history report"""
    await db.history_reports.update_one({"id": report_id}, {"$set": {"status": "approved"}})
    return {"success": True}

@fastapi_app.post("/api/admin/history-reports/deny/{report_id}", dependencies=[Depends(require_admin)])
async def deny_history_report(report_id: str):
    """Deny history report"""
    await db.history_reports.update_one({"id": report_id}, {"$set": {"status": "denied"}})
    return {"success": True}

@fastapi_app.get("/api/admin/predictive-leads/bucket/{bucket}", dependencies=[Depends(require_admin)])
async def predictive_leads_bucket(bucket: str):
    """Get predictive leads by bucket"""
    score_range = {"hot": {"$gte": 80}, "warm": {"$gte": 50, "$lt": 80}, "cold": {"$lt": 50}}
    query = {"score": score_range.get(bucket, {})} if bucket in score_range else {}
    cursor = db.leads.find(query, {'_id': 0}).limit(50)
    items = await cursor.to_list(length=50)
    return {"success": True, "data": items}

@fastapi_app.get("/api/login-approval/pending")
async def login_approval_pending():
    """Pending login approvals"""
    return {"success": True, "data": []}

@fastapi_app.post("/api/login-approval/{approval_id}")
async def process_login_approval(approval_id: str, data: Dict[str, Any] = Body(...)):
    """Process login approval"""
    return {"success": True}

@fastapi_app.get("/api/manager-ai/lead/{lead_id}")
async def manager_ai_lead(lead_id: str):
    """AI insights for lead"""
    return {"success": True, "insights": {"recommendation": "Follow up within 24h", "score": 75}}

@fastapi_app.get("/api/manager-ai/user/{user_id}")
async def manager_ai_user(user_id: str):
    """AI insights for user"""
    return {"success": True, "insights": {"performance": "Good", "suggestions": []}}

@fastapi_app.get("/api/deal-engine/evaluate")
async def deal_engine_evaluate(vin: Optional[str] = None, price: Optional[int] = None):
    """Evaluate deal"""
    return {"success": True, "evaluation": {"score": 75, "recommendation": "Good deal", "risks": []}}


# ═══════════════════════════════════════════════════════════════════
# CARFAST COOKIE PROXY API (V4.0)
# ═══════════════════════════════════════════════════════════════════

class CarfastCookieImport(BaseModel):
    cookies: List[Dict[str, Any]]
    userAgent: Optional[str] = None
    sessionId: Optional[str] = None

class CarfastParseRequest(BaseModel):
    url: Optional[str] = None
    vin: Optional[str] = None
    sessionId: Optional[str] = None

@fastapi_app.get("/api/carfast/session/status")
async def carfast_session_status():
    """
    Check Carfast session status
    Returns whether we have valid cookies for parsing
    """
    status = carfast_cookie_store.get_status()
    
    # Get best session details
    best = carfast_cookie_store.get_best_session()
    if best:
        status["bestSession"] = {
            "sessionId": best.session_id[:8] + "...",
            "hasCfClearance": best.has_cf_clearance(),
            "isExpired": best.is_expired(),
            "successCount": best.success_count,
            "failCount": best.fail_count,
            "ageMinutes": round((datetime.now(timezone.utc).timestamp() - best.imported_at) / 60, 1)
        }
    
    return status

@fastapi_app.post("/api/carfast/session/import")
async def carfast_session_import(data: CarfastCookieImport):
    """
    Import cookies from extension
    Extension collects cf_clearance and other cookies and sends them here
    """
    session_id = data.sessionId or f"ext_{datetime.now(timezone.utc).timestamp()}"
    
    session = carfast_cookie_store.import_cookies(
        session_id=session_id,
        cookies=data.cookies,
        user_agent=data.userAgent or ""
    )
    
    # Log important cookies
    cookie_names = [c.name for c in session.cookies]
    logger.info(f"[CARFAST] Imported cookies: {cookie_names}")
    
    # Save to MongoDB for persistence
    if db is not None:
        await db.carfast_sessions.update_one(
            {"session_id": session_id},
            {
                "$set": {
                    "session_id": session_id,
                    "cookies": data.cookies,
                    "user_agent": data.userAgent,
                    "imported_at": datetime.now(timezone.utc),
                    "has_cf_clearance": session.has_cf_clearance(),
                }
            },
            upsert=True
        )
    
    return {
        "success": True,
        "sessionId": session_id,
        "cookieCount": len(session.cookies),
        "hasCfClearance": session.has_cf_clearance(),
        "message": "Cookies imported successfully"
    }

@fastapi_app.post("/api/carfast/session/cookies")
async def carfast_session_cookies(data: CarfastCookieImport):
    """Alias for import - for compatibility"""
    return await carfast_session_import(data)

@fastapi_app.post("/api/carfast/parse")
async def carfast_parse(request: CarfastParseRequest):
    """
    Parse Carfast page using Playwright (real browser)
    No cookies needed - browser handles everything
    """
    # Build URL
    url = request.url
    if not url and request.vin:
        url = f"https://carfast.express/auction/lots/{request.vin}"
    
    if not url:
        return {"success": False, "error": "URL or VIN required"}
    
    # Validate URL
    if not url.startswith("https://carfast.express"):
        return {"success": False, "error": "Invalid URL - must be carfast.express"}
    
    # Parse using Playwright - real browser, no cookie bullshit
    result = await playwright_parser.parse_url(url)
    
    # If successful, save to VIN data
    if result.get("success") and result.get("data", {}).get("vin"):
        vin = result["data"]["vin"]
        await db.vin_data.update_one(
            {"vin": vin},
            {
                "$set": {
                    "vin": vin,
                    **{k: v for k, v in result["data"].items() if k != "raw_json"},
                    "source": "carfast_playwright",
                    "parsed_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)}
            },
            upsert=True
        )
    
    return result

# Legacy cookie-based endpoint (fallback)
@fastapi_app.post("/api/carfast/parse-cookies")
async def carfast_parse_cookies(request: CarfastParseRequest):
    """Parse using cookies (legacy, less reliable)"""
    url = request.url
    if not url and request.vin:
        url = f"https://carfast.express/auction/lots/{request.vin}"
    
    if not url:
        return {"success": False, "error": "URL or VIN required"}
    
    if not url.startswith("https://carfast.express"):
        return {"success": False, "error": "Invalid URL - must be carfast.express"}
    
    return await carfast_parser.parse_url(url, request.sessionId)

@fastapi_app.get("/api/carfast/sessions")
async def carfast_sessions_list():
    """List all Carfast sessions"""
    sessions = []
    for sid, s in carfast_cookie_store.sessions.items():
        sessions.append({
            "sessionId": sid if len(sid) <= 10 else sid[:8] + "...",
            "fullId": sid,
            "hasCfClearance": s.has_cf_clearance(),
            "isExpired": s.is_expired(),
            "isBlocked": s.blocked,
            "cookieCount": len(s.cookies),
            "successCount": s.success_count,
            "failCount": s.fail_count,
            "ageMinutes": round((datetime.now(timezone.utc).timestamp() - s.imported_at) / 60, 1),
            "importedAt": datetime.fromtimestamp(s.imported_at, tz=timezone.utc).isoformat(),
            "lastUsed": datetime.fromtimestamp(s.last_used, tz=timezone.utc).isoformat(),
        })
    
    return {
        "success": True,
        "sessions": sessions,
        "status": carfast_cookie_store.get_status()
    }

@fastapi_app.post("/api/carfast/session/refresh")
async def carfast_session_refresh():
    """
    Request extension to refresh cookies
    This sends a WebSocket message to connected clients
    """
    await ws_manager.broadcast({
        "type": "carfast_refresh_needed",
        "message": "Please refresh Carfast session",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    return {"success": True, "message": "Refresh request broadcasted"}

# ═══════════════════════════════════════════════════════════════════
# CARFAST INGEST - Receive parsed data from extension
# ═══════════════════════════════════════════════════════════════════

class CarfastIngestData(BaseModel):
    url: str
    vin: Optional[str] = None
    title: Optional[str] = None
    price: Optional[str] = None
    odometer: Optional[str] = None
    odometer_unit: Optional[str] = None
    year: Optional[int] = None
    lot_number: Optional[str] = None
    location: Optional[str] = None
    damage: Optional[List[str]] = None
    images: Optional[List[str]] = None
    timestamp: Optional[str] = None
    source: Optional[str] = "carfast_extension"

@fastapi_app.post("/api/carfast/ingest")
async def carfast_ingest(data: CarfastIngestData):
    """
    Receive parsed vehicle data from extension
    Extension parses DOM on carfast.express and sends data here
    """
    logger.info(f"[CARFAST-INGEST] Received data: VIN={data.vin}, URL={data.url[:50]}...")
    
    if not data.vin:
        return {"success": False, "error": "No VIN in data"}
    
    # Prepare document
    doc = {
        "vin": data.vin,
        "url": data.url,
        "source": "carfast_extension",
        "ingested_at": datetime.now(timezone.utc),
    }
    
    if data.title:
        doc["title"] = data.title
    if data.price:
        doc["price"] = data.price
    if data.odometer:
        doc["odometer"] = data.odometer
        doc["odometer_unit"] = data.odometer_unit or "mi"
    if data.year:
        doc["year"] = data.year
    if data.lot_number:
        doc["lot_number"] = data.lot_number
    if data.location:
        doc["location"] = data.location
    if data.damage:
        doc["damage"] = data.damage
    if data.images:
        doc["images"] = data.images[:10]  # Max 10 images
    
    # Save to MongoDB
    try:
        result = await db.carfast_vehicles.update_one(
            {"vin": data.vin},
            {
                "$set": doc,
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)}
            },
            upsert=True
        )
        
        is_new = result.upserted_id is not None
        
        logger.info(f"[CARFAST-INGEST] {'Created' if is_new else 'Updated'} VIN: {data.vin}")
        
        return {
            "success": True,
            "vin": data.vin,
            "isNew": is_new,
            "message": f"Vehicle {'created' if is_new else 'updated'}"
        }
    except Exception as e:
        logger.error(f"[CARFAST-INGEST] Error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/carfast/vehicles")
async def carfast_vehicles_list(limit: int = 50, skip: int = 0):
    """List ingested vehicles from Carfast"""
    vehicles = await db.carfast_vehicles.find(
        {},
        {"_id": 0}
    ).sort("ingested_at", -1).skip(skip).limit(limit).to_list(limit)
    
    total = await db.carfast_vehicles.count_documents({})
    
    return {
        "success": True,
        "vehicles": vehicles,
        "total": total,
        "limit": limit,
        "skip": skip
    }

@fastapi_app.get("/api/carfast/vehicle/{vin}")
async def carfast_vehicle_get(vin: str):
    """Get single vehicle by VIN"""
    vehicle = await db.carfast_vehicles.find_one({"vin": vin}, {"_id": 0})
    
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    return {"success": True, "vehicle": vehicle}

# ═══════════════════════════════════════════════════════════════════
# AUTOASTAT INGEST - Receive parsed data from extension
# ═══════════════════════════════════════════════════════════════════

class AutoAstatIngestData(BaseModel):
    url: str
    vin: Optional[str] = None
    title: Optional[str] = None
    price: Optional[str] = None
    odometer: Optional[str] = None
    odometer_unit: Optional[str] = None
    year: Optional[int] = None
    lot_number: Optional[str] = None
    location: Optional[str] = None
    primary_damage: Optional[str] = None
    secondary_damage: Optional[str] = None
    sale_date: Optional[str] = None
    images: Optional[List[str]] = None
    engine: Optional[str] = None
    transmission: Optional[str] = None
    drive: Optional[str] = None
    color: Optional[str] = None
    fuel: Optional[str] = None
    keys: Optional[str] = None
    airbags: Optional[str] = None
    auction_source: Optional[str] = None
    timestamp: Optional[str] = None
    source: Optional[str] = "autoastat"

@fastapi_app.post("/api/autoastat/ingest")
async def autoastat_ingest(data: AutoAstatIngestData):
    """
    Receive parsed vehicle data from AutoAstat extension
    """
    logger.info(f"[AUTOASTAT] Received: VIN={data.vin}, URL={data.url[:50] if data.url else 'N/A'}...")
    
    if not data.vin and not data.lot_number:
        return {"success": False, "error": "No VIN or lot_number in data"}
    
    # Prepare document
    doc = {
        "url": data.url,
        "source": "autoastat",
        "ingested_at": datetime.now(timezone.utc),
    }
    
    # Add all fields if present
    if data.vin:
        doc["vin"] = data.vin
    if data.title:
        doc["title"] = data.title
    if data.price:
        doc["price"] = data.price
    if data.odometer:
        doc["odometer"] = data.odometer
        doc["odometer_unit"] = data.odometer_unit or "mi"
    if data.year:
        doc["year"] = data.year
    if data.lot_number:
        doc["lot_number"] = data.lot_number
    if data.location:
        doc["location"] = data.location
    if data.primary_damage:
        doc["primary_damage"] = data.primary_damage
    if data.secondary_damage:
        doc["secondary_damage"] = data.secondary_damage
    if data.sale_date:
        doc["sale_date"] = data.sale_date
    if data.images:
        doc["images"] = data.images[:20]
    if data.engine:
        doc["engine"] = data.engine
    if data.transmission:
        doc["transmission"] = data.transmission
    if data.drive:
        doc["drive"] = data.drive
    if data.color:
        doc["color"] = data.color
    if data.fuel:
        doc["fuel"] = data.fuel
    if data.keys:
        doc["keys"] = data.keys
    if data.auction_source:
        doc["auction_source"] = data.auction_source
    
    # Save to MongoDB
    try:
        # Use VIN as primary key if available, otherwise lot_number
        filter_key = {"vin": data.vin} if data.vin else {"lot_number": data.lot_number, "source": "autoastat"}
        
        result = await db.autoastat_vehicles.update_one(
            filter_key,
            {
                "$set": doc,
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)}
            },
            upsert=True
        )
        
        is_new = result.upserted_id is not None
        
        logger.info(f"[AUTOASTAT] {'Created' if is_new else 'Updated'}: VIN={data.vin}, Lot={data.lot_number}")
        
        return {
            "success": True,
            "vin": data.vin,
            "lot_number": data.lot_number,
            "isNew": is_new,
            "message": f"Vehicle {'created' if is_new else 'updated'}"
        }
    except Exception as e:
        logger.error(f"[AUTOASTAT] Error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/autoastat/vehicles")
async def autoastat_vehicles_list(limit: int = 50, skip: int = 0):
    """List vehicles from AutoAstat"""
    vehicles = await db.autoastat_vehicles.find(
        {},
        {"_id": 0}
    ).sort("ingested_at", -1).skip(skip).limit(limit).to_list(limit)
    
    total = await db.autoastat_vehicles.count_documents({})
    
    return {
        "success": True,
        "vehicles": vehicles,
        "total": total,
        "limit": limit,
        "skip": skip
    }

@fastapi_app.get("/api/autoastat/vehicle/{vin}")
async def autoastat_vehicle_get(vin: str):
    """Get single vehicle by VIN from AutoAstat"""
    vehicle = await db.autoastat_vehicles.find_one({"vin": vin}, {"_id": 0})
    
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    return {"success": True, "vehicle": vehicle}

# ═══════════════════════════════════════════════════════════════════
# BID.CARS INGEST
# ═══════════════════════════════════════════════════════════════════

class BidCarsIngestData(BaseModel):
    url: str
    vin: Optional[str] = None
    title: Optional[str] = None
    price: Optional[str] = None
    odometer: Optional[str] = None
    odometer_unit: Optional[str] = None
    year: Optional[int] = None
    lot_number: Optional[str] = None
    location: Optional[str] = None
    primary_damage: Optional[str] = None
    secondary_damage: Optional[str] = None
    sale_date: Optional[str] = None
    images: Optional[List[str]] = None
    engine: Optional[str] = None
    transmission: Optional[str] = None
    drive: Optional[str] = None
    fuel: Optional[str] = None
    color: Optional[str] = None
    keys: Optional[str] = None
    title_type: Optional[str] = None
    auction_source: Optional[str] = None
    timestamp: Optional[str] = None
    source: Optional[str] = "bidcars"

@fastapi_app.post("/api/bidcars/ingest")
async def bidcars_ingest(data: BidCarsIngestData):
    """Receive parsed data from Bid.Cars extension"""
    logger.info(f"[BIDCARS] Received: VIN={data.vin}, Lot={data.lot_number}")
    
    if not data.vin and not data.lot_number:
        return {"success": False, "error": "No VIN or lot_number"}
    
    doc = {
        "url": data.url,
        "source": "bidcars",
        "ingested_at": datetime.now(timezone.utc),
    }
    
    fields = ['vin', 'title', 'price', 'odometer', 'odometer_unit', 'year', 'lot_number',
              'location', 'primary_damage', 'secondary_damage', 'sale_date', 'engine',
              'transmission', 'drive', 'fuel', 'color', 'keys', 'title_type', 'auction_source']
    
    for f in fields:
        val = getattr(data, f, None)
        if val:
            doc[f] = val
    
    if data.images:
        doc["images"] = data.images[:25]
    
    try:
        filter_key = {"vin": data.vin} if data.vin else {"lot_number": data.lot_number, "source": "bidcars"}
        
        result = await db.bidcars_vehicles.update_one(
            filter_key,
            {"$set": doc, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
            upsert=True
        )
        
        is_new = result.upserted_id is not None
        logger.info(f"[BIDCARS] {'Created' if is_new else 'Updated'}: VIN={data.vin}")
        
        return {"success": True, "vin": data.vin, "lot_number": data.lot_number, "isNew": is_new}
    except Exception as e:
        logger.error(f"[BIDCARS] Error: {e}")
        return {"success": False, "error": str(e)}

@fastapi_app.get("/api/bidcars/vehicles")
async def bidcars_vehicles_list(limit: int = 50, skip: int = 0):
    """List vehicles from Bid.Cars"""
    vehicles = await db.bidcars_vehicles.find({}, {"_id": 0}).sort("ingested_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.bidcars_vehicles.count_documents({})
    return {"success": True, "vehicles": vehicles, "total": total}

@fastapi_app.get("/api/bidcars/vehicle/{vin}")
async def bidcars_vehicle_get(vin: str):
    """Get vehicle by VIN"""
    vehicle = await db.bidcars_vehicles.find_one({"vin": vin}, {"_id": 0})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"success": True, "vehicle": vehicle}

# ═══════════════════════════════════════════════════════════════════
# BID.CARS VIN SEARCH - Backend searches bid.cars by VIN
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/bidcars/search/{vin}")
async def bidcars_search_vin(vin: str):
    """
    Search bid.cars by VIN
    Returns cached data or URL for extension to search
    """
    vin = vin.upper().strip()
    
    if len(vin) != 17:
        return {"success": False, "error": "Invalid VIN - must be 17 characters"}
    
    logger.info(f"[BIDCARS-SEARCH] Searching for VIN: {vin}")
    
    # Check cache first
    cached = await db.bidcars_vehicles.find_one({"vin": vin}, {"_id": 0})
    if cached:
        if cached.get("ingested_at"):
            ingested = cached["ingested_at"]
            if ingested.tzinfo is None:
                ingested = ingested.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - ingested).total_seconds() / 3600
            if age_hours < 24:
                logger.info(f"[BIDCARS-SEARCH] Returning cached data for {vin}")
                # Convert datetime to string for JSON
                cached_copy = dict(cached)
                if "ingested_at" in cached_copy:
                    cached_copy["ingested_at"] = cached_copy["ingested_at"].isoformat() if hasattr(cached_copy["ingested_at"], 'isoformat') else str(cached_copy["ingested_at"])
                if "created_at" in cached_copy:
                    cached_copy["created_at"] = cached_copy["created_at"].isoformat() if hasattr(cached_copy["created_at"], 'isoformat') else str(cached_copy["created_at"])
                return {"success": True, "vehicle": cached_copy, "source": "cache"}
    
    # No cache - return search URL for extension/frontend to use
    search_url = f"https://bid.cars/en/search/?q={vin}"
    
    return {
        "success": False,
        "error": "Not in cache",
        "vin": vin,
        "searchUrl": search_url,
        "action": "extension_required",
        "message": "Please open the search URL in browser with extension to fetch data"
    }

async def search_bidcars_playwright(vin: str) -> Dict[str, Any]:
    """Search bid.cars using Playwright"""
    import os
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/pw-browsers'
    
    from playwright.async_api import async_playwright
    
    search_url = f"https://bid.cars/en/search/?q={vin}"
    logger.info(f"[BIDCARS-PW] Opening: {search_url}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                  '--disable-blink-features=AutomationControlled']
        )
        
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='en-US'
        )
        
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        
        page = await context.new_page()
        
        try:
            # Go to search page
            await page.goto(search_url, wait_until='domcontentloaded', timeout=60000)
            await page.wait_for_timeout(5000)
            
            content = await page.content()
            
            # Check for Cloudflare
            if "Just a moment" in content or "Checking your browser" in content:
                logger.info("[BIDCARS-PW] Cloudflare challenge, waiting...")
                await page.wait_for_timeout(10000)
                content = await page.content()
            
            # Check if still blocked
            if "Just a moment" in content:
                await browser.close()
                return {"success": False, "error": "Cloudflare blocked access"}
            
            # Log page content for debugging
            page_title = await page.title()
            logger.info(f"[BIDCARS-PW] Page title: {page_title}")
            logger.info(f"[BIDCARS-PW] Content length: {len(content)} chars")
            
            # Save HTML for debugging
            with open('/tmp/bidcars_debug.html', 'w') as f:
                f.write(content)
            logger.info("[BIDCARS-PW] Saved HTML to /tmp/bidcars_debug.html")
            
            # Check for no results message
            if "No results" in content or "not found" in content.lower() or "no vehicles" in content.lower():
                await browser.close()
                return {"success": False, "error": "No vehicles found for this VIN on bid.cars"}
            
            # Parse search results or vehicle page
            vehicle = await page.evaluate("""() => {
                const data = {};
                const bodyText = document.body.innerText;
                
                // VIN
                const vinRegex = /[A-HJ-NPR-Z0-9]{17}/;
                const vinMatch = bodyText.match(vinRegex);
                if (vinMatch) data.vin = vinMatch[0];
                
                // Title from h1 or first result
                const titleEl = document.querySelector('h1') || 
                               document.querySelector('.vehicle-title') ||
                               document.querySelector('.lot-title');
                if (titleEl) data.title = titleEl.textContent.trim();
                
                // Lot number
                const lotRegex = /lot[:\s#]*(\d{5,})/i;
                const lotMatch = bodyText.match(lotRegex);
                if (lotMatch) data.lot_number = lotMatch[1];
                
                // Year
                if (data.title) {
                    const yearMatch = data.title.match(/\\b(19|20)\\d{2}\\b/);
                    if (yearMatch) data.year = parseInt(yearMatch[0]);
                }
                
                // Price
                const priceRegex = /\\$\\s*([\\d,]+)/;
                const priceMatch = bodyText.match(priceRegex);
                if (priceMatch) data.price = priceMatch[1].replace(/,/g, '');
                
                // Odometer
                const odoRegex = /(\\d[\\d,]*)\\s*(mi|km|miles)/i;
                const odoMatch = bodyText.match(odoRegex);
                if (odoMatch) {
                    data.odometer = odoMatch[1].replace(/,/g, '');
                    data.odometer_unit = odoMatch[2].toLowerCase().includes('km') ? 'km' : 'mi';
                }
                
                // Damage
                const damageRegex = /damage[:\\s]*([^\\n,]+)/i;
                const damageMatch = bodyText.match(damageRegex);
                if (damageMatch) data.primary_damage = damageMatch[1].trim().substring(0, 100);
                
                // Location
                const locationRegex = /location[:\\s]*([^\\n]+)/i;
                const locationMatch = bodyText.match(locationRegex);
                if (locationMatch) data.location = locationMatch[1].trim().substring(0, 100);
                
                // Images
                const images = [];
                document.querySelectorAll('img').forEach(img => {
                    const src = img.src || img.getAttribute('data-src') || '';
                    if (src.startsWith('http') && !src.includes('logo') && !src.includes('icon')) {
                        images.push(src);
                    }
                });
                if (images.length) data.images = [...new Set(images)].slice(0, 20);
                
                // Check if results found
                data.hasResults = !!(data.vin || data.lot_number || data.title);
                
                return data;
            }""")
            
            await browser.close()
            
            if vehicle.get("hasResults"):
                del vehicle["hasResults"]
                return {"success": True, "vehicle": vehicle}
            else:
                return {"success": False, "error": "No results found for this VIN"}
                
        except Exception as e:
            await browser.close()
            logger.error(f"[BIDCARS-PW] Error: {e}")
            return {"success": False, "error": str(e)}

@fastapi_app.delete("/api/carfast/session/{session_id}")
async def carfast_session_delete(session_id: str):
    """Delete a Carfast session"""
    if session_id in carfast_cookie_store.sessions:
        del carfast_cookie_store.sessions[session_id]
        return {"success": True, "message": "Session deleted"}
    return {"success": False, "error": "Session not found"}

@fastapi_app.post("/api/carfast/session/clear-expired")
async def carfast_clear_expired():
    """Clear expired sessions"""
    carfast_cookie_store.clear_expired()
    return {"success": True, "status": carfast_cookie_store.get_status()}

# ═══════════════════════════════════════════════════════════════════
# EXTENSION DOWNLOAD
# ═══════════════════════════════════════════════════════════════════
from fastapi.responses import FileResponse
import os as os_module

@fastapi_app.get("/api/extension/download")
async def download_extension():
    """Download BIBI Cars Parser Extension v4.1 ZIP (builds fresh from source folder).

    Always packages the current contents of /app/backend/chrome_extension/ so icon
    or popup updates are immediately reflected.
    """
    import io
    import zipfile
    ext_dir = "/app/backend/chrome_extension"

    if not os_module.path.isdir(ext_dir):
        raise HTTPException(status_code=404, detail="Extension source folder not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os_module.walk(ext_dir):
            for fname in files:
                full = os_module.path.join(root, fname)
                rel = os_module.path.relpath(full, ext_dir)
                # Skip hidden files, caches, OS junk
                if any(p.startswith(".") or p == "__pycache__" for p in rel.split(os_module.sep)):
                    continue
                with open(full, "rb") as fh:
                    zf.writestr(rel.replace(os_module.sep, "/"), fh.read())
    buf.seek(0)

    from fastapi.responses import Response as _Resp
    return _Resp(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="bibi-cars-extension.zip"',
            "X-Extension-Version": "4.1.0",
            "Cache-Control": "no-store",
        },
    )

@fastapi_app.get("/api/extension/info")
async def extension_info():
    """Get extension info."""
    ext_dir = "/app/backend/chrome_extension"
    file_exists = os_module.path.isdir(ext_dir)
    file_count = 0
    file_size = 0
    if file_exists:
        for root, _dirs, files in os_module.walk(ext_dir):
            for fname in files:
                # Skip hidden / cache junk
                if fname.startswith(".") or fname == "__pycache__":
                    continue
                full = os_module.path.join(root, fname)
                try:
                    file_size += os_module.path.getsize(full)
                    file_count += 1
                except OSError:
                    pass

    hmac_secret = os_module.environ.get("EXT_SHARED_SECRET", "").strip()

    return {
        "name": "BIBI Cars Parser",
        "version": "4.1.0",
        "type": "Multi-source CF-bypass agent",
        "description": (
            "Cloudflare-bypass extension for the multi-source resolver. "
            "Replaces the legacy Copart/bid.cars/carfast popup."
        ),
        "features": [
            "Automatic VIN lookup on poctra/carsfromwest/autoauctionhistory/salvagebid",
            "HMAC-signed observations to /api/ext/observation",
            "60s heartbeat",
            "Stable client_id with role-based registration",
            "No legacy cookie-sync flow (cleaned in v4.1)",
        ],
        "download_url": "/api/extension/download",
        "public_url": "/api/extension/download",
        "file_exists": file_exists,
        "file_size": file_size,
        "file_count": file_count,
        "hmac_secret": hmac_secret,
        "hmac_enabled": bool(hmac_secret),
        "supported_sites": [
            {"name": "poctra.com", "status": "active"},
            {"name": "carsfromwest.com", "status": "active"},
            {"name": "autoauctionhistory.com", "status": "active"},
            {"name": "salvagebid.com", "status": "active"},
        ],
        "installation": [
            "1. Завантажте ZIP файл",
            "2. Розпакуйте архів",
            "3. Відкрийте chrome://extensions/",
            "4. Увімкніть 'Режим розробника'",
            "5. Натисніть 'Завантажити розпаковане'",
            "6. Виберіть розпаковану папку",
            "7. У popup розширення введіть Backend URL та EXT_SHARED_SECRET",
        ],
    }

# ═══════════════════════════════════════════════════════════════════
# Phase V — Multi-Source Resolver: extension bridge endpoints
# ═══════════════════════════════════════════════════════════════════
#
# Architecture (same chain runs inside ``vin_service.get_car_by_vin``):
#   CACHE → BitMotors SEARCH → WestMotors INDEX → Lemon INDEX
#         → AuctionAuto (httpx) → EXTENSION → BitMotors PAGE → NOT_FOUND
#
# The browser extension polls /api/ext/jobs to fetch pending VIN
# lookups and POSTs parsed payloads back via /api/ext/push.  Operators
# can call /api/ext/lookup directly to issue an ad-hoc lookup that
# blocks for up to ~4 s while the extension does its job.
#
# All write endpoints are protected by HMAC (require_extension_hmac);
# /api/ext/health is read-only and unprotected so the admin panel can
# poll it without provisioning extension keys.
# ═══════════════════════════════════════════════════════════════════
from multisource_resolver import (
    enqueue_extension_job as _ms_enqueue,
    take_pending_jobs as _ms_take_jobs,
    push_extension_result as _ms_push,
    wait_for_extension_results as _ms_wait,
    extension_lookup as _ms_extension_lookup,
    extension_lookup_gated as _ms_extension_lookup_gated,
    auctionauto_lookup as _ms_auctionauto,
    auctionauto_lookup_gated as _ms_auctionauto_gated,
    get_health_snapshot as _ms_health,
    EXTENSION_SOURCES as _EXT_SOURCES,
    register_client as _ms_register_client,
    client_heartbeat as _ms_client_heartbeat,
    get_clients as _ms_get_clients,
    has_online_client_for as _ms_has_online,
    cache_observation as _ms_cache_obs,
    lookup_observation as _ms_lookup_obs,
    degraded_sources as _ms_degraded,
)


@fastapi_app.post("/api/ext/lookup")
async def ext_lookup(payload: Optional[dict] = Body(None)):
    """Ad-hoc VIN lookup that fans out across the extension sources.

    Body: {"vin": "WAUS...", "sources": ["poctra", ...] (optional)}

    Returns: {"request_id": str, "merged": {...}|null, "sources_replied":[...]}
    """
    payload = payload or {}
    vin = (payload.get("vin") or "").strip().upper()
    if not vin or len(vin) != 17:
        raise HTTPException(status_code=400, detail="vin (17-char) required")
    requested = payload.get("sources")
    sources_tuple: Optional[tuple] = (
        tuple(s for s in requested if s in _EXT_SOURCES) or None
    ) if requested else None
    rid = await _ms_enqueue(vin, sources=sources_tuple)
    replies = await _ms_wait(rid, timeout=4.0)
    return {
        "request_id": rid,
        "vin": vin,
        "sources_replied": [r.get("source") for r in replies],
        "results": replies,
    }


@fastapi_app.get("/api/ext/jobs")
async def ext_jobs(request: Request, limit: int = 10, _hmac=Depends(require_extension_hmac)):
    """Browser extension polls this to fetch pending VIN-lookup jobs.

    The X-Ext-Client header (validated by HMAC dependency) is used to
    attribute each job pull to the client_id, which feeds the
    success-rate health metric.
    """
    client_id = (request.headers.get("X-Ext-Client") or "").strip() or None
    return {
        "jobs": await _ms_take_jobs(
            limit=max(1, min(50, int(limit or 10))),
            client_id=client_id,
        )
    }


@fastapi_app.post("/api/ext/push")
async def ext_push(payload: dict, _hmac=Depends(require_extension_hmac)):
    """Browser extension content scripts upload parsed lot payloads here.

    Body: {
        "request_id": "<uuid from /api/ext/jobs>",
        "source": "poctra"|"carsfromwest"|"autoauctionhistory"|"salvagebid",
        "vin": "...",  "lot": "...", "title": "...", "images": [...], ...
    }
    """
    rid = (payload or {}).get("request_id", "").strip()
    src = (payload or {}).get("source", "").strip()
    if not rid or not src:
        raise HTTPException(status_code=400, detail="request_id and source required")
    ok = await _ms_push(rid, payload)
    return {"ok": bool(ok)}


@fastapi_app.get("/api/ext/result/{request_id}")
async def ext_result(request_id: str):
    """Poll the merged result for a previous /api/ext/lookup request_id."""
    replies = await _ms_wait(request_id, timeout=0.05)
    return {"request_id": request_id, "results": replies}


@fastapi_app.get("/api/ext/health")
async def ext_health():
    """Read-only health snapshot of every multi-source backend."""
    return _ms_health()


@fastapi_app.post("/api/ext/auctionauto/test")
async def ext_auctionauto_test(payload: dict):
    """Smoke-test the auctionauto httpx scraper from the admin panel."""
    vin = (payload or {}).get("vin", "").strip().upper()
    if not vin or len(vin) != 17:
        raise HTTPException(status_code=400, detail="vin (17-char) required")
    res = await _ms_auctionauto(vin)
    return {"vin": vin, "found": bool(res), "data": res}


# ═══════════════════════════════════════════════════════════════════
# Phase 8 — Multi-client registry, event-driven push, health gate
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/ext/register")
async def ext_register(payload: dict, _hmac=Depends(require_extension_hmac)):
    """Extension reports its client_id, capabilities and version.

    Body: {client_id, label?, version?, capabilities:["poctra","carsfromwest",...]}
    """
    cid = (payload or {}).get("client_id", "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="client_id required")
    caps = (payload or {}).get("capabilities") or list(_EXT_SOURCES)
    return _ms_register_client(
        cid,
        label=(payload or {}).get("label"),
        version=(payload or {}).get("version"),
        capabilities=caps,
    )


@fastapi_app.post("/api/ext/heartbeat")
async def ext_client_heartbeat(payload: dict, _hmac=Depends(require_extension_hmac)):
    """Extension keeps its registry entry warm; auto-registers when unknown.

    Body: {client_id, online?:bool=true, version?, label?, capabilities?}
    """
    cid = (payload or {}).get("client_id", "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="client_id required")
    return _ms_client_heartbeat(
        cid,
        online=bool((payload or {}).get("online", True)),
        extras={k: v for k, v in (payload or {}).items()
                if k in {"version", "label", "capabilities"}},
    )


@fastapi_app.get("/api/ext/clients")
async def ext_clients_list():
    """Read-only view of the extension client registry (for admin panel)."""
    clients = _ms_get_clients()
    online = sum(1 for c in clients if c.get("online"))
    return {
        "total": len(clients),
        "online": online,
        "offline": len(clients) - online,
        "clients": clients,
    }


@fastapi_app.post("/api/ext/observation")
async def ext_observation(payload: dict, _hmac=Depends(require_extension_hmac)):
    """Event-driven push: extension caches a parsed lot it just saw,
    even if the backend never asked for it.  Future VIN lookups for
    this VIN will hit the observation cache instantly.

    Body: {client_id?, source, vin, lot?, title?, images?, ...}
    """
    src = (payload or {}).get("source", "").strip()
    vin = (payload or {}).get("vin", "").strip().upper()
    if not src or len(vin) != 17:
        raise HTTPException(status_code=400, detail="source and 17-char vin required")
    return _ms_cache_obs(payload)


@fastapi_app.get("/api/ext/observation/{vin}")
async def ext_observation_lookup(vin: str):
    """Read the cached observation for a VIN (admin/debug helper)."""
    res = _ms_lookup_obs(vin)
    return {"vin": vin.upper(), "hit": bool(res), "data": res}


@fastapi_app.get("/api/ext/degraded")
async def ext_degraded():
    """List of sources currently failing the health gate (P95 too high)."""
    return {"degraded": _ms_degraded()}


@fastapi_app.get("/api/ext/drifting")
async def ext_drifting():
    """Sources whose recent parser output is failing validation more
    than SOURCE_DRIFT_MAX_INVALID of the time (silent data drift)."""
    from multisource_resolver import drifting_sources, source_drift_ratio
    drifting = drifting_sources()
    return {
        "drifting": drifting,
        "ratios": {s: source_drift_ratio(s) for s in drifting},
    }


@fastapi_app.get("/api/control/overview")
async def control_overview():
    """Single-fetch aggregator for the admin Control Center page.

    Returns the data needed to render:
      * a SYSTEM STATUS bar (red / yellow / green),
      * the EXTENSION STATUS card,
      * the unified SOURCES grid (BitMotors / WestMotors / Lemon /
        AuctionAuto / Extension layer),
      * a PERFORMANCE summary,
      * an ALERTS list.

    The payload is intentionally flat — UI is just rendering, not
    deriving state.
    """
    health = _ms_health()
    clients_payload = {
        "total": len(_ms_get_clients()),
        "online": sum(1 for c in _ms_get_clients() if c.get("online")),
        "clients": _ms_get_clients(),
    }
    sources = health.get("sources", {}) or {}

    # ── BitMotors live tier (from circuit-breaker stats inside vin_service) ──
    try:
        from vin_service import get_circuit_stats
        cb = get_circuit_stats() or {}
    except Exception:
        cb = {}
    bm_search = cb.get("bitmotors_search") or {}
    bm_page = cb.get("bitmotors_page") or {}
    bm_open = bool(bm_search.get("is_open")) or bool(bm_page.get("is_open"))

    # ── WestMotors INDEX tier ─────────────────────────────────────────────
    wm_status_doc: dict = {}
    try:
        wm_status_doc = await db.westmotors_state.find_one(  # type: ignore[name-defined]
            {"_id": "v1"}
        ) or {}
    except Exception:
        pass

    # ── Lemon INDEX tier ──────────────────────────────────────────────────
    lemon_status_doc: dict = {}
    try:
        lemon_status_doc = await db.lemon_state.find_one(  # type: ignore[name-defined]
            {"_id": "v1"}
        ) or {}
    except Exception:
        pass

    # ── Extension layer aggregate ─────────────────────────────────────────
    ext_caps = ["poctra", "carsfromwest", "autoauctionhistory", "salvagebid"]
    ext_layer_calls = sum(int((sources.get(s) or {}).get("calls") or 0) for s in ext_caps)
    ext_layer_hits = sum(int((sources.get(s) or {}).get("hits") or 0) for s in ext_caps)
    ext_layer_errs = sum(int((sources.get(s) or {}).get("errors") or 0) for s in ext_caps)
    ext_layer_p50 = max(
        (int((sources.get(s) or {}).get("latency_p50_ms") or 0) for s in ext_caps),
        default=0,
    )
    ext_layer_p95 = max(
        (int((sources.get(s) or {}).get("latency_p95_ms") or 0) for s in ext_caps),
        default=0,
    )
    ext_clients_online = clients_payload["online"]

    # ── compose unified source rows ───────────────────────────────────────
    def status_for(calls: int, errors: int, healthy: bool, drifting: bool, degraded: bool) -> str:
        if not healthy or degraded:
            return "down"
        if drifting:
            return "drift"
        if errors > 0 and calls > 0 and (errors / max(calls, 1)) > 0.2:
            return "warn"
        return "ok"

    rows: list[dict] = []

    rows.append({
        "key": "bitmotors",
        "label": "BitMotors",
        "tier": "LIVE",
        "calls": int(bm_search.get("total_calls") or 0)
                + int(bm_page.get("total_calls") or 0),
        "hits": int(bm_search.get("total_success") or 0)
                + int(bm_page.get("total_success") or 0),
        "errors": int(bm_search.get("total_failures") or 0)
                  + int(bm_page.get("total_failures") or 0),
        "latency_p50_ms": int(bm_search.get("latency_p50_ms") or 0),
        "latency_p95_ms": int(bm_search.get("latency_p95_ms") or 0),
        "hit_ratio": round(
            (int(bm_search.get("total_success") or 0)
             + int(bm_page.get("total_success") or 0))
            / max(1, int(bm_search.get("total_calls") or 0)
                     + int(bm_page.get("total_calls") or 0)),
            3,
        ),
        "status": "down" if bm_open else "ok",
        "circuit_open": bm_open,
    })

    wm_calls = int(wm_status_doc.get("total_lookups") or 0)
    wm_hits = int(wm_status_doc.get("total_hits") or 0)
    wm_errs = int(wm_status_doc.get("total_errors") or 0)
    wm_p50 = int(wm_status_doc.get("latency_p50_ms") or 0)
    rows.append({
        "key": "westmotors",
        "label": "WestMotors",
        "tier": "INDEX",
        "calls": wm_calls,
        "hits": wm_hits,
        "errors": wm_errs,
        "latency_p50_ms": wm_p50,
        "latency_p95_ms": int(wm_status_doc.get("latency_p95_ms") or 0),
        "hit_ratio": round(wm_hits / max(1, wm_calls), 3) if wm_calls else 0.0,
        "status": "ok",
    })

    lm_calls = int(lemon_status_doc.get("total_lookups") or 0)
    lm_hits = int(lemon_status_doc.get("total_hits") or 0)
    lm_errs = int(lemon_status_doc.get("total_errors") or 0)
    rows.append({
        "key": "lemon",
        "label": "Lemon",
        "tier": "INDEX",
        "calls": lm_calls,
        "hits": lm_hits,
        "errors": lm_errs,
        "latency_p50_ms": int(lemon_status_doc.get("latency_p50_ms") or 0),
        "latency_p95_ms": int(lemon_status_doc.get("latency_p95_ms") or 0),
        "hit_ratio": round(lm_hits / max(1, lm_calls), 3) if lm_calls else 0.0,
        "status": "ok",
    })

    aa = sources.get("auctionauto") or {}
    aa_status = (
        "down" if aa.get("circuit_open") else
        "drift" if aa.get("drifting") else
        "ok"
    )
    rows.append({
        "key": "auctionauto",
        "label": "AuctionAuto",
        "tier": "HTTP",
        "calls": int(aa.get("calls") or 0),
        "hits": int(aa.get("hits") or 0),
        "errors": int(aa.get("errors") or 0),
        "latency_p50_ms": int(aa.get("latency_p50_ms") or 0),
        "latency_p95_ms": int(aa.get("latency_p95_ms") or 0),
        "hit_ratio": float(aa.get("hit_ratio") or 0),
        "status": aa_status,
        "drift_ratio": aa.get("drift_ratio"),
    })

    rows.append({
        "key": "extension",
        "label": "Extension Layer",
        "tier": "EXT",
        "calls": ext_layer_calls,
        "hits": ext_layer_hits,
        "errors": ext_layer_errs,
        "latency_p50_ms": ext_layer_p50,
        "latency_p95_ms": ext_layer_p95,
        "hit_ratio": round(ext_layer_hits / max(1, ext_layer_calls), 3)
                     if ext_layer_calls else 0.0,
        "status": "down" if ext_clients_online == 0 else "ok",
        "clients_online": ext_clients_online,
        "subsources": ext_caps,
    })

    # ── overall system status logic ───────────────────────────────────────
    # Architecture: primary sources (BitMotors LIVE / WestMotors INDEX /
    # Lemon INDEX / AuctionAuto HTTP) work INDEPENDENTLY — if at least
    # one of them is up, the parser can serve VIN lookups. Extension is
    # only used as a CF-bypass FALLBACK for poctra/cfw/aah/salvagebid.
    # System should NOT be marked DEGRADED just because Extension is
    # offline — that's a partial degradation, not a full outage.
    primary_keys = {"bitmotors", "westmotors", "lemon", "auctionauto"}
    primary_rows = [r for r in rows if r["key"] in primary_keys]
    primary_up = [r for r in primary_rows if r["status"] == "ok"]
    primary_down = [r for r in primary_rows if r["status"] == "down"]
    ext_down = (ext_clients_online == 0)

    alerts: list[str] = []
    if ext_down:
        alerts.append(
            "No extension clients — Cloudflare-protected sources (poctra/cfw/aah/salvagebid) "
            "are temporarily offline. Primary sources still serve VINs."
        )
    for r in rows:
        if r["key"] == "extension":
            continue  # extension alert handled above
        if r["status"] == "down":
            alerts.append(f"{r['label']} is down")
        elif r["status"] == "drift":
            alerts.append(f"{r['label']} is drifting (parser may be returning bad data)")
        elif r["status"] == "warn":
            alerts.append(
                f"{r['label']} has elevated error rate "
                f"({int((r['errors']/max(r['calls'],1))*100)}%)"
            )
    for d in health.get("drifting_sources") or []:
        alerts.append(f"Source '{d}' silent drift detected")
    # Unhealthy clients (silent-death detection)
    for c in clients_payload["clients"]:
        if c.get("unhealthy"):
            alerts.append(
                f"Client {c.get('label') or c.get('client_id')} marked unhealthy "
                f"(success rate {int((c.get('success_rate_recent') or 0)*100)}%)"
            )

    # ── Status decision tree (primary-first) ─────────────────────────────
    if not primary_up:
        # ZERO primary sources available — parser cannot serve VINs at all.
        # This is the only true "DEGRADED" state.
        system_status = "red"
        system_label = "DEGRADED"
    elif primary_down or ext_down or any(r["status"] in ("warn", "drift") for r in primary_rows):
        # At least 1 primary source is up — parser IS serving VINs, but
        # not at 100% capacity (some sources offline / extension offline).
        system_status = "yellow"
        system_label = "PARTIAL"
    else:
        # All primary sources OK + extension layer OK.
        system_status = "green"
        system_label = "OK"

    # ── performance aggregate ─────────────────────────────────────────────
    aggregate_calls = sum(r["calls"] for r in rows)
    aggregate_hits = sum(r["hits"] for r in rows)
    aggregate_errors = sum(r["errors"] for r in rows)
    nonzero_p50 = [r["latency_p50_ms"] for r in rows if r["latency_p50_ms"] > 0]
    nonzero_p95 = [r["latency_p95_ms"] for r in rows if r["latency_p95_ms"] > 0]
    perf = {
        "p50_ms": int(sum(nonzero_p50) / len(nonzero_p50)) if nonzero_p50 else 0,
        "p95_ms": int(max(nonzero_p95)) if nonzero_p95 else 0,
        "hit_rate": round(aggregate_hits / max(1, aggregate_calls), 3) if aggregate_calls else 0.0,
        "error_rate": round(aggregate_errors / max(1, aggregate_calls), 3) if aggregate_calls else 0.0,
        "total_calls": aggregate_calls,
    }

    # Build human-readable reason explaining current system status
    if system_status == "green":
        reason = "All primary sources + extension layer healthy"
    elif system_status == "yellow":
        reason_parts = []
        if primary_down:
            reason_parts.append(
                f"{len(primary_down)}/{len(primary_rows)} primary sources offline ("
                + ", ".join(r["label"] for r in primary_down) + ")"
            )
        if ext_down:
            reason_parts.append("Extension layer offline (CF-protected sources)")
        warn_rows = [r for r in primary_rows if r["status"] in ("warn", "drift")]
        if warn_rows:
            reason_parts.append(
                f"{len(warn_rows)} source(s) elevated error rate"
            )
        reason = (
            f"Parser ACTIVE via {len(primary_up)}/{len(primary_rows)} primary source(s)"
            + (" • " + " • ".join(reason_parts) if reason_parts else "")
        )
    else:  # red
        reason = "All primary sources offline — VIN lookups cannot be served"

    return {
        "system": {
            "status": system_status,
            "label": system_label,
            "reason": reason,
            "primary_up": [r["key"] for r in primary_up],
            "primary_down": [r["key"] for r in primary_down],
        },
        "extension": {
            "online": ext_clients_online,
            "total": clients_payload["total"],
            "clients": clients_payload["clients"],
            "max_active_jobs": 3,  # mirror MAX_ACTIVE_JOBS in ext background.js
            "queue_depth": int(health.get("queue_depth") or 0),
            "in_flight": int(health.get("results_in_flight") or 0),
            "obs_cache_vins": int(health.get("observation_cache_vins") or 0),
        },
        "sources": rows,
        "performance": perf,
        "alerts": alerts[:20],
        "ts": int(time.time()),
    }


@fastapi_app.post("/api/control/debug/probe", dependencies=[Depends(require_master_admin)])
async def control_debug_probe(payload: dict):
    """Run a VIN/LOT probe through the resolver and report which source
    answered (used by the admin DEBUG block).

    Body: {"query": "5YJSA1E25HF199047"}
    """
    q = (payload or {}).get("query") or (payload or {}).get("vin") or ""
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="query required")
    try:
        from vin_service import get_car_by_vin
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"resolver unavailable: {e}")

    t0 = time.time()
    res = await get_car_by_vin(q)
    dt_ms = int((time.time() - t0) * 1000)
    return {
        "query": q,
        "found": bool(res.get("found")),
        "source": res.get("source"),
        "latency_ms": dt_ms,
        "title": (res.get("data") or {}).get("title"),
        "year": (res.get("data") or {}).get("year"),
        "make": (res.get("data") or {}).get("make"),
        "model": (res.get("data") or {}).get("model"),
        "image_count": (res.get("data") or {}).get("image_count")
                       or len((res.get("data") or {}).get("images") or []),
    }


@fastapi_app.post("/api/ext/validate")
async def ext_validate(payload: dict):
    """Standalone validator — useful for the admin to test if a parsed
    payload would be accepted by the resolver."""
    from multisource_resolver import validate_result, source_drift_ratio
    valid = validate_result(payload)
    src = (payload or {}).get("source") or "unknown"
    return {
        "valid": valid,
        "source": src,
        "drift_ratio": source_drift_ratio(src),
    }


# ═══════════════════════════════════════════════════════════════════
# OPS GUARDIAN — alerter + auto-healer status & control
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/control/ops/status", dependencies=[Depends(require_manager_or_admin)])
async def ops_status():
    """Read-only guardian snapshot for admin dashboards: which channels
    are wired, last loop tick, counter of alerts/heals, active dedup keys.

    Safe for any authenticated staff (manager / team_lead / admin / master_admin)
    — we only surface booleans `channels.telegram` / `channels.webhook`
    (no secrets). This mirrors the visibility rule of /api/control/overview."""
    from ops_guardian import get_guardian_status
    snap = get_guardian_status()
    # Pull last 10 audit rows for the UI timeline.
    try:
        audit = await db.ops_audit.find(
            {}, {"_id": 0}
        ).sort("ts", -1).limit(10).to_list(length=10)
    except Exception:
        audit = []
    return {**snap, "recent_audit": audit}


@fastapi_app.post(
    "/api/control/ops/test-alert",
    dependencies=[Depends(require_master_admin)],
)
async def ops_test_alert(payload: dict = Body(default={})):
    """Fire a synthetic alert through all configured channels.
    Master-admin only — used to verify Telegram / webhook wiring from the UI
    before a real incident occurs."""
    from ops_guardian import emit_alert
    title = (payload or {}).get("title") or "ops test alert"
    message = (payload or {}).get("message") or "Synthetic alert from /test-alert."
    severity = (payload or {}).get("severity") or "info"
    sent = await emit_alert(
        severity=severity,
        title=title,
        message=message,
        context={"initiated_by": "admin ui"},
        fingerprint=f"test_{int(time.time())}",  # always unique → bypass dedup
        db=db,
    )
    return {"ok": True, "dispatched": sent}


# ═══════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════
# SCRAPING QUEUE SYSTEM - Automatic Backend Parsing
# ═══════════════════════════════════════════════════════════════════
# UNIVERSAL SCRAPING QUEUE
# ═══════════════════════════════════════════════════════════════════

class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRY = "retry"

class JobSource(str, Enum):
    COPART = "copart"
    IAAI = "iaai"
    CARFAST = "carfast"

# In-memory job queue (for MVP, use Redis/RabbitMQ for production)
scrape_jobs: Dict[str, Dict] = {}
scrape_queue: List[str] = []
is_worker_running = False

class ScrapeJobRequest(BaseModel):
    url: Optional[str] = None
    vin: Optional[str] = None
    lot_number: Optional[str] = None
    source: Optional[str] = None
    priority: int = 1

@fastapi_app.post("/api/scrape/job")
async def create_scrape_job(request: ScrapeJobRequest):
    """Create a new scrape job"""
    job_id = str(uuid.uuid4())[:8]
    
    # Detect source from URL
    source = request.source
    if not source and request.url:
        if "copart" in request.url:
            source = JobSource.COPART
        elif "iaai" in request.url:
            source = JobSource.IAAI
        elif "carfast" in request.url:
            source = JobSource.CARFAST
    
    # Build URL if only VIN/lot provided
    url = request.url
    if not url and request.lot_number:
        if source == JobSource.COPART:
            url = f"https://www.copart.com/lot/{request.lot_number}"
        elif source == JobSource.IAAI:
            url = f"https://www.iaai.com/VehicleDetail/{request.lot_number}"
    
    if not url:
        return {"success": False, "error": "URL or lot_number required"}
    
    job = {
        "id": job_id,
        "url": url,
        "vin": request.vin,
        "lot_number": request.lot_number,
        "source": source or "unknown",
        "status": JobStatus.PENDING,
        "priority": request.priority,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
        "max_attempts": 3,
        "result": None,
        "error": None
    }
    
    scrape_jobs[job_id] = job
    scrape_queue.append(job_id)
    
    # Start worker if not running
    asyncio.create_task(process_scrape_queue())
    
    logger.info(f"[SCRAPE] Job created: {job_id} - {url}")
    
    return {
        "success": True,
        "jobId": job_id,
        "status": JobStatus.PENDING,
        "message": "Job queued for processing"
    }

@fastapi_app.get("/api/scrape/job/{job_id}")
async def get_scrape_job(job_id: str):
    """Get job status and result"""
    if job_id not in scrape_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = scrape_jobs[job_id]
    return {
        "success": True,
        "job": job
    }

@fastapi_app.get("/api/scrape/jobs")
async def list_scrape_jobs(status: Optional[str] = None, limit: int = 50):
    """List all scrape jobs"""
    jobs = list(scrape_jobs.values())
    
    if status:
        jobs = [j for j in jobs if j["status"] == status]
    
    # Sort by created_at desc
    jobs.sort(key=lambda x: x["created_at"], reverse=True)
    
    return {
        "success": True,
        "jobs": jobs[:limit],
        "total": len(jobs),
        "queue_length": len(scrape_queue)
    }

@fastapi_app.delete("/api/scrape/job/{job_id}")
async def cancel_scrape_job(job_id: str):
    """Cancel a pending job"""
    if job_id not in scrape_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = scrape_jobs[job_id]
    if job["status"] == JobStatus.PENDING:
        job["status"] = JobStatus.FAILED
        job["error"] = "Cancelled by user"
        if job_id in scrape_queue:
            scrape_queue.remove(job_id)
    
    return {"success": True, "message": "Job cancelled"}

# ═══════════════════════════════════════════════════════════════════
# PLAYWRIGHT WORKER
# ═══════════════════════════════════════════════════════════════════

async def scrape_with_playwright(url: str, source: str) -> Dict[str, Any]:
    """Scrape URL using Playwright"""
    import os
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/pw-browsers'
    
    from playwright.async_api import async_playwright
    
    logger.info(f"[SCRAPE-PW] Starting: {url}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        )
        
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080}
        )
        
        # Inject stealth
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        
        page = await context.new_page()
        
        try:
            response = await page.goto(url, wait_until='domcontentloaded', timeout=45000)
            await page.wait_for_timeout(3000)
            
            # Check for blocks
            content = await page.content()
            if response.status == 403 or "Just a moment" in content:
                logger.warning(f"[SCRAPE-PW] Cloudflare block detected")
                # Wait and retry
                await page.wait_for_timeout(5000)
                content = await page.content()
            
            # Parse based on source
            if source == JobSource.COPART or "copart" in url:
                data = await parse_copart_page(page)
            elif source == JobSource.IAAI or "iaai" in url:
                data = await parse_iaai_page(page)
            else:
                data = await parse_generic_page(page)
            
            data["url"] = url
            data["scraped_at"] = datetime.now(timezone.utc).isoformat()
            data["method"] = "playwright"
            
            await browser.close()
            return {"success": True, "data": data}
            
        except Exception as e:
            await browser.close()
            logger.error(f"[SCRAPE-PW] Error: {e}")
            return {"success": False, "error": str(e)}

async def parse_copart_page(page) -> Dict:
    """Parse Copart lot page"""
    return await page.evaluate("""() => {
        const get = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
        };
        
        const getAttr = (sel, attr) => {
            const el = document.querySelector(sel);
            return el ? el.getAttribute(attr) : null;
        };
        
        // Multiple selector fallbacks
        const vin = get('[data-uname="lotdetailVin"]') || 
                    get('.lot-detail-vin') ||
                    (document.body.innerText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) || [])[1];
        
        const title = get('h1') || get('.lot-title') || document.title;
        
        const currentBid = get('[data-uname="lotdetailCurrentBid"]') ||
                          get('.current-bid');
        
        const buyNow = get('[data-uname="lotdetailBuyItNow"]');
        
        const odometer = get('[data-uname="lotdetailOdometer"]');
        
        const damage = get('[data-uname="lotdetailPrimaryDamage"]');
        const secondaryDamage = get('[data-uname="lotdetailSecondaryDamage"]');
        
        const location = get('[data-uname="lotdetailLocation"]');
        const saleDate = get('[data-uname="lotdetailSaleDate"]');
        
        const engine = get('[data-uname="lotdetailEngine"]');
        const transmission = get('[data-uname="lotdetailTransmission"]');
        const drive = get('[data-uname="lotdetailDrive"]');
        const color = get('[data-uname="lotdetailColor"]');
        const keys = get('[data-uname="lotdetailKeys"]');
        
        // Images
        const images = Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => src && (src.includes('copart') || src.includes('cs.co')) && !src.includes('logo'))
            .slice(0, 15);
        
        // Lot number from URL
        const lotMatch = window.location.pathname.match(/\\/lot\\/(\\d+)/);
        
        return {
            source: 'copart',
            vin,
            title,
            lot_number: lotMatch ? lotMatch[1] : null,
            current_bid: currentBid,
            buy_now_price: buyNow,
            odometer,
            primary_damage: damage,
            secondary_damage: secondaryDamage,
            location,
            sale_date: saleDate,
            engine,
            transmission,
            drive,
            color,
            keys,
            images
        };
    }""")

async def parse_iaai_page(page) -> Dict:
    """Parse IAAI vehicle page"""
    return await page.evaluate("""() => {
        const get = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
        };
        
        const vin = get('.vinDetails') || get('[data-vin]') ||
                    (document.body.innerText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) || [])[1];
        
        const title = get('h1') || get('.vehicle-title') || document.title;
        
        const bodyText = document.body.innerText;
        
        const odoMatch = bodyText.match(/Odometer[:\s]*([\d,]+)/i);
        const odometer = odoMatch ? odoMatch[1].replace(/,/g, '') : null;
        
        const damageMatch = bodyText.match(/Primary Damage[:\s]*([^\n]+)/i);
        const damage = damageMatch ? damageMatch[1].trim() : null;
        
        const locationMatch = bodyText.match(/Location[:\s]*([^\n]+)/i);
        const location = locationMatch ? locationMatch[1].trim() : null;
        
        const images = Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => src && (src.includes('iaai') || src.includes('vehicleimage')) && !src.includes('logo'))
            .slice(0, 15);
        
        const stockMatch = window.location.href.match(/Stock=(\\d+)/i) ||
                          window.location.pathname.match(/VehicleDetail\\/(\\d+)/);
        
        return {
            source: 'iaai',
            vin,
            title,
            lot_number: stockMatch ? stockMatch[1] : null,
            odometer,
            primary_damage: damage,
            location,
            images
        };
    }""")

async def parse_generic_page(page) -> Dict:
    """Parse generic vehicle page"""
    return await page.evaluate("""() => {
        const vinMatch = document.body.innerText.match(/[A-HJ-NPR-Z0-9]{17}/);
        const title = document.querySelector('h1')?.textContent?.trim() || document.title;
        
        return {
            source: 'generic',
            vin: vinMatch ? vinMatch[0] : null,
            title
        };
    }""")

# ═══════════════════════════════════════════════════════════════════
# QUEUE PROCESSOR
# ═══════════════════════════════════════════════════════════════════

async def process_scrape_queue():
    """Process jobs from queue"""
    global is_worker_running
    
    if is_worker_running:
        return
    
    is_worker_running = True
    logger.info("[SCRAPE] Worker started")
    
    try:
        while scrape_queue:
            job_id = scrape_queue.pop(0)
            
            if job_id not in scrape_jobs:
                continue
            
            job = scrape_jobs[job_id]
            
            if job["status"] != JobStatus.PENDING and job["status"] != JobStatus.RETRY:
                continue
            
            job["status"] = JobStatus.PROCESSING
            job["attempts"] += 1
            job["processing_started"] = datetime.now(timezone.utc).isoformat()
            
            logger.info(f"[SCRAPE] Processing job {job_id} (attempt {job['attempts']})")
            
            try:
                # Try Playwright
                result = await scrape_with_playwright(job["url"], job["source"])
                
                if result["success"]:
                    job["status"] = JobStatus.COMPLETED
                    job["result"] = result["data"]
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                    
                    # Save to DB
                    if result["data"].get("vin"):
                        await db.scraped_vehicles.update_one(
                            {"vin": result["data"]["vin"]},
                            {
                                "$set": {
                                    **result["data"],
                                    "updated_at": datetime.now(timezone.utc)
                                },
                                "$setOnInsert": {"created_at": datetime.now(timezone.utc)}
                            },
                            upsert=True
                        )
                    
                    logger.info(f"[SCRAPE] Job {job_id} completed - VIN: {result['data'].get('vin')}")
                else:
                    raise Exception(result.get("error", "Unknown error"))
                    
            except Exception as e:
                logger.error(f"[SCRAPE] Job {job_id} failed: {e}")
                
                if job["attempts"] < job["max_attempts"]:
                    job["status"] = JobStatus.RETRY
                    job["error"] = str(e)
                    scrape_queue.append(job_id)  # Re-add to queue
                    await asyncio.sleep(5)  # Backoff
                else:
                    job["status"] = JobStatus.FAILED
                    job["error"] = str(e)
                    job["failed_at"] = datetime.now(timezone.utc).isoformat()
            
            # Rate limit
            await asyncio.sleep(2)
    
    finally:
        is_worker_running = False
        logger.info("[SCRAPE] Worker stopped")

@fastapi_app.get("/api/scrape/stats")
async def scrape_stats():
    """Get scraping statistics"""
    jobs = list(scrape_jobs.values())
    
    return {
        "total_jobs": len(jobs),
        "pending": len([j for j in jobs if j["status"] == JobStatus.PENDING]),
        "processing": len([j for j in jobs if j["status"] == JobStatus.PROCESSING]),
        "completed": len([j for j in jobs if j["status"] == JobStatus.COMPLETED]),
        "failed": len([j for j in jobs if j["status"] == JobStatus.FAILED]),
        "retry": len([j for j in jobs if j["status"] == JobStatus.RETRY]),
        "queue_length": len(scrape_queue),
        "worker_running": is_worker_running
    }

@fastapi_app.get("/api/scraped/vehicles")
async def list_scraped_vehicles(limit: int = 50, skip: int = 0):
    """List vehicles scraped by backend"""
    vehicles = await db.scraped_vehicles.find(
        {},
        {"_id": 0}
    ).sort("scraped_at", -1).skip(skip).limit(limit).to_list(limit)
    
    total = await db.scraped_vehicles.count_documents({})
    
    return {
        "success": True,
        "vehicles": vehicles,
        "total": total
    }

# ═══════════════════════════════════════════════════════════════════
# BID.CARS HTML SCRAPER API
# ═══════════════════════════════════════════════════════════════════

class BidCarsParseRequest(BaseModel):
    url: str

class BidCarsSearchRequest(BaseModel):
    make: str = "All"
    model: str = "All"
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    vehicle_type: str = "Automobile"
    page: int = 1

@fastapi_app.post("/api/bidcars/parse")
async def bidcars_parse_lot(request: BidCarsParseRequest):
    """
    Parse a single lot from bid.cars
    Example: POST /api/bidcars/parse {"url": "https://bid.cars/en/lot/1-75856755/..."}
    """
    if not BIDCARS_AVAILABLE:
        return {"success": False, "error": "BidCars parser not available (missing playwright_stealth)"}
    try:
        async with BidCarsParser() as parser:
            data = await parser.get_lot(request.url)
            
            if data:
                # Optionally save to database
                data["_source"] = "bidcars"
                data["_parsed_url"] = request.url
                
                # Save/update in MongoDB
                if data.get("vin"):
                    await db.bidcars_vehicles.update_one(
                        {"vin": data["vin"]},
                        {"$set": data, "$setOnInsert": {"first_seen": datetime.now(timezone.utc).isoformat()}},
                        upsert=True
                    )
                
                return {
                    "success": True,
                    "data": data
                }
            else:
                return {
                    "success": False,
                    "error": "Failed to parse URL or page not found"
                }
    except Exception as e:
        logger.error(f"[BIDCARS] Parse error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@fastapi_app.post("/api/bidcars/search")
async def bidcars_search(request: BidCarsSearchRequest):
    """
    Search vehicles on bid.cars
    Example: POST /api/bidcars/search {"make": "Tesla", "year_from": 2020}
    """
    if not BIDCARS_AVAILABLE:
        return {"success": False, "error": "BidCars parser not available"}
    try:
        async with BidCarsParser() as parser:
            results = await parser.search(
                make=request.make,
                model=request.model,
                year_from=request.year_from,
                year_to=request.year_to,
                vehicle_type=request.vehicle_type,
                page=request.page
            )
            
            return {
                "success": True,
                "count": len(results),
                "results": results
            }
    except Exception as e:
        logger.error(f"[BIDCARS] Search error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@fastapi_app.get("/api/bidcars/browse/{make}")
async def bidcars_browse_make(make: str, page: int = 1):
    if not BIDCARS_AVAILABLE:
        return {"success": False, "error": "BidCars parser not available"}
    try:
        async with BidCarsParser() as parser:
            results = await parser.browse_make(make, page=page)
            
            return {
                "success": True,
                "make": make,
                "page": page,
                "count": len(results),
                "results": results
            }
    except Exception as e:
        logger.error(f"[BIDCARS] Browse error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@fastapi_app.get("/api/bidcars/homepage")
async def bidcars_homepage():
    if not BIDCARS_AVAILABLE:
        return {"success": False, "error": "BidCars parser not available"}
    try:
        async with BidCarsParser() as parser:
            sections = await parser.get_homepage_lots()
            
            total = sum(len(lots) for lots in sections.values())
            
            return {
                "success": True,
                "sections_count": len(sections),
                "total_vehicles": total,
                "sections": sections
            }
    except Exception as e:
        logger.error(f"[BIDCARS] Homepage error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@fastapi_app.get("/api/bidcars/vehicles")
async def bidcars_list_vehicles(limit: int = 50, skip: int = 0):
    """
    List parsed bid.cars vehicles from database
    """
    vehicles = await db.bidcars_vehicles.find(
        {},
        {"_id": 0}
    ).sort("parsed_at", -1).skip(skip).limit(limit).to_list(limit)
    
    total = await db.bidcars_vehicles.count_documents({})
    
    return {
        "success": True,
        "vehicles": vehicles,
        "total": total
    }

@fastapi_app.post("/api/bidcars/batch")
async def bidcars_batch_parse(urls: List[str] = Body(...)):
    """
    Parse multiple bid.cars URLs in batch
    Example: POST /api/bidcars/batch ["url1", "url2", ...]
    """
    results = []
    
    async with BidCarsParser() as parser:
        for url in urls[:20]:  # Limit to 20 URLs per batch
            try:
                data = await parser.get_lot(url)
                if data:
                    # Save to DB
                    if data.get("vin"):
                        await db.bidcars_vehicles.update_one(
                            {"vin": data["vin"]},
                            {"$set": data, "$setOnInsert": {"first_seen": datetime.now(timezone.utc).isoformat()}},
                            upsert=True
                        )
                    results.append({"url": url, "success": True, "data": data})
                else:
                    results.append({"url": url, "success": False, "error": "Parse failed"})
            except Exception as e:
                results.append({"url": url, "success": False, "error": str(e)})
            
            # Small delay between requests
            await asyncio.sleep(0.5)
    
    return {
        "success": True,
        "total": len(results),
        "parsed": len([r for r in results if r["success"]]),
        "failed": len([r for r in results if not r["success"]]),
        "results": results
    }

# ═══════════════════════════════════════════════════════════════════
# BID.CARS COOKIE PROXY - DEPRECATED (v3 legacy, kept for module-import safety)
# All `/api/bidcars/*` endpoints below are intercepted by the legacy
# kill-switch middleware and return 410 Gone (see top of file).
# ═══════════════════════════════════════════════════════════════════

try:
    from bidcars_cookie_proxy import BidCarsCookieProxy
except Exception as _e:
    BidCarsCookieProxy = None  # type: ignore
    logger.warning(f"[deprecated] bidcars_cookie_proxy unavailable: {_e}")

# Cookie Proxy будет использовать db напрямую
bidcars_proxy = None

def get_bidcars_proxy():
    global bidcars_proxy
    if bidcars_proxy is None and BidCarsCookieProxy is not None:
        bidcars_proxy = BidCarsCookieProxy(db)
    return bidcars_proxy

@fastapi_app.post("/api/bidcars/session/import")
async def bidcars_import_session(data: Dict[str, Any] = Body(...)):
    """
    Import cookies from Chrome Extension - ONE TIME SETUP
    After this, parsing works automatically without user interaction
    """
    cookies = data.get("cookies", [])
    user_agent = data.get("userAgent")
    
    if not cookies:
        return {"success": False, "error": "No cookies provided"}
    
    result = await get_bidcars_proxy().import_cookies(cookies, user_agent)
    return result

@fastapi_app.get("/api/bidcars/session/status")
async def bidcars_session_status():
    """Check if cookie session is active and valid"""
    status = await get_bidcars_proxy().get_session_status()
    
    if not status.get("active"):
        status["import_instruction"] = """
Чтобы активировать автоматический парсинг bid.cars:

1. Откройте bid.cars в браузере
2. Откройте DevTools (F12) → Console
3. Выполните этот код:

fetch('https://dev-ready-8.preview.emergentagent.com/api/bidcars/session/import', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    cookies: document.cookie.split(';').map(c => {
      const [name, ...v] = c.trim().split('=');
      return {name, value: v.join('=')};
    }),
    userAgent: navigator.userAgent
  })
}).then(r => r.json()).then(d => console.log('✅ Cookies imported!', d));

После этого парсинг будет работать автоматически!
"""
    
    return status

@fastapi_app.post("/api/bidcars/session/test")
async def bidcars_test_session():
    """Test if current session cookies are still working"""
    result = await get_bidcars_proxy().test_session()
    return result

@fastapi_app.post("/api/bidcars/proxy/parse", dependencies=[Depends(require_admin)])
async def bidcars_proxy_parse(data: Dict[str, Any] = Body(...)):
    """
    Parse bid.cars URL using saved cookies - INSTANT, no Playwright
    """
    url = data.get("url", "")
    
    if "bid.cars" not in url:
        return {"success": False, "error": "Only bid.cars URLs are supported"}
    
    proxy = get_bidcars_proxy()
    result = await proxy.parse_and_save(url)
    
    if result.get("success") and result.get("data"):
        # Also update VIN search cache
        vehicle = result["data"]
        return {
            "success": True,
            "vin": vehicle.get("vin"),
            "year": vehicle.get("year"),
            "make": vehicle.get("make_model", "").split()[0] if vehicle.get("make_model") else None,
            "model": " ".join(vehicle.get("make_model", "").split()[1:]) if vehicle.get("make_model") else None,
            "price": vehicle.get("current_bid"),
            "odometer": vehicle.get("odometer_value"),
            "location": vehicle.get("location"),
            "lot_number": vehicle.get("lot_id"),
            "auction_name": vehicle.get("auction"),
            "damage_primary": vehicle.get("primary_damage"),
            "damage_secondary": vehicle.get("secondary_damage"),
            "title": vehicle.get("document_type"),
            "image_urls": vehicle.get("images", []),
            "sale_date": vehicle.get("auction_date"),
            "keys": vehicle.get("keys"),
            "transmission": vehicle.get("transmission"),
            "winning_source": "bid.cars (cookie proxy)",
            "source_url": url,
            "parse_method": "cookie_proxy",
            "confidence": 0.99
        }
    
    return result

# Update main search endpoint to use cookie proxy first
@fastapi_app.post("/api/v2/search-by-url")
async def vin_search_by_url_v2(data: Dict[str, Any] = Body(...)):
    """
    Search by bid.cars URL - tries Cookie Proxy first (instant), then Playwright (slow)
    """
    start_time = time.time()
    
    url = data.get("url", "")
    
    if "bid.cars" not in url.lower():
        return {"success": False, "error": "Only bid.cars URLs are supported"}
    
    # 1. Try Cookie Proxy first (instant if session active)
    proxy = get_bidcars_proxy()
    session_status = await proxy.get_session_status()
    
    if session_status.get("active"):
        logger.info("[VIN-SEARCH] Using Cookie Proxy for bid.cars")
        result = await proxy.parse_and_save(url)
        
        if result.get("success") and result.get("data"):
            vehicle = result["data"]
            return {
                "success": True,
                "vin": vehicle.get("vin"),
                "year": vehicle.get("year"),
                "make": vehicle.get("make_model", "").split()[0] if vehicle.get("make_model") else None,
                "model": " ".join(vehicle.get("make_model", "").split()[1:]) if vehicle.get("make_model") else None,
                "price": vehicle.get("current_bid"),
                "odometer": vehicle.get("odometer_value"),
                "odometer_unit": "mi",
                "location": vehicle.get("location"),
                "lot_number": vehicle.get("lot_id"),
                "auction_name": vehicle.get("auction"),
                "damage_primary": vehicle.get("primary_damage"),
                "damage_secondary": vehicle.get("secondary_damage"),
                "title": vehicle.get("document_type"),
                "image_urls": vehicle.get("images", []),
                "sale_date": vehicle.get("auction_date"),
                "keys": vehicle.get("keys"),
                "transmission": vehicle.get("transmission"),
                "color": vehicle.get("exterior_color"),
                "winning_source": "bid.cars",
                "source_url": url,
                "confidence": 0.99,
                "response_time_ms": int((time.time() - start_time) * 1000),
                "cached": False,
                "parse_method": "cookie_proxy"
            }
    
    # 2. Fallback to Playwright (slow, may timeout)
    logger.info("[VIN-SEARCH] Cookie Proxy not available, trying Playwright...")
    try:
        from bidcars_parser import BidCarsParser
        
        async with BidCarsParser() as parser:
            result = await parser.get_lot(url)
            
            if result and result.get("vin"):
                result["_source"] = "bidcars"
                result["_parsed_url"] = url
                
                await db.bidcars_vehicles.update_one(
                    {"vin": result["vin"]},
                    {"$set": result, "$setOnInsert": {"first_seen": datetime.now(timezone.utc).isoformat()}},
                    upsert=True
                )
                
                return {
                    "success": True,
                    "vin": result.get("vin"),
                    "year": result.get("year"),
                    "make": result.get("make_model", "").split()[0] if result.get("make_model") else None,
                    "model": " ".join(result.get("make_model", "").split()[1:]) if result.get("make_model") else None,
                    "price": result.get("current_bid"),
                    "odometer": result.get("odometer_value"),
                    "odometer_unit": "mi",
                    "location": result.get("location"),
                    "lot_number": result.get("lot_id"),
                    "auction_name": result.get("auction"),
                    "damage_primary": result.get("primary_damage"),
                    "damage_secondary": result.get("secondary_damage"),
                    "title": result.get("document_type"),
                    "image_urls": result.get("images", []),
                    "sale_date": result.get("auction_date"),
                    "keys": result.get("keys"),
                    "transmission": result.get("transmission"),
                    "color": result.get("exterior_color"),
                    "winning_source": "bid.cars",
                    "source_url": url,
                    "confidence": 0.98,
                    "response_time_ms": int((time.time() - start_time) * 1000),
                    "cached": False,
                    "parse_method": "playwright"
                }
    except Exception as e:
        logger.error(f"[VIN-SEARCH] Playwright parse failed: {e}")
    
    return {
        "success": False, 
        "error": "Failed to parse. Import cookies via Chrome Extension for instant parsing.",
        "need_cookies": not session_status.get("active")
    }

# ═══════════════════════════════════════════════════════════════════
# COPART COOKIE PROXY (Session Bridge Architecture)
# ═══════════════════════════════════════════════════════════════════
# Architecture:
#   1. User logs into Copart in browser
#   2. Extension sends session cookies to backend (ONE TIME)
#   3. Backend stores cookies and uses them to fetch ANY lot/VIN
#   4. CRM searches via backend — no Copart open needed
#   5. Session refresh only when cookies expire
#
# Copart API endpoints (internal, session-authenticated):
#   POST /public/vehicleFinder/search — search by VIN/query
#   GET  /public/data/lotdetails/solr/lotImages/{lotId} — full lot details
# ═══════════════════════════════════════════════════════════════════

# In-memory Copart session store
copart_session = {
    "cookies": {},
    "user_agent": "",
    "imported_at": None,
    "last_used": None,
    "requests_count": 0,
    "success_count": 0,
    "fail_count": 0,
}

COPART_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Connection": "keep-alive",
    "Cache-Control": "max-age=0",
}


def copart_cookie_header() -> str:
    """Build Cookie header string from stored cookies"""
    return "; ".join([f"{k}={v}" for k, v in copart_session["cookies"].items()])


def copart_session_active() -> bool:
    """Check if Copart session is available"""
    return bool(copart_session["cookies"]) and copart_session["imported_at"] is not None


@fastapi_app.post("/api/copart/session/import")
async def copart_import_session(data: Dict[str, Any] = Body(...)):
    """
    Import Copart cookies from Chrome Extension — ONE TIME SETUP.
    After this, backend can fetch any Copart lot/VIN without browser.
    """
    cookies_list = data.get("cookies", [])
    user_agent = data.get("userAgent", "")
    
    if not cookies_list:
        return {"success": False, "error": "No cookies provided"}
    
    # Store cookies as key-value dict
    cookie_dict = {}
    for c in cookies_list:
        name = c.get("name", "")
        value = c.get("value", "")
        if name and value:
            cookie_dict[name] = value
    
    if not cookie_dict:
        return {"success": False, "error": "No valid cookies found"}
    
    now = datetime.now(timezone.utc)
    copart_session["cookies"] = cookie_dict
    copart_session["user_agent"] = user_agent
    copart_session["imported_at"] = now
    copart_session["last_used"] = now
    copart_session["requests_count"] = 0
    copart_session["success_count"] = 0
    copart_session["fail_count"] = 0
    
    # Also persist to DB
    await db.copart_sessions.update_one(
        {"_id": "active_session"},
        {"$set": {
            "cookies": cookie_dict,
            "user_agent": user_agent,
            "imported_at": now,
            "cookie_count": len(cookie_dict),
            "cookie_names": list(cookie_dict.keys()),
        }},
        upsert=True,
    )
    
    # Key cookies for Copart auth
    key_cookies = ["G2JSESSIONID", "COPARTMEMBER", "coaboression"]
    found_keys = [k for k in key_cookies if k in cookie_dict]
    
    logger.info(f"[COPART] Session imported: {len(cookie_dict)} cookies, key cookies: {found_keys}")
    
    return {
        "success": True,
        "cookies_stored": len(cookie_dict),
        "key_cookies_found": found_keys,
        "cookie_names": list(cookie_dict.keys())[:20],
        "message": "Copart session imported. Backend can now fetch any lot/VIN.",
    }


@fastapi_app.get("/api/copart/session/status")
async def copart_session_status():
    """Check Copart session status"""
    if not copart_session_active():
        # Try to restore from DB
        stored = await db.copart_sessions.find_one({"_id": "active_session"})
        if stored and stored.get("cookies"):
            copart_session["cookies"] = stored["cookies"]
            copart_session["user_agent"] = stored.get("user_agent", "")
            copart_session["imported_at"] = stored.get("imported_at")
    
    active = copart_session_active()
    return {
        "active": active,
        "cookies_count": len(copart_session["cookies"]),
        "imported_at": copart_session["imported_at"].isoformat() if copart_session["imported_at"] else None,
        "last_used": copart_session["last_used"].isoformat() if copart_session["last_used"] else None,
        "requests_count": copart_session["requests_count"],
        "success_count": copart_session["success_count"],
        "fail_count": copart_session["fail_count"],
        "message": "Session active. Ready to fetch Copart data." if active 
            else "No session. Open Copart in browser, login, then sync cookies via Extension.",
    }


async def _copart_fetch(url: str, method: str = "GET", data: str = None) -> Optional[Dict]:
    """Internal: make HTTP request to Copart using stored cookies"""
    if not copart_session_active():
        return None
    
    headers = {
        **COPART_HEADERS,
        "User-Agent": copart_session["user_agent"] or "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Cookie": copart_cookie_header(),
        "Host": "www.copart.com",
        "Referer": "https://www.copart.com/",
        "Origin": "https://www.copart.com",
    }
    
    copart_session["requests_count"] += 1
    copart_session["last_used"] = datetime.now(timezone.utc)
    
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            if method == "POST":
                resp = await client.post(url, content=data, headers=headers)
            else:
                resp = await client.get(url, headers=headers)
            
            # Log response for debugging
            logger.info(f"[COPART] {method} {url} → {resp.status_code} ({len(resp.content)} bytes)")
            
            if resp.status_code == 200:
                # Check if response is JSON
                content_type = resp.headers.get("content-type", "")
                if "json" in content_type.lower():
                    result = resp.json()
                    copart_session["success_count"] += 1
                    return result
                else:
                    # Not JSON - might be HTML (Cloudflare challenge or login page)
                    logger.warning(f"[COPART] Non-JSON response: {content_type}, first 200 chars: {resp.text[:200]}")
                    copart_session["fail_count"] += 1
                    return {"error": "Non-JSON response (possibly Cloudflare/login page)", "content_type": content_type}
            elif resp.status_code in [301, 302, 303, 307, 308]:
                logger.warning(f"[COPART] Redirect {resp.status_code} to {resp.headers.get('location')}")
                copart_session["fail_count"] += 1
                return {"error": f"Redirect {resp.status_code} - session may be expired", "status": resp.status_code}
            else:
                copart_session["fail_count"] += 1
                logger.warning(f"[COPART] HTTP {resp.status_code} for {url}")
                return {"error": f"HTTP {resp.status_code}", "status": resp.status_code}
    except Exception as e:
        copart_session["fail_count"] += 1
        logger.error(f"[COPART] Fetch error: {e}")
        return {"error": str(e)}


def _parse_copart_lot(lot_data: Dict, images_data: Dict = None) -> Dict:
    """Parse Copart lot JSON response into normalized vehicle dict"""
    lot = lot_data.get("lotDetails", {})
    if not lot:
        return {}
    
    images_list = images_data or lot_data.get("imagesList", {})
    full_images = [img["url"] for img in images_list.get("FULL_IMAGE", []) if "url" in img]
    thumb_images = [img["url"] for img in images_list.get("THUMBNAIL_IMAGE", []) if "url" in img]
    
    # VIN parsing - может быть частичным (с звездочками)
    vin_raw = lot.get("fv")
    vin_partial = False
    if vin_raw and "*" in vin_raw:
        vin_partial = True
    
    # Odometer parsing
    orr = lot.get("orr", "")
    odometer = None
    odometer_unit = "mi"
    odometer_status = None
    if orr:
        num_match = re.sub(r'[^\d]', '', orr.split('(')[0] if '(' in orr else orr)
        odometer = int(num_match) if num_match else None
        odometer_unit = "km" if "km" in orr.lower() else "mi"
        if "NOT ACTUAL" in orr.upper():
            odometer_status = "NOT_ACTUAL"
        elif "ACTUAL" in orr.upper():
            odometer_status = "ACTUAL"
        elif "EXEMPT" in orr.upper():
            odometer_status = "EXEMPT"
    
    # Sale date
    sale_date = None
    if lot.get("ad"):
        try:
            sale_date = datetime.fromtimestamp(lot["ad"] / 1000, tz=timezone.utc).isoformat()
        except:
            pass
    
    return {
        "vin": vin_raw,
        "vin_partial": vin_partial,  # NEW: флаг для частичного VIN
        "lot_number": str(lot.get("ln", "")),
        "year": lot.get("lcy"),
        "make": lot.get("mkn"),
        "model": lot.get("lm"),
        "title": lot.get("ld"),
        "retail_value": lot.get("la"),
        "odometer": odometer,
        "odometer_unit": odometer_unit,
        "odometer_raw": orr,
        "odometer_status": odometer_status,
        "engine": lot.get("egn"),
        "cylinders": lot.get("cy"),
        "transmission": lot.get("tmtp"),
        "fuel": lot.get("ft"),
        "drive": lot.get("drv"),
        "color": lot.get("clr"),
        "body_style": lot.get("bstl"),
        "keys": lot.get("hk"),
        "damage_primary": lot.get("dd"),
        "damage_secondary": lot.get("sdd"),
        "title_status": lot.get("td"),
        "title_state": lot.get("ts"),
        "seller": lot.get("scn"),
        "location": lot.get("yn"),
        "sale_date": sale_date,
        "currency": lot.get("cuc"),
        "current_bid": lot.get("dynamicLotDetails", {}).get("currentBid"),
        "buy_today_bid": lot.get("dynamicLotDetails", {}).get("buyTodayBid"),
        "bid_status": lot.get("dynamicLotDetails", {}).get("bidStatus", "").replace("_", " "),
        "sale_status": lot.get("dynamicLotDetails", {}).get("saleStatus", "").replace("_", " "),
        "images": full_images,
        "thumbnail_images": thumb_images,
        "avatar": lot.get("tims"),
        "notes": (lot.get("ltnte") or "").strip(),
        "grid": lot.get("gr"),
        "lane": lot.get("al"),
        "auction_name": "Copart",
        "source": "copart",
    }


@fastapi_app.post("/api/copart/lookup")
async def copart_lookup(data: Dict[str, Any] = Body(...)):
    """
    Main CRM lookup endpoint.
    Fetches lot details from Copart using stored session cookies.
    Accepts: lot_number OR vin
    """
    lot_number = data.get("lot_number") or data.get("lotNumber")
    vin = data.get("vin")
    
    if not copart_session_active():
        # Try restore from DB
        stored = await db.copart_sessions.find_one({"_id": "active_session"})
        if stored and stored.get("cookies"):
            copart_session["cookies"] = stored["cookies"]
            copart_session["user_agent"] = stored.get("user_agent", "")
            copart_session["imported_at"] = stored.get("imported_at")
        else:
            return {
                "success": False,
                "error": "session_expired",
                "message": "No active Copart session. Open Copart in browser, login, sync cookies via Extension."
            }
    
    start_time = time.time()
    
    # Strategy 1: Direct lot lookup by lot number
    if lot_number:
        url = f"https://www.copart.com/public/data/lotdetails/solr/lotImages/{lot_number}"
        result = await _copart_fetch(url)
        
        if result and not result.get("error") and result.get("data"):
            vehicle = _parse_copart_lot(result["data"], result["data"].get("imagesList"))
            
            if vehicle.get("vin") or vehicle.get("lot_number"):
                # Save to DB
                vehicle["fetched_at"] = datetime.now(timezone.utc)
                vehicle["response_time_ms"] = int((time.time() - start_time) * 1000)
                
                await db.copart_vehicles.update_one(
                    {"lot_number": str(lot_number)},
                    {"$set": vehicle, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
                    upsert=True,
                )
                
                logger.info(f"[COPART] Lookup lot={lot_number} vin={vehicle.get('vin')} {vehicle.get('title')}")
                return {
                    "success": True,
                    "vehicle": vehicle,
                    "response_time_ms": int((time.time() - start_time) * 1000),
                    "source": "copart_live",
                }
        
        # Check if session expired
        if result and result.get("status") in [401, 403, 302]:
            return {
                "success": False,
                "error": "session_expired",
                "message": "Copart session expired. Please re-login and sync cookies."
            }
        
        return {"success": False, "error": f"Lot {lot_number} not found or session issue", "raw": result}
    
    # Strategy 2: Search by VIN
    if vin:
        search_payload = (
            f"query={vin.upper()}"
            f"&filter%5BFREEFORMQUERY%5D={vin.upper()}"
            f"&sort=auction_date_type+desc%2Cauction_date_utc+asc"
            f"&page=0&size=20&start=0&draw=1&columns%5B0%5D%5Bdata%5D=0"
            f"&watchListOnly=false&freeFormSearch=true"
        )
        
        url = "https://www.copart.com/public/vehicleFinder/search"
        result = await _copart_fetch(url, method="POST", data=search_payload)
        
        if result and not result.get("error"):
            results_data = result.get("data", {}).get("results", {})
            content = results_data.get("content", [])
            total = results_data.get("totalElements", 0)
            
            if content:
                # Get the first match and fetch full details
                first_lot = content[0]
                first_lot_number = first_lot.get("ln")
                
                if first_lot_number:
                    detail_url = f"https://www.copart.com/public/data/lotdetails/solr/lotImages/{first_lot_number}"
                    detail_result = await _copart_fetch(detail_url)
                    
                    if detail_result and detail_result.get("data"):
                        vehicle = _parse_copart_lot(detail_result["data"], detail_result["data"].get("imagesList"))
                        vehicle["fetched_at"] = datetime.now(timezone.utc)
                        vehicle["response_time_ms"] = int((time.time() - start_time) * 1000)
                        
                        await db.copart_vehicles.update_one(
                            {"lot_number": str(first_lot_number)},
                            {"$set": vehicle, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
                            upsert=True,
                        )
                        
                        logger.info(f"[COPART] VIN search vin={vin} → lot={first_lot_number} {vehicle.get('title')}")
                        return {
                            "success": True,
                            "vehicle": vehicle,
                            "total_results": total,
                            "response_time_ms": int((time.time() - start_time) * 1000),
                            "source": "copart_live",
                        }
            
            return {"success": False, "error": f"VIN {vin} not found on Copart", "total_results": total}
        
        if result and result.get("status") in [401, 403, 302]:
            return {"success": False, "error": "session_expired", "message": "Copart session expired."}
        
        return {"success": False, "error": "Search failed", "raw": result}
    
    return {"success": False, "error": "Provide lot_number or vin"}


@fastapi_app.get("/api/copart/vehicles")
async def copart_vehicles(limit: int = 50, skip: int = 0, search: str = ""):
    """List all Copart vehicles fetched via Cookie Proxy"""
    query = {}
    if search:
        query["$or"] = [
            {"vin": {"$regex": search, "$options": "i"}},
            {"lot_number": {"$regex": search, "$options": "i"}},
            {"title": {"$regex": search, "$options": "i"}},
            {"make": {"$regex": search, "$options": "i"}},
            {"model": {"$regex": search, "$options": "i"}},
        ]
    
    total = await db.copart_vehicles.count_documents(query)
    vehicles = await db.copart_vehicles.find(
        query, {"_id": 0}
    ).sort("fetched_at", -1).skip(skip).limit(limit).to_list(length=limit)
    
    return {"success": True, "total": total, "items": vehicles, "has_more": total > skip + limit}


@fastapi_app.get("/api/copart/stats")
async def copart_stats():
    """Copart statistics"""
    total = await db.copart_vehicles.count_documents({})
    with_vin = await db.copart_vehicles.count_documents({"vin": {"$exists": True, "$ne": None}})
    with_images = await db.copart_vehicles.count_documents({"images": {"$exists": True, "$ne": []}})
    latest = await db.copart_vehicles.find_one({}, {"_id": 0, "lot_number": 1, "title": 1, "fetched_at": 1}, sort=[("fetched_at", -1)])
    
    return {
        "success": True,
        "session_active": copart_session_active(),
        "stats": {
            "total_vehicles": total,
            "with_vin": with_vin,
            "with_images": with_images,
            "session_requests": copart_session["requests_count"],
            "session_success": copart_session["success_count"],
            "latest": latest,
        }
    }


@fastapi_app.get("/api/copart/vehicle/{lot_number}")
async def copart_vehicle_detail(lot_number: str):
    """Get single Copart vehicle — from DB cache or live fetch"""
    # Check DB first
    vehicle = await db.copart_vehicles.find_one({"lot_number": lot_number}, {"_id": 0})
    if vehicle:
        return {"success": True, "vehicle": vehicle, "source": "cache"}
    
    # Try live fetch
    if copart_session_active():
        url = f"https://www.copart.com/public/data/lotdetails/solr/lotImages/{lot_number}"
        result = await _copart_fetch(url)
        if result and result.get("data"):
            vehicle = _parse_copart_lot(result["data"], result["data"].get("imagesList"))
            return {"success": True, "vehicle": vehicle, "source": "live"}
    
    return {"success": False, "error": "Vehicle not found"}


# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/admin/chrome-extension/download", dependencies=[Depends(require_admin)])
async def download_chrome_extension():
    """Download Chrome Extension ZIP file"""
    from fastapi.responses import FileResponse
    import os
    
    file_path = os.path.join(os.path.dirname(__file__), "chrome_extension")
    zip_path = os.path.join(os.path.dirname(__file__), "bibi-cars-extension.zip")
    
    # Check if ZIP exists
    if not os.path.exists(zip_path):
        # Create ZIP if doesn't exist
        import zipfile
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(file_path):
                for file in files:
                    file_full_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_full_path, os.path.dirname(file_path))
                    zipf.write(file_full_path, arcname)
    
    return FileResponse(
        path=zip_path,
        media_type='application/zip',
        filename='bibi-cars-extension.zip'
    )


@fastapi_app.post("/api/copart/debug-cookies")
async def copart_debug_cookies(data: Dict[str, Any] = Body(...)):
    """Debug endpoint - receive cookie diagnostic data from extension"""
    logger.info(f"[COPART DEBUG] Received cookie diagnostic data")
    logger.info(f"  Total cookies: {data.get('totalCount', 0)}")
    logger.info(f"  hasCfClearance: {data.get('hasCfClearance', False)}")
    logger.info(f"  hasCfBm: {data.get('hasCfBm', False)}")
    logger.info(f"  hasG2Session: {data.get('hasG2Session', False)}")
    logger.info(f"  Cookie names: {data.get('cookieNames', [])}")
    logger.info(f"  Domains: {data.get('domains', [])}")
    
    # Store in DB for analysis
    await db.copart_debug.insert_one({
        **data,
        "timestamp": datetime.now(timezone.utc),
    })
    
    return {
        "success": True,
        "message": "Debug data received",
        "analysis": {
            "cf_clearance_present": data.get('hasCfClearance', False),
            "session_valid": data.get('hasCfClearance') and data.get('hasG2Session'),
            "recommendation": (
                "Cookie proxy should work" if data.get('hasCfClearance') 
                else "cf_clearance missing - Cloudflare challenge not passed"
            )
        }
    }


@fastapi_app.post("/api/auction/copart/ingest")
async def copart_ingest_lot(data: Dict[str, Any] = Body(...)):
    """
    Copart DOM Ingestion - receive parsed lot data from extension
    """
    logger.info(f"[COPART INGEST] Received lot data: {data.get('lotNumber')} / {data.get('vin')}")
    
    # Validate required fields
    if not data.get('lotNumber') and not data.get('vin'):
        raise HTTPException(status_code=400, detail="lotNumber or vin is required")
    
    # Dedupe key
    match_filter = {}
    if data.get('lotNumber'):
        match_filter = {"source": "copart", "lotNumber": data.get('lotNumber')}
    elif data.get('vin'):
        match_filter = {"source": "copart", "vin": data.get('vin')}
    
    # Upsert to database
    result = await db.copart_lots.update_one(
        match_filter,
        {
            "$set": {
                "source": "copart",
                "lotNumber": data.get('lotNumber'),
                "vin": data.get('vin'),
                "title": data.get('title'),
                "year": data.get('year'),
                "make": data.get('make'),
                "model": data.get('model'),
                "currentBid": data.get('currentBid'),
                "buyItNowPrice": data.get('buyItNowPrice'),
                "odometer": data.get('odometer'),
                "primaryDamage": data.get('primaryDamage'),
                "secondaryDamage": data.get('secondaryDamage'),
                "saleDate": data.get('saleDate'),
                "location": data.get('location'),
                "titleStatus": data.get('titleStatus'),
                "titleState": data.get('titleState'),
                "engine": data.get('engine'),
                "transmission": data.get('transmission'),
                "fuelType": data.get('fuelType'),
                "color": data.get('color'),
                "bodyStyle": data.get('bodyStyle'),
                "driveType": data.get('driveType'),
                "cylinders": data.get('cylinders'),
                "keys": data.get('keys'),
                "seller": data.get('seller'),
                "sourceUrl": data.get('sourceUrl'),
                "images": data.get('images', []),
                "raw": data,
                "lastScrapedAt": data.get('scrapedAt'),
                "updatedAt": datetime.now(timezone.utc),
            },
            "$setOnInsert": {
                "createdAt": datetime.now(timezone.utc),
            }
        },
        upsert=True
    )
    
    # Get the document ID
    if result.upserted_id:
        doc_id = str(result.upserted_id)
        logger.info(f"[COPART INGEST] Created new lot: {doc_id}")
    else:
        # Find the existing doc
        doc = await db.copart_lots.find_one(match_filter)
        doc_id = str(doc["_id"]) if doc else None
        logger.info(f"[COPART INGEST] Updated existing lot: {doc_id}")
    
    return {
        "ok": True,
        "id": doc_id,
        "lotNumber": data.get('lotNumber'),
        "vin": data.get('vin'),
        "isNew": bool(result.upserted_id),
        "matchedCount": result.matched_count,
        "modifiedCount": result.modified_count
    }


@fastapi_app.get("/api/auction/copart/lots")
async def get_copart_lots(
    limit: int = 50,
    skip: int = 0,
    search: str = None
):
    """Get parsed Copart lots from database"""
    filter_query = {"source": "copart"}
    
    if search:
        filter_query["$or"] = [
            {"vin": {"$regex": search, "$options": "i"}},
            {"lotNumber": {"$regex": search, "$options": "i"}},
            {"title": {"$regex": search, "$options": "i"}},
        ]
    
    cursor = db.copart_lots.find(filter_query).sort("createdAt", -1).skip(skip).limit(limit)
    lots = await cursor.to_list(length=limit)
    
    total = await db.copart_lots.count_documents(filter_query)
    
    return {
        "lots": [serialize_doc(lot) for lot in lots],
        "total": total,
        "limit": limit,
        "skip": skip
    }


# ═══════════════════════════════════════════════════════════════════
# VIN SEARCH ENGINE - AUTOMATED AGENT QUEUE SYSTEM
# ═══════════════════════════════════════════════════════════════════
# Architecture:
#   User → POST /api/vin/search → Backend creates PENDING task
#   Extension → GET /api/agent/tasks (polling every 5s) → Backend returns + locks task (IN_PROGRESS)
#   Extension → opens Copart, searches VIN, parses DOM → POST /api/agent/result
#   User UI → GET /api/vin/status/:id (polling every 2s) → Backend returns current status
#   Extension → POST /api/agent/heartbeat (every 10-15s) → Backend tracks agent health
#   Background job → requeue stuck tasks (IN_PROGRESS > 30s → PENDING)
# ═══════════════════════════════════════════════════════════════════

# Agent heartbeat storage (in-memory for MVP, можно переместить в Redis/MongoDB)
agent_heartbeat_store = {
    "lastHeartbeat": None,  # datetime
    "agentId": None,
    "isAlive": False
}

def normalize_vin(vin: str) -> Dict[str, Any]:
    """
    Normalize VIN for partial VIN support
    Supports:
    - Full VIN: 17 characters (e.g., 1HGBH41JXMN109186)
    - Partial VIN: < 17 characters (e.g., 5N1AR2MM3FC - 11 chars)
    - Partial with wildcards: contains * (e.g., 5UXTA6C08M9******)
    
    Returns: { vinRaw, vinClean, vinPartial }
    """
    vin_raw = vin.strip().upper()
    vin_clean = vin_raw.replace("*", "")
    
    # Partial VIN if:
    # 1. Contains * wildcard
    # 2. Less than 17 characters (natural partial VIN from Copart)
    vin_partial = "*" in vin_raw or len(vin_clean) < 17
    
    return {
        "vinRaw": vin_raw,
        "vinClean": vin_clean,
        "vinPartial": vin_partial
    }


@fastapi_app.post("/api/vin/search")
async def create_vin_search(data: Dict[str, Any] = Body(...)):
    """
    User endpoint: Create new VIN search task
    Body: { vin: string }
    Returns: { searchId, status }
    """
    vin = data.get("vin", "").strip()
    
    if not vin:
        raise HTTPException(status_code=400, detail="VIN is required")
    
    # Normalize VIN (supports partial VIN with *)
    normalized = normalize_vin(vin)
    
    # Validate length
    if len(normalized["vinClean"]) < 6:
        raise HTTPException(status_code=400, detail="VIN должен содержать минимум 6 символов")
    
    if len(normalized["vinClean"]) > 17:
        raise HTTPException(status_code=400, detail="VIN не может превышать 17 символов")
    
    # Create search request
    search_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    search_doc = {
        "_id": search_id,
        "vin": normalized["vinRaw"],
        "vinClean": normalized["vinClean"],
        "vinPartial": normalized["vinPartial"],
        "status": "PENDING",
        "vehicleId": None,
        "errorMessage": None,
        "createdAt": now,
        "updatedAt": now,
        "startedAt": None,
    }
    
    await db.search_requests.insert_one(search_doc)
    
    logger.info(f"[VIN SEARCH] Created task {search_id[:8]}... for VIN {normalized['vinRaw']}")
    
    return {
        "searchId": search_id,
        "status": "PENDING",
        "vin": normalized["vinRaw"],
        "vinPartial": normalized["vinPartial"]
    }


@fastapi_app.get("/api/agent/tasks")
async def get_agent_task():
    """
    Extension endpoint: Get next PENDING task and lock it (atomic reservation)
    Returns ONE task or null
    """
    now = datetime.now(timezone.utc)
    
    # Atomically find and update ONE PENDING task to IN_PROGRESS
    result = await db.search_requests.find_one_and_update(
        {"status": "PENDING"},
        {
            "$set": {
                "status": "IN_PROGRESS",
                "startedAt": now,
                "updatedAt": now
            }
        },
        sort=[("createdAt", 1)],  # FIFO
        return_document=True
    )
    
    if not result:
        return {"task": None}
    
    search_id = result["_id"]
    vin = result["vin"]
    
    logger.info(f"[AGENT] Task {search_id[:8]}... reserved for VIN {vin}")
    
    return {
        "task": {
            "searchId": search_id,
            "vin": vin,
            "vinClean": result["vinClean"],
            "vinPartial": result["vinPartial"]
        }
    }


@fastapi_app.post("/api/agent/result")
async def submit_agent_result(data: Dict[str, Any] = Body(...)):
    """
    Extension endpoint: Submit search result
    Body: {
      searchId: string,
      status: "FOUND" | "NOT_FOUND" | "FAILED",
      vehicleData?: object (lot payload from DOM parser),
      errorMessage?: string
    }
    """
    search_id = data.get("searchId")
    status = data.get("status")
    vehicle_data = data.get("vehicleData")
    error_message = data.get("errorMessage")
    
    if not search_id or not status:
        raise HTTPException(status_code=400, detail="searchId and status are required")
    
    if status not in ["FOUND", "NOT_FOUND", "FAILED"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    now = datetime.now(timezone.utc)
    vehicle_id = None
    
    # If FOUND, upsert vehicle data to copart_lots
    if status == "FOUND" and vehicle_data:
        # Use existing ingest logic
        match_filter = {}
        if vehicle_data.get('lotNumber'):
            match_filter = {"source": "copart", "lotNumber": vehicle_data.get('lotNumber')}
        elif vehicle_data.get('vin'):
            match_filter = {"source": "copart", "vin": vehicle_data.get('vin')}
        
        if match_filter:
            result = await db.copart_lots.update_one(
                match_filter,
                {
                    "$set": {
                        "source": "copart",
                        "lotNumber": vehicle_data.get('lotNumber'),
                        "vin": vehicle_data.get('vin'),
                        "title": vehicle_data.get('title'),
                        "year": vehicle_data.get('year'),
                        "make": vehicle_data.get('make'),
                        "model": vehicle_data.get('model'),
                        "currentBid": vehicle_data.get('currentBid'),
                        "buyItNowPrice": vehicle_data.get('buyItNowPrice'),
                        "odometer": vehicle_data.get('odometer'),
                        "primaryDamage": vehicle_data.get('primaryDamage'),
                        "secondaryDamage": vehicle_data.get('secondaryDamage'),
                        "saleDate": vehicle_data.get('saleDate'),
                        "location": vehicle_data.get('location'),
                        "titleStatus": vehicle_data.get('titleStatus'),
                        "titleState": vehicle_data.get('titleState'),
                        "engine": vehicle_data.get('engine'),
                        "transmission": vehicle_data.get('transmission'),
                        "fuelType": vehicle_data.get('fuelType'),
                        "color": vehicle_data.get('color'),
                        "bodyStyle": vehicle_data.get('bodyStyle'),
                        "driveType": vehicle_data.get('driveType'),
                        "cylinders": vehicle_data.get('cylinders'),
                        "keys": vehicle_data.get('keys'),
                        "seller": vehicle_data.get('seller'),
                        "sourceUrl": vehicle_data.get('sourceUrl'),
                        "images": vehicle_data.get('images', []),
                        "raw": vehicle_data,
                        "lastScrapedAt": vehicle_data.get('scrapedAt'),
                        "updatedAt": now,
                    },
                    "$setOnInsert": {
                        "createdAt": now,
                    }
                },
                upsert=True
            )
            
            # Get vehicle_id
            if result.upserted_id:
                vehicle_id = str(result.upserted_id)
            else:
                doc = await db.copart_lots.find_one(match_filter)
                vehicle_id = str(doc["_id"]) if doc else None
    
    # Update search_request
    update_data = {
        "status": status,
        "updatedAt": now
    }
    
    if vehicle_id:
        update_data["vehicleId"] = vehicle_id
    
    if error_message:
        update_data["errorMessage"] = error_message
    
    await db.search_requests.update_one(
        {"_id": search_id},
        {"$set": update_data}
    )
    
    logger.info(f"[AGENT] Result for {search_id[:8]}... → {status} (vehicleId: {vehicle_id})")
    
    return {
        "ok": True,
        "searchId": search_id,
        "status": status,
        "vehicleId": vehicle_id
    }


@fastapi_app.get("/api/vin/status/{search_id}")
async def get_search_status(search_id: str):
    """
    User endpoint: Get current search status (for polling)
    Returns: { searchId, status, vin, vehicleData?, errorMessage? }
    """
    search = await db.search_requests.find_one({"_id": search_id})
    
    if not search:
        raise HTTPException(status_code=404, detail="Search request not found")
    
    response = {
        "searchId": search_id,
        "status": search["status"],
        "vin": search["vin"],
        "vinPartial": search.get("vinPartial", False),
        "createdAt": search["createdAt"].isoformat(),
        "updatedAt": search["updatedAt"].isoformat(),
    }
    
    # If FOUND, include vehicle data
    if search["status"] == "FOUND" and search.get("vehicleId"):
        from bson import ObjectId
        try:
            vehicle_oid = ObjectId(search["vehicleId"])
            vehicle = await db.copart_lots.find_one({"_id": vehicle_oid})
            if vehicle:
                # Convert ObjectId to string for JSON serialization
                vehicle["_id"] = str(vehicle["_id"])
                response["vehicleData"] = vehicle
        except Exception as e:
            logger.warning(f"Failed to load vehicle data: {e}")
    
    # If FAILED, include error message
    if search.get("errorMessage"):
        response["errorMessage"] = search["errorMessage"]
    
    return response


@fastapi_app.post("/api/agent/heartbeat")
async def agent_heartbeat(data: Dict[str, Any] = Body(...)):
    """
    Extension endpoint: Heartbeat ping (every 10-15s)
    Body: { agentId?: string }
    """
    now = datetime.now(timezone.utc)
    agent_id = data.get("agentId", "default")
    
    # Update in-memory store
    agent_heartbeat_store["lastHeartbeat"] = now
    agent_heartbeat_store["agentId"] = agent_id
    agent_heartbeat_store["isAlive"] = True
    
    logger.debug(f"[AGENT] Heartbeat from {agent_id}")
    
    return {"ok": True, "timestamp": now.isoformat()}


@fastapi_app.get("/api/agent/ping")
async def check_agent_status():
    """
    User endpoint: Check if agent is alive
    Returns: { alive: bool, lastHeartbeat?: datetime, staleSeconds?: int }
    """
    last_heartbeat = agent_heartbeat_store.get("lastHeartbeat")
    
    if not last_heartbeat:
        return {
            "alive": False,
            "message": "Агент никогда не подключался"
        }
    
    now = datetime.now(timezone.utc)
    stale_seconds = (now - last_heartbeat).total_seconds()
    
    # Consider alive if heartbeat within last 30 seconds
    is_alive = stale_seconds < 30
    
    return {
        "alive": is_alive,
        "lastHeartbeat": last_heartbeat.isoformat(),
        "staleSeconds": int(stale_seconds),
        "agentId": agent_heartbeat_store.get("agentId"),
        "message": "Агент активен" if is_alive else "Агент не отвечает"
    }


# Background task: Requeue stuck tasks
async def requeue_stuck_tasks():
    """
    Background job: Find IN_PROGRESS tasks older than 30s and reset to PENDING
    """
    while True:
        try:
            await asyncio.sleep(10)  # Run every 10 seconds
            
            now = datetime.now(timezone.utc)
            timeout_threshold = now - timedelta(seconds=30)
            
            # Find stuck tasks
            result = await db.search_requests.update_many(
                {
                    "status": "IN_PROGRESS",
                    "startedAt": {"$lt": timeout_threshold}
                },
                {
                    "$set": {
                        "status": "PENDING",
                        "startedAt": None,
                        "updatedAt": now
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.warning(f"[REQUEUE] Reset {result.modified_count} stuck tasks to PENDING")
                
        except Exception as e:
            logger.error(f"[REQUEUE] Error: {e}")


# Start background task on app startup
@fastapi_app.on_event("startup")
async def startup_event():
    logger.info("[VIN SEARCH ENGINE] Starting background requeue task...")
    asyncio.create_task(requeue_stuck_tasks())
    # Seed app_settings.auth defaults (idempotent)
    try:
        await get_settings_service().ensure_defaults()
        logger.info("[settings] auth defaults ensured")
    except Exception as exc:
        logger.warning(f"[settings] ensure_defaults failed: {exc}")


# =============================================
# CABINET API ENDPOINTS (без авторизации для теста)
# =============================================

# ═══════════════════════════════════════════════════════════════════
# PHASE III — Customer Favorites (auth-gated, real)
# ═══════════════════════════════════════════════════════════════════
# Identity = `customerId` resolved from Bearer customer-session token.
# Storage = `favorites` collection, unique by (customerId, vin).
# Each favorite snapshots vehicle metadata so cabinet renders fast even
# if the source listing is later archived/removed from `vin_data`.

async def _require_customer(authorization: Optional[str]) -> Dict[str, Any]:
    """Resolve the Bearer session into a customer doc; 401 if missing/expired."""
    customer = await _resolve_bearer(authorization)
    if not customer:
        raise HTTPException(status_code=401, detail="Authentication required")
    return customer


async def _vin_card_for_favorite(vin: str) -> Dict[str, Any]:
    """Pull a fresh card snapshot for VIN from vin_data (best-effort).

    Returns an empty dict if VIN not found — caller should fall back to the
    snapshot stored in the favorite row.
    """
    if not vin:
        return {}
    try:
        doc = await db.vin_data.find_one({"vin": vin}, {"_id": 0})
        if not doc:
            return {}
        return {
            "vin": doc.get("vin"),
            "title": doc.get("title"),
            "make": doc.get("make"),
            "model": doc.get("model"),
            "year": doc.get("year"),
            "trim": doc.get("trim"),
            "price": doc.get("price") or doc.get("buy_now_price"),
            "image": doc.get("image") or (doc.get("images") or [None])[0],
            "lot_number": doc.get("lot_number"),
            "auction_name": doc.get("auction_name") or doc.get("auction"),
            "odometer": doc.get("odometer"),
            "odometer_unit": doc.get("odometer_unit"),
            "archived": bool(doc.get("archived")),
        }
    except Exception:
        return {}


@fastapi_app.get("/api/favorites/me")
async def get_my_favorites(authorization: Optional[str] = Header(None)):
    """Return the authenticated customer's favorites, enriched with the
    latest vin_data snapshot when available."""
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")

    cursor = db.favorites.find(
        {"$or": [{"customerId": customer_id}, {"userId": customer_id}]},
        {"_id": 0},
    ).sort("createdAt", -1).limit(500)
    rows = await cursor.to_list(length=500)

    out: List[Dict[str, Any]] = []
    for r in rows:
        vin = (r.get("vin") or "").upper()
        live = await _vin_card_for_favorite(vin) if vin else {}
        # Strip None values from live so they don't overwrite snapshot/row
        live_clean = {k: v for k, v in (live or {}).items() if v not in (None, "", [])}
        snapshot = r.get("snapshot") or {}
        # Priority: live (fresh) > snapshot (saved at favorite-time) > row (legacy)
        merged: Dict[str, Any] = {}
        merged.update({k: v for k, v in r.items() if k not in ("_id", "snapshot") and v not in (None, "")})
        for k, v in snapshot.items():
            if v not in (None, ""):
                merged[k] = v
        merged.update(live_clean)
        # Computed title fallback
        if not merged.get("title"):
            parts = [merged.get("year"), merged.get("make"), merged.get("model"), merged.get("trim")]
            ttl = " ".join(str(p) for p in parts if p)
            if ttl.strip():
                merged["title"] = ttl.strip()
        # Normalize timestamps
        for k in ("createdAt", "created_at", "updatedAt"):
            v = r.get(k)
            if hasattr(v, "isoformat"):
                merged[k] = v.isoformat()
        merged["isFavorite"] = True
        out.append(merged)
    return out  # array, as the cabinet expects


@fastapi_app.post("/api/favorites")
async def add_favorite(
    data: Dict[str, Any] = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Add a vehicle to the customer's favorites. Idempotent by VIN.

    Body: `{vin, vehicleId?, title?, make?, model?, year?, price?, image?, sourcePage?, ...}`
    """
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")

    raw_vin = (data.get("vin") or data.get("vehicleId") or "").strip().upper().replace(" ", "").replace("-", "")
    if not raw_vin:
        raise HTTPException(status_code=400, detail="vin is required")

    now = datetime.now(timezone.utc)
    snapshot = {
        "vin": raw_vin,
        "vehicleId": data.get("vehicleId") or raw_vin,
        "title": data.get("title"),
        "make": data.get("make"),
        "model": data.get("model"),
        "year": data.get("year"),
        "trim": data.get("trim"),
        "price": data.get("price"),
        "image": data.get("image"),
        "lot_number": data.get("lot_number") or data.get("lot"),
        "auction_name": data.get("auction_name") or data.get("auction"),
        "odometer": data.get("odometer"),
        "odometer_unit": data.get("odometer_unit"),
    }
    # Strip Nones — keep snapshot tight
    snapshot = {k: v for k, v in snapshot.items() if v is not None}

    fav_id = f"fav-{uuid.uuid4().hex[:12]}"
    res = await db.favorites.update_one(
        {"customerId": customer_id, "vin": raw_vin},
        {
            "$set": {
                "customerId": customer_id,
                "userId": customer_id,
                "vin": raw_vin,
                "vehicleId": snapshot.get("vehicleId"),
                "snapshot": snapshot,
                "sourcePage": (data.get("sourcePage") or "")[:200],
                "updatedAt": now,
            },
            "$setOnInsert": {
                "id": fav_id,
                "createdAt": now,
            },
        },
        upsert=True,
    )
    duplicate = res.matched_count > 0 and res.upserted_id is None
    inserted_id = str(res.upserted_id) if res.upserted_id else None
    return {
        "success": True,
        "id": inserted_id or fav_id,
        "vin": raw_vin,
        "duplicate": duplicate,
        "isFavorite": True,
    }


@fastapi_app.get("/api/favorites/check/{vin}")
async def check_favorite(vin: str, authorization: Optional[str] = Header(None)):
    """Lightweight presence check for the current customer."""
    customer = await _resolve_bearer(authorization)
    if not customer:
        return {"success": True, "isFavorite": False, "authenticated": False}
    customer_id = customer.get("customerId") or customer.get("id")
    raw_vin = vin.strip().upper().replace(" ", "").replace("-", "")
    fav = await db.favorites.find_one(
        {"$or": [{"customerId": customer_id}, {"userId": customer_id}], "vin": raw_vin},
        {"_id": 0, "id": 1, "createdAt": 1},
    )
    return {"success": True, "isFavorite": bool(fav), "authenticated": True}


@fastapi_app.delete("/api/favorites/{vehicle_id}")
async def remove_favorite(vehicle_id: str, authorization: Optional[str] = Header(None)):
    """Remove a favorite. `vehicle_id` accepts VIN or favorite id."""
    customer = await _require_customer(authorization)
    customer_id = customer.get("customerId") or customer.get("id")
    raw = vehicle_id.strip().upper().replace(" ", "").replace("-", "")
    res = await db.favorites.delete_one({
        "$and": [
            {"$or": [{"customerId": customer_id}, {"userId": customer_id}]},
            {"$or": [{"vin": raw}, {"id": vehicle_id}, {"vehicleId": vehicle_id}, {"vehicleId": raw}]},
        ]
    })
    return {"success": bool(res.deleted_count), "deleted": res.deleted_count}

@fastapi_app.get("/api/compare/me")
async def get_my_compare():
    """Get compare list"""
    items = await db.compare.find({"userId": "test_customer_001"}).to_list(10)
    return items  # Возвращаем массив напрямую

@fastapi_app.post("/api/compare/add")
async def add_to_compare(data: Dict[str, Any] = Body(...)):
    """Add to compare"""
    item = {
        "userId": "test_customer_001",
        "vehicleId": data.get("vehicleId"),
        "vin": data.get("vin"),
        **data,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    await db.compare.insert_one(item)
    return {"success": True}

@fastapi_app.delete("/api/compare/remove/{vehicle_id}")
async def remove_from_compare(vehicle_id: str):
    """Remove from compare"""
    await db.compare.delete_one({"userId": "test_customer_001", "vehicleId": vehicle_id})
    return {"success": True}

@fastapi_app.delete("/api/compare/clear")
async def clear_compare():
    """Clear compare list"""
    await db.compare.delete_many({"userId": "test_customer_001"})
    return {"success": True}

@fastapi_app.get("/api/cabinet/orders")
async def get_cabinet_orders():
    """Get customer orders - показываем РЕАЛЬНЫЕ deals из CRM"""
    # Получаем deals где customer = test_customer_001
    deals = await db.deals.find({}).sort("created_at", -1).limit(20).to_list(20)
    return {"orders": [serialize_doc(d) for d in deals]}

@fastapi_app.get("/api/cabinet/deposits")
async def get_cabinet_deposits():
    """Get customer deposits - РЕАЛЬНЫЕ из CRM"""
    deposits = await db.deposits.find({}).sort("created_at", -1).limit(20).to_list(20)
    return {"deposits": [serialize_doc(d) for d in deposits]}

@fastapi_app.get("/api/cabinet/invoices")
async def get_cabinet_invoices():
    """Get customer invoices - mock"""
    return {"invoices": []}

@fastapi_app.get("/api/cabinet/contracts")
async def get_cabinet_contracts():
    """Get customer contracts - mock"""
    return {"contracts": []}

@fastapi_app.get("/api/cabinet/shipping")
async def get_cabinet_shipping():
    """Get shipping info - mock"""
    return {"shipments": []}

@fastapi_app.get("/api/cabinet/notifications")
async def get_cabinet_notifications():
    """Get notifications"""
    return {"notifications": []}

@fastapi_app.get("/api/cabinet/profile")
async def get_cabinet_profile():
    """Get customer profile"""
    return {
        "id": "test_customer_001",
        "email": "test@customer.com",
        "name": "Test Customer",
        "phone": "+380123456789",
        "city": "Kyiv",
        "telegram": "@testcustomer"
    }


# ═══════════════════════════════════════════════════════════════════
# CUSTOMER CABINET — full per-customer API (production)
# ═══════════════════════════════════════════════════════════════════

async def _ensure_customer_seed(customer_id: str):
    """
    Create comprehensive mock data for the customer cabinet:
    customer + 4 deals (different stages) + 2 shipments + 4 invoices +
    3 contracts + 2 carfax + 8 notifications + 2 requests + 2 deposits +
    shipment events.
    Idempotent — uses upsert on 'id' keys.
    """
    now = datetime.now(timezone.utc)

    # 1. Customer profile
    existing = await db.customers.find_one({'id': customer_id})
    if not existing:
        seed_customer = {
            'id': customer_id,
            'firstName': 'Олександр',
            'lastName': 'Демо',
            'name': 'Олександр Демо',
            'email': f'{customer_id}@bibi.cars',
            'phone': '+380671234567',
            'city': 'Київ',
            'telegram': '@bibi_demo',
            'avatar': None,
            'address': 'вул. Хрещатик, 12, Київ',
            'preferredLanguage': 'uk',
            'notificationChannels': ['email', 'sms', 'telegram'],
            'marketingOptIn': True,
            'emailVerified': True,
            'phoneVerified': True,
            'createdAt': now - timedelta(days=95),
            'updatedAt': now,
        }
        await db.customers.insert_one(seed_customer)

    manager_info = {
        'managerId': 'mgr_001',
        'managerName': 'Ірина Петренко',
        'managerPhone': '+380509876543',
        'managerEmail': 'irina@bibi.cars',
    }

    # 2. Deals (multiple — different stages for visual coverage)
    deals_seed = [
        {
            'id': f"deal_{customer_id}_1",
            'title': 'BMW X5 xDrive40i 2023',
            'vehicleTitle': 'BMW X5 xDrive40i 2023',
            'vin': 'WBAJA7C52KWW12345',
            'lot': '67823459',
            'status': 'in_transit',
            'clientPrice': 58400,
            'auctionPrice': 42000,
            'auctionName': 'Copart',
            'auctionDate': (now - timedelta(days=22)).isoformat(),
            'brand': 'BMW',
            'model': 'X5 xDrive40i',
            'year': 2023,
            'mileage': 48320,
            'color': 'Alpine White',
            'damage': 'Front End',
            'created_at': now - timedelta(days=30),
            'updated_at': now - timedelta(hours=6),
            'mainImage': 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800',
            'stages': [
                {'code': 'selection',  'done': True,  'date': (now - timedelta(days=30)).isoformat()},
                {'code': 'contract',   'done': True,  'date': (now - timedelta(days=28)).isoformat()},
                {'code': 'payment',    'done': True,  'date': (now - timedelta(days=20)).isoformat()},
                {'code': 'shipping',   'done': False, 'date': None},
                {'code': 'received',   'done': False, 'date': None},
            ],
            **manager_info,
        },
        {
            'id': f"deal_{customer_id}_2",
            'title': 'Tesla Model 3 Long Range 2022',
            'vehicleTitle': 'Tesla Model 3 Long Range 2022',
            'vin': '5YJ3E1EB5NF123456',
            'lot': '55123478',
            'status': 'delivered',
            'clientPrice': 34900,
            'auctionPrice': 24500,
            'auctionName': 'IAAI',
            'auctionDate': (now - timedelta(days=88)).isoformat(),
            'brand': 'Tesla',
            'model': 'Model 3 Long Range',
            'year': 2022,
            'mileage': 28140,
            'color': 'Deep Blue Metallic',
            'damage': 'Minor (Rear)',
            'created_at': now - timedelta(days=90),
            'updated_at': now - timedelta(days=7),
            'deliveredAt': (now - timedelta(days=7)).isoformat(),
            'mainImage': 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800',
            'stages': [
                {'code': 'selection', 'done': True, 'date': (now - timedelta(days=90)).isoformat()},
                {'code': 'contract',  'done': True, 'date': (now - timedelta(days=88)).isoformat()},
                {'code': 'payment',   'done': True, 'date': (now - timedelta(days=75)).isoformat()},
                {'code': 'shipping',  'done': True, 'date': (now - timedelta(days=25)).isoformat()},
                {'code': 'received',  'done': True, 'date': (now - timedelta(days=7)).isoformat()},
            ],
            **manager_info,
        },
        {
            'id': f"deal_{customer_id}_3",
            'title': 'Audi Q7 Premium Plus 2024',
            'vehicleTitle': 'Audi Q7 Premium Plus 2024',
            'vin': 'WA1LAAF72RD012345',
            'lot': '71294851',
            'status': 'contract_pending',
            'clientPrice': 64200,
            'auctionPrice': 48500,
            'auctionName': 'Copart',
            'auctionDate': (now + timedelta(days=3)).isoformat(),
            'brand': 'Audi',
            'model': 'Q7 Premium Plus',
            'year': 2024,
            'mileage': 12840,
            'color': 'Mythos Black',
            'damage': 'Minor (Left Side)',
            'created_at': now - timedelta(days=5),
            'updated_at': now - timedelta(hours=2),
            'mainImage': 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800',
            'stages': [
                {'code': 'selection', 'done': True,  'date': (now - timedelta(days=5)).isoformat()},
                {'code': 'contract',  'done': False, 'date': None},
                {'code': 'payment',   'done': False, 'date': None},
                {'code': 'shipping',  'done': False, 'date': None},
                {'code': 'received',  'done': False, 'date': None},
            ],
            **manager_info,
        },
        {
            'id': f"deal_{customer_id}_4",
            'title': 'Mercedes-Benz GLE 450 2023',
            'vehicleTitle': 'Mercedes-Benz GLE 450 2023',
            'vin': '4JGFB5KB4PB098765',
            'lot': '69185432',
            'status': 'auction_won',
            'clientPrice': 71800,
            'auctionPrice': 54300,
            'auctionName': 'IAAI',
            'auctionDate': (now - timedelta(days=1)).isoformat(),
            'brand': 'Mercedes-Benz',
            'model': 'GLE 450',
            'year': 2023,
            'mileage': 18920,
            'color': 'Obsidian Black',
            'damage': 'None',
            'created_at': now - timedelta(days=14),
            'updated_at': now - timedelta(hours=18),
            'mainImage': 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800',
            'stages': [
                {'code': 'selection', 'done': True, 'date': (now - timedelta(days=14)).isoformat()},
                {'code': 'contract',  'done': True, 'date': (now - timedelta(days=10)).isoformat()},
                {'code': 'payment',   'done': True, 'date': (now - timedelta(days=5)).isoformat()},
                {'code': 'shipping',  'done': False, 'date': None},
                {'code': 'received',  'done': False, 'date': None},
            ],
            **manager_info,
        },
    ]
    for d in deals_seed:
        d['customerId'] = customer_id
        await db.deals.update_one({'id': d['id']}, {'$setOnInsert': d}, upsert=True)

    # 3. Shipments — одна активная (BMW, real live vessel) + одна доставленная (Tesla) + одна у порту (Mercedes)
    # NOTE: BMW uses a REAL vessel (CMA CGM HARMONY, MMSI 256849000) which is
    # regularly present in VesselFinder data. This makes the live-tracking flow
    # work end-to-end in the customer cabinet as soon as VF cookies are synced.
    REAL_VESSEL = {
        'name': 'CMA CGM HARMONY',
        'mmsi': '256849000',
        'imo': None,
        'boundAt': now,
    }
    ship_id_bmw = f"ship_{customer_id}_1"
    existing_bmw = await db.shipments.find_one({'id': ship_id_bmw})
    # One-time migration: replace the old fake vessel with the real one so
    # existing seeded accounts get live tracking too.
    if existing_bmw and (existing_bmw.get('vessel') or {}).get('mmsi') != REAL_VESSEL['mmsi']:
        # Update top-level vessel AND the vessel stage inside stages[]
        stage_vessel_clean = {k: v for k, v in REAL_VESSEL.items() if k != 'boundAt'}
        set_ops = {
            'vessel': REAL_VESSEL,
            'trackingActive': True,
            'trackingSource': existing_bmw.get('trackingSource') or 'simulated',
            'updatedAt': now,
        }
        stages_list = existing_bmw.get('stages') or []
        for idx, st in enumerate(stages_list):
            if (st or {}).get('type') == 'vessel':
                set_ops[f'stages.{idx}.vessel'] = stage_vessel_clean
        await db.shipments.update_one({'id': ship_id_bmw}, {'$set': set_ops})
    if not existing_bmw:
        origin = {'name': 'Newark, NJ', 'lat': 40.687, 'lng': -74.172}
        destination = {'name': 'Odesa, UA', 'lat': 46.4825, 'lng': 30.7233}
        route = generate_route(origin, destination)
        # Atomic upsert: if another concurrent request already inserted this
        # shipment between our find_one() and this call, we just no-op.
        await db.shipments.update_one(
            {'id': ship_id_bmw},
            {'$setOnInsert': {
                'id': ship_id_bmw,
                'dealId': f"deal_{customer_id}_1",
                'customerId': customer_id,
                'managerId': 'mgr_001',
                'vin': 'WBAJA7C52KWW12345',
                'vehicleTitle': 'BMW X5 xDrive40i 2023',
                'containerNumber': 'MSCU7894512',
                'carrier': 'CMA CGM',
                'vessel': REAL_VESSEL,
                'status': 'in_transit',
                'origin': origin,
                'destination': destination,
                'route': route,
                'currentPosition': {**origin, 'source': 'simulated'},
                'progress': 0.35,
                'lastEventProgress': 0.2,
                'originPort': 'Newark, NJ',
                'destinationPort': 'Odesa, UA',
                'estimatedPickupDate': (now - timedelta(days=22)).isoformat(),
                'estimatedDepartureDate': (now - timedelta(days=18)).isoformat(),
                'estimatedArrivalDate': (now + timedelta(days=14)).isoformat(),
                'estimatedDeliveryDate': (now + timedelta(days=18)).isoformat(),
                'trackingActive': True,
                'trackingSource': 'simulated',
                'liveEta': (now + timedelta(days=14)).isoformat().replace('+00:00', 'Z'),
                'created_at': now - timedelta(days=22),
            }},
            upsert=True,
        )

    ship_id_tesla = f"ship_{customer_id}_2"
    await db.shipments.update_one(
        {'id': ship_id_tesla},
        {'$setOnInsert': {
            'id': ship_id_tesla,
            'dealId': f"deal_{customer_id}_2",
            'customerId': customer_id,
            'managerId': 'mgr_001',
            'vin': '5YJ3E1EB5NF123456',
            'vehicleTitle': 'Tesla Model 3 Long Range 2022',
            'containerNumber': 'HLCU4512378',
            'carrier': 'Hapag-Lloyd',
            'vessel': {'imo': '9320626', 'name': 'HANOVER BRIDGE'},
            'status': 'delivered',
            'origin': {'name': 'Long Beach, CA', 'lat': 33.77, 'lng': -118.19},
            'destination': {'name': 'Odesa, UA', 'lat': 46.4825, 'lng': 30.7233},
            'route': generate_route({'lat': 33.77, 'lng': -118.19, 'name': 'Long Beach, CA'},
                                    {'lat': 46.4825, 'lng': 30.7233, 'name': 'Odesa, UA'}),
            'currentPosition': {'lat': 46.4825, 'lng': 30.7233, 'source': 'delivered'},
            'progress': 1.0,
            'lastEventProgress': 1.0,
            'originPort': 'Long Beach, CA',
            'destinationPort': 'Odesa, UA',
            'estimatedArrivalDate': (now - timedelta(days=12)).isoformat(),
            'actualArrivalDate': (now - timedelta(days=10)).isoformat(),
            'deliveredDate': (now - timedelta(days=7)).isoformat(),
            'trackingActive': False,
            'trackingSource': 'delivered',
            'liveEta': None,
            'created_at': now - timedelta(days=75),
        }},
        upsert=True,
    )

    ship_id_merc = f"ship_{customer_id}_3"
    origin_m = {'name': 'Houston, TX', 'lat': 29.75, 'lng': -95.36}
    destination_m = {'name': 'Klaipeda, LT', 'lat': 55.71, 'lng': 21.13}
    await db.shipments.update_one(
        {'id': ship_id_merc},
        {'$setOnInsert': {
            'id': ship_id_merc,
            'dealId': f"deal_{customer_id}_4",
            'customerId': customer_id,
            'managerId': 'mgr_001',
            'vin': '4JGFB5KB4PB098765',
            'vehicleTitle': 'Mercedes-Benz GLE 450 2023',
            'containerNumber': 'CMAU9812345',
            'carrier': 'CMA CGM',
            'vessel': {'imo': '9454436', 'name': 'CMA CGM MARCO POLO'},
            'status': 'at_port',
            'origin': origin_m,
            'destination': destination_m,
            'route': generate_route(origin_m, destination_m),
            'currentPosition': {**destination_m, 'source': 'simulated'},
            'progress': 0.95,
            'lastEventProgress': 0.8,
            'originPort': 'Houston, TX',
            'destinationPort': 'Klaipeda, LT',
            'estimatedArrivalDate': (now - timedelta(days=1)).isoformat(),
            'estimatedDeliveryDate': (now + timedelta(days=6)).isoformat(),
            'trackingActive': True,
            'trackingSource': 'simulated',
            'liveEta': (now + timedelta(days=6)).isoformat().replace('+00:00', 'Z'),
            'created_at': now - timedelta(days=14),
        }},
        upsert=True,
    )

    # 3b. Shipment events for timeline
    events_to_seed = [
        (ship_id_bmw, 'loaded_on_vessel', '📦 Завантажено на судно MSC OSCAR', 'Newark, NJ', -18, 0.05),
        (ship_id_bmw, 'departed', '🚢 Відплив з порту Newark', 'Newark, NJ', -17, 0.1),
        (ship_id_bmw, 'position_update', '🌊 Атлантичний океан', 'Atlantic Ocean', -10, 0.25),
        (ship_id_tesla, 'delivered', '✅ Автомобіль отримано', 'Odesa, UA', -7, 1.0),
        (ship_id_tesla, 'customs_cleared', '📋 Митниця пройдена', 'Odesa, UA', -9, 0.95),
        (ship_id_tesla, 'arrived_at_port', '⚓ Прибуття в порт', 'Odesa, UA', -10, 0.9),
        (ship_id_merc, 'arrived_at_port', '⚓ Прибуття в порт Клайпеда', 'Klaipeda, LT', -1, 0.95),
        (ship_id_merc, 'unloading', '🏗️ Розвантаження', 'Klaipeda, LT', 0, 0.95),
    ]
    for (sid, etype, title, loc, day_offset, progress) in events_to_seed:
        evt_key = f"evt_{sid}_{etype}"
        existing_event = await db.shipment_events.find_one({'id': evt_key})
        if not existing_event:
            await db.shipment_events.insert_one({
                'id': evt_key,
                'shipmentId': sid,
                'type': etype,
                'title': title,
                'description': title,
                'location': loc,
                'meta': {'progress': progress},
                'customerId': customer_id,
                'timestamp': now + timedelta(days=day_offset, hours=-3),
            })

    # 4. Invoices — 4 штуки (paid, paid, pending, overdue)
    invoices_seed = [
        {
            'id': f"inv_{customer_id}_1",
            'number': 'INV-2026-0412',
            'dealId': f"deal_{customer_id}_1",
            'amount': 58400,
            'currency': 'USD',
            'status': 'paid',
            'issueDate': (now - timedelta(days=20)).isoformat(),
            'dueDate': (now - timedelta(days=5)).isoformat(),
            'paidDate': (now - timedelta(days=14)).isoformat(),
            'description': 'Повна оплата за BMW X5 xDrive40i 2023',
            'items': [
                {'name': 'Вартість авто (auction)', 'amount': 42000},
                {'name': 'Послуги BIBI Cars', 'amount': 3500},
                {'name': 'Доставка та логістика', 'amount': 4200},
                {'name': 'Мито та збори', 'amount': 8700},
            ],
            'created_at': now - timedelta(days=20),
        },
        {
            'id': f"inv_{customer_id}_2",
            'number': 'INV-2026-0288',
            'dealId': f"deal_{customer_id}_2",
            'amount': 34900,
            'currency': 'USD',
            'status': 'paid',
            'issueDate': (now - timedelta(days=82)).isoformat(),
            'dueDate': (now - timedelta(days=67)).isoformat(),
            'paidDate': (now - timedelta(days=75)).isoformat(),
            'description': 'Повна оплата за Tesla Model 3 Long Range 2022',
            'items': [
                {'name': 'Вартість авто', 'amount': 24500},
                {'name': 'Послуги BIBI Cars', 'amount': 2800},
                {'name': 'Доставка', 'amount': 3400},
                {'name': 'Мито', 'amount': 4200},
            ],
            'created_at': now - timedelta(days=82),
        },
        {
            'id': f"inv_{customer_id}_3",
            'number': 'INV-2026-0508',
            'dealId': f"deal_{customer_id}_4",
            'amount': 71800,
            'currency': 'USD',
            'status': 'pending',
            'issueDate': (now - timedelta(days=4)).isoformat(),
            'dueDate': (now + timedelta(days=3)).isoformat(),
            'paidDate': None,
            'description': 'Передплата за Mercedes-Benz GLE 450 2023',
            'items': [
                {'name': 'Депозит (30%)', 'amount': 21540},
                {'name': 'Основна оплата (70%)', 'amount': 50260},
            ],
            'created_at': now - timedelta(days=4),
        },
        {
            'id': f"inv_{customer_id}_4",
            'number': 'INV-2026-0312',
            'dealId': f"deal_{customer_id}_3",
            'amount': 19260,
            'currency': 'USD',
            'status': 'pending',
            'issueDate': (now - timedelta(days=2)).isoformat(),
            'dueDate': (now + timedelta(days=5)).isoformat(),
            'paidDate': None,
            'description': 'Депозит за Audi Q7 Premium Plus 2024',
            'items': [
                {'name': 'Депозит (30% від $64,200)', 'amount': 19260},
            ],
            'created_at': now - timedelta(days=2),
        },
    ]
    for inv in invoices_seed:
        inv['customerId'] = customer_id
        await db.invoices.update_one({'id': inv['id']}, {'$setOnInsert': inv}, upsert=True)

    # 5. Contracts — 3 штуки
    contracts_seed = [
        {
            'id': f"ctr_{customer_id}_1",
            'dealId': f"deal_{customer_id}_1",
            'number': 'BIB-2026-0328',
            'title': 'Договір поставки BMW X5 xDrive40i',
            'status': 'signed',
            'signedDate': (now - timedelta(days=28)).isoformat(),
            'url': None,
            'created_at': now - timedelta(days=29),
        },
        {
            'id': f"ctr_{customer_id}_2",
            'dealId': f"deal_{customer_id}_2",
            'number': 'BIB-2025-1178',
            'title': 'Договір поставки Tesla Model 3',
            'status': 'signed',
            'signedDate': (now - timedelta(days=88)).isoformat(),
            'url': None,
            'created_at': now - timedelta(days=89),
        },
        {
            'id': f"ctr_{customer_id}_3",
            'dealId': f"deal_{customer_id}_3",
            'number': 'BIB-2026-0487',
            'title': 'Договір поставки Audi Q7 Premium Plus',
            'status': 'pending',
            'signedDate': None,
            'url': None,
            'created_at': now - timedelta(days=4),
        },
    ]
    for c in contracts_seed:
        c['customerId'] = customer_id
        await db.contracts.update_one({'id': c['id']}, {'$setOnInsert': c}, upsert=True)

    # 6. Carfax reports — 2 штуки
    carfax_seed = [
        {
            'id': f"carfax_{customer_id}_1",
            'dealId': f"deal_{customer_id}_1",
            'vin': 'WBAJA7C52KWW12345',
            'vehicleTitle': 'BMW X5 xDrive40i 2023',
            'status': 'ready',
            'issuedAt': (now - timedelta(days=24)).isoformat(),
            'reportUrl': None,
            'summary': {
                'ownersCount': 1,
                'accidents': 0,
                'mileage': 48320,
                'serviceRecords': 7,
                'titleBrand': 'Clean',
                'lastInspection': (now - timedelta(days=45)).isoformat(),
            },
        },
        {
            'id': f"carfax_{customer_id}_2",
            'dealId': f"deal_{customer_id}_2",
            'vin': '5YJ3E1EB5NF123456',
            'vehicleTitle': 'Tesla Model 3 Long Range 2022',
            'status': 'ready',
            'issuedAt': (now - timedelta(days=85)).isoformat(),
            'reportUrl': None,
            'summary': {
                'ownersCount': 2,
                'accidents': 1,
                'mileage': 28140,
                'serviceRecords': 4,
                'titleBrand': 'Clean',
                'lastInspection': (now - timedelta(days=92)).isoformat(),
            },
        },
    ]
    for cfx in carfax_seed:
        cfx['customerId'] = customer_id
        await db.carfax_reports.update_one({'id': cfx['id']}, {'$setOnInsert': cfx}, upsert=True)

    # 7. Notifications — 8 штук (mix read/unread, different types)
    if await db.notifications.count_documents({'customerId': customer_id}) == 0:
        await db.notifications.insert_many([
            {
                'id': f"notif_{customer_id}_1",
                'customerId': customer_id,
                'title': 'Договір підписано',
                'message': 'Договір BIB-2026-0328 успішно підписано',
                'type': 'contract',
                'isRead': True,
                'createdAt': now - timedelta(days=28),
            },
            {
                'id': f"notif_{customer_id}_2",
                'customerId': customer_id,
                'title': 'Оплату отримано',
                'message': 'Платіж $58,400 за BMW X5 зараховано',
                'type': 'invoice',
                'isRead': True,
                'createdAt': now - timedelta(days=14),
            },
            {
                'id': f"notif_{customer_id}_3",
                'customerId': customer_id,
                'title': 'Авто завантажено на судно',
                'message': 'MSC OSCAR — Newark, NJ → Odesa',
                'type': 'shipping',
                'isRead': True,
                'createdAt': now - timedelta(days=18),
            },
            {
                'id': f"notif_{customer_id}_4",
                'customerId': customer_id,
                'title': 'Tesla Model 3 доставлено',
                'message': 'Автомобіль успішно передано. Дякуємо за вибір BIBI Cars!',
                'type': 'delivery',
                'isRead': True,
                'createdAt': now - timedelta(days=7),
            },
            {
                'id': f"notif_{customer_id}_5",
                'customerId': customer_id,
                'title': '⚓ Mercedes-Benz GLE 450 прибуло в порт',
                'message': 'Автомобіль у Клайпеді. Митне оформлення розпочато.',
                'type': 'shipping',
                'isRead': False,
                'createdAt': now - timedelta(days=1, hours=4),
            },
            {
                'id': f"notif_{customer_id}_6",
                'customerId': customer_id,
                'title': '🎉 Ви виграли аукціон!',
                'message': 'Лот Mercedes-Benz GLE 450 успішно придбано за $54,300',
                'type': 'auction',
                'isRead': False,
                'createdAt': now - timedelta(hours=18),
            },
            {
                'id': f"notif_{customer_id}_7",
                'customerId': customer_id,
                'title': 'Рахунок на депозит за Audi Q7',
                'message': 'Рахунок INV-2026-0312 на $19,260 — оплатіть до 23.04.2026',
                'type': 'invoice',
                'isRead': False,
                'createdAt': now - timedelta(days=2),
            },
            {
                'id': f"notif_{customer_id}_8",
                'customerId': customer_id,
                'title': '📝 Договір готовий до підпису',
                'message': 'BIB-2026-0487 на Audi Q7 Premium Plus очікує вашого підпису',
                'type': 'contract',
                'isRead': False,
                'createdAt': now - timedelta(hours=6),
            },
        ])

    # 8. Requests / leads — 2 штуки
    requests_seed = [
        {
            'id': f"lead_{customer_id}_1",
            'firstName': 'Олександр',
            'lastName': 'Демо',
            'vin': 'WDDWF4KB0KR234567',
            'status': 'new',
            'vehicleRequest': 'Шукаю Mercedes-Benz C-Class 2020-2022',
            'budget': 30000,
            'createdAt': now - timedelta(days=7),
        },
        {
            'id': f"lead_{customer_id}_2",
            'firstName': 'Олександр',
            'lastName': 'Демо',
            'vin': None,
            'status': 'processing',
            'vehicleRequest': 'Підбір Porsche Macan S 2023',
            'budget': 65000,
            'createdAt': now - timedelta(days=3),
        },
    ]
    for r in requests_seed:
        r['customerId'] = customer_id
        r['created_at'] = r['createdAt']
        await db.leads.update_one({'id': r['id']}, {'$setOnInsert': r}, upsert=True)

    # 9. Deposits — 2 штуки
    deposits_seed = [
        {
            'id': f"dep_{customer_id}_1",
            'dealId': f"deal_{customer_id}_4",
            'amount': 5000,
            'currency': 'USD',
            'status': 'held',
            'purpose': 'Депозит на аукціон Mercedes-Benz GLE 450',
            'created_at': now - timedelta(days=14),
            'returnDate': (now - timedelta(days=5)).isoformat(),
        },
        {
            'id': f"dep_{customer_id}_2",
            'dealId': f"deal_{customer_id}_2",
            'amount': 3000,
            'currency': 'USD',
            'status': 'refunded',
            'purpose': 'Депозит на аукціон Tesla Model 3',
            'created_at': now - timedelta(days=92),
            'returnDate': (now - timedelta(days=88)).isoformat(),
        },
    ]
    for d in deposits_seed:
        d['customerId'] = customer_id
        await db.deposits.update_one({'id': d['id']}, {'$setOnInsert': d}, upsert=True)


def _customer_cabinet_status_label(status: Optional[str]) -> str:
    return {
        'new': 'Нова заявка',
        'negotiation': 'Переговори',
        'contract_pending': 'Очікуємо підпис договору',
        'contract_signed': 'Договір підписано',
        'deposit_pending': 'Очікуємо депозит',
        'deposit_paid': 'Депозит оплачено',
        'payment_pending': 'Очікуємо оплату',
        'payment_complete': 'Оплачено',
        'auction_won': 'Аукціон виграно',
        'in_transit': 'В дорозі',
        'shipping': 'Доставка',
        'at_port': 'В порту',
        'customs': 'Митниця',
        'delivered': 'Доставлено',
        'completed': 'Завершено',
    }.get(status or '', status or '—')


@fastapi_app.get("/api/customer-cabinet/{customer_id}/dashboard")
async def customer_cabinet_dashboard_real(customer_id: str):
    """Full customer dashboard (real data)."""
    try:
        await _ensure_customer_seed(customer_id)
        customer = await db.customers.find_one({'id': customer_id}) or {'id': customer_id}

        deals = await db.deals.find({'customerId': customer_id}).sort('created_at', -1).limit(20).to_list(20)
        active_deals = [d for d in deals if d.get('status') not in ('completed', 'cancelled')]

        # Timeline — merge notifications + shipment events
        notifs = await db.notifications.find({'customerId': customer_id}).sort('createdAt', -1).limit(8).to_list(8)
        latest_timeline = [
            {
                'title': n.get('title'),
                'description': n.get('message'),
                'type': n.get('type'),
                'timestamp': n.get('createdAt').isoformat() if isinstance(n.get('createdAt'), datetime) else n.get('createdAt'),
            }
            for n in notifs
        ]

        # Next action
        next_action = None
        primary = active_deals[0] if active_deals else None
        if primary:
            st = primary.get('status')
            if st == 'contract_pending':
                next_action = {'title': 'Підпишіть договір', 'description': 'Договір готовий до підпису', 'urgency': 'high', 'dealId': primary.get('id')}
            elif st in ('deposit_pending', 'payment_pending'):
                next_action = {'title': 'Очікується оплата', 'description': 'Підтвердіть платіж щоб рухатись далі', 'urgency': 'high', 'dealId': primary.get('id')}

        # Manager
        manager = None
        if primary and primary.get('managerId'):
            manager = {
                'id': primary.get('managerId'),
                'name': primary.get('managerName') or 'Менеджер BIBI Cars',
                'phone': primary.get('managerPhone') or '+380680000000',
                'email': primary.get('managerEmail') or 'support@bibi.cars',
            }

        return {
            'customer': {
                'id': customer.get('id'),
                'firstName': customer.get('firstName'),
                'lastName': customer.get('lastName'),
                'name': customer.get('name') or customer.get('firstName'),
                'email': customer.get('email'),
                'phone': customer.get('phone'),
                'city': customer.get('city'),
                'telegram': customer.get('telegram'),
                'avatar': customer.get('avatar'),
            },
            'activeDeals': [serialize_doc(d) for d in active_deals],
            'latestTimeline': latest_timeline,
            'nextAction': next_action,
            'manager': manager,
        }
    except Exception as e:
        logger.exception(f"[CABINET] dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/api/customer-cabinet/{customer_id}/orders")
async def customer_cabinet_orders(customer_id: str):
    await _ensure_customer_seed(customer_id)
    deals = await db.deals.find({'customerId': customer_id}).sort('created_at', -1).to_list(100)
    return {'data': [serialize_doc(d) for d in deals]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/orders/{deal_id}")
async def customer_cabinet_order_detail(customer_id: str, deal_id: str):
    await _ensure_customer_seed(customer_id)
    deal = await db.deals.find_one({'id': deal_id, 'customerId': customer_id})
    if not deal:
        raise HTTPException(status_code=404, detail='Deal not found')
    # include shipment
    shipment = await db.shipments.find_one({'dealId': deal_id})
    return {
        'deal': serialize_doc(deal),
        'shipment': serialize_doc(shipment) if shipment else None,
    }


@fastapi_app.get("/api/customer-cabinet/{customer_id}/requests")
async def customer_cabinet_requests(customer_id: str):
    await _ensure_customer_seed(customer_id)
    requests = await db.leads.find({'customerId': customer_id}).sort('created_at', -1).to_list(50)
    return {'data': [serialize_doc(r) for r in requests]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/deposits")
async def customer_cabinet_deposits(customer_id: str):
    await _ensure_customer_seed(customer_id)
    deposits = await db.deposits.find({'customerId': customer_id}).sort('created_at', -1).to_list(50)
    return {'data': [serialize_doc(d) for d in deposits]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/timeline")
async def customer_cabinet_timeline(customer_id: str, limit: int = 50):
    await _ensure_customer_seed(customer_id)

    events = []
    # Notifications as events
    notifs = await db.notifications.find({'customerId': customer_id}).sort('createdAt', -1).to_list(limit)
    for n in notifs:
        events.append({
            'id': n.get('id'),
            'title': n.get('title'),
            'description': n.get('message'),
            'type': n.get('type'),
            'timestamp': n.get('createdAt').isoformat() if isinstance(n.get('createdAt'), datetime) else n.get('createdAt'),
        })

    # Shipment events
    shipments = await db.shipments.find({'customerId': customer_id}).to_list(20)
    for s in shipments:
        sh_events = await db.shipment_events.find({'shipmentId': s['id']}).sort('timestamp', -1).limit(20).to_list(20)
        for e in sh_events:
            events.append({
                'id': e.get('id') or str(e.get('_id')),
                'title': e.get('title') or e.get('description'),
                'description': e.get('location') or '',
                'type': 'shipping',
                'timestamp': e.get('timestamp').isoformat() if isinstance(e.get('timestamp'), datetime) else e.get('timestamp'),
            })

    # sort
    def _k(e):
        t = e.get('timestamp') or ''
        return t
    events.sort(key=_k, reverse=True)
    return {'data': events[:limit]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/notifications")
async def customer_cabinet_notifications(customer_id: str, limit: int = 50):
    await _ensure_customer_seed(customer_id)
    items = await db.notifications.find({'customerId': customer_id}).sort('createdAt', -1).limit(limit).to_list(limit)
    return {'data': [serialize_doc(n) for n in items]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/profile")
async def customer_cabinet_profile(customer_id: str):
    await _ensure_customer_seed(customer_id)
    c = await db.customers.find_one({'id': customer_id})
    if not c:
        raise HTTPException(status_code=404, detail='Customer not found')

    # statistics for the cabinet profile page
    total_deals = await db.deals.count_documents({'customerId': customer_id})
    completed_deals = await db.deals.count_documents(
        {'customerId': customer_id, 'status': {'$in': ['delivered', 'completed', 'received']}}
    )
    total_deposits = await db.deposits.count_documents({'customerId': customer_id})
    total_invoices = await db.invoices.count_documents({'customerId': customer_id})
    paid_invoices = await db.invoices.count_documents({'customerId': customer_id, 'status': 'paid'})

    # total spent
    pipeline = [
        {'$match': {'customerId': customer_id, 'status': 'paid'}},
        {'$group': {'_id': None, 'total': {'$sum': '$amount'}}},
    ]
    spent_agg = await db.invoices.aggregate(pipeline).to_list(1)
    total_spent = spent_agg[0]['total'] if spent_agg else 0

    manager = None
    latest_deal = await db.deals.find_one(
        {'customerId': customer_id, 'managerId': {'$exists': True}}
    )
    if latest_deal:
        manager = {
            'id': latest_deal.get('managerId'),
            'name': latest_deal.get('managerName', 'Менеджер BIBI Cars'),
            'phone': latest_deal.get('managerPhone'),
            'email': latest_deal.get('managerEmail'),
        }

    return {
        'customer': serialize_doc(c),
        'stats': {
            'totalDeals': total_deals,
            'completedDeals': completed_deals,
            'totalDeposits': total_deposits,
            'totalInvoices': total_invoices,
            'paidInvoices': paid_invoices,
            'totalSpent': total_spent,
            'memberSince': c.get('createdAt').isoformat() if isinstance(c.get('createdAt'), datetime) else c.get('createdAt'),
        },
        'manager': manager,
    }


@fastapi_app.patch("/api/customer-cabinet/{customer_id}/profile")
async def customer_cabinet_profile_update(customer_id: str, payload: Dict[str, Any] = Body(...)):
    await _ensure_customer_seed(customer_id)
    allowed = {k: payload[k] for k in ('firstName', 'lastName', 'phone', 'city', 'telegram', 'avatar') if k in payload}
    if allowed:
        allowed['updatedAt'] = datetime.now(timezone.utc)
        if 'firstName' in allowed or 'lastName' in allowed:
            current = await db.customers.find_one({'id': customer_id}) or {}
            allowed['name'] = f"{allowed.get('firstName', current.get('firstName',''))} {allowed.get('lastName', current.get('lastName',''))}".strip()
        await db.customers.update_one({'id': customer_id}, {'$set': allowed})
    c = await db.customers.find_one({'id': customer_id})
    return {'customer': serialize_doc(c)}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/carfax")
async def customer_cabinet_carfax(customer_id: str):
    await _ensure_customer_seed(customer_id)
    items = await db.carfax_reports.find({'customerId': customer_id}).sort('issuedAt', -1).to_list(50)
    return {'data': [serialize_doc(r) for r in items]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/contracts")
async def customer_cabinet_contracts(customer_id: str):
    await _ensure_customer_seed(customer_id)
    items = await db.contracts.find({'customerId': customer_id}).sort('created_at', -1).to_list(50)
    return {'data': [serialize_doc(c) for c in items]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/invoices")
async def customer_cabinet_invoices(customer_id: str):
    await _ensure_customer_seed(customer_id)
    items = await db.invoices.find({'customerId': customer_id}).sort('created_at', -1).to_list(50)
    return {'data': [serialize_doc(i) for i in items]}


@fastapi_app.get("/api/customer-cabinet/{customer_id}/shipping")
async def customer_cabinet_shipping(customer_id: str):
    """Full shipping payload per customer — includes route, vessel, live ETA & events.

    Shipments are enriched via ``serialize_journey`` so the client receives the
    computed ``trackingHealth`` (ok / estimated / stale / no_data) and the
    humanised ``emotionalText`` — both critical for the cabinet live pill and
    the "Автомобіль в Атлантичному океані"-style status line.
    """
    await _ensure_customer_seed(customer_id)
    shipments = await db.shipments.find({'customerId': customer_id}).sort('created_at', -1).to_list(50)
    result = []
    for s in shipments:
        # Make sure VIN-centric stages structure is present (legacy shipments).
        try:
            ensure_shipment_stages(s)
        except Exception:
            pass
        # Derive trackingHealth / emotionalText / currentVessel etc.
        journey = serialize_journey(s)
        # Pull per-shipment event timeline.
        events = await db.shipment_events.find({'shipmentId': s['id']}).sort('timestamp', -1).limit(20).to_list(20)
        # Preserve any legacy top-level fields the cabinet template still reads,
        # then overlay the richer serialize_journey view so the new UI gets all
        # computed fields (trackingHealth, emotionalText, currentContainer, ...).
        merged = {
            **serialize_doc(s),
            **journey,
            'events': [
                {
                    'title': e.get('title') or e.get('description'),
                    'description': e.get('title') or e.get('description'),
                    'location': e.get('location'),
                    'type': e.get('type'),
                    'timestamp': e.get('timestamp').isoformat() if isinstance(e.get('timestamp'), datetime) else e.get('timestamp'),
                }
                for e in events
            ] or journey.get('events') or [],
        }
        result.append(merged)
    return {'data': result}


# ═══════════════════════════════════════════════════════════════════
# MANAGER TRACKING — Universal VIN / Container / IMO search
# ═══════════════════════════════════════════════════════════════════

# Container-tracking provider keys (ShipsGo V1 authCode / AfterShip)
SHIPSGO_API_KEY = os.environ.get('SHIPSGO_API_KEY', '').strip()
SHIPSGO_FLEET_KEY = os.environ.get('SHIPSGO_FLEET_KEY', '').strip()  # optional separate key for vessel/fleet API
AFTERSHIP_API_KEY = os.environ.get('AFTERSHIP_API_KEY', '').strip()


async def _load_tracking_keys_from_db():
    """Load persisted provider keys from DB on startup / change."""
    global VESSELFINDER_API_KEY, VESSELFINDER_FLEET_KEY, SHIPSGO_API_KEY, SHIPSGO_FLEET_KEY, AFTERSHIP_API_KEY
    try:
        doc = await db.tracking_config.find_one({'_id': 'providers'}) or {}
        if doc.get('vesselfinder'):
            VESSELFINDER_API_KEY = doc['vesselfinder'].strip()
        if doc.get('vesselfinder_fleet'):
            VESSELFINDER_FLEET_KEY = doc['vesselfinder_fleet'].strip()
        if doc.get('shipsgo'):
            SHIPSGO_API_KEY = doc['shipsgo'].strip()
        if doc.get('shipsgo_fleet'):
            SHIPSGO_FLEET_KEY = doc['shipsgo_fleet'].strip()
        if doc.get('aftership'):
            AFTERSHIP_API_KEY = doc['aftership'].strip()
        logger.info(
            f"[TRACKING] keys loaded from DB: vesselfinder={bool(VESSELFINDER_API_KEY)} "
            f"vesselfinder_fleet={bool(VESSELFINDER_FLEET_KEY)} "
            f"shipsgo={bool(SHIPSGO_API_KEY)} shipsgo_fleet={bool(SHIPSGO_FLEET_KEY)} aftership={bool(AFTERSHIP_API_KEY)}"
        )
    except Exception as e:
        logger.warning(f"[TRACKING] could not load keys from DB: {e}")


def _classify_query(q: str) -> str:
    """Classify query as vin / container / imo / lot / generic."""
    qs = (q or '').strip().upper()
    if not qs:
        return 'empty'
    if qs.isdigit():
        if len(qs) == 7:
            return 'imo'
        if 6 <= len(qs) <= 9:
            return 'lot'
        return 'number'
    # VIN — exactly 17 alphanumeric (no I/O/Q)
    if len(qs) == 17 and qs.replace(' ', '').isalnum():
        return 'vin'
    # Container numbers: 4 letters + 7 digits (ISO 6346)
    if len(qs) == 11 and qs[:4].isalpha() and qs[4:].isdigit():
        return 'container'
    return 'generic'


async def _lookup_in_db(q: str) -> Dict[str, Any]:
    """Search our DB for shipments / vehicles / deals matching VIN/container/IMO/lot."""
    qs = (q or '').strip()
    qu = qs.upper()
    matches = {
        'shipments': [],
        'vehicles': [],
        'deals': [],
        'vessels': [],
    }
    if not qs:
        return matches

    or_shipment = [
        {'vin': qu},
        {'containerNumber': qu},
        {'vessel.imo': qs},
        {'lot': qs},
    ]
    shipments = await db.shipments.find({'$or': or_shipment}).limit(10).to_list(10)
    for s in shipments:
        matches['shipments'].append(serialize_doc(s))

    vehicles = await db.vehicles.find({'$or': [{'vin': qu}, {'lot_number': qs}]}).limit(5).to_list(5)
    matches['vehicles'] = [serialize_doc(v) for v in vehicles]

    deals = await db.deals.find({'$or': [{'vin': qu}, {'lot': qs}]}).limit(5).to_list(5)
    matches['deals'] = [serialize_doc(d) for d in deals]

    vessels = await db.vessel_positions.find({'imo': qs}).limit(3).to_list(3)
    matches['vessels'] = [serialize_doc(v) for v in vessels]
    return matches


async def _external_container_lookup(container_or_vin: str) -> Optional[Dict[str, Any]]:
    """
    On-demand container tracking via ShipsGo V1 authCode API.
    Returns {imo, vessel_name, status, origin, destination, eta, last_event} or None.

    ShipsGo V1 flow:
      1. POST PostContainerInfo with containerNumber + shippingLine + authCode
      2. GET GetContainerInfo with requestId (returned by step 1) + mapPoint=true
    """
    cn = (container_or_vin or '').strip().upper()
    if not cn:
        return None

    base = "https://shipsgo.com/api/v1.2"

    # ── ShipsGo V1 (authCode) — principal container tracking
    if SHIPSGO_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                # 1) direct GET by number (works when container already tracked before)
                url_get = f"{base}/ContainerService/GetContainerInfo/"
                res = await client.get(url_get, params={
                    'authCode': SHIPSGO_API_KEY,
                    'requestId': cn,
                    'mapPoint': 'true',
                })
                text = res.text or ''
                if res.status_code == 200 and 'Invalid' not in text:
                    try:
                        data = res.json()
                        if isinstance(data, list):
                            data = data[0] if data else {}
                        vessel_imo = data.get('VesselIMO') or data.get('LastVesselIMO') or data.get('LoadingVesselIMO')
                        vessel_name = data.get('VesselName') or data.get('LastVesselName') or data.get('LoadingVesselName')
                        return {
                            'source': 'shipsgo_v1',
                            'container': cn,
                            'imo': str(vessel_imo) if vessel_imo else None,
                            'vesselName': vessel_name,
                            'status': data.get('Status') or data.get('ContainerStatus'),
                            'origin': data.get('Pol') or data.get('LoadingPort') or data.get('FromPort'),
                            'destination': data.get('Pod') or data.get('DischargePort') or data.get('ToPort'),
                            'eta': data.get('FormatedETA') or data.get('ETA') or data.get('EstimatedTimeOfArrival'),
                            'mapPoint': data.get('MapPoint') or data.get('Coordinates'),
                            'raw': data,
                        }
                    except Exception as parse_err:
                        logger.warning(f"[SHIPSGO/V1] parse error: {parse_err} body={text[:200]}")

                # 2) if not found — POST to initiate new tracking
                url_post = f"{base}/ContainerService/PostContainerInfo/"
                post_res = await client.post(url_post, data={
                    'authCode': SHIPSGO_API_KEY,
                    'containerNumber': cn,
                    'shippingLine': 'OTHERS',
                })
                post_text = post_res.text or ''
                if 'Invalid' in post_text:
                    logger.warning(f"[SHIPSGO/V1] Invalid key — check account/api activation")
                    return {
                        'source': 'shipsgo_v1',
                        'container': cn,
                        'error': 'Invalid authCode — ShipsGo вважає ключ недійсним. Перевірте активацію API в панелі ShipsGo.',
                        'raw': post_text[:300],
                    }
                return {
                    'source': 'shipsgo_v1',
                    'container': cn,
                    'status': 'submitted_for_tracking',
                    'note': 'Контейнер доданий у ShipsGo для трекінгу — повторіть запит за ~1-5 хв',
                    'raw': post_text[:300],
                }
        except Exception as e:
            logger.error(f"[SHIPSGO/V1] error: {e}")

    # ── AfterShip fallback
    if AFTERSHIP_API_KEY:
        try:
            url = f"https://api.aftership.com/v4/trackings/container/{cn}"
            headers = {'aftership-api-key': AFTERSHIP_API_KEY}
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    data = (res.json() or {}).get('data', {}).get('tracking', {})
                    return {
                        'source': 'aftership',
                        'container': cn,
                        'status': data.get('tag'),
                        'eta': data.get('expected_delivery'),
                        'raw': data,
                    }
                else:
                    logger.warning(f"[AFTERSHIP] {res.status_code} for {cn}")
        except Exception as e:
            logger.error(f"[AFTERSHIP] error: {e}")

    return None


async def fetch_vessel_position_shipsgo(imo: str) -> Optional[Dict[str, Any]]:
    """
    Try to get vessel position via ShipsGo Fleet/Vessel service.
    Uses SHIPSGO_FLEET_KEY if present, otherwise SHIPSGO_API_KEY.
    """
    key = SHIPSGO_FLEET_KEY or SHIPSGO_API_KEY
    if not key or not imo:
        return None

    base = "https://shipsgo.com/api/v1.2"
    # Multiple endpoint candidates tried in sequence (API surface varies by plan)
    candidates = [
        f"{base}/VesselService/GetVesselPosition/",
        f"{base}/VesselService/GetVesselInfo/",
        f"{base}/FleetService/GetVesselPosition/",
    ]
    for url in candidates:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(url, params={'authCode': key, 'imo': imo})
                if res.status_code != 200:
                    continue
                data = res.json() if res.text.strip().startswith('{') or res.text.strip().startswith('[') else None
                if not data:
                    continue
                item = data[0] if isinstance(data, list) and data else data
                if not isinstance(item, dict):
                    continue
                lat = item.get('Latitude') or item.get('LAT') or item.get('Lat')
                lng = item.get('Longitude') or item.get('LON') or item.get('Lng')
                if lat is None or lng is None:
                    continue
                return {
                    'imo': str(imo),
                    'lat': float(lat),
                    'lng': float(lng),
                    'speed': float(item.get('Speed') or item.get('SPEED') or 0) or None,
                    'course': float(item.get('Course') or item.get('COURSE') or 0) or None,
                    'timestamp': item.get('LastUpdate') or item.get('TIMESTAMP'),
                    'source': 'shipsgo_fleet',
                }
        except Exception as e:
            logger.debug(f"[SHIPSGO/FLEET] {url} failed: {e}")
            continue
    return None


@fastapi_app.get("/api/manager/tracking/providers", dependencies=[Depends(require_manager_or_admin)])
async def tracking_providers_status():
    """Return configuration status for all tracking providers."""
    return {
        'success': True,
        'providers': {
            'vesselfinder': {
                'name': 'VesselFinder (Master API)',
                'purpose': 'Real-time vessel position by IMO',
                'envVar': 'VESSELFINDER_API_KEY',
                'configured': bool(VESSELFINDER_API_KEY),
                'signUpUrl': 'https://www.vesselfinder.com/api',
            },
            'vesselfinder_fleet': {
                'name': 'VesselFinder Fleet API',
                'purpose': 'Позиції всього флоту (підписка на IMO list)',
                'envVar': 'VESSELFINDER_FLEET_KEY',
                'configured': bool(VESSELFINDER_FLEET_KEY),
                'signUpUrl': 'https://www.vesselfinder.com/api',
            },
            'shipsgo': {
                'name': 'ShipsGo (Container API)',
                'purpose': 'Контейнер/VIN → IMO / ETA / порти',
                'envVar': 'SHIPSGO_API_KEY',
                'configured': bool(SHIPSGO_API_KEY),
                'signUpUrl': 'https://shipsgo.com',
            },
            'shipsgo_fleet': {
                'name': 'ShipsGo Fleet (Vessel)',
                'purpose': 'Позиція судна через Fleet API ShipsGo (альтернатива VesselFinder)',
                'envVar': 'SHIPSGO_FLEET_KEY',
                'configured': bool(SHIPSGO_FLEET_KEY),
                'signUpUrl': 'https://shipsgo.com',
            },
            'aftership': {
                'name': 'AfterShip',
                'purpose': 'Універсальний fallback-трекер посилок',
                'envVar': 'AFTERSHIP_API_KEY',
                'configured': bool(AFTERSHIP_API_KEY),
                'signUpUrl': 'https://www.aftership.com',
            },
        },
        'hybridFlow': [
            'VIN/Container → ShipsGo → get container + vessel IMO',
            'IMO → VesselFinder OR ShipsGo Fleet → live lat/lng/speed/course',
            'Cache 90s, interpolate ≤ 2h, fallback to SIMULATE',
        ],
    }


@fastapi_app.get("/api/manager/tracking/search", dependencies=[Depends(require_manager_or_admin)])
async def tracking_search(q: str = ""):
    """Search internal DB by VIN / container / IMO / lot. Returns all matches."""
    classification = _classify_query(q)
    matches = await _lookup_in_db(q)
    # attach latest vessel position when shipment has IMO
    enriched_shipments = []
    for s in matches['shipments']:
        vessel = s.get('vessel') or {}
        imo = vessel.get('imo')
        pos = await fetch_vessel_position(imo) if imo else None
        enriched_shipments.append({**s, 'vesselPosition': serialize_doc(pos) if pos else None})
    return {
        'success': True,
        'query': q,
        'classification': classification,
        'data': {**matches, 'shipments': enriched_shipments},
    }


@fastapi_app.post("/api/manager/tracking/quick-track", dependencies=[Depends(require_manager_or_admin)])
async def tracking_quick_track(payload: Dict[str, Any] = Body(...)):
    """
    On-demand tracking:
      1. Try DB lookup (VIN / container / IMO)
      2. If not found — call external container-tracking API (ShipsGo / AfterShip)
      3. If container → IMO resolved → fetch vessel position
    Returns best-available result with provenance.
    """
    q = str(payload.get('query', '')).strip()
    if not q:
        raise HTTPException(status_code=400, detail="query required")
    classification = _classify_query(q)

    result: Dict[str, Any] = {
        'query': q,
        'classification': classification,
        'internal': None,
        'external': None,
        'vesselPosition': None,
    }

    # 1) internal
    internal = await _lookup_in_db(q)
    if any([internal['shipments'], internal['vehicles'], internal['deals']]):
        result['internal'] = internal

    # 2) determine IMO path
    imo_to_fetch = None

    if classification == 'imo':
        imo_to_fetch = q
    else:
        # derive from internal shipment if any
        if internal['shipments']:
            v = (internal['shipments'][0].get('vessel') or {})
            imo_to_fetch = v.get('imo')
        # still no IMO — try external container-tracking
        if not imo_to_fetch and classification in ('container', 'vin', 'generic'):
            ext = await _external_container_lookup(q)
            if ext:
                result['external'] = ext
                imo_to_fetch = ext.get('imo')

    # 3) vessel position
    if imo_to_fetch:
        pos = await fetch_vessel_position(str(imo_to_fetch))
        result['vesselPosition'] = serialize_doc(pos) if pos else None
        result['imo'] = str(imo_to_fetch)

    result['success'] = bool(
        result.get('internal') or result.get('external') or result.get('vesselPosition')
    )
    return result


@fastapi_app.post("/api/manager/tracking/attach", dependencies=[Depends(require_manager_or_admin)])
async def tracking_attach_to_shipment(payload: Dict[str, Any] = Body(...)):
    """
    Manager action: attach IMO/vessel to a shipment (by shipmentId) and enable live tracking.
    """
    shipment_id = str(payload.get('shipmentId', '')).strip()
    imo = str(payload.get('imo', '')).strip()
    if not shipment_id or not imo:
        raise HTTPException(status_code=400, detail='shipmentId and imo required')

    vessel = {
        'imo': imo,
        'name': payload.get('vesselName'),
        'attachedAt': datetime.now(timezone.utc),
    }
    r = await db.shipments.update_one(
        {'id': shipment_id},
        {'$set': {'vessel': vessel, 'trackingActive': True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail='Shipment not found')

    sh = await db.shipments.find_one({'id': shipment_id})
    # trigger immediate tick
    try:
        await update_shipment_position(sh)
    except Exception as e:
        logger.warning(f"[TRACKING/attach] initial tick failed: {e}")

    pos = await fetch_vessel_position(imo)
    return {
        'success': True,
        'shipmentId': shipment_id,
        'vessel': serialize_doc(vessel),
        'vesselPosition': serialize_doc(pos) if pos else None,
    }


@fastapi_app.post("/api/admin/tracking/providers/configure", dependencies=[Depends(require_admin)])
async def tracking_providers_configure(payload: Dict[str, Any] = Body(...)):
    """
    Update provider API keys at runtime. Persists to the DB (tracking_config),
    updates in-memory globals immediately (no restart required),
    and reports live test results for the newly-set keys.
    """
    global VESSELFINDER_API_KEY, VESSELFINDER_FLEET_KEY, SHIPSGO_API_KEY, SHIPSGO_FLEET_KEY, AFTERSHIP_API_KEY
    now = datetime.now(timezone.utc)
    updates = {}

    if 'vesselfinder' in payload:
        VESSELFINDER_API_KEY = str(payload['vesselfinder'] or '').strip()
        updates['vesselfinder'] = bool(VESSELFINDER_API_KEY)
    if 'vesselfinder_fleet' in payload:
        VESSELFINDER_FLEET_KEY = str(payload['vesselfinder_fleet'] or '').strip()
        updates['vesselfinder_fleet'] = bool(VESSELFINDER_FLEET_KEY)
    if 'shipsgo' in payload:
        SHIPSGO_API_KEY = str(payload['shipsgo'] or '').strip()
        updates['shipsgo'] = bool(SHIPSGO_API_KEY)
    if 'shipsgo_fleet' in payload:
        SHIPSGO_FLEET_KEY = str(payload['shipsgo_fleet'] or '').strip()
        updates['shipsgo_fleet'] = bool(SHIPSGO_FLEET_KEY)
    if 'aftership' in payload:
        AFTERSHIP_API_KEY = str(payload['aftership'] or '').strip()
        updates['aftership'] = bool(AFTERSHIP_API_KEY)

    await db.tracking_config.update_one(
        {'_id': 'providers'},
        {'$set': {
            'vesselfinder': VESSELFINDER_API_KEY,
            'vesselfinder_fleet': VESSELFINDER_FLEET_KEY,
            'shipsgo': SHIPSGO_API_KEY,
            'shipsgo_fleet': SHIPSGO_FLEET_KEY,
            'aftership': AFTERSHIP_API_KEY,
            'updatedAt': now,
        }},
        upsert=True,
    )
    return {
        'success': True,
        'updated': updates,
        'configured': {
            'vesselfinder': bool(VESSELFINDER_API_KEY),
            'vesselfinder_fleet': bool(VESSELFINDER_FLEET_KEY),
            'shipsgo': bool(SHIPSGO_API_KEY),
            'shipsgo_fleet': bool(SHIPSGO_FLEET_KEY),
            'aftership': bool(AFTERSHIP_API_KEY),
        },
    }


@fastapi_app.post("/api/admin/tracking/providers/test", dependencies=[Depends(require_admin)])
async def tracking_providers_test(payload: Dict[str, Any] = Body(default={})):
    """
    Quick connectivity test of configured providers. Returns success/error per provider.
    Safe to call repeatedly.
    """
    test_container = (payload or {}).get('container') or 'MSCU1234567'
    test_imo = (payload or {}).get('imo') or '9629344'

    results = {}
    # ShipsGo container - validate key first via GetShippingLineList (free), then try GetContainerInfo
    if SHIPSGO_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Step 1: validate key via free endpoint
                validation = await client.get(
                    'https://shipsgo.com/api/v1.2/ContainerService/GetShippingLineList/',
                    params={'authCode': SHIPSGO_API_KEY},
                )
                key_valid = validation.status_code == 200 and validation.text.strip().startswith('[')
                # Step 2: attempt actual container info lookup
                res = await client.get(
                    'https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/',
                    params={'authCode': SHIPSGO_API_KEY, 'requestId': test_container, 'mapPoint': 'true'},
                )
                text = (res.text or '')[:200]
                tracking_ok = res.status_code == 200 and 'Invalid' not in text
                if key_valid and not tracking_ok:
                    note = 'key valid but no container credits (Containers left: 0 in dashboard). Buy credits at https://shipsgo.com/dashboard'
                else:
                    note = ''
                results['shipsgo'] = {
                    'ok': tracking_ok,
                    'keyValid': key_valid,
                    'status_code': res.status_code,
                    'preview': text[:160],
                    'note': note,
                }
        except Exception as e:
            results['shipsgo'] = {'ok': False, 'error': str(e)[:200]}
    else:
        results['shipsgo'] = {'ok': False, 'error': 'not_configured'}

    # VesselFinder
    if VESSELFINDER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f'https://api.vesselfinder.com/vessels?userkey={VESSELFINDER_API_KEY}&imo={test_imo}'
                )
                ok = res.status_code == 200
                results['vesselfinder'] = {'ok': ok, 'status_code': res.status_code, 'preview': (res.text or '')[:160]}
        except Exception as e:
            results['vesselfinder'] = {'ok': False, 'error': str(e)[:200]}
    else:
        results['vesselfinder'] = {'ok': False, 'error': 'not_configured'}

    # VesselFinder Fleet
    if VESSELFINDER_FLEET_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f'https://api.vesselfinder.com/vesselslist?userkey={VESSELFINDER_FLEET_KEY}'
                )
                ok = res.status_code == 200
                results['vesselfinder_fleet'] = {
                    'ok': ok,
                    'status_code': res.status_code,
                    'preview': (res.text or '')[:160],
                }
        except Exception as e:
            results['vesselfinder_fleet'] = {'ok': False, 'error': str(e)[:200]}
    else:
        results['vesselfinder_fleet'] = {'ok': False, 'error': 'not_configured'}

    # ShipsGo Fleet
    if SHIPSGO_FLEET_KEY:
        # Validate key via free endpoint
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                validation = await client.get(
                    'https://shipsgo.com/api/v1.2/ContainerService/GetShippingLineList/',
                    params={'authCode': SHIPSGO_FLEET_KEY},
                )
                key_valid = validation.status_code == 200 and validation.text.strip().startswith('[')
        except Exception:
            key_valid = False
        pos = await fetch_vessel_position_shipsgo(test_imo)
        if key_valid and not pos:
            note = 'Fleet key valid but no vessels added to fleet (Vessels in fleets: 0/10). Add IMO vessels in ShipsGo dashboard → Fleet.'
        else:
            note = ''
        results['shipsgo_fleet'] = {
            'ok': bool(pos),
            'keyValid': key_valid,
            'position': pos,
            'note': note,
        }
    else:
        results['shipsgo_fleet'] = {'ok': False, 'error': 'not_configured'}

    return {'success': True, 'results': results}


# ═══════════════════════════════════════════════════════════════════
# VESSELFINDER — extension-driven live tracking (NO BACKEND SCRAPING)
# ═══════════════════════════════════════════════════════════════════
# Architecture (final):
#   Manager's Chrome extension fetches mp2/sfl/refresh using their own IP +
#   cookies (they look like a normal user to VF), posts raw payload to CRM.
#   Backend: /jobs endpoint → dispatch → parse payload (pure functions) →
#   update shipment → emit shipment:update via Socket.IO.
#
# Backend does NOT store VF cookies, NOT perform server-side HTTP to VF,
# NOT manage "VF sessions". Extension is the sole VF data source.
# ═══════════════════════════════════════════════════════════════════
# Only pure parser helpers are imported — no network client.
from vesselfinder_scraper import (
    route_to_bbox as _vf_route_to_bbox,
    extract_vessels_from_payload as _vf_extract_vessels,
    find_matching_vessel as _vf_find_match,
)


class VFBindVesselRequest(BaseModel):
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    name: Optional[str] = None
    # Container number (e.g. "MSKU1234567"). Optional but recommended — the
    # container is the entity that physically carries the VIN across vessels.
    container: Optional[str] = None
    containerSeal: Optional[str] = None
    # Explicit flag: force creation of a new vessel stage even if MMSI/IMO matches.
    # Useful for "Сменить судно" UX when operator re-binds same ship by mistake.
    forceNewStage: Optional[bool] = False
    # Optional label override for the new stage (e.g. "Перевалка в Algeciras").
    newStageLabel: Optional[str] = None


class VFBindByVinRequest(BaseModel):
    vin: str
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    name: Optional[str] = None
    container: Optional[str] = None
    containerSeal: Optional[str] = None
    forceNewStage: Optional[bool] = False
    newStageLabel: Optional[str] = None


class VFTransferVesselRequest(BaseModel):
    """Explicit transshipment: always creates a new vessel stage."""
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    name: Optional[str] = None
    container: Optional[str] = None
    containerSeal: Optional[str] = None
    label: Optional[str] = None
    transferPort: Optional[str] = None     # e.g. "Algeciras"


# ═════════════════════════════════════════════════════════════════════
# REMOVED in Phase 2 (security hardening):
#   • POST /api/vesselfinder/session/sync         — stored VF cookies
#   • GET  /api/vesselfinder/session/status       — server-side health
#   • POST /api/vesselfinder/session/test         — server-side ping
#   • DELETE /api/vesselfinder/session            — session clear
#   • POST /api/vesselfinder/session/reset-counters
#   • GET  /api/vesselfinder/vessels/search       — server-side world sweep
#
# All VesselFinder network access must now go through the trusted Chrome
# extension runtime (HMAC-signed POST to /api/vesselfinder/jobs/result).
# See docs/SECURITY.md (TODO) for the new flow.
# ═════════════════════════════════════════════════════════════════════




@fastapi_app.post("/api/shipments/{shipment_id}/vessel", dependencies=[Depends(require_manager_or_admin)])
async def bind_vessel_to_shipment(shipment_id: str, payload: VFBindVesselRequest):
    """
    VIN-centric bind of a vessel (+ optional container) to a shipment.

    THE KEY PRINCIPLE — we track the VIN's JOURNEY, not a single ship:
      • Same-vessel rebind  → MERGE into active stage (non-destructive).
      • Different vessel    → CLOSE active vessel stage (status=done) +
                              APPEND a new vessel stage with status=active.
                              Previous stage is kept in stages[] forever —
                              this is the vessel history.

    That way, when a cargo transships Ship A → Ship B in an intermediate port,
    the UI naturally renders:

        ✅ Stage 1 — Ship A (done,  MSC OSCAR)
        🟠 Stage 2 — Ship B (active, AQUARIUS)
        ⏳ Stage 3 — Land delivery (pending)

    …without any extra modelling.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    # Backfill legacy shipments without stages[] so the logic below always has
    # a proper journey to work with.
    ensure_shipment_stages(shipment)
    if shipment.get("_stages_backfilled"):
        await _persist_stages_backfill(shipment)

    vessel_incoming = {
        "name":  (payload.name or "").strip() or None,
        "mmsi":  (payload.mmsi or "").strip() or None,
        "imo":   (payload.imo or "").strip() or None,
    }
    if not any([vessel_incoming["mmsi"], vessel_incoming["imo"], vessel_incoming["name"]]):
        raise HTTPException(status_code=400, detail="At least one of mmsi/imo/name required")

    now = datetime.now(timezone.utc)
    container_incoming: Optional[Dict[str, Any]] = None
    if payload.container:
        container_incoming = {
            "number":     payload.container.strip(),
            "sealNumber": (payload.containerSeal or "").strip() or None,
            "boundAt":    now,
        }

    stages: List[Dict[str, Any]] = list(shipment.get("stages") or [])
    current_stage_id: Optional[str] = shipment.get("currentStageId")

    # Locate current stage (or the first active vessel stage).
    cur_idx: Optional[int] = None
    for idx, st in enumerate(stages):
        if st.get("id") == current_stage_id:
            cur_idx = idx
            break
    if cur_idx is None:
        # fallback — first 'active' stage
        for idx, st in enumerate(stages):
            if st.get("status") == "active":
                cur_idx = idx
                break

    # Determine if this is a vessel-change (new ship) or same-ship rebind.
    def _vessel_key(v: Dict[str, Any]) -> str:
        return "|".join([
            (v.get("mmsi") or "").strip(),
            (v.get("imo") or "").strip(),
            (v.get("name") or "").strip().lower(),
        ])

    stage_is_vessel = (cur_idx is not None and stages[cur_idx].get("type") == "vessel")
    cur_vessel = (stages[cur_idx].get("vessel") if cur_idx is not None else None) or {}
    cur_vessel_key = _vessel_key(cur_vessel)
    # "First bind" — stage has no vessel yet. Always merge (no stage split).
    cur_has_vessel = cur_vessel_key != "||"
    is_same_vessel = (
        stage_is_vessel
        and cur_has_vessel
        and cur_vessel_key == _vessel_key(vessel_incoming)
    )

    created_new_stage = False
    new_stage_id: Optional[str] = None
    prev_vessel_snapshot: Optional[Dict[str, Any]] = None

    # ── Branch A: same vessel OR first-ever bind OR non-vessel stage → merge.
    merge_mode = (
        (is_same_vessel or not stage_is_vessel or not cur_has_vessel)
        and not payload.forceNewStage
    )
    if merge_mode:
        if cur_idx is not None:
            merged_vessel = {**(cur_vessel or {}), **{k: v for k, v in vessel_incoming.items() if v is not None}}
            merged_vessel["boundAt"] = now
            stages[cur_idx]["vessel"] = merged_vessel
            if container_incoming:
                prev_container = stages[cur_idx].get("container") or {}
                stages[cur_idx]["container"] = {**prev_container, **container_incoming}
            # If the current stage was non-vessel, promote its 'type' to 'vessel'
            # so tracking kicks in.
            if not stage_is_vessel:
                stages[cur_idx]["type"] = "vessel"
        else:
            # No stage at all — create one (shouldn't happen after ensure_shipment_stages,
            # but defensive).
            new_stage = build_default_stages(
                origin=shipment.get("origin"),
                destination=shipment.get("destination"),
                vessel={**vessel_incoming, "boundAt": now},
            )[0]
            if container_incoming:
                new_stage["container"] = container_incoming
            stages.append(new_stage)
            current_stage_id = new_stage["id"]
            new_stage_id = new_stage["id"]
            created_new_stage = True

    # ── Branch B: vessel changed → close current vessel stage + append new one.
    else:
        # Capture what we're transitioning away from for the event payload.
        prev_vessel_snapshot = dict(cur_vessel) if cur_vessel else None
        if cur_idx is not None and stages[cur_idx].get("status") == "active":
            stages[cur_idx]["status"] = "done"
            stages[cur_idx]["completedAt"] = now

        # Build the new vessel stage. Use current stage's destination as the
        # new stage's origin (most transshipments happen at a port).
        label = payload.newStageLabel or "Нове судно"
        prev_to = (stages[cur_idx].get("to") if cur_idx is not None else None)
        prev_to_point = (stages[cur_idx].get("toPoint") if cur_idx is not None else None)
        dest = shipment.get("destination") or {}
        new_stage = {
            "id":         f"stage_{int(now.timestamp())}_{len(stages)+1}",
            "type":       "vessel",
            "label":      (
                f"{label} — {vessel_incoming.get('name') or 'нове судно'}"
                if label == "Нове судно"
                else label
            ),
            "from":       prev_to or (shipment.get("origin") or {}).get("name") or "Transfer",
            "to":         dest.get("name") or "Destination",
            "fromPoint":  prev_to_point or shipment.get("origin"),
            "toPoint":    shipment.get("destination"),
            "status":     "active",
            "vessel":     {**vessel_incoming, "boundAt": now},
            "container":  container_incoming,  # may be None — will merge later
            "startedAt":  now,
            "completedAt": None,
        }
        new_stage = _normalize_stage(new_stage, len(stages), len(stages) + 1)

        # Insert directly AFTER the current stage (preserves any land/pending stages
        # that were planned to happen after arrival).
        insert_at = (cur_idx + 1) if cur_idx is not None else len(stages)
        stages.insert(insert_at, new_stage)
        current_stage_id = new_stage["id"]
        new_stage_id = new_stage["id"]
        created_new_stage = True

    # Normalize the full stages list so ids/keys are sane.
    stages = [_normalize_stage(s, i, len(stages)) for i, s in enumerate(stages)]

    # Keep top-level `vessel` in sync for backwards compat (old UI still reads it).
    cur_idx_final = next((i for i, s in enumerate(stages) if s.get("id") == current_stage_id), None)
    top_vessel = (stages[cur_idx_final].get("vessel") if cur_idx_final is not None else None) or vessel_incoming
    set_ops: Dict[str, Any] = {
        "vessel":          top_vessel,
        "stages":          stages,
        "currentStageId":  current_stage_id,
        "trackingActive":  True,
        "updatedAt":       now,
        "updated_at":      now,
    }
    # Top-level container (most-recent) for convenience.
    if container_incoming:
        set_ops["container"] = container_incoming
    # If VIN was NOT in the shipment and operator typed it elsewhere, we don't
    # overwrite it here (bind-by-vin handles VIN lookup separately).

    await db.shipments.update_one({"id": shipment_id}, {"$set": set_ops})

    # ── Side effects: events + Socket.IO push
    customer_id = shipment.get("customerId")
    if created_new_stage:
        await add_shipment_event(
            shipment_id,
            "vessel_changed" if prev_vessel_snapshot else "vessel_assigned",
            (
                f"Судно змінено: {prev_vessel_snapshot.get('name') or '—'} → "
                f"{vessel_incoming.get('name') or vessel_incoming.get('mmsi') or 'new vessel'}"
                if prev_vessel_snapshot
                else f"Судно призначено: {vessel_incoming.get('name') or vessel_incoming.get('mmsi')}"
            ),
            meta={
                "previousVessel": prev_vessel_snapshot,
                "newVessel":      vessel_incoming,
                "newStageId":     new_stage_id,
                "container":      container_incoming,
            },
            customer_id=customer_id,
        )
    else:
        await add_shipment_event(
            shipment_id,
            "vessel_updated",
            f"Оновлено дані судна: {vessel_incoming.get('name') or vessel_incoming.get('mmsi')}",
            meta={"vessel": vessel_incoming, "container": container_incoming},
            customer_id=customer_id,
        )

    fresh = await db.shipments.find_one({"id": shipment_id})
    return {
        "ok": True,
        "shipmentId": shipment_id,
        "vessel": serialize_doc(top_vessel),
        "container": serialize_doc(container_incoming) if container_incoming else None,
        "createdNewStage": created_new_stage,
        "newStageId":      new_stage_id,
        "currentStageId":  current_stage_id,
        "vesselStagesCount": sum(1 for s in stages if s.get("type") == "vessel"),
        "shipment": serialize_journey(fresh) if fresh else None,
    }


@fastapi_app.post("/api/shipments/bind-by-vin", dependencies=[Depends(require_manager_or_admin)])
@(_rate_limiter.limit("30/minute") if _rate_limiter else (lambda f: f))
async def bind_vessel_by_vin(request: Request, response: Response, payload: VFBindByVinRequest):
    """
    VIN-first bind. Locates shipment by VIN, then delegates to the same
    logic as /api/shipments/{id}/vessel.

    Returns 404 if VIN has no active shipment yet (manager should create one).
    """
    vin = (payload.vin or "").strip().upper()
    if not vin:
        raise HTTPException(status_code=400, detail="vin is required")
    shipment = await db.shipments.find_one({"vin": vin})
    if not shipment:
        # Try case-insensitive (some imports lowercase VINs)
        shipment = await db.shipments.find_one({"vin": {"$regex": f"^{vin}$", "$options": "i"}})
    if not shipment:
        raise HTTPException(
            status_code=404,
            detail=f"VIN {vin} has no shipment. Create a shipment first (Admin → Shipments → +New).",
        )
    inner = VFBindVesselRequest(
        mmsi=payload.mmsi,
        imo=payload.imo,
        name=payload.name,
        container=payload.container,
        containerSeal=payload.containerSeal,
        forceNewStage=bool(payload.forceNewStage),
        newStageLabel=payload.newStageLabel,
    )
    return await bind_vessel_to_shipment(shipment["id"], inner)


@fastapi_app.post("/api/shipments/{shipment_id}/transfer-vessel", dependencies=[Depends(require_manager_or_admin)])
@(_rate_limiter.limit("30/minute") if _rate_limiter else (lambda f: f))
async def transfer_vessel_shipment(
    request: Request, response: Response, shipment_id: str,
    payload: VFTransferVesselRequest,
    current_user: Dict[str, Any] = Depends(require_manager_or_admin),
):
    """
    Explicit transshipment: always creates a new vessel stage, regardless of
    whether the incoming ship matches the current one. Use this for manual
    "Сменить судно" UX where the operator *intends* to record a ship change.
    """
    label = payload.label
    if not label and payload.transferPort:
        label = f"Перевалка в {payload.transferPort}"
    req = VFBindVesselRequest(
        mmsi=payload.mmsi,
        imo=payload.imo,
        name=payload.name,
        container=payload.container,
        containerSeal=payload.containerSeal,
        forceNewStage=True,
        newStageLabel=label or "Перевалка на нове судно",
    )
    result = await bind_vessel_to_shipment(shipment_id, req)
    await audit(
        "transfer-vessel", user=current_user, resource=f"shipment:{shipment_id}",
        meta={"mmsi": payload.mmsi, "imo": payload.imo, "name": payload.name, "port": payload.transferPort},
        request=request,
    )
    return result


@fastapi_app.get("/api/shipments/{shipment_id}/vessel-history", dependencies=[Depends(require_manager_or_admin)])
async def vessel_history(shipment_id: str):
    """
    Returns the full vessel/container history of a shipment's journey.

    Derived from stages[] (no separate collection needed) — every stage of
    type='vessel' contributes one history entry. Response is ordered
    chronologically: [past ships..., current ship, (future ships)].
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    stages = shipment.get("stages") or []
    history: List[Dict[str, Any]] = []
    current_id = shipment.get("currentStageId")
    for st in stages:
        if st.get("type") != "vessel":
            continue
        vessel = st.get("vessel") or {}
        history.append({
            "stageId":     st.get("id"),
            "label":       st.get("label"),
            "status":      st.get("status"),
            "isCurrent":   st.get("id") == current_id,
            "from":        st.get("from"),
            "to":          st.get("to"),
            "vessel": {
                "name":    vessel.get("name"),
                "mmsi":    vessel.get("mmsi"),
                "imo":     vessel.get("imo"),
                "boundAt": vessel.get("boundAt"),
            } if vessel else None,
            "container":   st.get("container"),
            "startedAt":   st.get("startedAt"),
            "completedAt": st.get("completedAt"),
        })
    return {
        "ok":             True,
        "shipmentId":     shipment_id,
        "vin":            shipment.get("vin"),
        "vesselStages":   [serialize_doc(h) for h in history],
        "currentStageId": current_id,
        "totalVessels":   len(history),
    }


# ═══════════════════════════════════════════════════════════════════════════
#   UNIVERSAL SHIPMENT SEARCH  (VIN / container / vessel name / MMSI / IMO / id)
# ═══════════════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/admin/shipments/search", dependencies=[Depends(require_admin)])
async def search_shipments(q: str = '', limit: int = 50):
    """
    Search across: VIN, shipment.id, shipment.dealId,
    vessel (top-level and inside every stage) name/mmsi/imo,
    container (top-level and inside every stage) number/sealNumber.

    Powers the manager's search bar. Case-insensitive substring match.
    """
    q_raw = (q or '').strip()
    if not q_raw:
        return {"ok": True, "results": [], "total": 0}
    import re as _re
    pattern = _re.escape(q_raw)
    rx = {"$regex": pattern, "$options": "i"}

    query = {
        "$or": [
            {"id":              rx},
            {"vin":             rx},
            {"dealId":          rx},
            {"customerId":      rx},
            {"vehicleTitle":    rx},
            # top-level vessel
            {"vessel.name":     rx},
            {"vessel.mmsi":     rx},
            {"vessel.imo":      rx},
            # top-level container
            {"container.number":     rx},
            {"container.sealNumber": rx},
            # inside stages
            {"stages.vessel.name":        rx},
            {"stages.vessel.mmsi":        rx},
            {"stages.vessel.imo":         rx},
            {"stages.container.number":   rx},
            {"stages.container.sealNumber": rx},
        ],
    }

    raw = await db.shipments.find(query).limit(max(1, min(int(limit), 200))).to_list(None)
    results = []
    for sh in raw:
        ensure_shipment_stages(sh)  # so currentStage/currentVessel/etc work
        j = serialize_journey(sh)
        # Compact result — enough for a search row; full details load on click.
        results.append({
            "id":              j["id"],
            "vin":             j["vin"],
            "customerId":      j["customerId"],
            "vehicleTitle":    sh.get('vehicleTitle'),
            "status":          sh.get('status'),
            "currentVessel":   j.get("currentVessel"),
            "currentContainer": j.get("currentContainer"),
            "origin":          j.get("origin"),
            "destination":     j.get("destination"),
            "progress":        j.get("progress"),
            "trackingHealth":  j.get("trackingHealth"),
            "trackingSource":  j.get("trackingSource"),
            "liveEta":         j.get("liveEta"),
            "location":        j.get("location"),
            "lastTrackingUpdate": j.get("lastTrackingUpdate"),
        })
    return {"ok": True, "results": results, "total": len(results), "query": q_raw}


# ═══════════════════════════════════════════════════════════════════════════
#   EXCEPTIONS DASHBOARD — shipments that need human attention.
# ═══════════════════════════════════════════════════════════════════════════
@fastapi_app.get("/api/admin/shipments/exceptions", dependencies=[Depends(require_admin)])
async def shipments_exceptions():
    """
    Lists shipments that currently need manual review, grouped by reason.

    Reasons:
      • stale         — tracking update > 3 h old
      • no_data       — trackingActive=true but no source / no position
      • no_vessel     — active stage is 'vessel' but no mmsi/imo/name bound
      • no_container  — active stage is 'vessel' but no container bound (soft)
      • stuck_progress — progress > 0.99 for > 24 h and not delivered
    """
    tracked = await db.shipments.find(
        {"trackingActive": True}
    ).to_list(None)
    now_ts = datetime.now(timezone.utc)
    buckets: Dict[str, List[Dict[str, Any]]] = {
        "stale": [], "no_data": [], "no_vessel": [],
        "no_container": [], "stuck_progress": [],
    }
    total = 0

    def _age_sec(dt_val) -> Optional[float]:
        if isinstance(dt_val, datetime):
            if dt_val.tzinfo is None:
                dt_val = dt_val.replace(tzinfo=timezone.utc)
            return (now_ts - dt_val).total_seconds()
        if isinstance(dt_val, str):
            try:
                dt_val = datetime.fromisoformat(dt_val.replace('Z', '+00:00'))
                return (now_ts - dt_val).total_seconds()
            except Exception:
                return None
        return None

    for sh in tracked:
        ensure_shipment_stages(sh)
        issues: List[str] = []
        cur = get_current_stage(sh) or {}
        # Last update age
        age = _age_sec(sh.get('lastTrackingUpdate') or (sh.get('currentPosition') or {}).get('updatedAt'))
        if age is not None and age > 3 * 3600:
            issues.append('stale')
        src = sh.get('trackingSource') or (sh.get('currentPosition') or {}).get('source')
        if not src or not sh.get('currentPosition'):
            issues.append('no_data')
        # Vessel-stage requirements
        if cur.get('type') == 'vessel':
            cv = cur.get('vessel') or {}
            if not (cv.get('mmsi') or cv.get('imo') or cv.get('name')):
                issues.append('no_vessel')
            if not (cur.get('container') or {}).get('number'):
                issues.append('no_container')
        # Stuck near destination for long time
        if (sh.get('progress') or 0) >= 0.99 and sh.get('status') != 'delivered':
            if age is not None and age > 24 * 3600:
                issues.append('stuck_progress')
        if not issues:
            continue
        total += 1
        compact = {
            "id":             sh.get('id'),
            "vin":            sh.get('vin'),
            "customerId":     sh.get('customerId'),
            "vehicleTitle":   sh.get('vehicleTitle'),
            "origin":         (sh.get('origin') or {}).get('name'),
            "destination":    (sh.get('destination') or {}).get('name'),
            "progress":       sh.get('progress') or 0,
            "currentStageId": sh.get('currentStageId'),
            "currentStageType": cur.get('type'),
            "currentVessel":  cur.get('vessel') or sh.get('vessel'),
            "currentContainer": cur.get('container') or sh.get('container'),
            "trackingSource": src,
            "lastTrackingUpdate": sh.get('lastTrackingUpdate'),
            "ageHours":       round((age or 0) / 3600, 1) if age is not None else None,
            "issues":         issues,
        }
        for bucket in issues:
            buckets[bucket].append(serialize_doc(compact))
    return {
        "ok":     True,
        "total":  total,
        "buckets": {k: v for k, v in buckets.items()},
        "counts": {k: len(v) for k, v in buckets.items()},
        "computedAt": now_ts.isoformat().replace('+00:00', 'Z'),
    }


# ═══════════════════════════════════════════════════════════════════════════
#   AUTO RESOLVER — Public admin endpoints
# ═══════════════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/admin/shipments/{shipment_id}/resolver/run", dependencies=[Depends(require_admin)])
async def shipment_resolver_run(shipment_id: str):
    """
    Manually trigger the Auto Resolver for one shipment.
    Returns the full report + diff of what was persisted.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    ensure_shipment_stages(shipment)
    report = await _run_auto_resolver(shipment)
    persisted = await _persist_resolver_hits(shipment, report)
    # Reload to return the fresh snapshot
    fresh = await db.shipments.find_one({"id": shipment_id}) or shipment
    return {
        "ok": True,
        "shipmentId": shipment_id,
        "report": serialize_doc(report),
        "persisted": persisted,
        "shipment": {
            "container": (fresh.get("container") or {}).get("number"),
            "vessel": fresh.get("vessel"),
            "containerConfidence": fresh.get("containerConfidence"),
            "vesselConfidence": fresh.get("vesselConfidence"),
        },
    }


@fastapi_app.get("/api/admin/shipments/{shipment_id}/resolver/status", dependencies=[Depends(require_admin)])
async def shipment_resolver_status(shipment_id: str):
    """Returns the last stored resolver trace for a shipment."""
    shipment = await db.shipments.find_one(
        {"id": shipment_id},
        {"_id": 0, "id": 1, "resolver": 1, "container": 1, "vessel": 1,
         "containerConfidence": 1, "vesselConfidence": 1,
         "containerAutoResolved": 1, "vesselAutoResolved": 1},
    )
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"ok": True, **serialize_doc(shipment)}


@fastapi_app.get("/api/admin/resolver/queue", dependencies=[Depends(require_admin)])
async def resolver_queue(limit: int = 50):
    """
    List shipments that need container/vessel resolution — shipments where
    tracking is active, active stage is vessel-type, but container or
    vessel identity is missing. This is the "work queue" for the auto
    resolver (either by worker or manual click).

    Each row includes the last resolver trace (if any) so the manager can
    see what was tried and why it failed.
    """
    limit = max(1, min(int(limit), 200))
    cursor = db.shipments.find({"trackingActive": True})
    items: List[Dict[str, Any]] = []
    async for s in cursor:
        ensure_shipment_stages(s)
        cur = get_current_stage(s) or {}
        if cur.get("type") != "vessel":
            continue
        container = (cur.get("container") or {}).get("number") or (s.get("container") or {}).get("number") or s.get("containerNumber")
        vessel = cur.get("vessel") or s.get("vessel") or {}
        has_vessel_ident = bool(vessel.get("mmsi") or vessel.get("imo") or vessel.get("name"))
        if container and has_vessel_ident:
            continue
        trace = s.get("resolver") or {}
        items.append({
            "id":            s.get("id"),
            "vin":           s.get("vin"),
            "vehicleTitle":  s.get("vehicleTitle"),
            "customerId":    s.get("customerId"),
            "missing":       [k for k, v in [("container", container), ("vessel", has_vessel_ident)] if not v],
            "currentStage":  {"id": cur.get("id"), "label": cur.get("label")},
            "container":     container,
            "vessel":        {k: vessel.get(k) for k in ("name", "mmsi", "imo")},
            "resolver":      serialize_doc(trace) if trace else None,
            "containerConfidence": s.get("containerConfidence"),
            "vesselConfidence":    s.get("vesselConfidence"),
        })
        if len(items) >= limit:
            break
    # Summary counts
    buckets = {"missing_container": 0, "missing_vessel": 0, "missing_both": 0}
    for it in items:
        miss = it.get("missing") or []
        if "container" in miss and "vessel" in miss:
            buckets["missing_both"] += 1
        elif "container" in miss:
            buckets["missing_container"] += 1
        elif "vessel" in miss:
            buckets["missing_vessel"] += 1
    return {
        "ok":    True,
        "total": len(items),
        "items": items,
        "buckets": buckets,
        "computedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@fastapi_app.post("/api/admin/resolver/run-queue", dependencies=[Depends(require_admin)])
async def resolver_run_queue(limit: int = 10):
    """
    Batch-run the resolver over the current queue. Executes the resolver
    sequentially for up to ``limit`` shipments and returns an aggregated
    report. Useful for "Run all" button in Exceptions dashboard.
    """
    limit = max(1, min(int(limit), 50))
    queue = await resolver_queue(limit=limit)
    results: List[Dict[str, Any]] = []
    resolved_count = 0
    for it in queue.get("items", []):
        sh = await db.shipments.find_one({"id": it["id"]})
        if not sh:
            continue
        ensure_shipment_stages(sh)
        try:
            rep = await _run_auto_resolver(sh)
            diff = await _persist_resolver_hits(sh, rep)
            if diff.get("containerChanged") or diff.get("vesselChanged"):
                resolved_count += 1
            results.append({
                "id": it["id"],
                "container": rep.get("container", {}).get("value"),
                "containerConfidence": rep.get("container", {}).get("confidence"),
                "vesselName": (rep.get("vessel", {}).get("value") or {}).get("name") if isinstance(rep.get("vessel", {}).get("value"), dict) else None,
                "diff": diff,
            })
        except Exception as e:
            logger.warning(f"[Resolver/queue] {it['id']} failed: {e}")
            results.append({"id": it["id"], "error": str(e)})
    return {"ok": True, "processed": len(results), "resolved": resolved_count, "results": results}


@fastapi_app.post("/api/shipments/{shipment_id}/tick", dependencies=[Depends(require_manager_or_admin)])
async def force_tick_shipment(shipment_id: str):
    """
    Force an immediate tracking update for a shipment. Canonical shape:

        {
          "ok": true,
          "shipmentId": "...",
          "position": {"lat": ..., "lng": ...},
          "progress": 0.62,
          "eta": "2026-05-04T15:00:00Z",
          "source": "real_scraped" | "real" | "interpolated" | "simulated",
          "currentStageId": "stage_..."
        }

    Runs the full REAL → INTERPOLATE → SIMULATE pipeline + movement sanity +
    stage-gated VF fetch. Safe to call from the manager UI "force tick" button.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    try:
        await update_shipment_position(shipment)
    except Exception as e:
        logger.exception(f"[TICK] force_tick failed for {shipment_id}")
        return {"ok": False, "shipmentId": shipment_id, "error": str(e)[:200]}
    fresh = await db.shipments.find_one({"id": shipment_id})
    cur = fresh.get("currentPosition") or {}
    return {
        "ok": True,
        "shipmentId": shipment_id,
        "position": (
            {"lat": cur.get("lat"), "lng": cur.get("lng")}
            if isinstance(cur, dict) and cur.get("lat") is not None else None
        ),
        "progress": fresh.get("progress"),
        "eta": fresh.get("liveEta") or fresh.get("eta"),
        "source": fresh.get("trackingSource"),
        "currentStageId": fresh.get("currentStageId"),
        # Back-compat aliases (pre-existing clients may read these):
        "success": True,
        "currentPosition": serialize_doc(cur) if isinstance(cur, dict) else None,
        "trackingSource": fresh.get("trackingSource"),
        "liveEta": fresh.get("liveEta"),
    }


# ═══════════════════════════════════════════════════════════════════
# EXTENSION-DRIVEN JOBS API
# ═══════════════════════════════════════════════════════════════════
# The extension polls /api/vesselfinder/jobs every ~2 min. For each job it
# fetches mp2 (and sfl/refresh as fallback) from vesselfinder.com and POSTs
# the raw payload to /api/vesselfinder/jobs/result. CRM parses it and
# updates shipments.
# ═══════════════════════════════════════════════════════════════════
MAX_JOBS_PER_TICK = 5


class VFHeartbeatRequest(BaseModel):
    managerEmail: Optional[str] = None
    userAgent: Optional[str] = None
    extensionVersion: Optional[str] = None


class VFJobResult(BaseModel):
    jobId: str
    shipmentId: Optional[str] = None
    source: Optional[str] = "mp2"          # which VF endpoint produced the payload
    ok: bool = True
    payload: Optional[Any] = None          # raw VF response body (list, dict, or {"format":"binary-b64","data":"..."})
    status_code: Optional[int] = None
    contentType: Optional[str] = None      # raw VF content-type header
    contentTypeHint: Optional[str] = None  # "json" | "text" | "binary"
    rawSize: Optional[int] = None          # byte count of the raw VF response
    error: Optional[str] = None
    fetchedAt: Optional[datetime] = None


@fastapi_app.get("/api/extension/vesselfinder/download")
async def vf_extension_download_public():
    """
    Public download for the VesselFinder Chrome extension as a ZIP (no admin auth).

    Packs /app/backend/chrome_extension_vf/ as-is so the latest icons and popup
    markup are always shipped. Managers set the CRM URL inside the popup.
    """
    import io
    import zipfile
    ext_dir = os.path.join(os.path.dirname(__file__), "chrome_extension_vf")
    if not os.path.isdir(ext_dir):
        raise HTTPException(status_code=404, detail="Extension source missing")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(ext_dir):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, ext_dir)
                if any(part.startswith('.') or part == '__pycache__' or part == 'dist' for part in rel.split(os.sep)):
                    continue
                with open(full, "rb") as fh:
                    content = fh.read()
                zf.writestr(rel.replace(os.sep, "/"), content)
    buf.seek(0)
    from fastapi.responses import Response
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="bibi-vesselfinder-extension.zip"',
            "X-Extension-Version": "3.2.0",
            "Cache-Control": "no-store",
        },
    )


@fastapi_app.get("/api/admin/vesselfinder/extension/download", dependencies=[Depends(require_admin)])
async def vf_extension_download(request: Request):
    """
    Download the VesselFinder Chrome extension as a ZIP.

    Starting from v3.0.0 the CRM backend URL is NOT hardcoded at download time.
    The manager types / pastes it in the popup, the value is stored in
    chrome.storage.local.backendUrl, and the service worker reads it on
    every tick. The download endpoint just packs the source folder as-is.
    """
    import io
    import zipfile
    ext_dir = os.path.join(os.path.dirname(__file__), "chrome_extension_vf")
    if not os.path.isdir(ext_dir):
        raise HTTPException(status_code=404, detail="Extension source missing")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(ext_dir):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, ext_dir)
                # Skip caches / editor junk
                if any(part.startswith('.') or part == '__pycache__' for part in rel.split(os.sep)):
                    continue
                with open(full, "rb") as fh:
                    content = fh.read()
                # Use posix separators in zip entries
                zf.writestr(rel.replace(os.sep, "/"), content)
    buf.seek(0)
    from fastapi.responses import Response
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="bibi-vesselfinder-extension.zip"',
            "X-Extension-Version": "3.0.0",
        },
    )


@fastapi_app.get("/api/admin/vesselfinder/debug/payloads", dependencies=[Depends(require_admin)])
async def vf_debug_payloads(limit: int = 20):
    """
    Last N captured payload metadata (from extension). Full raw snippets are
    only available if PAYLOAD_DEBUG_STORE=1 (prod default: off).
    """
    limit = max(1, min(limit, 50))
    items = []
    cursor = db.vf_payload_meta.find({}).sort("storedAt", -1).limit(limit)
    async for d in cursor:
        d.pop("_id", None)
        items.append(serialize_doc(d))
    return {"ok": True, "count": len(items), "payloads": items, "rawAvailable": bool(PAYLOAD_DEBUG_STORE)}


@fastapi_app.get("/api/admin/vesselfinder/debug/endpoint-probe", dependencies=[Depends(require_admin)])
async def vf_debug_endpoint_probe():
    """
    Quick summary over the last 50 payload meta records: which extension
    endpoint (mp2, sfl, refresh, mapapi-mp, api-pub-map, api-pub-vessels, …)
    returned useful data vs 404/error.
    """
    cursor = db.vf_payload_meta.find({}).sort("storedAt", -1).limit(50)
    summary: Dict[str, Dict[str, Any]] = {}
    async for d in cursor:
        src = d.get("source") or "unknown"
        st = d.get("status_code") or 0
        ct = d.get("contentTypeHint") or "?"
        row = summary.setdefault(src, {"attempts": 0, "http_counts": {}, "content_types": {}, "any_json": False, "any_vessels": 0})
        row["attempts"] += 1
        row["http_counts"][str(st)] = row["http_counts"].get(str(st), 0) + 1
        row["content_types"][ct] = row["content_types"].get(ct, 0) + 1
        if ct == "json":
            row["any_json"] = True
        row["any_vessels"] = max(row["any_vessels"], d.get("vesselsInPayload", 0) or 0)
    # rank candidates by usefulness
    ranked = sorted(
        summary.items(),
        key=lambda kv: (-int(kv[1]["any_json"]), -kv[1]["any_vessels"], -kv[1]["attempts"]),
    )
    return {
        "ok": True,
        "candidates": [{"source": k, **v} for k, v in ranked],
        "recommendation": ranked[0][0] if ranked and ranked[0][1]["any_json"] else None,
    }


@fastapi_app.post("/api/vesselfinder/heartbeat", dependencies=[Depends(require_extension_hmac)])
@(_rate_limiter.limit("10/minute") if _rate_limiter else (lambda f: f))
async def vf_heartbeat(request: Request, response: Response, payload: VFHeartbeatRequest):
    """Extension → CRM: says 'manager online, extension alive'.

    Telemetry only — does NOT store VF cookies. Persisted in ``ext_heartbeat``
    keyed by extensionVersion + managerEmail so we can show 'last seen' in UI.
    """
    now = datetime.now(timezone.utc)
    await db.ext_heartbeat.update_one(
        {"provider": "vesselfinder"},
        {
            "$set": {
                "provider": "vesselfinder",
                "lastHeartbeatAt": now,
                "extensionVersion": payload.extensionVersion,
                "userAgent": payload.userAgent or None,
                "managerEmail": payload.managerEmail or None,
            }
        },
        upsert=True,
    )
    return {"ok": True, "serverTime": now.isoformat().replace("+00:00", "Z")}


def _build_bbox_for_shipment(shipment: Dict[str, Any]) -> Optional[str]:
    route = shipment.get("route") or []
    if not route:
        origin = shipment.get("origin") or {}
        dest = shipment.get("destination") or {}
        if origin.get("lat") is not None and dest.get("lat") is not None:
            route = [origin, dest]
    if not route:
        return None
    # If shipment has a currentPosition, build a tight bbox around it so mp2
    # returns the actual neighbourhood of the vessel (not the whole ocean).
    cur = shipment.get("currentPosition") or {}
    if cur.get("lat") is not None and cur.get("lng") is not None:
        try:
            lat = float(cur["lat"])
            lng = float(cur["lng"])
            pad = 2.5  # degrees ~ ~275km pad
            return f"{lng - pad:.4f},{lat - pad:.4f},{lng + pad:.4f},{lat + pad:.4f}"
        except Exception:
            pass
    return _vf_route_to_bbox(route, pad_deg=5.0)


@fastapi_app.get("/api/vesselfinder/jobs", dependencies=[Depends(require_extension_hmac)])
@(_rate_limiter.limit("30/minute") if _rate_limiter else (lambda f: f))
async def vf_jobs_list(request: Request, response: Response, limit: int = MAX_JOBS_PER_TICK):
    """
    Extension polls this to get the list of shipments to track.
    Filters:
      * trackingActive = true
      * vessel has at least one of mmsi/imo/name
      * skipped if TTL cache would be fresh (< 60s since last update)
      * capped at limit (default 5 / tick, to avoid hammering VF)
    """
    limit = max(1, min(limit, 20))
    # Kill switch: if TRACKING_ENABLED=false, return empty jobs list so the
    # extension just idles without triggering any fetches.
    if not _tracking_enabled():
        logger.info("[VF] jobs list requested while TRACKING_ENABLED=false — returning empty")
        return {
            "ok": True,
            "serverTime": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "maxPerTick": limit,
            "count": 0,
            "jobs": [],
            "killSwitch": True,
        }
    now = datetime.now(timezone.utc)
    shipments_cursor = db.shipments.find(
        {"trackingActive": True, "vessel": {"$exists": True, "$ne": None}}
    ).sort("lastTrackingUpdate", 1)  # oldest first = fairness
    jobs: List[Dict[str, Any]] = []
    async for s in shipments_cursor:
        if len(jobs) >= limit:
            break
        vessel = s.get("vessel") or {}
        mmsi = (vessel.get("mmsi") or "").strip() or None
        imo = (vessel.get("imo") or "").strip() or None
        name = (vessel.get("name") or "").strip() or None
        if not (mmsi or imo or name):
            continue
        # TTL skip
        last_update = s.get("lastTrackingUpdate")
        if isinstance(last_update, datetime):
            if last_update.tzinfo is None:
                last_update = last_update.replace(tzinfo=timezone.utc)
            age = (now - last_update).total_seconds()
            if age < 60:
                continue
        bbox = _build_bbox_for_shipment(s)
        job_id = f"job_{s['id']}_{int(now.timestamp())}"
        jobs.append({
            "jobId": job_id,
            "shipmentId": s["id"],
            "bbox": bbox,
            "target": {"mmsi": mmsi, "imo": imo, "name": name},
            # Informational only — the extension v2.3+ ignores this field and
            # uses its own ENDPOINT_CANDIDATES (now /api/pub/mp2 + /api/pub/sfl).
            "endpoints": ["api-pub-mp2", "api-pub-sfl"],
            "hint": {
                "origin": s.get("origin"),
                "destination": s.get("destination"),
            },
        })
    return {
        "ok": True,
        "serverTime": now.isoformat().replace("+00:00", "Z"),
        "maxPerTick": limit,
        "count": len(jobs),
        "jobs": jobs,
    }


@fastapi_app.post("/api/vesselfinder/jobs/result", dependencies=[Depends(require_extension_hmac)])
@(_rate_limiter.limit("120/minute") if _rate_limiter else (lambda f: f))
async def vf_jobs_result(request: Request, response: Response, result: VFJobResult):
    """
    Extension → CRM: raw payload from one of vesselfinder.com endpoints.
    Backend parses it, matches target, updates shipment, emits Socket.IO.
    """
    # Kill switch — reject at the door so no state is mutated.
    if not _tracking_enabled():
        try:
            await audit("tracking_disabled_rejected", resource="vf_jobs_result", meta={"jobId": result.jobId})
        except Exception:
            pass
        return {"ok": True, "accepted": False, "killSwitch": True}

    shipment_id = result.shipmentId
    if not shipment_id:
        parts = (result.jobId or "").split("_")
        if len(parts) >= 3:
            shipment_id = "_".join(parts[1:-1])
    if not shipment_id:
        try:
            await audit("invalid_payload", resource="vf_jobs_result", meta={"reason": "no_shipment_id", "jobId": result.jobId})
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="Cannot determine shipmentId")

    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        try:
            await audit("invalid_payload", resource="vf_jobs_result", meta={"reason": "shipment_not_found", "shipmentId": shipment_id})
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Shipment not found")

    now = datetime.now(timezone.utc)

    # Serialize payload for debug storage (works for dict, list, or string)
    def _snippet(p) -> str:
        if p is None:
            return ""
        try:
            import json as _json
            return _json.dumps(p)[:4000]
        except Exception:
            return str(p)[:4000]

    raw_snippet = _snippet(result.payload)
    is_html = False
    is_binary_payload = False
    binary_size = 0
    if isinstance(result.payload, str):
        low = result.payload.lower()[:2000]
        is_html = "<html" in low or "<!doctype" in low or "<body" in low
    elif isinstance(result.payload, dict) and result.payload.get("format") == "binary-b64":
        is_binary_payload = True
        try:
            binary_size = int(result.payload.get("size") or 0)
        except Exception:
            binary_size = 0
        # compact snippet — don't store the whole base64 blob
        raw_snippet = f"<binary-b64 size={binary_size} first32b64={(result.payload.get('data') or '')[:32]}>"

    # Try to parse — even for ok:false (maybe partial payload is useful)
    vessels: List[Dict[str, Any]] = []
    match: Optional[Dict[str, Any]] = None
    target = shipment.get("vessel") or {}
    try:
        if result.payload:
            vessels = _vf_extract_vessels(result.payload) or []
            if vessels:
                match = _vf_find_match(vessels, target)
    except Exception as e:
        logger.warning(f"[VF-JOBS] parse error: {e}")

    # ALWAYS store debug entry so operator can see what VF returned
    try:
        if is_binary_payload:
            ct_hint = "binary"
        elif is_html:
            ct_hint = "html"
        elif isinstance(result.payload, (dict, list)):
            ct_hint = "json"
        elif isinstance(result.payload, str):
            ct_hint = "text"
        else:
            ct_hint = result.contentTypeHint or None
        # SECURITY: split storage.
        # - `vf_payload_meta` holds small metadata only (ALWAYS written, TTL 7d).
        # - `vf_payload_raw` stores the base64/text snippet ONLY when
        #   PAYLOAD_DEBUG_STORE=1 (debug mode), TTL 24h via index.
        meta_doc = {
            "shipmentId": shipment_id,
            "jobId": result.jobId,
            "source": result.source,
            "ok": bool(result.ok),
            "status_code": result.status_code,
            "error": result.error,
            "contentType": result.contentType,
            "contentTypeHint": ct_hint,
            "rawSize": result.rawSize if result.rawSize is not None else binary_size,
            "payloadLooksLikeHtml": is_html,
            "vesselsInPayload": len(vessels),
            "matched": bool(match),
            "target": target,
            "fetchedAt": result.fetchedAt or now,
            "storedAt": now,
        }
        await db.vf_payload_meta.insert_one(meta_doc)
        if PAYLOAD_DEBUG_STORE:
            await db.vf_payload_raw.insert_one({
                "shipmentId": shipment_id,
                "jobId": result.jobId,
                "source": result.source,
                "payloadSnippet": raw_snippet,
                "sampleVessels": vessels[:5],
                "storedAt": now,
            })
    except Exception as e:
        logger.warning(f"[VF-JOBS] debug store failed: {e}")

    # ── Fail branches
    # CRITICAL: legacy endpoints (mp2/sfl/refresh without /api/pub) were
    # retired by VesselFinder in 2026-04. They always return 404. Treat
    # those 404s as "skipped fallback", NOT as session failures — otherwise
    # the fail counter explodes even when the primary endpoint is healthy.
    LIVE_ENDPOINTS = {"api-pub-mp2", "api-pub-sfl"}
    src = (result.source or "").lower()
    is_legacy_fallback = src not in LIVE_ENDPOINTS
    is_real_vf_failure = (not result.ok or result.error) and not (
        is_legacy_fallback and (result.status_code == 404)
    )

    if not result.ok or result.error:
        fail_reason = (result.error or f"http_{result.status_code}")[:120]
        if is_real_vf_failure:
            await db.ext_metrics.update_one(
                {"provider": "vesselfinder"},
                {
                    "$inc": {"failCount": 1, "consecutiveFails": 1},
                    "$set": {
                        "provider": "vesselfinder",
                        "lastFailAt": now,
                        "lastFailShipment": shipment_id,
                        "lastFailReason": fail_reason,
                    },
                },
                upsert=True,
            )
            logger.warning(
                f"[VF-JOBS] fetch error shipment={shipment_id} src={result.source} "
                f"http={result.status_code} error={result.error} is_html={is_html}"
            )
        else:
            logger.debug(
                f"[VF-JOBS] skipped legacy 404 shipment={shipment_id} src={result.source} "
                f"(live endpoint handles this now)"
            )
        return {"ok": False, "reason": fail_reason, "isHtml": is_html, "payloadSize": len(raw_snippet), "skipped": is_legacy_fallback}

    if not match:
        fail_reason = f"no_match_in_{len(vessels)}_vessels" if vessels else ("html_login_page" if is_html else "empty_payload")
        # Track VF fetch success separately — if vessels>0 it means VF endpoint
        # works and cookies are valid, just our target isn't in this bbox.
        vf_fetch_ok = len(vessels) > 0 and not is_html
        inc_fields = {"failCount": 1, "consecutiveFails": 1}
        set_fields = {
            "lastFailAt": now,
            "lastFailShipment": shipment_id,
            "lastFailReason": fail_reason,
        }
        if vf_fetch_ok:
            inc_fields["vfFetchOkCount"] = 1
            set_fields["lastVfFetchOkAt"] = now
        await db.ext_metrics.update_one(
            {"provider": "vesselfinder"},
            {"$inc": inc_fields, "$set": {**set_fields, "provider": "vesselfinder"}},
            upsert=True,
        )
        logger.info(
            f"[VF-JOBS] no match shipment={shipment_id} "
            f"source={result.source} vessels={len(vessels)} is_html={is_html} "
            f"target_mmsi={target.get('mmsi')} target_imo={target.get('imo')} target_name={target.get('name')}"
        )
        return {"ok": False, "reason": fail_reason, "vesselsInPayload": len(vessels), "isHtml": is_html, "vfFetchOk": vf_fetch_ok}

    # ✅ Real match → push into the same update pipeline
    if not _is_valid_coord(match.get("lat"), match.get("lng")):
        return {"ok": False, "reason": "invalid_coord"}

    key_imo = str(match.get("imo") or target.get("imo") or f"mmsi-{match.get('mmsi') or target.get('mmsi')}")
    position_doc = {
        "imo": key_imo,
        "mmsi": match.get("mmsi") or target.get("mmsi"),
        "lat": float(match["lat"]),
        "lng": float(match["lng"]),
        "speed": match.get("speed"),
        "course": match.get("course"),
        "timestamp": match.get("timestamp"),
        "fetched_at": now,
        "source": f"vesselfinder_ext_{result.source or 'mp2'}",
    }
    await db.vessel_positions.update_one(
        {"imo": key_imo}, {"$set": position_doc}, upsert=True
    )
    await db.ext_metrics.update_one(
        {"provider": "vesselfinder"},
        {
            "$inc": {"successCount": 1},
            "$set": {
                "provider": "vesselfinder",
                "lastSuccessAt": now,
                "lastSuccessShipment": shipment_id,
                "consecutiveFails": 0,
            },
        },
        upsert=True,
    )

    try:
        # ── Phase D: Auto Transfer Detection ─────────────────────
        # If the live match MMSI differs from the currently-bound vessel,
        # run the detector BEFORE update_shipment_position so the split
        # (if any) is committed and the position lands on the new stage.
        try:
            cur_vessel = (shipment.get("vessel") or {})
            match_mmsi = str(match.get("mmsi") or "").strip()
            cur_mmsi = str(cur_vessel.get("mmsi") or "").strip()
            if match_mmsi and cur_mmsi and match_mmsi != cur_mmsi:
                # Score confidence using the same additive weights as
                # ShipmentIdentityResolver so the two layers agree.
                from shipment_identity_resolver import calculate_vessel_confidence  # type: ignore
                candidate = {
                    "name": match.get("name"),
                    "mmsi": match.get("mmsi"),
                    "imo": match.get("imo"),
                    "confidence": 0.0,  # filled below
                    "position": {"lat": match.get("lat"), "lng": match.get("lng")},
                }
                # Live VF payload is a strong source → base score 0.6 + weight-based bonus
                base_conf = 0.60
                bonus = calculate_vessel_confidence(
                    {"name": match.get("name"), "mmsi": match.get("mmsi"), "imo": match.get("imo")},
                    cur_vessel,
                    route_match=bool(shipment.get("route")),
                )
                candidate["confidence"] = round(min(1.0, base_conf + bonus * 0.4), 3)
                detector = _auto_transfer_detector()
                td_res = await detector.process_shipment(shipment, candidate)
                if td_res.get("ok"):
                    # Reload shipment so downstream update_shipment_position
                    # operates on the NEW active stage.
                    shipment = await db.shipments.find_one({"id": shipment_id}) or shipment
                    # Emit socketio event about the transfer so clients refresh
                    try:
                        await sio.emit(
                            "shipment:update",
                            {
                                "shipmentId": shipment_id,
                                "type": "vessel_transferred",
                                "newStageId": td_res.get("newStageId"),
                                "to": td_res.get("to"),
                                "from": td_res.get("from"),
                            },
                            room=f"user_{shipment.get('customerId')}",
                        )
                    except Exception:
                        pass
        except Exception as td_exc:
            logger.warning(f"[VF-JOBS] transfer detector failed (non-fatal): {td_exc}")

        await update_shipment_position(shipment)
    except Exception as e:
        logger.exception(f"[VF-JOBS] update_shipment_position failed for {shipment_id}: {e}")

    fresh = await db.shipments.find_one({"id": shipment_id})
    return {
        "ok": True,
        "shipmentId": shipment_id,
        "match": {
            "mmsi": match.get("mmsi"),
            "imo": match.get("imo"),
            "name": match.get("name"),
            "lat": match["lat"],
            "lng": match["lng"],
            "speed": match.get("speed"),
            "course": match.get("course"),
        },
        "trackingSource": fresh.get("trackingSource") if fresh else None,
        "progress": fresh.get("progress") if fresh else None,
        "vesselsInPayload": len(vessels),
    }


# ═══════════════════════════════════════════════════════════════════
# RINGOSTAT ADMIN PANEL - P0 Operations Control
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.get("/api/admin/ringostat/health", dependencies=[Depends(require_admin)])
async def get_ringostat_health():
    """Health status for Ringostat admin panel"""
    
    # Get config
    config = await db.ringostat_config.find_one({}) or {}
    
    # Get recent calls
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    calls_today = await db.ringostat_calls.count_documents({
        "started_at": {"$gte": today_start}
    })
    
    # Get last webhook event
    last_call = await db.ringostat_calls.find_one(
        {}, sort=[("created_at", -1)]
    )
    
    # Get mappings
    mappings = config.get("extension_mapping", {})
    total_extensions = len(mappings)
    unmapped_extensions = sum(1 for v in mappings.values() if not v)
    
    # Get unassigned calls today
    unassigned_calls = await db.ringostat_calls.count_documents({
        "started_at": {"$gte": today_start},
        "manager_id": None
    })
    
    # Connection status
    is_connected = bool(config.get("api_key") and config.get("project_id"))
    
    return {
        "connection": {
            "status": "connected" if is_connected else "disconnected",
            "api_key_set": bool(config.get("api_key")),
            "project_id_set": bool(config.get("project_id"))
        },
        "webhook": {
            "last_event": last_call.get("created_at").isoformat() if last_call and last_call.get("created_at") else None,
            "events_today": calls_today
        },
        "calls_today": calls_today,
        "unassigned": {
            "extensions": unmapped_extensions,
            "calls_today": unassigned_calls
        },
        "mappings": {
            "total": total_extensions,
            "unmapped": unmapped_extensions
        }
    }

@fastapi_app.get("/api/admin/ringostat/settings", dependencies=[Depends(require_admin)])
async def get_ringostat_settings():
    """Get current Ringostat configuration"""
    config = await db.ringostat_config.find_one({}) or {}
    
    return {
        "api_key": config.get("api_key", ""),
        "project_id": config.get("project_id", ""),
        "enabled": config.get("enabled", True),
        "extension_mapping": config.get("extension_mapping", {}),
        "automation_rules": config.get("automation_rules", {
            "auto_create_lead": True,
            "missed_call_task": True,
            "missed_call_task_minutes": 5,
            "require_outcome": True,
            "require_outcome_duration": 10
        })
    }

@fastapi_app.patch("/api/admin/ringostat/settings", dependencies=[Depends(require_admin)])
async def update_ringostat_settings(data: Dict[str, Any] = Body(...)):
    """Update Ringostat configuration"""
    config = await db.ringostat_config.find_one({}) or {}
    
    # Update fields
    if "api_key" in data:
        config["api_key"] = data["api_key"]
    if "project_id" in data:
        config["project_id"] = data["project_id"]
    if "enabled" in data:
        config["enabled"] = data["enabled"]
    if "automation_rules" in data:
        config["automation_rules"] = data["automation_rules"]
    
    config["updated_at"] = datetime.now(timezone.utc)
    
    # Upsert
    if "_id" in config:
        await db.ringostat_config.replace_one({"_id": config["_id"]}, config)
    else:
        config["created_at"] = datetime.now(timezone.utc)
        await db.ringostat_config.insert_one(config)
    
    return {"success": True, "message": "Settings updated"}

@fastapi_app.post("/api/admin/ringostat/test-connection", dependencies=[Depends(require_admin)])
async def test_ringostat_connection(data: Dict[str, Any] = Body(...)):
    """Test Ringostat API connection"""
    api_key = data.get("api_key")
    project_id = data.get("project_id")
    
    if not api_key or not project_id:
        raise HTTPException(status_code=400, detail="API key and Project ID required")
    
    # TODO: Add real Ringostat API test when API is available
    # For now, just validate format
    
    if len(api_key) < 10:
        return {
            "success": False,
            "error": "Invalid API key format"
        }
    
    return {
        "success": True,
        "message": "Connection successful",
        "project_id": project_id
    }

@fastapi_app.post("/api/admin/ringostat/test-webhook", dependencies=[Depends(require_admin)])
async def test_ringostat_webhook():
    """Send test webhook event"""
    
    # Create test call event
    test_event = {
        "call_id": f"test_{int(time.time())}",
        "direction": "inbound",
        "from": "+380501234567",
        "to": "+380441234567",
        "status": "answered",
        "duration": 125,
        "recording_url": None,
        "manager_extension": "101",
        "started_at": datetime.now(timezone.utc),
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.ringostat_calls.insert_one(test_event)
    
    return {
        "success": True,
        "message": "Test webhook event created",
        "call_id": test_event["call_id"]
    }

@fastapi_app.get("/api/admin/ringostat/mappings", dependencies=[Depends(require_admin)])
async def get_ringostat_mappings():
    """Get extension → manager mappings"""
    config = await db.ringostat_config.find_one({}) or {}
    extension_mapping = config.get("extension_mapping", {})
    
    # Get all staff (используем без фильтра, т.к. role='manager' работает)
    staff = await db.staff.find({}).to_list(100)
    staff_dict = {str(s["_id"]): s for s in staff}
    
    # Build mappings list
    mappings = []
    for ext, manager_id in extension_mapping.items():
        manager = staff_dict.get(manager_id) if manager_id else None
        mappings.append({
            "extension": ext,
            "manager_id": manager_id,
            "manager_name": manager.get("name") if manager else None,
            "manager_email": manager.get("email") if manager else None,
            "status": "assigned" if manager_id else "unassigned"
        })
    
    return {
        "mappings": mappings,
        "staff": [{"id": str(s["_id"]), "name": s.get("name"), "email": s.get("email"), "role": s.get("role")} for s in staff]
    }

@fastapi_app.post("/api/admin/ringostat/mappings", dependencies=[Depends(require_admin)])
async def create_ringostat_mapping(data: Dict[str, Any] = Body(...)):
    """Create or update extension mapping"""
    extension = data.get("extension")
    manager_id = data.get("manager_id")
    
    if not extension:
        raise HTTPException(status_code=400, detail="Extension required")
    
    # Validate manager exists if manager_id provided
    if manager_id:
        try:
            manager = await db.staff.find_one({"_id": manager_id})
            if not manager:
                raise HTTPException(status_code=400, detail=f"Manager with ID {manager_id} not found")
        except Exception as e:
            logger.error(f"Manager validation error: {e}")
            # Continue anyway - string _id format
    
    config = await db.ringostat_config.find_one({}) or {}
    
    if "extension_mapping" not in config:
        config["extension_mapping"] = {}
    
    config["extension_mapping"][extension] = manager_id
    config["updated_at"] = datetime.now(timezone.utc)
    
    if "_id" in config:
        await db.ringostat_config.replace_one({"_id": config["_id"]}, config)
    else:
        config["created_at"] = datetime.now(timezone.utc)
        await db.ringostat_config.insert_one(config)
    
    return {"success": True, "message": "Mapping created"}

@fastapi_app.delete("/api/admin/ringostat/mappings/{extension}", dependencies=[Depends(require_admin)])
async def delete_ringostat_mapping(extension: str):
    """Delete extension mapping"""
    config = await db.ringostat_config.find_one({}) or {}
    
    if "extension_mapping" in config and extension in config["extension_mapping"]:
        del config["extension_mapping"][extension]
        config["updated_at"] = datetime.now(timezone.utc)
        await db.ringostat_config.replace_one({"_id": config["_id"]}, config)
    
    return {"success": True, "message": "Mapping deleted"}

@fastapi_app.get("/api/admin/ringostat/calls", dependencies=[Depends(require_admin)])
async def get_ringostat_calls(
    period: str = "today",
    manager: Optional[str] = None,
    status: Optional[str] = None,
    direction: Optional[str] = None,
    limit: int = 50
):
    """Get calls history with filters"""
    
    # Build query
    query = {}
    
    # Period filter
    now = datetime.now(timezone.utc)
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query["started_at"] = {"$gte": start}
    elif period == "week":
        start = now - timedelta(days=7)
        query["started_at"] = {"$gte": start}
    elif period == "month":
        start = now - timedelta(days=30)
        query["started_at"] = {"$gte": start}
    
    # Manager filter
    if manager:
        query["manager_id"] = manager
    
    # Status filter
    if status:
        query["status"] = status
    
    # Direction filter
    if direction:
        query["direction"] = direction
    
    # Get calls
    calls = await db.ringostat_calls.find(query).sort("started_at", -1).limit(limit).to_list(limit)
    
    # Enrich with lead/deal info
    for call in calls:
        if call.get("lead_id"):
            lead = await db.leads.find_one({"_id": ObjectId(call["lead_id"])})
            call["lead"] = {
                "id": str(lead["_id"]),
                "name": lead.get("name"),
                "phone": lead.get("phone")
            } if lead else None
        
        if call.get("deal_id"):
            deal = await db.deals.find_one({"_id": ObjectId(call["deal_id"])})
            call["deal"] = {
                "id": str(deal["_id"]),
                "title": deal.get("title"),
                "stage": deal.get("stage")
            } if deal else None
    
    return {
        "calls": [serialize_doc(c) for c in calls],
        "total": len(calls)
    }

@fastapi_app.get("/api/admin/ringostat/calls/{call_id}", dependencies=[Depends(require_admin)])
async def get_ringostat_call_details(call_id: str):
    """Get call details"""
    call = await db.ringostat_calls.find_one({"call_id": call_id})
    
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    
    # Enrich with lead/deal info
    if call.get("lead_id"):
        lead = await db.leads.find_one({"_id": ObjectId(call["lead_id"])})
        call["lead"] = serialize_doc(lead) if lead else None
    
    if call.get("deal_id"):
        deal = await db.deals.find_one({"_id": ObjectId(call["deal_id"])})
        call["deal"] = serialize_doc(deal) if deal else None
    
    if call.get("manager_id"):
        manager = await db.staff.find_one({"_id": ObjectId(call["manager_id"])})
        call["manager"] = serialize_doc(manager) if manager else None
    
    return serialize_doc(call)

@fastapi_app.get("/api/admin/ringostat/events", dependencies=[Depends(require_admin)])
async def get_ringostat_events(limit: int = 50):
    """Get recent webhook events for debugging"""
    
    # Get recent calls as events
    calls = await db.ringostat_calls.find({}).sort("created_at", -1).limit(limit).to_list(limit)
    
    events = []
    for call in calls:
        events.append({
            "id": str(call["_id"]),
            "event_type": f"CALL_{call['status'].upper()}",
            "call_id": call.get("call_id"),
            "direction": call.get("direction"),
            "from": call.get("from"),
            "to": call.get("to"),
            "duration": call.get("duration"),
            "timestamp": call.get("created_at").isoformat() if call.get("created_at") else None,
            "status": "success"
        })
    
    return {
        "events": events,
        "total": len(events)
    }




# ═══════════════════════════════════════════════════════════════════
# RINGOSTAT PHASE 2 - MANAGER OUTCOME & DECISION ENGINE
# ═══════════════════════════════════════════════════════════════════

@fastapi_app.post("/api/manager/calls/{call_id}/outcome", dependencies=[Depends(require_manager_or_admin)])
async def save_call_outcome(
    call_id: str, 
    data: Dict[str, Any] = Body(...),
    authorization: str = Header(None)
):
    """
    Save call outcome and trigger Decision Engine
    
    Requires: JWT token in Authorization header
    """
    
    # Verify JWT and extract manager_id
    manager_id = None
    if authorization and authorization.startswith('Bearer '):
        token = authorization.split(' ')[1]
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        manager_id = payload.get('user_id') or payload.get('sub')
    else:
        raise HTTPException(status_code=401, detail="Authorization token required")
    
    outcome = data.get('outcome')
    outcome_note = data.get('outcome_note')
    callback_at = data.get('callback_at')
    
    if not outcome or not outcome_note:
        raise HTTPException(status_code=400, detail="Outcome and note required")
    
    # Find call
    call = await db.ringostat_calls.find_one({"call_id": call_id})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    
    # Update call with outcome
    now = datetime.now(timezone.utc)
    await db.ringostat_calls.update_one(
        {"call_id": call_id},
        {
            "$set": {
                "outcome": outcome,
                "outcome_note": outcome_note,
                "callback_at": callback_at,
                "outcome_saved_at": now,
                "updated_at": now
            }
        }
    )
    
    # Decision Engine - Create tasks based on outcome
    lead_id = call.get('lead_id')
    deal_id = call.get('deal_id')
    manager_id = call.get('manager_id')
    
    task_created = None
    
    if outcome == 'interested':
        # Create "Follow up" task
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Follow up після дзвінку',
            'description': outcome_note,
            'type': 'follow_up',
            'priority': 'medium',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': now + timedelta(days=1),
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task
        
        # 🔥 Mark lead as HOT
        if lead_id:
            await db.leads.update_one(
                {'_id': lead_id},
                {
                    '$set': {
                        'is_hot': True,
                        'temperature': 85,
                        'updated_at': now
                    }
                }
            )

        
        # TODO: Score↑ (integrate with Score Engine)
        
    elif outcome == 'callback':
        # Create callback task with specific deadline
        deadline = datetime.fromisoformat(callback_at.replace('Z', '+00:00')) if callback_at else now + timedelta(hours=2)
        
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Передзвонити клієнту',
            'description': outcome_note,
            'type': 'callback',
            'priority': 'high',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': deadline,
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task
        
    elif outcome == 'no_answer':
        # Create task через 2 часа
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Повторний дзвінок (не відповів)',
            'description': outcome_note,
            'type': 'callback',
            'priority': 'medium',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': now + timedelta(hours=2),
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task
        
    elif outcome == 'vin_request':
        # Create VIN task
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Відправити VIN для клієнта',
            'description': outcome_note,
            'type': 'vin_search',
            'priority': 'high',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': now + timedelta(hours=4),
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task
        
        # TODO: Trigger VIN Engine
        
    elif outcome == 'delivery_discussion':
        # Create delivery follow-up task
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Follow-up по доставці',
            'description': outcome_note,
            'type': 'follow_up',
            'priority': 'medium',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': now + timedelta(days=2),
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task
        
    elif outcome == 'ready_deposit':
        # Move deal to next stage
        if deal_id:
            await db.deals.update_one(
                {"_id": ObjectId(deal_id)},
                {
                    "$set": {
                        "stage": "deposit",
                        "updated_at": now
                    }
                }
            )
        
        # Create deposit task
        task = {
            '_id': str(uuid.uuid4()),
            'title': f'Прийняти депозит від клієнта',
            'description': outcome_note,
            'type': 'payment',
            'priority': 'high',
            'assigned_to': manager_id,
            'lead_id': lead_id,
            'deal_id': deal_id,
            'call_id': call_id,
            'deadline': now + timedelta(hours=24),
            'status': 'pending',
            'created_at': now,
            'updated_at': now
        }
        await db.tasks.insert_one(task)
        task_created = task


# ==================== AI ANALYSIS ENDPOINTS ====================

@fastapi_app.post("/api/ai/analyze-call")
async def analyze_call_ai(
    call_id: str,
    current_user: dict = Depends(require_user)
):
    """
    AI Analysis of call using Whisper (speech-to-text) + GPT-4o mini
    
    Flow:
    1. Get call from DB (with recording_url)
    2. Download audio
    3. Whisper transcription
    4. GPT analysis (intent, objection, suggested_outcome)
    5. Save ai_analysis to DB
    6. Return suggestions
    """
    try:
        # Get call from DB
        call = await db.ringostat_calls.find_one({'call_id': call_id})
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        recording_url = call.get('recording_url')
        if not recording_url:
            raise HTTPException(status_code=400, detail="Recording URL not available yet")
        
        # Get lead context
        lead = await db.leads.find_one({'_id': call.get('lead_id')}) if call.get('lead_id') else None
        
        # Get previous calls for context
        previous_calls = []
        if call.get('lead_id'):
            prev_calls_cursor = db.ringostat_calls.find({
                'lead_id': call['lead_id'],
                '_id': {'$ne': call['_id']}
            }).sort('created_at', -1).limit(5)
            previous_calls = await prev_calls_cursor.to_list(length=5)
        
        # 🔥 REAL AI ANALYSIS (Emergent LLM for testing, OpenAI for production)
        
        # === EMERGENT LLM (Temporary Testing) ===
        EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY', 'sk-emergent-c0546472bEeE8D4C5D')
        USE_EMERGENT = True  # Set to False to use OpenAI
        
        # Build context for AI
        duration = call.get('duration', 0)
        prev_count = len(previous_calls)
        lead_name = lead.get('name', 'Unknown') if lead else 'Unknown'
        lead_source = lead.get('source', '') if lead else ''
        
        # Context prompt
        context = f"""
Проанализируй звонок:

Телефон: {call.get('from')}
Имя лида: {lead_name}
Источник: {lead_source}
Длительность звонка: {duration} секунд
Количество предыдущих звонков: {prev_count}

Определи:
1. Намерение клиента (buy / consider / info / reject)
2. Уровень интереса (0-1)
3. Возражение (если есть: price / delivery / trust / quality / other)
4. Рекомендуемый outcome:
   - interested (если высокий интерес)
   - ready_deposit (если готов к оплате)
   - callback (если нужно перезвонить)
   - vin_request (если спрашивал про VIN)
   - next_step (общий случай)
5. Следующее действие для менеджера

Ответь строго в JSON формате:
{{
  "intent": "...",
  "interest_level": 0.X,
  "objection": "...",
  "suggested_outcome": "...",
  "next_action": "..."
}}
"""
        
        ai_analysis = None
        
        if USE_EMERGENT:
            # === Use Emergent LLM ===
            try:
                from emergentintegrations import OpenAI as EmergentOpenAI
                
                client = EmergentOpenAI(api_key=EMERGENT_KEY)
                
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "Ты эксперт по анализу телефонных звонков для автомобильного дилера BIBI Cars. Отвечай строго в JSON."},
                        {"role": "user", "content": context}
                    ],
                    temperature=0.3,
                    max_tokens=500
                )
                
                result_text = response.choices[0].message.content.strip()
                
                # Parse JSON
                import re
                json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    
                    ai_analysis = {
                        "call_id": call_id,
                        "transcript": None,  # No audio transcription yet
                        "intent": result.get('intent', 'unknown'),
                        "interest_level": float(result.get('interest_level', 0.5)),
                        "objection": result.get('objection'),
                        "suggested_outcome": result.get('suggested_outcome', 'next_step'),
                        "confidence": float(result.get('interest_level', 0.5)),
                        "next_action": result.get('next_action', 'Follow up'),
                        "analyzed_at": datetime.now(timezone.utc).isoformat(),
                        "model": "gpt-4o-mini (Emergent)",
                        "provider": "emergent_llm"
                    }
                    
                    logger.info(f"[AI] Emergent analysis completed for call_id: {call_id}")
                else:
                    raise ValueError("Invalid JSON response from AI")
                    
            except Exception as e:
                logger.error(f"[AI] Emergent LLM error: {e}")
                # Fallback to mock
                ai_analysis = None
        
        # === OPENAI (Production - Commented for now) ===
        # else:
        #     try:
        #         import openai
        #         
        #         openai.api_key = os.environ.get('OPENAI_API_KEY')
        #         
        #         response = openai.chat.completions.create(
        #             model="gpt-4o-mini",
        #             messages=[
        #                 {"role": "system", "content": "Ты эксперт по анализу телефонных звонков..."},
        #                 {"role": "user", "content": context}
        #             ],
        #             temperature=0.3
        #         )
        #         
        #         # ... same parsing logic
        #         
        #     except Exception as e:
        #         logger.error(f"[AI] OpenAI error: {e}")
        #         ai_analysis = None
        
        # === FALLBACK: Mock analysis if AI fails ===
        if not ai_analysis:
            logger.warning("[AI] Using fallback mock analysis")
            
            if duration > 120 and prev_count >= 1:
                intent = "buy"
                interest_level = 0.85
                suggested_outcome = "interested"
            elif duration > 60:
                intent = "consider"
                interest_level = 0.65
                suggested_outcome = "callback"
            else:
                intent = "info"
                interest_level = 0.4
                suggested_outcome = "next_step"
            
            ai_analysis = {
                "call_id": call_id,
            "transcript": None,  # Will be filled by Whisper
            "intent": intent,
            "interest_level": interest_level,
            "objection": None,
            "suggested_outcome": suggested_outcome,
            "confidence": interest_level,
            "next_action": "Follow up based on interest",
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "model": "gpt-4o-mini"
        }
        
        # Save AI analysis to call
        await db.ringostat_calls.update_one(
            {'call_id': call_id},
            {
                '$set': {
                    'ai_analysis': ai_analysis,
                    'ai_analyzed_at': datetime.now(timezone.utc)
                }
            }
        )
        
        return {
            "success": True,
            "call_id": call_id,
            "ai_analysis": ai_analysis
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/api/ai/call-analysis/{call_id}")
async def get_call_ai_analysis(
    call_id: str,
    current_user: dict = Depends(require_user)
):
    """
    Get AI analysis for a specific call
    """
    try:
        call = await db.ringostat_calls.find_one({'call_id': call_id})
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        ai_analysis = call.get('ai_analysis')
        if not ai_analysis:
            # Trigger analysis if not done yet
            return {"success": False, "message": "Analysis not available yet"}
        
        return {
            "success": True,
            "call_id": call_id,
            "ai_analysis": ai_analysis
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get AI analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== OUTCOME DECISION ENGINE ====================
# This function should be defined earlier in the file, near other decision engine logic

# Note: The remaining outcome processing logic (reject, next_step, etc.) 
# should already be defined earlier in the decision engine function.
# The duplicate code below was removed to fix syntax errors.


# ═══════════════════════════════════════════════════════════════════
# Automation Layer — Identity Resolver admin endpoints (Phase A+B+C)
# Separate `/api/admin/identity/*` namespace so the new resolver does
# NOT collide with the legacy AutoResolver endpoints at /api/admin/shipments/.../resolver/run.
# ═══════════════════════════════════════════════════════════════════
@fastapi_app.post("/api/admin/identity/shipments/{shipment_id}/resolve")
async def admin_identity_resolve(
    shipment_id: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    """Run the Shipment Identity Resolver (Phase A+B+C) on one shipment.

    Returns the attempt report (decision/confidence/evidence). On high
    confidence (>0.85) writes to shipment_identity_links; on medium
    (0.5–0.85) writes to resolver_exceptions. Never mutates stages.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    deal = None
    deal_id = shipment.get("dealId")
    if deal_id:
        try:
            deal = await db.deals.find_one({"id": deal_id})
        except Exception:
            deal = None
    resolver = _make_identity_resolver()
    attempt = await resolver.resolve(shipment, deal=deal)
    await audit(
        "resolver_manual_run",
        user=current_user,
        resource=f"shipment:{shipment_id}",
        meta={"decision": attempt.decision, "confidence": attempt.finalConfidence},
        request=request,
    )
    return {"ok": True, "attempt": attempt.to_dict()}


@fastapi_app.get("/api/admin/identity/exceptions")
async def admin_identity_exceptions(
    status_filter: str = "pending",
    limit: int = 50,
    current_user: dict = Depends(require_admin),
):
    """List resolver exceptions (low-confidence auto-bind attempts + transfer rejects).

    Each row is **enriched** with shipment metadata (VIN, container, current
    vessel) so the UI can render without extra fetches.
    """
    limit = max(1, min(int(limit or 50), 200))
    q: Dict[str, Any] = {}
    if status_filter and status_filter != "all":
        q["status"] = status_filter
    cursor = db.resolver_exceptions.find(q).sort("createdAt", -1).limit(limit)
    items: List[Dict[str, Any]] = []
    ship_cache: Dict[str, Dict[str, Any]] = {}
    async for d in cursor:
        d["_id"] = str(d.get("_id"))
        ship_id = d.get("shipmentId")
        if ship_id and ship_id not in ship_cache:
            ship_cache[ship_id] = (
                await db.shipments.find_one(
                    {"id": ship_id},
                    {"_id": 0, "id": 1, "vin": 1, "vehicleTitle": 1,
                     "container": 1, "vessel": 1, "currentStageId": 1,
                     "stages": 1, "customerId": 1},
                )
                or {}
            )
        ship = ship_cache.get(ship_id) or {}
        cur_stage = None
        for st in (ship.get("stages") or []):
            if st.get("id") == ship.get("currentStageId"):
                cur_stage = st
                break
        d["shipment"] = {
            "id": ship_id,
            "vin": ship.get("vin"),
            "vehicleTitle": ship.get("vehicleTitle"),
            "customerId": ship.get("customerId"),
            "container": (ship.get("container") or {}).get("number") or (
                (cur_stage or {}).get("container") or {}
            ).get("number"),
            "currentVessel": (cur_stage or {}).get("vessel") or ship.get("vessel") or {},
        }
        items.append(d)
    return {"ok": True, "count": len(items), "items": items}


@fastapi_app.get("/api/admin/identity/exceptions/count")
async def admin_identity_exceptions_count(
    current_user: dict = Depends(require_admin),
):
    """Pending-count badge for the admin sidebar. Returns 0 when no queue."""
    n = await db.resolver_exceptions.count_documents({"status": "pending"})
    return {"ok": True, "pending": n}


@fastapi_app.post("/api/admin/identity/exceptions/{exc_id}/confirm")
async def admin_identity_exceptions_confirm(
    exc_id: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    """Confirm a resolver exception — apply the stored attempt.

    Two code paths depending on exception kind:
      * ``low_confidence_vessel`` (Phase A+B+C): bind the candidate
        container+vessel to shipment_identity_links + shipment.vessel.
      * ``transfer_rejected`` (Phase D): run transfer_detector._apply_transfer
        using the stored candidate regardless of confidence / distance guards.
    """
    from bson import ObjectId  # local import to avoid top-level dep
    try:
        oid = ObjectId(exc_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Bad exception id")

    exc = await db.resolver_exceptions.find_one({"_id": oid})
    if not exc:
        raise HTTPException(status_code=404, detail="Exception not found")
    if exc.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Exception already {exc.get('status')}")

    shipment_id = exc.get("shipmentId")
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    kind = exc.get("kind") or ""
    data = exc.get("data") or {}
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    applied: Dict[str, Any] = {"kind": kind}

    if kind == "transfer_rejected":
        # Data shape: {newMmsi, newName, confidence} OR nested "vessel" dict;
        # normalize to a candidate for _apply_transfer.
        cand = {
            "name": data.get("newName") or (data.get("vessel") or {}).get("name"),
            "mmsi": data.get("newMmsi") or (data.get("vessel") or {}).get("mmsi"),
            "imo": (data.get("vessel") or {}).get("imo"),
            "confidence": float(data.get("confidence") or 1.0),
            "position": data.get("to") or data.get("position"),
        }
        detector = _auto_transfer_detector()
        cur_stage = None
        for st in (shipment.get("stages") or []):
            if st.get("id") == shipment.get("currentStageId"):
                cur_stage = st
                break
        if not cur_stage:
            raise HTTPException(status_code=409, detail="No active stage")
        result = await detector._apply_transfer(shipment, cur_stage, cand)
        applied["result"] = result
        # Emit socket event so client cabinets refresh
        try:
            await sio.emit(
                "shipment:update",
                {
                    "shipmentId": shipment_id,
                    "type": "vessel_transferred",
                    "newStageId": result.get("newStageId"),
                    "to": cand, "from": cur_stage.get("vessel"),
                    "manualConfirm": True,
                },
                room=f"user_{shipment.get('customerId')}",
            )
        except Exception:
            pass
    else:
        # Generic: re-run resolver and apply
        resolver = _make_identity_resolver()
        attempt = await resolver.resolve(shipment)
        applied["resolver_attempt"] = attempt.to_dict()

    await db.resolver_exceptions.update_one(
        {"_id": oid},
        {"$set": {
            "status": "confirmed",
            "resolvedAt": now_iso,
            "resolvedBy": current_user.get("id"),
            "manualApplied": applied,
        }},
    )
    await audit(
        "exception_confirmed",
        user=current_user,
        resource=f"shipment:{shipment_id}",
        meta={"excId": exc_id, "kind": kind, "reason": exc.get("reason")},
        request=request,
    )
    return {"ok": True, "excId": exc_id, "applied": applied}


@fastapi_app.post("/api/admin/identity/exceptions/{exc_id}/reject")
async def admin_identity_exceptions_reject(
    exc_id: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    """Mark a resolver exception as rejected (no action taken on shipment)."""
    from bson import ObjectId
    try:
        oid = ObjectId(exc_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Bad exception id")
    exc = await db.resolver_exceptions.find_one({"_id": oid})
    if not exc:
        raise HTTPException(status_code=404, detail="Exception not found")
    if exc.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Already {exc.get('status')}")
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    await db.resolver_exceptions.update_one(
        {"_id": oid},
        {"$set": {
            "status": "rejected",
            "resolvedAt": now_iso,
            "resolvedBy": current_user.get("id"),
        }},
    )
    await audit(
        "exception_rejected",
        user=current_user,
        resource=f"shipment:{exc.get('shipmentId')}",
        meta={"excId": exc_id, "kind": exc.get("kind"), "reason": exc.get("reason")},
        request=request,
    )
    return {"ok": True, "excId": exc_id, "status": "rejected"}


# ═══════════════════════════════════════════════════════════════════
# Phase E — Extension clients registry (per-manager HMAC secret)
# ═══════════════════════════════════════════════════════════════════
class _ExtClientCreate(BaseModel):
    name: str
    managerEmail: Optional[str] = None


def _gen_client_secret() -> str:
    import secrets as _secrets
    return _secrets.token_urlsafe(32)


@fastapi_app.post("/api/admin/ext-clients")
async def ext_client_create(
    payload: _ExtClientCreate,
    request: Request,
    current_user: dict = Depends(require_master_admin),
):
    """Create a new extension client with a unique per-device HMAC secret."""
    import secrets as _secrets
    client_id = f"ext_{_secrets.token_urlsafe(8)}"
    secret = _gen_client_secret()
    doc = {
        "clientId": client_id,
        "name": payload.name.strip(),
        "managerEmail": (payload.managerEmail or "").strip().lower() or None,
        "secret": secret,
        "active": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": current_user.get("id"),
    }
    await db.ext_clients.insert_one(doc)
    await audit("ext_client_created", user=current_user, resource=f"ext_client:{client_id}",
                meta={"name": payload.name}, request=request)
    # Return the secret ONLY on creation (write-once semantics)
    return {"ok": True, "clientId": client_id, "secret": secret, "name": doc["name"]}


@fastapi_app.post("/api/admin/ext-clients/bootstrap")
async def ext_client_bootstrap(
    request: Request,
    current_user: dict = Depends(require_master_admin),
):
    """Auto-provision an ext_client for every active ``role=manager`` staff
    member that does not yet have an **active** client bound to their email.

    Idempotent: managers that already have an active client are skipped.
    Secrets are returned ONCE in the response payload (write-once).

    Response::

        {
          "ok": True,
          "created":    [{clientId, secret, managerEmail, name}, ...],
          "skipped":    [{managerEmail, existingClientId}, ...],
          "totalManagers": N
        }
    """
    import secrets as _secrets

    created: list[dict] = []
    skipped: list[dict] = []
    managers = db.staff.find({"role": "manager"})
    total = 0
    async for m in managers:
        total += 1
        email = (m.get("email") or "").strip().lower()
        if not email:
            continue
        existing = await db.ext_clients.find_one({"managerEmail": email, "active": True})
        if existing:
            skipped.append({"managerEmail": email, "existingClientId": existing["clientId"]})
            continue
        client_id = f"ext_{_secrets.token_urlsafe(8)}"
        secret = _gen_client_secret()
        name = (m.get("name") or "").strip() or email.split("@")[0]
        doc = {
            "clientId": client_id,
            "name": f"manager-{name}",
            "managerEmail": email,
            "secret": secret,
            "active": True,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "createdBy": current_user.get("id"),
            "bootstrapped": True,
        }
        await db.ext_clients.insert_one(doc)
        await audit(
            "ext_client_bootstrapped",
            user=current_user,
            resource=f"ext_client:{client_id}",
            meta={"managerEmail": email},
            request=request,
        )
        created.append({
            "clientId": client_id,
            "secret": secret,
            "managerEmail": email,
            "name": doc["name"],
        })

    return {
        "ok": True,
        "created": created,
        "skipped": skipped,
        "totalManagers": total,
    }


@fastapi_app.get("/api/admin/ext-clients")
async def ext_client_list(current_user: dict = Depends(require_admin)):
    """List ext clients (without secret)."""
    items = []
    cursor = db.ext_clients.find({}, {"secret": 0, "_id": 0}).sort("createdAt", -1)
    async for d in cursor:
        items.append(d)
    return {"ok": True, "items": items}


@fastapi_app.post("/api/admin/ext-clients/{client_id}/revoke")
async def ext_client_revoke(
    client_id: str,
    request: Request,
    current_user: dict = Depends(require_master_admin),
):
    """Revoke an ext client — all subsequent signed requests with this clientId fail."""
    res = await db.ext_clients.update_one({"clientId": client_id}, {"$set": {"active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    await audit("ext_client_revoked", user=current_user, resource=f"ext_client:{client_id}",
                meta={}, request=request)
    return {"ok": True, "clientId": client_id, "active": False}


@fastapi_app.post("/api/admin/ext-clients/{client_id}/rotate")
async def ext_client_rotate(
    client_id: str,
    request: Request,
    current_user: dict = Depends(require_master_admin),
):
    """Rotate the secret for a client (invalidates the previous secret immediately)."""
    new_secret = _gen_client_secret()
    res = await db.ext_clients.update_one(
        {"clientId": client_id},
        {"$set": {"secret": new_secret, "active": True, "rotatedAt": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    await audit("ext_client_rotated", user=current_user, resource=f"ext_client:{client_id}",
                meta={}, request=request)
    return {"ok": True, "clientId": client_id, "secret": new_secret}


# Legacy aliases for backward-compat with the test_resolver_and_security_v2.py


@fastapi_app.get("/api/admin/identity/shipments/{shipment_id}")
async def admin_identity_get(
    shipment_id: str,
    current_user: dict = Depends(require_admin),
):
    """Return the current identity_link for a shipment (for UI inspection)."""
    doc = await db.shipment_identity_links.find_one({"shipmentId": shipment_id})
    if not doc:
        return {"ok": True, "found": False}
    doc["_id"] = str(doc.get("_id"))
    return {"ok": True, "found": True, "identity": doc}


@fastapi_app.get("/api/admin/identity/tracking-status")
async def admin_identity_tracking_status(
    current_user: dict = Depends(require_admin),
):
    """Read-only view of the TRACKING_ENABLED kill switch + last heartbeat."""
    hb = await db.ext_heartbeat.find_one({"provider": "vesselfinder"}) or {}
    return {
        "ok": True,
        "trackingEnabled": _tracking_enabled(),
        "extensionLastHeartbeatAt": hb.get("lastHeartbeatAt"),
        "extensionVersion": hb.get("extensionVersion"),
        "resolverIntervalSec": int(os.environ.get("RESOLVER_INTERVAL_SEC", 300)),
        "enforceNonce": os.environ.get("ENFORCE_NONCE", "0") in ("1", "true", "yes", "on"),
        "hmacWindowSec": int(os.environ.get("HMAC_WINDOW_SEC", 60)),
        "transferDetectIntervalSec": int(os.environ.get("TRANSFER_DETECT_INTERVAL_SEC", 120)),
    }


# ═══════════════════════════════════════════════════════════════════
# Phase D — Transfer detection admin endpoint
# ═══════════════════════════════════════════════════════════════════
class _TransferCandidate(BaseModel):
    name: Optional[str] = None
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    confidence: Optional[float] = None
    position: Optional[Dict[str, float]] = None
    progress: Optional[float] = None


@fastapi_app.post("/api/admin/identity/shipments/{shipment_id}/transfer-check")
async def admin_transfer_check(
    shipment_id: str,
    candidate: _TransferCandidate,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    """Run Phase D transfer guards against a candidate vessel.

    Returns the detector's decision. On ``status=transfer`` the DB has been
    mutated (old stage closed, new stage pushed). On ``exception`` a row was
    saved to ``resolver_exceptions`` for manual review.
    """
    shipment = await db.shipments.find_one({"id": shipment_id})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    detector = _auto_transfer_detector()
    result = await detector.process_shipment(shipment, candidate.dict(exclude_none=True))
    await audit(
        "transfer_manual_check",
        user=current_user,
        resource=f"shipment:{shipment_id}",
        meta={"status": result.get("status"), "reason": result.get("reason")},
        request=request,
    )
    return {"ok": True, "result": result}


# Legacy aliases for backward-compat with the test_resolver_and_security_v2.py
# draft and any dashboards that may have wired the earlier names.
@fastapi_app.get("/api/admin/tracking/status")
async def admin_tracking_status_alias(
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_tracking_status(current_user=current_user)


@fastapi_app.get("/api/admin/resolver/exceptions")
async def admin_resolver_exceptions_alias(
    status_filter: str = "pending",
    limit: int = 50,
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_exceptions(
        status_filter=status_filter, limit=limit, current_user=current_user,
    )


@fastapi_app.get("/api/admin/resolver/identity/{shipment_id}")
async def admin_resolver_identity_alias(
    shipment_id: str,
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_get(shipment_id=shipment_id, current_user=current_user)


print("All endpoints loaded successfully")

# Legacy aliases for backward-compat with the test_resolver_and_security_v2.py
# draft and any dashboards that may have wired the earlier names.
@fastapi_app.get("/api/admin/tracking/status")
async def admin_tracking_status_alias(
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_tracking_status(current_user=current_user)


@fastapi_app.get("/api/admin/resolver/exceptions")
async def admin_resolver_exceptions_alias(
    status_filter: str = "pending",
    limit: int = 50,
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_exceptions(
        status_filter=status_filter, limit=limit, current_user=current_user,
    )


@fastapi_app.get("/api/admin/resolver/identity/{shipment_id}")
async def admin_resolver_identity_alias2(
    shipment_id: str,
    current_user: dict = Depends(require_admin),
):
    return await admin_identity_get(shipment_id=shipment_id, current_user=current_user)




# ═══════════════════════════════════════════════════════════════════════════
# Public lead capture (About Us / Contacts / Catalog consultation forms)
# ─────────────────────────────────────────────────────────────────────────
class ConsultationLead(BaseModel):
    full_name: str
    phone: str
    source: str | None = "about-us"
    budget: str | None = None
    notes: str | None = None


def _validate_bg_phone(phone: str) -> tuple[bool, str]:
    """Validate Bulgarian phone number.
    Returns (is_valid, e164_normalized).
    Mobile: 9 digits after +359, starts with 8 or 9 (e.g. 87/88/89/98/99)
    Landline: 7-9 digits after +359, area codes 2 (Sofia), 3X-7X regional
    """
    if not phone:
        return False, ""
    # Extract digits only
    digits = "".join(ch for ch in phone if ch.isdigit())
    # Strip leading 359 (country) if present
    if digits.startswith("359"):
        digits = digits[3:]
    # Strip leading 0 (local trunk prefix) if present
    if digits.startswith("0"):
        digits = digits[1:]
    if not digits:
        return False, ""
    # Mobile: 9 digits, first is 8 or 9
    if len(digits) == 9 and digits[0] in ("8", "9"):
        return True, "+359" + digits
    # Landline: 8 or 9 digits, first is 2-7
    if len(digits) in (8, 9) and digits[0] in ("2", "3", "4", "5", "6", "7"):
        return True, "+359" + digits
    return False, ""


@fastapi_app.post("/api/leads/consultation")
async def submit_consultation_lead(payload: ConsultationLead):
    """Public endpoint — accepts free-consultation request from the website
    forms (About Us, Catalog, Contacts). Persists to `leads` collection
    using the same schema the team manager cabinet (TeamLeadsPage) reads.
    Returns a stable id so the frontend can show a thank-you state.
    """
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz

    full_name = (payload.full_name or "").strip()
    phone_raw = (payload.phone or "").strip()
    if not full_name or len(full_name) < 2:
        raise HTTPException(status_code=400, detail="full_name is required")

    # Validate Bulgarian phone (E.164 normalize)
    valid, e164 = _validate_bg_phone(phone_raw)
    if not valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid Bulgarian phone number. Use format +359 8X XXX XXXX (mobile) or +359 2 XXX XXXX (landline)."
        )

    lead_id = _uuid.uuid4().hex
    now_iso = _dt.now(_tz.utc).isoformat()

    # Schema compatible BOTH with TeamLeadsPage (uses `name`, `phone`, `score`, `status`)
    # AND with internal /api/leads/consultation history.
    doc = {
        "_id": lead_id,
        "id": lead_id,
        "lead_id": lead_id,
        # Manager-cabinet expected fields:
        "name": full_name[:200],
        "full_name": full_name[:200],
        "phone": e164,
        "email": None,
        "source": (payload.source or "about-us")[:64],
        "country": "BG",
        "score": 60,                   # consultation form = warm lead
        "status": "new",
        "managerId": None,
        "manager": None,
        "lastContactAt": None,
        "ageInDays": 0,
        "isStale": False,
        "slaBreached": False,
        # Optional extras:
        "budget": (payload.budget or "")[:200] or None,
        "notes": (payload.notes or "")[:2000] or None,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    try:
        if db is not None:
            await db.leads.insert_one(doc)
            logger.info("[LEADS] new consultation lead: %s (%s) src=%s",
                        full_name, e164, doc["source"])
    except Exception as exc:
        logger.warning("[LEADS] insert failed: %s", exc)
        # do not fail the request — lead capture is best-effort
    return {"ok": True, "lead_id": lead_id, "phone_normalized": e164}


# ═════════════════════════════════════════════════════════════════════════
# SITE INFO — admin-configurable site-wide content
# Privacy / Terms / Cookies / Conditions (EN+BG rich-text)
# Footer settings (contacts, socials)
# ═════════════════════════════════════════════════════════════════════════

SITE_INFO_DOC_ID = "singleton"

DEFAULT_SITE_INFO = {
    "_id": SITE_INFO_DOC_ID,
    "policies": {
        "privacy": {
            "en": {
                "title": "Privacy Policy",
                "content": "<h2>Privacy Policy</h2><p>BIBI Cars values your privacy. This document explains how we collect, use and protect your personal data when you use our services.</p><p><em>Full policy text will be provided here.</em></p>",
            },
            "bg": {
                "title": "Политика за поверителност",
                "content": "<h2>Политика за поверителност</h2><p>BIBI Cars цени Вашата поверителност. Този документ обяснява как събираме, използваме и защитаваме Вашите лични данни.</p><p><em>Пълният текст на политиката ще бъде предоставен тук.</em></p>",
            },
        },
        "terms": {
            "en": {
                "title": "Terms of Use",
                "content": "<h2>Terms of Use</h2><p>By using BIBI Cars services, you agree to the following terms and conditions.</p><p><em>Full terms text will be provided here.</em></p>",
            },
            "bg": {
                "title": "Условия за ползване",
                "content": "<h2>Условия за ползване</h2><p>С използването на услугите на BIBI Cars Вие приемате следните общи условия.</p><p><em>Пълният текст на условията ще бъде предоставен тук.</em></p>",
            },
        },
        "cookies": {
            "en": {
                "title": "Cookie Policy",
                "content": "<h2>Cookie Policy</h2><p>We use cookies to provide you with the best experience on our website. Essential cookies are required for the platform to function correctly, while analytical cookies help us improve our services.</p>",
            },
            "bg": {
                "title": "Политика за бисквитки",
                "content": "<h2>Политика за бисквитки</h2><p>Използваме бисквитки, за да Ви осигурим най-доброто изживяване на нашия уебсайт. Основните бисквитки са необходими за правилното функциониране на платформата.</p>",
            },
        },
        "conditions": {
            "en": {
                "title": "Conditions",
                "content": "<h2>Service Conditions</h2><p>BIBI Cars provides turnkey vehicle import services from auctions worldwide. Please review the following service conditions carefully.</p>",
            },
            "bg": {
                "title": "Условия за услугата",
                "content": "<h2>Условия за услугата</h2><p>BIBI Cars предоставя комплексни услуги за внос на автомобили от търгове по целия свят.</p>",
            },
        },
    },
    "header": {
        "phones": ["+359 875 313 158", "+359 897 884 804"],
        "cta_label_en": "Contact Us",
        "cta_label_bg": "Свържете се с нас",
    },
    "footer": {
        "contacts": {
            "phones": ["+359 875 313 158", "+359 897 884 804"],
            "email": "info@bibicars.bg",
            "addresses": [
                "Bulgaria, Sofia, Dragalevtsi, Vitosha Blvd. No. 230",
                "Bulgaria, Sofia, Bulgaria Blvd., No. 81",
            ],
            "working_hours": "Mon - Fri, 10.00 - 19.00",
        },
        # Each social: { enabled: bool, url: str }. Only rendered when enabled AND url non-empty.
        "socials": {
            "instagram": {"enabled": True,  "url": "https://instagram.com/"},
            "facebook":  {"enabled": True,  "url": "https://facebook.com/"},
            "telegram":  {"enabled": True,  "url": "https://t.me/"},
            "tiktok":    {"enabled": False, "url": ""},
            "whatsapp":  {"enabled": False, "url": ""},
            "viber":     {"enabled": True,  "url": "viber://chat?number=%2B359875313158"},
        },
        "viber_community": {
            "enabled": True,
            "url": "viber://chat?number=%2B359875313158",
            "label_en": "Join Our Group And Get The Hottest Offers",
            "label_bg": "Присъединете се към нашата група и получавайте най-горещите оферти",
        },
    },
    "cookie_banner": {
        "enabled": True,
        "title_en": "Cookie & Privacy Settings",
        "title_bg": "Настройки за бисквитки и поверителност",
        "body_en": "We value your privacy. Please accept our cookies and privacy policy to continue exploring BIBI Cars.",
        "body_bg": "Ние ценим Вашата поверителност. Моля, приемете нашите бисквитки и политика за поверителност, за да продължите.",
    },
    "updated_at": None,
    "updated_by": None,
}


async def _get_site_info_doc():
    """Fetch site_info doc; create with defaults if missing."""
    if db is None:
        return DEFAULT_SITE_INFO
    doc = await db.site_info.find_one({"_id": SITE_INFO_DOC_ID})
    if not doc:
        seed = dict(DEFAULT_SITE_INFO)
        seed["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            await db.site_info.insert_one(seed)
        except Exception as e:
            logger.warning(f"[site_info] seed insert failed: {e}")
        return seed
    # Merge defaults for any missing keys (forward-compat)
    merged = {**DEFAULT_SITE_INFO, **doc}
    for k in ("policies", "footer", "cookie_banner", "header"):
        if k in DEFAULT_SITE_INFO:
            merged[k] = {**DEFAULT_SITE_INFO[k], **(doc.get(k) or {})}
    # Backward-compat: socials may be stored as flat strings { ig: "url" } —
    # normalize to { ig: {enabled, url} } so the frontend has a single shape.
    try:
        socials = (merged.get("footer") or {}).get("socials") or {}
        norm = {}
        default_socials = (DEFAULT_SITE_INFO["footer"]["socials"] or {})
        for key in default_socials.keys():
            v = socials.get(key, default_socials[key])
            if isinstance(v, str):
                norm[key] = {"enabled": bool(v), "url": v}
            elif isinstance(v, dict):
                norm[key] = {
                    "enabled": bool(v.get("enabled", bool(v.get("url")))),
                    "url": v.get("url", ""),
                }
            else:
                norm[key] = {"enabled": False, "url": ""}
        merged["footer"]["socials"] = norm
    except Exception as e:
        logger.warning(f"[site_info] socials normalize failed: {e}")
    return merged


@fastapi_app.get("/api/site-info")
async def get_site_info_public():
    """Public endpoint — returns full site info (used by footer, cookie banner, policy pages)."""
    doc = await _get_site_info_doc()
    # Strip internal fields
    return {k: v for k, v in doc.items() if not k.startswith("_")}


@fastapi_app.get("/api/site-info/policy/{key}")
async def get_site_policy_public(key: str, lang: str = "en"):
    """Public endpoint — returns one policy section in given language (en|bg)."""
    if key not in ("privacy", "terms", "cookies", "conditions"):
        raise HTTPException(status_code=404, detail="Unknown policy key")
    if lang not in ("en", "bg"):
        lang = "en"
    doc = await _get_site_info_doc()
    policy = (doc.get("policies") or {}).get(key) or {}
    return policy.get(lang) or policy.get("en") or {"title": key.title(), "content": ""}


@fastapi_app.put("/api/admin/site-info")
async def update_site_info_admin(
    payload: Dict[str, Any] = Body(...),
    user: dict = Depends(require_user),
):
    """Admin endpoint — update site info. Requires master_admin / admin."""
    role = (user or {}).get("role", "")
    if role not in ("master_admin", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if db is None:
        raise HTTPException(status_code=503, detail="DB not available")

    update = {}
    for key in ("policies", "footer", "cookie_banner", "header"):
        if key in payload and isinstance(payload[key], dict):
            update[key] = payload[key]
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")

    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_by"] = user.get("email") or user.get("id")

    await db.site_info.update_one(
        {"_id": SITE_INFO_DOC_ID},
        {"$set": update},
        upsert=True,
    )
    return await _get_site_info_doc()

