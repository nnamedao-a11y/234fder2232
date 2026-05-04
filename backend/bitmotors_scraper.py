"""
BidMotors Adapter — Faithful port from NestJS BidMotorsAdapter v2
=================================================================
Source: backend/src/modules/vin/adapters/bidmotors.adapter.ts

Flow:
  1. Search → find detail URL (sitemap first, then search page)
  2. Fetch detail page
  3. Parse ALL fields (Bulgarian + English labels)
  4. Normalize
  5. Quality score

Also includes autonomous catalogue scraper for continuous data ingestion.
"""
import asyncio
import re
import logging
import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from bs4 import BeautifulSoup
import httpx

logger = logging.getLogger("bitmotors")

# ═══════════════════════════════════════════════════════════════════
# PARSER UTILS (port from utils/parser.utils.ts)
# ═══════════════════════════════════════════════════════════════════

VIN_RE = re.compile(r'[A-HJ-NPR-Z0-9]{17}')
LOT_PATTERNS = [
    re.compile(r'[Ll]ot\s*[#:№]?\s*(\d{6,10})'),
    re.compile(r'[Ss]tock\s*[#:№]?\s*(\d{6,10})'),
    re.compile(r'№\s*(\d{6,10})'),
]

def clean(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    s = re.sub(r'\s+', ' ', v).strip()
    return s or None

def extract_number(v: Optional[str]) -> Optional[int]:
    if not v:
        return None
    n = re.sub(r'[^\d]', '', v)
    return int(n) if n else None

def extract_vin(text: str) -> Optional[str]:
    m = VIN_RE.search(text.upper())
    return m.group(0) if m else None

def extract_lot(text: str) -> Optional[str]:
    for pat in LOT_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    return None

def extract_year(text: str) -> Optional[int]:
    m = re.search(r'\b(19[89]\d|20[0-3]\d)\b', text)
    if m:
        year = int(m.group(1))
        if 1980 <= year <= 2030:
            return year
    return None

def extract_images(html: str, soup=None) -> List[str]:
    """Extract images for the CURRENT vehicle only.

    BidMotors detail pages contain a "similar cars" / "special offer" carousel
    at the bottom that includes 5-15 unrelated cars' photos. If we run regex
    on the raw HTML we'll often pick the FIRST IAAI imageKey we see, which
    belongs to a "popular cars" entry — not our target VIN. To avoid this,
    we narrow the scope to the main car-content sections only.
    """
    images: List[str] = []
    seen = set()

    # Build a scoped HTML string limited to "our" sections only.
    # Fall back to the full HTML if BS4 wasn't given to us.
    scoped_html = html
    if soup is None:
        try:
            soup = BeautifulSoup(html, "html.parser")
        except Exception:
            soup = None
    if soup is not None:
        chunks: List[str] = []
        for sel in (
            "section.sales-car-content",
            "section.section-about-car",
            ".car-page__photos",
            ".car-detail",
            ".car-info",
            "main .swiper",
        ):
            for el in soup.select(sel):
                chunks.append(str(el))
        if chunks:
            scoped_html = "\n".join(chunks)

    # ── 1. Copart pattern (most reliable on BidMotors detail pages) ──────
    for m in re.finditer(r'(https://cs\.copart\.com/[^\s"\'\\]+\.jpg)', scoped_html):
        url = m.group(1)
        if url not in seen and len(images) < 50:
            seen.add(url)
            images.append(url)
    if images:
        logger.info(f"[extract_images] Copart: {len(images)} images (scoped)")
        return images

    # ── 2. IAAI pattern — extract ALL unique images from scoped HTML ────
    iaai_matches = re.findall(r'https://vis\.iaai\.com/resizer\?imageKeys=([^"&\s]+)', scoped_html)
    if iaai_matches:
        stock_id = None
        angle = None
        unique_nums = set()

        for img_params in iaai_matches:
            if not stock_id:
                m = re.search(r'(\d+)~SID~([^~]+)~', img_params)
                if m:
                    stock_id = m.group(1)
                    angle = m.group(2)
            m = re.search(r'~I(\d+)~', img_params)
            if m:
                unique_nums.add(int(m.group(1)))

        if stock_id and angle and unique_nums:
            for i in sorted(unique_nums):
                url = f"https://vis.iaai.com/resizer?imageKeys={stock_id}~SID~{angle}~S0~I{i}~RW2576~H1932"
                if url not in seen:
                    seen.add(url)
                    images.append(url)
            logger.info(f"[extract_images] IAAI: {len(images)} images (scoped)")
            return images

    # ── 3. KAR/OpenLane pattern ─────────────────────────────────────────
    for m in re.finditer(r'(https://pub-us\.kar-media\.com[^"\'\\\s]+\.(?:jpg|jpeg|png))', scoped_html, re.I):
        url = m.group(1)
        if url not in seen and len(images) < 50:
            seen.add(url)
            images.append(url)
    if images:
        return images

    # ── 4. og:image fallback (BidMotors meta image — always specific) ──
    if soup is not None:
        og = soup.select_one('meta[property="og:image"]')
        if og and og.get("content"):
            url = og["content"].strip()
            if url and url not in seen:
                seen.add(url)
                images.append(url)
        # Also try main swiper imgs as a last resort
        for img in (soup.select("main .swiper-slide img") or [])[:50]:
            src = img.get("data-src") or img.get("src") or ""
            if src.startswith("http") and src not in seen and len(images) < 50:
                if any(ext in src.lower() for ext in (".jpg", ".jpeg", ".png", ".webp")):
                    seen.add(src)
                    images.append(src)
        if images:
            return images

    # ── 5. Generic last-resort (inside scoped block only) ──────────────
    if soup is not None:
        for sel in ("section.sales-car-content img", "section.section-about-car img"):
            for img in soup.select(sel):
                src = img.get("data-src") or img.get("src") or ""
                if (src.startswith("http") and src not in seen and len(images) < 50
                        and any(ext in src.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"])):
                    seen.add(src)
                    images.append(src)
    return images

def detect_auction(html: str) -> Optional[str]:
    text = html.upper()
    if 'VIS.IAAI.COM' in text or 'IAAI' in text:
        return 'IAAI'
    if 'CS.COPART.COM' in text or 'COPART' in text:
        return 'Copart'
    if 'KAR-MEDIA.COM' in text:
        return 'OpenLane'
    return None


# ═══════════════════════════════════════════════════════════════════
# NORMALIZE SERVICE (port from normalize/normalize.service.ts)
# ═══════════════════════════════════════════════════════════════════

def normalize_make(v):
    if not v: return None
    s = v.strip().upper()
    m = {
        'MERCEDES-BENZ': 'MERCEDES-BENZ', 'MERCEDES BENZ': 'MERCEDES-BENZ',
        'MERCEDES': 'MERCEDES-BENZ', 'MB': 'MERCEDES-BENZ',
        'VW': 'VOLKSWAGEN', 'CHEVY': 'CHEVROLET', 'LANDROVER': 'LAND ROVER',
        'RANGE ROVER': 'LAND ROVER',
    }
    return m.get(s, s)

def normalize_damage(v):
    if not v: return None
    s = v.lower()
    if 'front end' in s: return 'FRONT END'
    if 'front' in s: return 'FRONT'
    if 'rear end' in s: return 'REAR END'
    if 'rear' in s: return 'REAR'
    if 'left side' in s: return 'LEFT SIDE'
    if 'right side' in s: return 'RIGHT SIDE'
    if 'side' in s: return 'SIDE'
    if 'water' in s or 'flood' in s: return 'WATER/FLOOD'
    if 'fire' in s or 'burn' in s: return 'FIRE'
    if 'hail' in s: return 'HAIL'
    if 'vandal' in s: return 'VANDALISM'
    if 'rollover' in s: return 'ROLLOVER'
    if 'mechanical' in s: return 'MECHANICAL'
    if 'all over' in s: return 'ALL OVER'
    if 'minor' in s: return 'MINOR'
    if 'normal' in s or 'none' in s or 'no damage' in s: return 'NONE'
    return v.upper().strip()

def normalize_transmission(v):
    if not v: return None
    s = v.lower()
    if 'auto' in s or 'автомат' in s: return 'AUTOMATIC'
    if 'manual' in s or 'stick' in s or 'механ' in s: return 'MANUAL'
    if 'cvt' in s: return 'CVT'
    return v.upper().strip()

def normalize_fuel(v):
    if not v: return None
    s = v.lower()
    if 'gas' in s or 'petrol' in s or 'бензин' in s: return 'GAS'
    if 'diesel' in s or 'дизел' in s: return 'DIESEL'
    if 'electric' in s or 'ev' in s: return 'ELECTRIC'
    if 'hybrid' in s or 'гибрид' in s: return 'HYBRID'
    if 'plug-in' in s or 'phev' in s: return 'PLUG-IN HYBRID'
    return v.upper().strip()

def normalize_drivetrain(v):
    if not v: return None
    s = v.lower()
    if '4wd' in s or '4x4' in s: return '4WD'
    if 'awd' in s or 'all wheel' in s: return 'AWD'
    if 'fwd' in s or 'front wheel' in s: return 'FWD'
    if 'rwd' in s or 'rear wheel' in s: return 'RWD'
    return v.upper().strip()

def normalize_title(v):
    if not v: return None
    s = v.lower()
    if 'clean' in s or 'clear' in s: return 'CLEAN'
    if 'salvage' in s: return 'SALVAGE'
    if 'rebuilt' in s: return 'REBUILT'
    if 'junk' in s: return 'JUNK'
    if 'flood' in s: return 'FLOOD'
    if 'bill of sale' in s: return 'BILL OF SALE'
    if 'certificate' in s: return 'CERTIFICATE'
    return v.upper().strip()

def normalize_color(v):
    if not v: return None
    s = v.lower()
    colors = {'blk': 'BLACK', 'wht': 'WHITE', 'sil': 'SILVER', 'gry': 'GRAY',
              'grey': 'GRAY', 'blu': 'BLUE', 'red': 'RED', 'grn': 'GREEN',
              'brn': 'BROWN', 'gold': 'GOLD', 'tan': 'TAN', 'orange': 'ORANGE',
              'yellow': 'YELLOW', 'purple': 'PURPLE', 'beige': 'BEIGE'}
    for k, c in colors.items():
        if k in s:
            return c
    return v.upper().strip()

def normalize_keys(v):
    if not v: return None
    s = v.lower()
    if 'yes' in s or 'present' in s or 'да' in s: return 'YES'
    if 'no' in s or 'missing' in s or 'нет' in s: return 'NO'
    return v.upper().strip()

def normalize_odometer(value, unit='km'):
    if not value or value <= 0:
        return None
    if unit and unit.lower() == 'km':
        return round(value * 0.621371)
    return value


# ═══════════════════════════════════════════════════════════════════
# QUALITY SERVICE (port from quality/quality.service.ts)
# ═══════════════════════════════════════════════════════════════════

CORE_FIELDS = ['vin', 'make', 'model', 'year']
IMPORTANT_FIELDS = ['odometer', 'damage_primary', 'title_status']
BONUS_FIELDS = ['lot_number', 'auction_name', 'sale_date', 'location',
                'engine', 'fuel_type', 'transmission', 'drivetrain',
                'color', 'body_style', 'keys']

def _has_value(d, key):
    v = d.get(key)
    if v is None: return False
    if isinstance(v, str) and not v.strip(): return False
    if isinstance(v, (int, float)) and v <= 0: return False
    if isinstance(v, list) and len(v) == 0: return False
    return True

def calculate_quality(data: Dict) -> Tuple[Optional[str], int, float]:
    core = sum(1 for f in CORE_FIELDS if _has_value(data, f))
    important = sum(1 for f in IMPORTANT_FIELDS if _has_value(data, f))
    bonus = sum(1 for f in BONUS_FIELDS if _has_value(data, f))
    has_images = len(data.get('images', [])) > 0
    image_bonus = 1 if has_images else 0
    fields_filled = core + important + bonus + image_bonus

    quality = None
    if core == 4 and important >= 2 and (has_images or bonus >= 2):
        quality = 'A'
    elif core == 4 or (core >= 3 and important >= 2):
        quality = 'B'
    elif core >= 2 or (core >= 1 and important >= 1):
        quality = 'C'

    max_score = len(CORE_FIELDS) + len(IMPORTANT_FIELDS) + len(BONUS_FIELDS) + 1
    confidence = round(min(1.0, fields_filled / max_score), 2)
    return quality, fields_filled, confidence


# ═══════════════════════════════════════════════════════════════════
# BIDMOTORS ADAPTER (port from adapters/bidmotors.adapter.ts)
# ═══════════════════════════════════════════════════════════════════

# Bulgarian + English labels mapping (comprehensive)
LABELS = {
    'lot_number': ['Търг №', 'Лот №', 'Lot №', 'Lot number', 'Lot'],
    'sale_date':  ['Дата на търга', 'Sale Date', 'Auction date'],
    'make':       ['Марка на автомобила', 'Марка', 'Car Brand', 'Make'],
    'model':      ['Модел на автомобила', 'Модел', 'Car Model', 'Model'],
    'vin':        ['VIN номер', 'VIN Number', 'VIN'],
    'year':       ['Година', 'Year'],
    'odometer':   ['Пробег', 'Километраж', 'Mileage', 'Odometer'],
    'keys':       ['Ключове', 'Keys'],
    'drivetrain': ['Задвижване', 'Drive'],
    'engine':     ['Двигател', 'Engine type', 'Engine'],
    'fuel_type':  ['Вид гориво', 'Fuel type', 'Fuel'],
    'transmission': ['Скоростна кутия', 'Gearbox', 'Transmission'],
    'damage_primary': ['Щета', 'Primary Damage', 'Damage'],
    'condition':  ['Състояние', 'Condition', 'State'],
    'location':   ['Локация', 'Location'],
    'color':      ['Цвят', 'Color', 'Цвета'],
    'title_status': ['Документи за продажба', 'Документи', 'Documents for sale', 'Title'],
    'seller':     ['Продавач', 'Seller', 'Seller name'],
    'body_style': ['Тип купе', 'Body'],
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,bg;q=0.8',
}


async def find_detail_url(client: httpx.AsyncClient, vin: str) -> Optional[str]:
    """
    Strategy 1: Sitemap search (fast, VIN only)
    Strategy 2: Search page fallback
    — exact port from findDetailUrl()
    """
    v = vin.upper().strip()

    # Strategy 1: Sitemap
    if len(v) == 17:
        try:
            resp = await client.get(
                'https://bidmotors.bg/sitemap-products-new-bg-1.xml',
                headers=HEADERS, timeout=5,
            )
            if resp.status_code == 200:
                xml = resp.text
                pat = re.compile(
                    rf'<loc>(https://bidmotors\.bg/[^<]*-{v.lower()})</loc>', re.I
                )
                m = pat.search(xml)
                if m:
                    logger.info(f"[bidmotors] Sitemap hit: {m.group(1)}")
                    return m.group(1)
        except Exception:
            pass

    # Strategy 2: Search page
    try:
        resp = await client.get(
            f'https://bidmotors.bg/?s={v}',
            headers=HEADERS, timeout=8,
        )
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            # Look for article links ending with VIN
            for a in soup.select('article a[href]'):
                href = a.get('href', '')
                if v.lower() in href.lower():
                    url = href if href.startswith('http') else f'https://bidmotors.bg{href}'
                    logger.info(f"[bidmotors] Search hit (article): {url}")
                    return url
            # Any link containing VIN
            for a in soup.select('a[href]'):
                href = a.get('href', '')
                if v.lower() in href.lower() and '?s=' not in href:
                    url = href if href.startswith('http') else f'https://bidmotors.bg{href}'
                    logger.info(f"[bidmotors] Search hit (link): {url}")
                    return url
    except Exception:
        pass

    # Strategy 3: Direct catalogue search (EN)
    try:
        resp = await client.get(
            f'https://bidmotors.bg/en/live-auction/search?query={v}',
            headers=HEADERS, timeout=8,
        )
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            for a in soup.select('a.car-card__wrapper[href]'):
                href = a.get('href', '')
                if v.lower() in href.lower():
                    url = href if href.startswith('http') else f'https://bidmotors.bg{href}'
                    logger.info(f"[bidmotors] Catalogue search hit: {url}")
                    return url
    except Exception:
        pass

    return None


def parse_detail_page(html: str, source_url: str) -> Dict[str, Any]:
    """
    Parse detail page — extract ALL fields.
    Exact port of parseDetailPage() from TS.
    Uses Bulgarian + English label mapping.

    IMPORTANT: scope lot/images extraction to the *main* car block.
    BidMotors detail pages contain a "popular cars" carousel that would
    otherwise leak unrelated lots/images into our parsed result.
    """
    soup = BeautifulSoup(html, 'html.parser')
    text = clean(soup.get_text()) or ''

    # Build a SCOPED text/html that excludes the recommended/special-offer
    # carousels. These contain other vehicles' lot numbers and images.
    car_info_block = soup.select_one("section.sales-car-content, .car-info") or soup.select_one(".car-page__main")
    about_block = soup.select_one("section.section-about-car, [class*='section-about-car']")
    scoped_text_parts: List[str] = []
    if car_info_block:
        scoped_text_parts.append(clean(car_info_block.get_text(' ', strip=True)) or '')
    if about_block:
        scoped_text_parts.append(clean(about_block.get_text(' ', strip=True)) or '')
    scoped_text = '\n'.join([t for t in scoped_text_parts if t]) or text

    # Build field map from detail items — SCOPED to the main car blocks so
    # that the "popular cars" carousel can't poison fields like lot_number.
    fields: Dict[str, str] = {}
    field_scope_root = car_info_block or about_block or soup
    # If we have BOTH a hero `.car-info` and the spec table, prefer them
    # together — they describe the same vehicle.
    field_scope_roots = [b for b in (car_info_block, about_block) if b is not None] or [soup]

    for root in field_scope_roots:
        for item in root.select(
            '.car-details__item, .vehicle-detail, .detail-item, '
            '.car-card__spec-item, dl, table tr'
        ):
            # Collect 2 first text-bearing children
            spans = item.find_all(['span', 'div', 'dt', 'dd', 'th', 'td'])
            if len(spans) >= 2:
                label = clean(spans[0].get_text())
                value = clean(spans[1].get_text())
                if label and value and value != '-' and len(value) < 200:
                    fields.setdefault(label, value)
        # Also try plain table rows specifically inside main about-car block
        for row in root.select('table tr'):
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 2:
                label = clean(cells[0].get_text())
                value = clean(cells[1].get_text())
                if label and value and value != '-' and len(value) < 200:
                    fields.setdefault(label, value)

    def get(label_keys: List[str]) -> Optional[str]:
        for lbl in label_keys:
            # Exact match
            for key, val in fields.items():
                if key.replace(':', '').strip().lower() == lbl.lower():
                    return val
            # Partial match
            for key, val in fields.items():
                if lbl.lower() in key.lower():
                    return val
        return None

    # Extract VIN — prefer URL, then scoped main text, then global text
    vin = extract_vin(source_url) or extract_vin(scoped_text or '') or extract_vin(text or '')
    vin_field = get(LABELS['vin'])
    if vin_field:
        cleaned_vin = re.sub(r'[^A-HJ-NPR-Z0-9]', '', vin_field.upper())
        if len(cleaned_vin) == 17:
            vin = cleaned_vin

    # Year
    year_raw = get(LABELS['year'])
    year = extract_number(year_raw)
    if not year:
        year = extract_year(scoped_text or text or '')

    # Odometer
    odometer_raw = get(LABELS['odometer']) or ''
    odometer = extract_number(odometer_raw)
    odometer_unit = 'mi' if 'mi' in odometer_raw.lower() else 'km'

    # Images — pass scoped soup so the function can apply its own scoping
    image_urls = extract_images(html, soup)

    # Auction detection — scoped to main HTML chunks if possible
    scoped_html = (str(car_info_block) if car_info_block else '') + (str(about_block) if about_block else '')
    auction_name = detect_auction(scoped_html or html)

    # Lot — try labelled field first, then scoped text only (NOT global text!)
    lot_number = get(LABELS['lot_number']) or extract_lot(scoped_text or '')

    result = {
        'vin': vin,
        'source_url': source_url,
        'lot_number': lot_number,
        'sale_date': get(LABELS['sale_date']),
        'make': get(LABELS['make']),
        'model': get(LABELS['model']),
        'year': year,
        'odometer': odometer,
        'odometer_unit': odometer_unit,
        'keys': get(LABELS['keys']),
        'engine': get(LABELS['engine']),
        'fuel_type': get(LABELS['fuel_type']),
        'drivetrain': get(LABELS['drivetrain']),
        'transmission': get(LABELS['transmission']),
        'damage_primary': get(LABELS['damage_primary']),
        'condition': get(LABELS['condition']),
        'location': get(LABELS['location']),
        'color': get(LABELS['color']),
        'title_status': get(LABELS['title_status']),
        'seller': get(LABELS['seller']),
        'body_style': get(LABELS['body_style']),
        'auction_name': auction_name,
        'images': image_urls,
        'source': 'bidmotors',
    }
    return result


def normalize_result(data: Dict) -> Dict:
    """Apply all normalizations — port of NormalizeService.normalize()"""
    data['make'] = normalize_make(data.get('make'))
    model_val = data.get('model', '').upper().strip() if data.get('model') else None
    # Reject model values that are clearly lot numbers or other garbage
    if model_val and re.search(r'LOT\s*(NUMBER|#|:|\d)', model_val, re.IGNORECASE):
        model_val = None
    if model_val and model_val.isdigit():
        model_val = None
    data['model'] = model_val
    data['damage_primary'] = normalize_damage(data.get('damage_primary'))
    data['transmission'] = normalize_transmission(data.get('transmission'))
    data['fuel_type'] = normalize_fuel(data.get('fuel_type'))
    data['drivetrain'] = normalize_drivetrain(data.get('drivetrain'))
    data['title_status'] = normalize_title(data.get('title_status'))
    data['color'] = normalize_color(data.get('color'))
    data['keys'] = normalize_keys(data.get('keys'))
    if data.get('odometer'):
        data['odometer'] = normalize_odometer(data['odometer'], data.get('odometer_unit', 'km'))
        data['odometer_unit'] = 'mi'
    return data


async def search_vin(vin: str, db=None) -> Dict[str, Any]:
    """
    Main VIN search — port of BidMotorsAdapter.search()
    1. Check local DB first (we may already have the detail_url)
    2. Search bidmotors.bg sitemap/search/catalogue
    3. Fetch detail page, parse, normalize, score.
    """
    start = time.time()
    v = vin.upper().strip()

    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            detail_url = None

            # Strategy 0: Check local DB for stored detail_url
            if db is not None:
                existing = await db.vin_data.find_one({'vin': v}, {'_id': 0})
                if existing and existing.get('detail_url'):
                    detail_url = existing['detail_url']
                    logger.info(f"[bidmotors] DB hit: {detail_url}")

            # Strategy 1-3: Search bidmotors.bg
            if not detail_url:
                detail_url = await find_detail_url(client, v)

            if not detail_url:
                return {'success': False, 'source': 'bidmotors', 'error': 'not found'}

            # Fetch detail page
            resp = await client.get(detail_url, headers=HEADERS)
            if resp.status_code != 200:
                return {'success': False, 'source': 'bidmotors', 'error': f'HTTP {resp.status_code}'}

            # Parse detail page
            parsed = parse_detail_page(resp.text, detail_url)
            if not parsed.get('vin'):
                # Fallback: use VIN from input
                parsed['vin'] = v

            # Normalize
            normalized = normalize_result(parsed)

            # Quality
            quality, fields_filled, confidence = calculate_quality(normalized)

            latency = round((time.time() - start) * 1000)
            logger.info(f"[bidmotors] {v} → fields={fields_filled} quality={quality} {latency}ms")

            return {
                'success': True,
                'source': 'bidmotors',
                **normalized,
                'quality': quality,
                'fields_filled': fields_filled,
                'confidence': confidence,
                'latency_ms': latency,
            }

    except Exception as e:
        logger.warning(f"[bidmotors] ERROR: {e}")
        return {'success': False, 'source': 'bidmotors', 'error': str(e)[:100]}


# ═══════════════════════════════════════════════════════════════════
# AUTONOMOUS CATALOGUE SCRAPER
# ═══════════════════════════════════════════════════════════════════

def parse_catalogue_card(card) -> Optional[Dict]:
    """Parse a single car-card from catalogue page"""
    try:
        link = card.select_one('a.car-card__wrapper')
        if not link:
            return None
        href = link.get('href', '')
        detail_url = href if href.startswith('http') else f'https://bidmotors.bg{href}'
        # Extract VIN: last 17 chars of URL path (after removing hyphens)
        path_segment = href.rstrip('/').split('/')[-1]
        clean_path = path_segment.replace('-', '').upper()
        vin = None
        if len(clean_path) >= 17:
            candidate = clean_path[-17:]
            if VIN_RE.match(candidate):
                vin = candidate

        title_el = card.select_one('.car-card__title')
        title = title_el.get_text(strip=True) if title_el else ''

        # Parse title → year/make/model
        parts = title.strip().split()
        year, make, model = None, None, None
        if parts and parts[0].isdigit() and len(parts[0]) == 4:
            year = int(parts[0])
            if len(parts) > 1: make = parts[1]
            if len(parts) > 2: model = ' '.join(parts[2:])

        img_el = card.select_one('.car-card__image img')
        image_url = img_el.get('src', '') if img_el else ''

        specs = {}
        for item in card.select('.car-card__spec-item'):
            spans = item.find_all('span')
            if len(spans) >= 2:
                lbl = spans[0].get_text(strip=True).rstrip(':').strip().lower()
                val = spans[1].get_text(strip=True)
                if 'lot' in lbl: specs['lot_number'] = val
                elif 'auction' in lbl or 'date' in lbl: specs['sale_date'] = val
                elif 'engine' in lbl: specs['engine'] = val
                elif 'mileage' in lbl or 'km' in lbl:
                    m = re.search(r'([\d\s]+)', val)
                    if m: specs['odometer'] = int(m.group(1).replace(' ', ''))
                    specs['odometer_unit'] = 'km' if 'km' in val.lower() else 'mi'
                elif 'state' in lbl: specs['condition'] = val
                elif 'damage' in lbl: specs['damage_primary'] = val
                elif 'seller' in lbl: specs['seller'] = val

        # Detect auction source
        logo = card.select_one('.car-card__auction-logo img')
        auction = 'unknown'
        if logo:
            src = logo.get('src', '').lower()
            if 'copart' in src: auction = 'Copart'
            elif 'iaai' in src: auction = 'IAAI'

        return {
            'vin': vin, 'title': title, 'detail_url': detail_url,
            'year': year, 'make': make, 'model': model,
            'images': [image_url] if image_url else [],
            'auction_name': auction, 'source': 'bitmotors',
            **specs,
        }
    except Exception as e:
        logger.warning(f"Card parse error: {e}")
        return None


class BitmotorsScraper:
    """Autonomous catalogue scraper + VIN search"""

    def __init__(self, db):
        self.db = db
        self.running = False
        self.task = None
        self.stats = {
            'total_scraped': 0, 'total_new': 0, 'total_updated': 0,
            'total_errors': 0, 'last_run': None, 'last_success': None,
            'last_error': None, 'pages_scraped': 0, 'run_count': 0,
            'is_scraping': False, 'vin_searches': 0,
        }
        self.interval_seconds = 1800  # 30 min
        self.max_pages = 10
        self._stop = asyncio.Event()

    # ── VIN Search (adapter port) ──

    async def search_vin(self, vin: str) -> Dict:
        """Search by VIN — delegates to adapter with DB lookup"""
        self.stats['vin_searches'] += 1
        result = await search_vin(vin, db=self.db)
        # Save to DB if found
        if result.get('success') and result.get('vin') and self.db is not None:
            await self._save_one(result)
        return result

    # ── Catalogue Scraping ──

    async def scrape_page(self, client: httpx.AsyncClient, page: int) -> List[Dict]:
        url = f'https://bidmotors.bg/en/catalogue' + (f'?page={page}' if page > 1 else '')
        try:
            resp = await client.get(url, headers=HEADERS, follow_redirects=True)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            cards = soup.select('article.car-card')
            vehicles = []
            for card in cards:
                v = parse_catalogue_card(card)
                if v and v.get('vin'):
                    vehicles.append(v)
            logger.info(f"[bitmotors] Page {page}: {len(vehicles)} vehicles")
            return vehicles
        except Exception as e:
            logger.error(f"[bitmotors] Page {page} error: {e}")
            self.stats['total_errors'] += 1
            return []

    async def _save_one(self, v: Dict):
        vin = v.get('vin')
        if not vin or self.db is None:
            return
        now = datetime.now(timezone.utc)
        # Build doc excluding None values
        doc = {k: val for k, val in v.items() if val is not None and k != 'success'}
        doc['updated_at'] = now
        doc['source'] = 'bitmotors'

        # Quality
        quality, ff, conf = calculate_quality(doc)
        doc['quality'] = quality
        doc['fields_filled'] = ff
        doc['confidence'] = conf

        # Check if existing doc has better make/model (from catalogue title parse)
        existing = await self.db.vin_data.find_one({'vin': vin}, {'_id': 0, 'make': 1, 'model': 1})
        if existing:
            # Don't overwrite valid make/model with None
            if existing.get('make') and not doc.get('make'):
                doc.pop('make', None)
            if existing.get('model') and not doc.get('model'):
                doc.pop('model', None)

        result = await self.db.vin_data.update_one(
            {'vin': vin},
            {'$set': doc, '$setOnInsert': {'created_at': now}},
            upsert=True,
        )
        return result

    async def save_vehicles(self, vehicles: List[Dict]) -> Tuple[int, int]:
        new_c, upd_c = 0, 0
        for v in vehicles:
            if not v.get('vin'):
                continue
            r = await self._save_one(v)
            if r and r.upserted_id:
                new_c += 1
            elif r and r.modified_count:
                upd_c += 1
        return new_c, upd_c

    async def run_once(self) -> Dict:
        start = time.time()
        self.stats['is_scraping'] = True
        self.stats['run_count'] += 1
        all_vehicles = []
        pages = 0

        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                for page in range(1, self.max_pages + 1):
                    if not self.running:
                        break
                    vehicles = await self.scrape_page(client, page)
                    all_vehicles.extend(vehicles)
                    pages += 1
                    if not vehicles:
                        break
                    if page < self.max_pages:
                        await asyncio.sleep(2)

            new_c, upd_c = (0, 0)
            if all_vehicles:
                new_c, upd_c = await self.save_vehicles(all_vehicles)

            elapsed = round(time.time() - start, 1)
            self.stats['total_scraped'] += len(all_vehicles)
            self.stats['total_new'] += new_c
            self.stats['total_updated'] += upd_c
            self.stats['pages_scraped'] = pages
            self.stats['last_run'] = datetime.now(timezone.utc).isoformat()
            self.stats['last_success'] = self.stats['last_run']
            self.stats['is_scraping'] = False

            logger.info(f"[bitmotors] Scrape done: {len(all_vehicles)} vehicles ({new_c} new, {upd_c} upd) {pages} pages {elapsed}s")
            return {'success': True, 'vehicles_found': len(all_vehicles), 'new': new_c, 'updated': upd_c, 'pages': pages, 'elapsed': elapsed}
        except Exception as e:
            self.stats['total_errors'] += 1
            self.stats['last_error'] = str(e)
            self.stats['is_scraping'] = False
            logger.error(f"[bitmotors] Scrape failed: {e}")
            return {'success': False, 'error': str(e)}

    async def _loop(self):
        logger.info(f"[bitmotors] Autonomous loop started (interval={self.interval_seconds}s, pages={self.max_pages})")
        while self.running:
            try:
                await self.run_once()
            except Exception as e:
                logger.error(f"[bitmotors] Loop error: {e}")
            try:
                self._stop.clear()
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval_seconds)
                break
            except asyncio.TimeoutError:
                continue
        logger.info("[bitmotors] Autonomous loop stopped")

    def start(self):
        if self.running:
            return {'success': False, 'message': 'Already running'}
        self.running = True
        self._stop.clear()
        self.task = asyncio.create_task(self._loop())
        return {'success': True, 'message': 'BidMotors parser started'}

    def stop(self):
        if not self.running:
            return {'success': False, 'message': 'Not running'}
        self.running = False
        self._stop.set()
        if self.task:
            self.task.cancel()
            self.task = None
        self.stats['is_scraping'] = False
        return {'success': True, 'message': 'BidMotors parser stopped'}

    def get_stats(self) -> Dict:
        return {**self.stats, 'running': self.running, 'interval_seconds': self.interval_seconds, 'max_pages': self.max_pages}


# ═══════════════════════════════════════════════════════════════════
# HYBRID LIVE SEARCH (proxy to BidMotors search bar)
# ═══════════════════════════════════════════════════════════════════
# Architecture:
#   • For EVERY user search (autocomplete + enter), we hit BidMotors' own
#     search endpoint instead of relying on the tiny local DB. Results are
#     normalized and *also* upserted to Mongo with ``last_seen=now`` so the
#     DB gradually fills up with hot queries.
#   • A module-level TTL cache absorbs repeat keystrokes (5 min default).
#   • The catalogue-page scraper remains — but it is now the BACKGROUND
#     full-sync worker (see BitmotorsFullSync below), not the primary data
#     source.
#
# BidMotors exposes two useful endpoints we can abuse:
#   1. GET /en/live-auction/search?query=<VIN/LOT>
#        Response: JSON  {"redirect_url":"/en/<slug>-<vin>"}   (exact hit)
#        Response: JSON  {}                                    (no hit)
#   2. GET /en/catalogue?query=<anything>&page=1
#        Response: HTML  with <article.car-card ...> elements (partial /
#                         free-text / brand / model)

LIVE_SEARCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 '
                  '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.95,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,bg;q=0.7',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
}


async def _live_vin_redirect(client: httpx.AsyncClient, query: str) -> Optional[str]:
    """Hit BidMotors JSON redirect endpoint. Returns absolute detail URL or None."""
    try:
        resp = await client.get(
            'https://bidmotors.bg/en/live-auction/search',
            params={'query': query},
            headers={**LIVE_SEARCH_HEADERS, 'Accept': 'application/json'},
            timeout=8,
        )
        if resp.status_code != 200:
            return None
        try:
            data = resp.json()
        except Exception:
            return None
        url = (data or {}).get('redirect_url')
        if not url:
            return None
        if url.startswith('/'):
            url = 'https://bidmotors.bg' + url
        return url
    except Exception as e:
        logger.debug(f"[live-search] redirect failed for {query!r}: {e}")
        return None


async def _live_catalogue_search(client: httpx.AsyncClient, query: str,
                                 page: int = 1) -> List[Dict[str, Any]]:
    """Hit filtered catalogue page, parse cards."""
    try:
        resp = await client.get(
            'https://bidmotors.bg/en/catalogue',
            params={'query': query, 'page': page},
            headers=LIVE_SEARCH_HEADERS,
            timeout=12,
        )
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, 'html.parser')
        out: List[Dict[str, Any]] = []
        for card in soup.select('article.car-card'):
            parsed = parse_catalogue_card(card)
            if parsed and parsed.get('vin'):
                out.append(parsed)
        return out
    except Exception as e:
        logger.debug(f"[live-search] catalogue {query!r} p={page} failed: {e}")
        return []


