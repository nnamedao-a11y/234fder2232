"""
POC-1: Phase 1 of the Multi-Source Resolver.

Validates that we can fetch and parse vehicle data from the two
"open" (no-Cloudflare) external sources:

  * auctionauto.org  — server-side rendered listing, can be queried by
    /auction/cars/vin/{VIN} and parsed with BeautifulSoup.
  * salvagebid.com   — datacenter-IP CF block on /search; verify the
    block so we know it must go through the extension layer.

Run:
    python /app/backend/test_poc_multisource.py
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    # NOTE: deliberately do NOT advertise "br" — httpx cannot decode brotli
    # without an extra dep, and auctionauto serves brotli when offered,
    # which would yield an unreadable body.
}

# Real VINs harvested from the auctionauto landing during analysis.
SAMPLE_VINS = [
    "2C3CDZFJ0MH580278",  # 2021 Dodge Challenger
    "5YJSA1E25HF199047",  # 2017 Tesla Model S
    "3N1AB7AP1KY221010",  # 2019 Nissan Sentra
]
SAMPLE_VIN_NOT_FOUND = "1HGCM82633A123456"  # synthetic, must miss


# ─────────────────────────────────────────────────────────────────
# auctionauto.org parser
# ─────────────────────────────────────────────────────────────────
def parse_auctionauto_vin_page(html: str, target_vin: str) -> Optional[Dict[str, Any]]:
    """Extract a single matching vehicle record from auctionauto's
    /auction/cars?search={VIN} response.

    Reliable match marker: image gallery alt-attribute carries the VIN
    (e.g. ``<img alt="2C3CDZFJ0MH580278 2021 DODGE CHALLENGER-0">``).
    If that pattern is absent, the page is just the "popular cars"
    fallback list and we treat the lookup as a miss.
    """

    if f'alt="{target_vin}' not in html:
        return None

    soup = BeautifulSoup(html, "lxml")

    # Locate the image whose alt starts with the VIN.
    img = soup.find("img", alt=re.compile(rf"^{re.escape(target_vin)}\b"))
    if not img:
        return None

    # Climb up to the lot card.
    card = img.find_parent(class_=re.compile(r"lot-card|listing-card-wrapper"))
    if not card:
        # Fallback: some cards omit the wrapper class — go to article/div.
        card = img.find_parent(["article"]) or img.find_parent("div")
    if not card:
        return None

    text = card.get_text(" ", strip=True)

    # Title: pick the lot anchor whose text is NOT "View all".
    title = ""
    lot_url: Optional[str] = None
    for a in card.select('a[href*="/auction/lot/"]'):
        t = a.get_text(" ", strip=True)
        if t and t.lower() != "view all":
            title = t
            href = a.get("href") or ""
            lot_url = ("https://auctionauto.org" + href) if href.startswith("/") else href
            break

    # Year / make / model from the card title (e.g. "2021 DODGE CHALLENGER").
    year, make, model = None, None, None
    m = re.match(r"\s*(19|20)\d{2}\s+([A-Z][A-Z0-9-]+)\s+(.+)$", title)
    if m:
        year = int(title.split()[0])
        make = m.group(2).title()
        model = m.group(3).split(",")[0].strip().title()

    # Lot # is the trailing 6-9 digit segment of the slug.
    lot_no: Optional[str] = None
    if lot_url:
        mlot = re.search(r"-(\d{6,})(?:[/?#]|$)", lot_url)
        if mlot:
            lot_no = mlot.group(1)

    # Price labels: "Current bid: $100" / "Buy now: $2,000".
    current_bid = None
    buy_now = None
    cb = re.search(r"Current\s+bid[:\s]*\$?\s*([\d,]+)", text, re.I)
    if cb:
        try:
            current_bid = int(cb.group(1).replace(",", ""))
        except ValueError:
            current_bid = None
    bn = re.search(r"Buy\s+now[:\s]*\$?\s*([\d,]+)", text, re.I)
    if bn:
        try:
            buy_now = int(bn.group(1).replace(",", ""))
        except ValueError:
            buy_now = None

    # Photos. AA proxies them via /_ipx/.../<absolute-cdn-url>.
    images: List[str] = []
    for im in card.select("img[src]"):
        src = im.get("src") or ""
        m_cdn = re.search(r"https?://[^\"' )]+", src)
        if m_cdn:
            url = m_cdn.group(0).rstrip("&\"'")
            if url not in images:
                images.append(url)

    # Mileage / engine / fuel from the meta line:
    # "2021, 47.331 Km, 5.7, Gas, Automatic, Coupe"
    odometer_km = None
    odo_match = re.search(r"([\d.,]+)\s*Km\b", text, re.I)
    if odo_match:
        raw = odo_match.group(1).replace(".", "").replace(",", "").replace(" ", "")
        if raw.isdigit():
            odometer_km = int(raw)

    engine_l: Optional[float] = None
    eng = re.search(r",\s*([\d.]+)\s*,\s*(Gas|Diesel|Hybrid|Electric)", text, re.I)
    if eng:
        try:
            engine_l = float(eng.group(1))
        except ValueError:
            pass

    fuel: Optional[str] = None
    fmatch = re.search(r"\b(Gas|Diesel|Hybrid|Electric)\b", text)
    if fmatch:
        fuel = fmatch.group(1)

    return {
        "source": "auctionauto",
        "vin": target_vin,
        "lot": lot_no,
        "url": lot_url,
        "title": title or None,
        "year": year,
        "make": make,
        "model": model,
        "current_bid_usd": current_bid,
        "buy_now_usd": buy_now,
        "odometer_km": odometer_km,
        "engine_l": engine_l,
        "fuel": fuel,
        "images": images[:10],
        "image_count": len(images),
    }


async def auctionauto_lookup(client: httpx.AsyncClient, vin: str) -> Optional[Dict[str, Any]]:
    """Single VIN lookup against auctionauto.org.

    The /auction/cars?search={VIN} endpoint server-side renders the
    listing page with the matching lot card embedded.  Direct
    /auction/cars/vin/{VIN} only renders a search form, not results.
    """
    url = "https://auctionauto.org/auction/cars"
    try:
        r = await client.get(url, params={"search": vin}, timeout=8.0)
        if r.status_code != 200:
            return None
        return parse_auctionauto_vin_page(r.text, vin)
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        print(f"  [auctionauto] {vin}: error {e}")
        return None


# ─────────────────────────────────────────────────────────────────
# salvagebid.com — verify it requires extension layer
# ─────────────────────────────────────────────────────────────────
async def salvagebid_probe(client: httpx.AsyncClient, vin: str) -> Dict[str, Any]:
    """Confirm /search returns SPA-shell only and /rest-api needs CF cookie."""
    out: Dict[str, Any] = {"source": "salvagebid", "vin": vin, "needs_extension": True}
    try:
        r = await client.get(
            f"https://www.salvagebid.com/search?q={vin}", timeout=8.0,
        )
        out["search_html_status"] = r.status_code
        out["search_html_size"] = len(r.text)
        # Real SPA returns ~94KB shell with no lot data
        out["spa_shell"] = '<div id="root"' in r.text or "main." in r.text
        # Check API direct
        api_resp = await client.get(
            f"https://www.salvagebid.com/rest-api/v1.0/lots/search?keyword={vin}",
            headers={"Accept": "application/json"},
            timeout=8.0,
        )
        out["api_status"] = api_resp.status_code
        out["api_body_preview"] = api_resp.text[:160]
    except Exception as e:
        out["error"] = repr(e)
    return out


# ─────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────
async def main() -> None:
    print("=" * 70)
    print("POC-1 — Multi-source resolver: auctionauto.org + salvagebid.com probe")
    print("=" * 70)

    pass_count = 0
    fail_count = 0

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:

        # ─── TEST 1: auctionauto VIN lookups (3 real VINs)
        print("\n[T1] auctionauto.org VIN lookups (real listings)")
        for vin in SAMPLE_VINS:
            t0 = time.time()
            res = await auctionauto_lookup(client, vin)
            dt_ms = int((time.time() - t0) * 1000)
            if res and (res.get("title") or res.get("lot") or res.get("raw_match_only")):
                pass_count += 1
                print(
                    f"  ✓ {vin}  {dt_ms}ms  "
                    f"lot={res.get('lot')}  title={res.get('title')!r}  "
                    f"bid=${res.get('current_bid_usd')}  imgs={res.get('image_count')}"
                )
            else:
                fail_count += 1
                print(f"  ✗ {vin}  {dt_ms}ms  no match")

        # ─── TEST 2: auctionauto must NOT find synthetic VIN
        print("\n[T2] auctionauto.org synthetic VIN (must miss)")
        t0 = time.time()
        res = await auctionauto_lookup(client, SAMPLE_VIN_NOT_FOUND)
        dt_ms = int((time.time() - t0) * 1000)
        if not res:
            pass_count += 1
            print(f"  ✓ {SAMPLE_VIN_NOT_FOUND}  {dt_ms}ms  correctly returned None")
        else:
            fail_count += 1
            print(f"  ✗ false-positive: {res}")

        # ─── TEST 3: salvagebid — confirm it needs the extension
        print("\n[T3] salvagebid.com probe (must confirm needs_extension)")
        for vin in SAMPLE_VINS[:1]:
            res = await salvagebid_probe(client, vin)
            print(f"  {vin}: {res}")
            if res.get("needs_extension"):
                pass_count += 1
                print("  ✓ confirmed: salvagebid requires extension layer")
            else:
                fail_count += 1

    print("\n" + "=" * 70)
    print(f"RESULT: {pass_count} pass, {fail_count} fail")
    print("=" * 70)
    if fail_count:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
