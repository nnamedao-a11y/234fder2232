"""
Bid.Cars Cookie Proxy System
Автоматический парсинг через сохраненные cookies - без Playwright, мгновенно
"""

import httpx
import asyncio
from typing import Optional, Dict, List, Any
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup
import re
import logging

logger = logging.getLogger(__name__)


class BidCarsCookieProxy:
    """
    Cookie-based parser for bid.cars
    Works with cookies imported from Chrome Extension
    No Playwright needed - instant HTTP requests
    """
    
    BASE_URL = "https://bid.cars"
    
    def __init__(self, db):
        self.db = db
        self._cookies = None
        self._cookies_loaded_at = None
    
    async def get_active_session(self) -> Optional[Dict]:
        """Get active cookie session from database"""
        session = await self.db.bidcars_sessions.find_one(
            {"status": "active"},
            {"_id": 0},
            sort=[("imported_at", -1)]
        )
        return session
    
    async def import_cookies(self, cookies: List[Dict], user_agent: str = None) -> Dict:
        """
        Import cookies from Chrome Extension
        Called once - then works automatically
        """
        # Extract important cookies
        cf_clearance = None
        cf_bm = None
        session_cookie = None
        
        for cookie in cookies:
            name = cookie.get("name", "")
            if name == "cf_clearance":
                cf_clearance = cookie.get("value")
            elif name == "_cf_bm":
                cf_bm = cookie.get("value")
            elif name == "bidcars_session":
                session_cookie = cookie.get("value")
        
        if not cf_clearance:
            return {"success": False, "error": "cf_clearance cookie not found"}
        
        # Deactivate old sessions
        await self.db.bidcars_sessions.update_many(
            {"status": "active"},
            {"$set": {"status": "replaced"}}
        )
        
        # Save new session
        session = {
            "cf_clearance": cf_clearance,
            "cf_bm": cf_bm,
            "bidcars_session": session_cookie,
            "user_agent": user_agent or "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "all_cookies": cookies,
            "status": "active",
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "requests_count": 0,
            "last_used": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        }
        
        await self.db.bidcars_sessions.insert_one(session)
        session.pop("_id", None)
        
        # Test the session
        test_result = await self.test_session()
        session["test_result"] = test_result
        
        return {
            "success": True,
            "message": "Cookies imported successfully! Auto-parsing enabled.",
            "session": session
        }
    
    async def _get_http_client(self) -> Optional[httpx.AsyncClient]:
        """Create HTTP client with saved cookies"""
        session = await self.get_active_session()
        if not session:
            return None
        
        cookies = httpx.Cookies()
        cookies.set("cf_clearance", session["cf_clearance"], domain=".bid.cars")
        if session.get("cf_bm"):
            cookies.set("_cf_bm", session["cf_bm"], domain=".bid.cars")
        if session.get("bidcars_session"):
            cookies.set("bidcars_session", session["bidcars_session"], domain="bid.cars")
        
        headers = {
            "User-Agent": session.get("user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        }
        
        return httpx.AsyncClient(
            cookies=cookies,
            headers=headers,
            timeout=30.0,
            follow_redirects=True
        )
    
    async def test_session(self) -> Dict:
        """Test if cookies are still valid"""
        client = await self._get_http_client()
        if not client:
            return {"valid": False, "error": "No active session"}
        
        try:
            async with client:
                response = await client.get(f"{self.BASE_URL}/en/")
                
                if response.status_code == 200:
                    content = response.text
                    # Check if we got real content or Cloudflare challenge
                    if "cf-challenge" in content.lower() or "just a moment" in content.lower():
                        return {"valid": False, "error": "Cloudflare challenge - cookies expired"}
                    
                    if "bid.cars" in content and "item-box" in content or "automobile" in content:
                        return {"valid": True, "message": "Session is active"}
                    
                    return {"valid": True, "message": "Session appears active"}
                else:
                    return {"valid": False, "error": f"HTTP {response.status_code}"}
                    
        except Exception as e:
            return {"valid": False, "error": str(e)}
    
    async def fetch_page(self, url: str) -> Optional[str]:
        """Fetch page using saved cookies"""
        client = await self._get_http_client()
        if not client:
            logger.warning("[BIDCARS] No active session - cookies needed")
            return None
        
        try:
            async with client:
                response = await client.get(url)
                
                # Update session stats
                await self.db.bidcars_sessions.update_one(
                    {"status": "active"},
                    {
                        "$inc": {"requests_count": 1},
                        "$set": {"last_used": datetime.now(timezone.utc).isoformat()}
                    }
                )
                
                if response.status_code == 200:
                    content = response.text
                    
                    # Check for Cloudflare challenge
                    if "cf-challenge" in content.lower() or "just a moment" in content.lower():
                        logger.warning("[BIDCARS] Cloudflare challenge - cookies expired")
                        await self.db.bidcars_sessions.update_one(
                            {"status": "active"},
                            {"$set": {"status": "expired"}}
                        )
                        return None
                    
                    return content
                else:
                    logger.error(f"[BIDCARS] HTTP {response.status_code}")
                    return None
                    
        except Exception as e:
            logger.error(f"[BIDCARS] Fetch error: {e}")
            return None
    
    def parse_lot_page(self, html: str) -> Dict[str, Any]:
        """Parse vehicle data from lot page HTML"""
        soup = BeautifulSoup(html, 'lxml')
        
        data = {
            "source": "bid.cars",
            "parsed_at": datetime.utcnow().isoformat(),
            "parse_method": "cookie_proxy"
        }
        
        # VIN
        vin_el = soup.select_one('.vin_lot.copy-vin, h1.vin_lot, .copy-vin')
        if vin_el:
            data["vin"] = vin_el.get_text(strip=True)
        
        # Lot ID  
        lot_el = soup.select_one('.vin_lot.copy-lot, span.copy-lot, .copy-lot')
        if lot_el:
            data["lot_id"] = lot_el.get_text(strip=True)
        
        # Title
        title_el = soup.select_one('.title_lot, h2.title_lot, h1.title_lot')
        if title_el:
            data["title"] = title_el.get_text(strip=True)
            match = re.match(r'(\d{4})\s+(.+)', data["title"])
            if match:
                data["year"] = int(match.group(1))
                data["make_model"] = match.group(2)
        
        # Auction source
        auction_el = soup.select_one('.auction-label, a.auction-label')
        if auction_el:
            data["auction"] = auction_el.get_text(strip=True)
            data["auction_url"] = auction_el.get('href')
        
        # Current bid
        bid_el = soup.select_one('.current_bid, .price-current')
        if bid_el:
            text = bid_el.get_text(strip=True)
            match = re.search(r'\$([\d,]+)', text)
            if match:
                data["current_bid"] = int(match.group(1).replace(',', ''))
        
        # Buy Now price
        buy_now_el = soup.select_one('.buy-now-price')
        if buy_now_el:
            text = buy_now_el.get_text(strip=True)
            match = re.search(r'\$([\d,]+)', text)
            if match:
                data["buy_now"] = int(match.group(1).replace(',', ''))
        
        # Location & other info from list items
        for li in soup.select('li'):
            text = li.get_text(strip=True)
            if 'Location:' in text:
                data["location"] = text.replace('Location:', '').strip()
            elif 'Shipping from:' in text:
                data["shipping_terminal"] = text.replace('Shipping from:', '').strip()
            elif 'Seller:' in text:
                data["seller"] = text.replace('Seller:', '').strip()
            elif 'Sale Document:' in text:
                data["document_type"] = text.replace('Sale Document:', '').strip()
        
        # Auction date
        countdown = soup.select_one('[data-countdown-bn]')
        if countdown:
            data["auction_date"] = countdown.get('data-countdown-bn')
        
        # Damage & specs from options
        for opt in soup.select('.option'):
            text = opt.get_text(strip=True)
            value_el = opt.select_one('.right-info')
            if value_el:
                value = value_el.get_text(strip=True)
                text_lower = text.lower()
                
                if 'primary damage' in text_lower:
                    data["primary_damage"] = value
                elif 'secondary damage' in text_lower:
                    data["secondary_damage"] = value
                elif 'odometer' in text_lower:
                    data["odometer"] = value
                    match = re.search(r'([\d,]+)', value)
                    if match:
                        data["odometer_value"] = int(match.group(1).replace(',', ''))
                elif 'key' in text_lower:
                    data["keys"] = value
                elif 'acv' in text_lower or 'erc' in text_lower:
                    data["acv_erc"] = value
                elif 'exterior color' in text_lower or 'color' in text_lower:
                    data["exterior_color"] = value
                elif 'transmission' in text_lower:
                    data["transmission"] = value
                elif 'engine' in text_lower:
                    data["engine"] = value
                elif 'fuel' in text_lower:
                    data["fuel"] = value
                elif 'drive' in text_lower:
                    data["drivetrain"] = value
        
        # Images
        images = []
        for img in soup.select('img[src*="bid.cars"], img[data-src*="bid.cars"]'):
            src = img.get('src') or img.get('data-src')
            if src and src not in images:
                images.append(src)
        
        for el in soup.select('[data-thumb-src]'):
            thumb = el.get('data-thumb-src')
            if thumb and thumb not in images:
                images.append(thumb)
        
        data["images"] = images[:20]  # Limit to 20 images
        data["images_count"] = len(images)
        
        # Calculator prices
        for el_id, key in [
            ('#final-in-currency', 'estimated_total_eur'),
            ('#lot-price', 'lot_price'),
            ('#auction-fees', 'auction_fees'),
            ('#shipping-cost', 'shipping_cost')
        ]:
            el = soup.select_one(el_id)
            if el:
                data[key] = el.get_text(strip=True)
        
        return data
    
    async def parse_lot(self, url: str) -> Optional[Dict[str, Any]]:
        """Parse a lot page and return structured data"""
        html = await self.fetch_page(url)
        if not html:
            return None
        
        data = self.parse_lot_page(html)
        
        # Only return if we got meaningful data
        if data.get("vin") or data.get("title") or data.get("lot_id"):
            data["_source_url"] = url
            return data
        
        return None
    
    async def parse_and_save(self, url: str) -> Dict:
        """Parse lot and save to database"""
        data = await self.parse_lot(url)
        
        if not data:
            return {"success": False, "error": "Failed to parse - check if cookies are valid"}
        
        # Save to database
        if data.get("vin"):
            data["_parsed_url"] = url
            await self.db.bidcars_vehicles.update_one(
                {"vin": data["vin"]},
                {
                    "$set": data,
                    "$setOnInsert": {"first_seen": datetime.now(timezone.utc).isoformat()}
                },
                upsert=True
            )
        
        return {"success": True, "data": data}
    
    async def get_session_status(self) -> Dict:
        """Get current session status"""
        session = await self.get_active_session()
        
        if not session:
            return {
                "active": False,
                "message": "No active session. Import cookies from Chrome Extension."
            }
        
        # Test validity
        test = await self.test_session()
        
        return {
            "active": test.get("valid", False),
            "imported_at": session.get("imported_at"),
            "expires_at": session.get("expires_at"),
            "requests_count": session.get("requests_count", 0),
            "last_used": session.get("last_used"),
            "test_result": test
        }