def _live_card_mini(v: Dict[str, Any]) -> Dict[str, Any]:
    """Shape an internal parsed card → public mini-card (shared shape with /suggest)."""
    imgs = v.get('images') or v.get('image_urls') or []
    title = v.get('title') or (
        f"{v.get('year','')} {v.get('make','')} {v.get('model','')}".strip() or None
    )
    return {
        'vin': v.get('vin'),
        'title': title,
        'year': v.get('year'),
        'make': v.get('make'),
        'model': v.get('model'),
        'trim': v.get('trim'),
        'lot_number': v.get('lot_number'),
        'price': v.get('price'),
        'image': imgs[0] if imgs else None,
        'auction_name': v.get('auction_name'),
        'location': v.get('location'),
        'odometer': v.get('odometer'),
        'odometer_unit': v.get('odometer_unit') or 'km',
    }


async def _upsert_live_result(db, v: Dict[str, Any]) -> None:
    """Persist a live-search hit into vin_data with last_seen / archived=False."""
    if db is None:
        return
    vin = v.get('vin')
    if not vin:
        return
    try:
        now = datetime.now(timezone.utc)
        doc = {k: val for k, val in v.items() if val is not None and k != 'success'}
        doc['updated_at'] = now
        doc['last_seen'] = now
        doc['archived'] = False
        doc['source'] = 'bitmotors'
        q, ff, conf = calculate_quality(doc)
        doc['quality'] = q
        doc['fields_filled'] = ff
        doc['confidence'] = conf
        await db.vin_data.update_one(
            {'vin': vin},
            {'$set': doc, '$setOnInsert': {'created_at': now}},
            upsert=True,
        )
    except Exception as e:
        logger.debug(f"[live-search] upsert {v.get('vin')} failed: {e}")


