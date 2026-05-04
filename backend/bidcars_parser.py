"""
Bid.Cars HTML Scraper with Playwright Stealth
Handles Cloudflare protection via headless browser with stealth mode
"""

import os
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = '/pw-browsers'

import asyncio
import re
from typing import Optional, Dict, List, Any
from datetime import datetime
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Browser, Page
from playwright_stealth import Stealth
import logging

logger = logging.getLogger(__name__)


class BidCarsParser:
    """HTML Scraper for bid.cars using Playwright with Stealth"""
    
    BASE_URL = "https://bid.cars"
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.playwright = None
    
    async def __aenter__(self):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1920,1080',
                '--start-maximized',
            ]
        )
        self.stealth = Stealth()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
    
    async def fetch_page(self, url: str, wait_selector: str = None) -> Optional[str]:
        """Fetch HTML content using Playwright with stealth"""
        context = None
        page = None
        try:
            context = await self.browser.new_context(
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                locale='en-US',
                timezone_id='America/New_York',
            )
            page = await context.new_page()
            
            # Apply stealth mode
            await self.stealth.apply_stealth_async(page)
            
            # Set extra headers
            await page.set_extra_http_headers({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            })
            
            # Navigate
            response = await page.goto(url, wait_until='domcontentloaded', timeout=25000)
            
            # Wait for page to stabilize
            await page.wait_for_timeout(2000)
            
            # Check if we hit Cloudflare challenge
            content = await page.content()
            if 'cf-challenge' in content.lower() or 'just a moment' in content.lower():
                logger.warning("Cloudflare challenge detected, waiting...")
                await page.wait_for_timeout(5000)
                content = await page.content()
            
            # Additional wait for selector if specified
            if wait_selector:
                try:
                    await page.wait_for_selector(wait_selector, timeout=5000)
                except:
                    pass
            
            return content
            
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None
        finally:
            if page:
                await page.close()
            if context:
                await context.close()
    
    def parse_lot_page(self, html: str) -> Dict[str, Any]:
        """Parse single lot page"""
        soup = BeautifulSoup(html, 'lxml')
        
        data = {
            "source": "bid.cars",
            "parsed_at": datetime.utcnow().isoformat()
        }
        
        # VIN
        vin_el = soup.select_one('.vin_lot.copy-vin, h1.vin_lot')
        if vin_el:
            data["vin"] = vin_el.get_text(strip=True)
        
        # Lot ID
        lot_el = soup.select_one('.vin_lot.copy-lot, span.copy-lot')
        if lot_el:
            data["lot_id"] = lot_el.get_text(strip=True)
        
        # Title
        title_el = soup.select_one('.title_lot, h2.title_lot')
        if title_el:
            data["title"] = title_el.get_text(strip=True)
            match = re.match(r'(\d{4})\s+(.+)', data["title"])
            if match:
                data["year"] = int(match.group(1))
                data["make_model"] = match.group(2)
        
        # Auction
        auction_el = soup.select_one('.auction-label')
        if auction_el:
            data["auction"] = auction_el.get_text(strip=True)
            data["auction_url"] = auction_el.get('href')
        
        # Current bid
        bid_el = soup.select_one('.current_bid')
        if bid_el:
            text = bid_el.get_text(strip=True)
            match = re.search(r'\$([\d,]+)', text)
            if match:
                data["current_bid"] = int(match.group(1).replace(',', ''))
                data["current_bid_formatted"] = text
        
        # Location info
        for li in soup.select('li.location, li.terminal, li.seller_header, li.doc_header'):
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
        
        # Secondary info (damages, odometer)
        for opt in soup.select('#secondary-info .option'):
            text = opt.get_text(strip=True)
            value_el = opt.select_one('.right-info')
            if value_el:
                value = value_el.get_text(strip=True)
                if 'Primary damage' in text:
                    data["primary_damage"] = value
                elif 'Secondary damage' in text:
                    data["secondary_damage"] = value
                elif 'Odometer' in text:
                    data["odometer"] = value
                    match = re.search(r'([\d,]+)', value)
                    if match:
                        data["odometer_value"] = int(match.group(1).replace(',', ''))
                elif 'Key' in text:
                    data["keys"] = value
                elif 'ACV' in text or 'ERC' in text:
                    data["acv_erc"] = value
        
        # Specs
        for spec in soup.select('#tertiary-info .option'):
            text = spec.get_text(strip=True)
            value_el = spec.select_one('.right-info')
            if value_el:
                value = value_el.get_text(strip=True)
                if 'Exterior color' in text:
                    data["exterior_color"] = value
                elif 'Transmission' in text:
                    data["transmission"] = value
        
        # Images
        images = []
        for img in soup.select('.f-carousel__slide img, .carousel-item img'):
            src = img.get('src')
            if src and 'bid.cars' in src:
                images.append(src)
        
        for el in soup.select('[data-thumb-src]'):
            thumb = el.get('data-thumb-src')
            if thumb and thumb not in images:
                images.append(thumb)
        
        data["images"] = images
        data["images_count"] = len(images)
        
        # Prices from calculator
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
    
    def parse_search_page(self, html: str) -> List[Dict[str, Any]]:
        """Parse search results"""
        soup = BeautifulSoup(html, 'lxml')
        lots = []
        
        for box in soup.select('.item-box'):
            lot = {}
            
            name_link = box.select_one('.item-name a')
            if name_link:
                lot["title"] = name_link.get_text(strip=True)
                href = name_link.get('href')
                if href:
                    lot["url"] = href if href.startswith('http') else self.BASE_URL + href
                    match = re.search(r'/lot/([^/]+)/', href)
                    if match:
                        lot["lot_id"] = match.group(1)
            
            auction_span = box.select_one('.copart, .iaai')
            if auction_span:
                lot["auction"] = auction_span.get_text(strip=True)
            
            status_span = box.select_one('.open, .finished')
            if status_span:
                lot["status"] = status_span.get_text(strip=True)
            
            price_box = box.select_one('.price-box')
            if price_box:
                text = price_box.get_text(strip=True)
                lot["price_info"] = text
                
                for pattern, key in [
                    (r'Current[^$]*\$([\d,]+)', 'current_bid'),
                    (r'Buy Now[^$]*\$([\d,]+)', 'buy_now'),
                    (r'Final[^$]*\$([\d,]+)', 'final_bid')
                ]:
                    match = re.search(pattern, text)
                    if match:
                        lot[key] = int(match.group(1).replace(',', ''))
            
            countdown = box.select_one('[data-countdown-bn]')
            if countdown:
                lot["auction_date"] = countdown.get('data-countdown-bn')
            
            img = box.select_one('.carousel-item img, img.carousel-item')
            if img:
                lot["thumbnail"] = img.get('src')
            
            if lot.get("url"):
                lots.append(lot)
        
        return lots
    
    async def get_lot(self, lot_url: str) -> Optional[Dict[str, Any]]:
        """Get full lot details"""
        html = await self.fetch_page(lot_url, wait_selector='.title_lot')
        if html:
            data = self.parse_lot_page(html)
            # Only return if we got meaningful data
            if data.get("vin") or data.get("title"):
                return data
        return None
    
    async def search(self, make: str = "All", year_from: int = None, year_to: int = None, page: int = 1) -> List[Dict[str, Any]]:
        """Search vehicles"""
        url = f"{self.BASE_URL}/en/search/results?search-type=filters&status=All&type=Automobile"
        url += f"&make={make}&model=All"
        if year_from:
            url += f"&year-from={year_from}"
        if year_to:
            url += f"&year-to={year_to}"
        url += "&auction-type=All"
        
        html = await self.fetch_page(url, wait_selector='.item-box')
        if html:
            return self.parse_search_page(html)
        return []
    
    async def browse_make(self, make: str, page: int = 1) -> List[Dict[str, Any]]:
        """Browse by make"""
        url = f"{self.BASE_URL}/en/automobile/{make.lower()}/page/{page}"
        html = await self.fetch_page(url, wait_selector='.item-box')
        if html:
            return self.parse_search_page(html)
        return []


async def test_parser():
    """Test the parser"""
    print("Testing BidCars Parser with Stealth...")
    
    async with BidCarsParser() as parser:
        print("\n1. Testing lot page...")
        data = await parser.get_lot("https://bid.cars/en/lot/0-44515368/1981-Datsun-280ZX-JN1HZ04S8BX265704")
        if data:
            print(f"   VIN: {data.get('vin')}")
            print(f"   Title: {data.get('title')}")
            print(f"   Price: ${data.get('current_bid')}")
            print(f"   Images: {data.get('images_count')}")
        else:
            print("   Failed to parse lot")
    
    print("\n✅ Test complete!")


if __name__ == "__main__":
    asyncio.run(test_parser())