async def _live_brand_landing(client: httpx.AsyncClient, brand_slug: str) -> List[Dict[str, Any]]:
    """BidMotors redirects brand queries to landing pages like /bmw, /audi.

    Try fetching the brand landing page (which lists 12 newest cars of that brand).
    """
    try:
        resp = await client.get(
            f'https://bidmotors.bg/{brand_slug.lower()}',
            headers=LIVE_SEARCH_HEADERS,
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, 'html.parser')
        out: List[Dict[str, Any]] = []
        for card in soup.select('article.car-card'):
            v = parse_catalogue_card(card)
            if v and v.get('vin'):
                out.append(v)
        return out
    except Exception as e:
        logger.debug(f"[live-search] brand-landing {brand_slug!r} failed: {e}")
        return []


async def live_search(query: str, db=None, limit: int = 12) -> Dict[str, Any]:
    """One-shot hybrid live search.

    Strategy:
      - 17-char VIN → `/en/live-auction/search?query=...` (JSON redirect) →
        fetch detail page → full parse → 1 card
      - else → `/en/catalogue?query=...&page=1` → parse up to 12 cards
      - Every hit is upserted to `vin_data` with `last_seen`.

    Returns: {"items": [...mini cards...], "source": "bidmotors_live", "kind": "<vin|catalogue>"}
    """
    raw = (query or '').strip()
    if not raw:
        return {'items': [], 'count': 0, 'source': 'bidmotors_live', 'kind': 'empty'}
    clean_q = raw.upper().replace(' ', '').replace('-', '')
    is_vin = bool(re.fullmatch(r'[A-HJ-NPR-Z0-9]{17}', clean_q))
    is_lot = bool(re.fullmatch(r'\d{4,10}', clean_q))

    # Loose brand heuristic: 3..12 letters, not numeric, not a VIN prefix that happens to be letters
    looks_like_brand = (
        not is_vin and not is_lot
        and bool(re.fullmatch(r'[A-Za-z]{3,15}', raw.replace(' ', '').replace('-', '')))
    )

    items: List[Dict[str, Any]] = []
    detail_payload: Optional[Dict[str, Any]] = None
    kind = 'catalogue'

    try:
        async with httpx.AsyncClient(
            timeout=12, follow_redirects=True, headers=LIVE_SEARCH_HEADERS
        ) as client:
            if is_vin or is_lot:
                kind = 'vin' if is_vin else 'lot'
                # JSON-redirect endpoint works for full VIN AND for valid lot numbers
                detail_url = await _live_vin_redirect(client, clean_q)
                if detail_url:
                    try:
                        resp = await client.get(detail_url, timeout=12)
                        if resp.status_code == 200:
                            parsed = parse_detail_page(resp.text, detail_url)
                            if is_vin and not parsed.get('vin'):
                                parsed['vin'] = clean_q
                            normalized = normalize_result(parsed)
                            detail_payload = normalized
                            items.append(_live_card_mini(normalized))
                            await _upsert_live_result(db, normalized)
                    except Exception as e:
                        logger.debug(f"[live-search] detail fetch failed {detail_url}: {e}")
                # Fallback: catalogue filter (usually empty, but cheap)
                if not items:
                    vehicles = await _live_catalogue_search(client, clean_q, 1)
                    for v in vehicles[:limit]:
                        items.append(_live_card_mini(v))
                        await _upsert_live_result(db, v)
                    if items:
                        kind = 'catalogue_fallback'
            else:
                # Non-VIN, non-LOT query — try multiple strategies in order:
                #   1. Brand landing page (`/<brand>`) if it looks like a word
                #   2. Filtered catalogue (`?query=<term>`) — works for exact
                #      words sometimes
                if looks_like_brand:
                    vehicles = await _live_brand_landing(client, raw)
                    if vehicles:
                        kind = 'brand_landing'
                        for v in vehicles[:limit]:
                            items.append(_live_card_mini(v))
                            await _upsert_live_result(db, v)
                if not items:
                    vehicles = await _live_catalogue_search(client, raw, 1)
                    if vehicles:
                        kind = 'catalogue'
                        for v in vehicles[:limit]:
                            items.append(_live_card_mini(v))
                            await _upsert_live_result(db, v)
    except Exception as e:
        logger.warning(f"[live-search] fatal {raw!r}: {e}")

    return {
        'items': items,
        'count': len(items),
        'source': 'bidmotors_live',
        'kind': kind,
        'detail': detail_payload,
    }


# ═══════════════════════════════════════════════════════════════════
# FULL CATALOGUE SYNC WORKER (daily, all 54 000+ pages)
# ═══════════════════════════════════════════════════════════════════
class BitmotorsFullSync:
    """Asynchronous, resumable, rate-limited full catalogue scraper.

    Config (persisted in Mongo `parser_full_sync_settings`):
      - enabled (bool)
      - concurrency (int, 1..10, default 5)
      - delay_seconds (float, 0.5..5.0, default 2.0)
      - daily_hour_utc (int, 0..23, default 3)
      - max_pages (int, 1..100000, default 0 = "all discovered")
      - retry_on_error (int, default 2)

    Archive policy:
      - When the scrape completes successfully and covers ≥ 80 % of the
        discovered pages, any vin_data document whose `last_seen` is older
        than the sync start timestamp is marked ``archived=True``.
    """

    DEFAULT_SETTINGS = {
        'enabled': True,
        'concurrency': 5,
        'delay_seconds': 2.0,
        'daily_hour_utc': 3,
        'max_pages': 0,       # 0 = auto (discovered last page)
        'retry_on_error': 2,
    }

    def __init__(self, db):
        self.db = db
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._cancel_current = asyncio.Event()
        self.settings: Dict[str, Any] = dict(self.DEFAULT_SETTINGS)
        self.stats: Dict[str, Any] = {
            'is_scraping': False,
            'last_run_started_at': None,
            'last_run_finished_at': None,
            'last_success_at': None,
            'last_error': None,
            'last_total_pages_discovered': 0,
            'last_pages_scraped': 0,
            'last_vehicles_found': 0,
            'last_new': 0,
            'last_updated': 0,
            'last_archived': 0,
            'last_errors_count': 0,
            'current_page': 0,
            'current_total_pages': 0,
            'current_vehicles': 0,
            'run_count': 0,
        }

    # ── Settings persistence ──
    async def load_settings(self) -> None:
        if self.db is None:
            return
        try:
            doc = await self.db.parser_full_sync_settings.find_one({'source': 'bitmotors'})
        except Exception as e:
            logger.warning(f"[full-sync] settings load failed: {e}")
            return
        if not doc:
            return
        for k in self.DEFAULT_SETTINGS:
            if k in doc:
                self.settings[k] = doc[k]
        # Clamp
        self.settings['concurrency'] = max(1, min(10, int(self.settings['concurrency'])))
        self.settings['delay_seconds'] = max(0.5, min(5.0, float(self.settings['delay_seconds'])))
        self.settings['daily_hour_utc'] = max(0, min(23, int(self.settings['daily_hour_utc'])))
        self.settings['max_pages'] = max(0, int(self.settings['max_pages']))
        self.settings['retry_on_error'] = max(0, min(5, int(self.settings['retry_on_error'])))

    async def save_settings(self) -> None:
        if self.db is None:
            return
        try:
            await self.db.parser_full_sync_settings.update_one(
                {'source': 'bitmotors'},
                {
                    '$set': {**self.settings, 'updated_at': datetime.now(timezone.utc)},
                    '$setOnInsert': {
                        'source': 'bitmotors',
                        'created_at': datetime.now(timezone.utc),
                    },
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"[full-sync] settings save failed: {e}")

    async def configure(self, **kwargs) -> Dict[str, Any]:
        for k, v in kwargs.items():
            if k in self.DEFAULT_SETTINGS and v is not None:
                self.settings[k] = v
        await self.save_settings()
        return dict(self.settings)

    # ── Page-count discovery ──
    async def _discover_total_pages(self, client: httpx.AsyncClient) -> int:
        try:
            resp = await client.get(
                'https://bidmotors.bg/en/catalogue',
                headers=LIVE_SEARCH_HEADERS,
                timeout=15,
            )
            if resp.status_code != 200:
                return 0
            # Parse the pagination: last page appears as /en/catalogue?page=<N>
            matches = re.findall(r'/en/catalogue\?page=(\d+)', resp.text)
            if not matches:
                return 1
            nums = [int(m) for m in matches if m.isdigit()]
            return max(nums) if nums else 1
        except Exception as e:
            logger.warning(f"[full-sync] discover pages failed: {e}")
            return 0

    # ── Scrape one page with retry/backoff ──
    async def _scrape_page_with_retry(self, client: httpx.AsyncClient, page: int) -> List[Dict]:
        retries = self.settings['retry_on_error']
        backoff = 2.0
        last_err: Optional[Exception] = None
        for attempt in range(retries + 1):
            if self._cancel_current.is_set() or not self.running:
                return []
            try:
                resp = await client.get(
                    f'https://bidmotors.bg/en/catalogue?page={page}',
                    headers=LIVE_SEARCH_HEADERS,
                    timeout=20,
                )
                if resp.status_code == 429 or resp.status_code == 403:
                    last_err = RuntimeError(f"HTTP {resp.status_code}")
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, 'html.parser')
                out: List[Dict] = []
                for card in soup.select('article.car-card'):
                    v = parse_catalogue_card(card)
                    if v and v.get('vin'):
                        out.append(v)
                return out
            except Exception as e:
                last_err = e
                await asyncio.sleep(backoff * (2 ** attempt))
        logger.warning(f"[full-sync] page {page} failed after retries: {last_err}")
        return []

    # ── Save a batch ──
    async def _save_batch(self, vehicles: List[Dict]) -> Tuple[int, int]:
        if not vehicles or self.db is None:
            return 0, 0
        new_c = 0
        upd_c = 0
        now = datetime.now(timezone.utc)
        for v in vehicles:
            vin = v.get('vin')
            if not vin:
                continue
            doc = {k: val for k, val in v.items() if val is not None}
            doc['updated_at'] = now
            doc['last_seen'] = now
            doc['archived'] = False
            doc['source'] = 'bitmotors'
            q, ff, conf = calculate_quality(doc)
            doc['quality'] = q
            doc['fields_filled'] = ff
            doc['confidence'] = conf
            try:
                # Preserve richer make/model from previous write
                existing = await self.db.vin_data.find_one(
                    {'vin': vin}, {'_id': 0, 'make': 1, 'model': 1}
                )
                if existing:
                    if existing.get('make') and not doc.get('make'):
                        doc.pop('make', None)
                    if existing.get('model') and not doc.get('model'):
                        doc.pop('model', None)
                r = await self.db.vin_data.update_one(
                    {'vin': vin},
                    {'$set': doc, '$setOnInsert': {'created_at': now}},
                    upsert=True,
                )
                if r.upserted_id:
                    new_c += 1
                elif r.modified_count:
                    upd_c += 1
            except Exception as e:
                logger.debug(f"[full-sync] upsert {vin} failed: {e}")
        return new_c, upd_c

    # ── Archive stale ──
    async def _archive_stale(self, sync_start: datetime) -> int:
        if self.db is None:
            return 0
        try:
            r = await self.db.vin_data.update_many(
                {
                    'source': 'bitmotors',
                    '$or': [
                        {'last_seen': {'$lt': sync_start}},
                        {'last_seen': {'$exists': False}},
                    ],
                    'archived': {'$ne': True},
                },
                {'$set': {'archived': True, 'archived_at': datetime.now(timezone.utc)}},
            )
            return r.modified_count or 0
        except Exception as e:
            logger.warning(f"[full-sync] archive stale failed: {e}")
            return 0

    # ── One full cycle ──
    async def run_once(self) -> Dict[str, Any]:
        if self.stats.get('is_scraping'):
            return {'success': False, 'error': 'already_running'}
        self.stats['is_scraping'] = True
        self.stats['run_count'] += 1
        self.stats['current_page'] = 0
        self.stats['current_vehicles'] = 0
        self.stats['last_error'] = None
        self._cancel_current.clear()

        sync_start = datetime.now(timezone.utc)
        self.stats['last_run_started_at'] = sync_start.isoformat()

        total_vehicles = 0
        total_new = 0
        total_upd = 0
        errors = 0
        pages_done = 0

        try:
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=True, headers=LIVE_SEARCH_HEADERS
            ) as client:
                discovered = await self._discover_total_pages(client)
                max_pages = self.settings['max_pages'] or discovered
                if max_pages <= 0:
                    max_pages = 1
                self.stats['last_total_pages_discovered'] = discovered
                self.stats['current_total_pages'] = max_pages

                concurrency = int(self.settings['concurrency'])
                delay = float(self.settings['delay_seconds'])
                sem = asyncio.Semaphore(concurrency)

                async def worker(pg: int):
                    nonlocal total_vehicles, total_new, total_upd, errors, pages_done
                    if self._cancel_current.is_set() or not self.running:
                        return
                    async with sem:
                        # polite delay per request
                        await asyncio.sleep(delay / concurrency)
                        vehicles = await self._scrape_page_with_retry(client, pg)
                        if vehicles:
                            new_c, upd_c = await self._save_batch(vehicles)
                            total_vehicles += len(vehicles)
                            total_new += new_c
                            total_upd += upd_c
                        else:
                            errors += 1
                        pages_done += 1
                        self.stats['current_page'] = pages_done
                        self.stats['current_vehicles'] = total_vehicles

                # Spawn tasks in batches of `concurrency*10` to keep memory low
                batch_size = max(concurrency * 10, 50)
                for start in range(1, max_pages + 1, batch_size):
                    if self._cancel_current.is_set() or not self.running:
                        break
                    end = min(start + batch_size, max_pages + 1)
                    tasks = [asyncio.create_task(worker(p)) for p in range(start, end)]
                    await asyncio.gather(*tasks, return_exceptions=True)

                # Archive stale if we scraped ≥ 80 % of discovered pages
                archived = 0
                if discovered and pages_done >= 0.8 * discovered and not self._cancel_current.is_set():
                    archived = await self._archive_stale(sync_start)

                # Finalize stats
                finished = datetime.now(timezone.utc)
                elapsed = (finished - sync_start).total_seconds()
                self.stats.update({
                    'is_scraping': False,
                    'last_run_finished_at': finished.isoformat(),
                    'last_success_at': finished.isoformat() if not self._cancel_current.is_set() else None,
                    'last_pages_scraped': pages_done,
                    'last_vehicles_found': total_vehicles,
                    'last_new': total_new,
                    'last_updated': total_upd,
                    'last_archived': archived,
                    'last_errors_count': errors,
                    'current_page': 0,
                    'current_total_pages': 0,
                    'current_vehicles': 0,
                })

                return {
                    'success': True,
                    'pages_discovered': discovered,
                    'pages_scraped': pages_done,
                    'vehicles_found': total_vehicles,
                    'new': total_new,
                    'updated': total_upd,
                    'archived': archived,
                    'errors': errors,
                    'elapsed_seconds': round(elapsed, 1),
                    'cancelled': self._cancel_current.is_set(),
                }
        except Exception as e:
            logger.error(f"[full-sync] fatal: {e}")
            self.stats['is_scraping'] = False
            self.stats['last_error'] = str(e)[:300]
            self.stats['last_run_finished_at'] = datetime.now(timezone.utc).isoformat()
            return {'success': False, 'error': str(e)[:200]}

    # ── Daily scheduler loop ──
    async def _scheduler_loop(self):
        logger.info(
            f"[full-sync] scheduler started (daily at {self.settings['daily_hour_utc']:02d}:00 UTC)"
        )
        last_fire_day: Optional[str] = None
        while self.running:
            try:
                now = datetime.now(timezone.utc)
                # Fire condition: it's the target hour AND we haven't fired today
                if self.settings['enabled'] and now.hour == int(self.settings['daily_hour_utc']):
                    day_key = now.strftime('%Y-%m-%d')
                    if day_key != last_fire_day and not self.stats.get('is_scraping'):
                        logger.info(f"[full-sync] scheduled trigger for {day_key}")
                        asyncio.create_task(self.run_once())
                        last_fire_day = day_key
                # Sleep ~60 sec, but wake early on stop
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=60)
                    break
                except asyncio.TimeoutError:
                    continue
            except Exception as e:
                logger.warning(f"[full-sync] scheduler error: {e}")
                await asyncio.sleep(60)
        logger.info("[full-sync] scheduler stopped")

    def start(self) -> Dict[str, Any]:
        if self.running:
            return {'success': False, 'message': 'already running'}
        self.running = True
        self._stop.clear()
        self.task = asyncio.create_task(self._scheduler_loop())
        return {'success': True, 'message': 'full-sync scheduler started'}

    def stop(self) -> Dict[str, Any]:
        if not self.running:
            return {'success': False, 'message': 'not running'}
        self.running = False
        self._stop.set()
        self._cancel_current.set()
        if self.task:
            self.task.cancel()
            self.task = None
        return {'success': True, 'message': 'full-sync scheduler stopped'}

    def cancel_current(self) -> Dict[str, Any]:
        """Cancel an in-flight run_once (scheduler keeps running)."""
        self._cancel_current.set()
        return {'success': True, 'message': 'current run cancelled'}

    def get_stats(self) -> Dict[str, Any]:
        return {
            **self.stats,
            'running': self.running,
            'settings': dict(self.settings),
        }
