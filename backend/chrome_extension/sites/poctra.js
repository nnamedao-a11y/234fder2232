/* sites/poctra.js — archive lookup parser.
 *
 * Poctra archives historical Copart / IAAI auction lots and exposes
 * VIN, year/make/model, sale price, mileage, location, and full image
 * gallery on a public detail page.  We:
 *   1. Detect the page kind: search results vs detail.
 *   2. If results, click into the first lot whose VIN matches the job.
 *   3. If detail, parse the structured table.
 *
 * The page is server-rendered, but Cloudflare may inject a 5-second
 * "Just a moment" interstitial.  We wait up to 6 s for the real DOM to
 * settle before parsing.
 */

(async function () {
  const job = window.bibiSender ? window.bibiSender.pickJob() : null;
  // No job? still parse + push observation so the resolver gets it for free.
  const isObservation = !job;

  // For observation mode we still need a target VIN — try to extract
  // from the page itself.
  let targetVin = job ? (job.vin || '').toUpperCase() : null;

  function vinFromBody() {
    const txt = document.body ? document.body.innerText || '' : '';
    const m = txt.match(new RegExp('VIN[:\\s]*([A-HJ-NPR-Z0-9]{17})', 'i'))
      || txt.match(new RegExp('\\b' + targetVin + '\\b'));
    if (m) return (m[1] || m[0]).toUpperCase();
    return null;
  }

  function parseDetail() {
    const txt = document.body ? document.body.innerText || '' : '';
    if (!txt) return null;
    const vin = vinFromBody();
    if (!vin || vin !== targetVin) return null;

    const titleEl =
      document.querySelector('h1') || document.querySelector('h2');
    const title = titleEl ? titleEl.innerText.trim() : '';

    const yearMatch = title.match(/(19|20)\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
    const afterYear = yearMatch ? title.slice(yearMatch.index + 4).trim() : title;
    const tokens = afterYear.split(/\s+/).filter(Boolean);
    const make = tokens[0] || null;
    const model = tokens.slice(1).join(' ') || null;

    function pick(label) {
      const re = new RegExp(label + '[:\\s]*([^\\n]+)', 'i');
      const m = txt.match(re);
      return m ? m[1].trim() : null;
    }

    const damage = pick('Primary Damage') || pick('Damage');
    const location = pick('Location') || pick('City');
    const acvRaw = pick('Actual Cash Value') || pick('ACV');
    const finalBidRaw = pick('Final bid') || pick('Sold for');
    const odoRaw = pick('Odometer');
    const auction = pick('Auction') || pick('Source');
    const saleDate = pick('Sale date') || pick('Sale Date');

    const images = window.bibiSender.uniqueImages(
      Array.from(document.images)
        .map((i) => i.src)
        .filter((s) => /poctra|iaai|copart|s\d?\.poctra/i.test(s))
        .filter((s) => !/logo|sprite|icon/i.test(s)),
    );

    return {
      source: 'poctra',
      vin,
      title: title || null,
      year,
      make: make ? make.toString() : null,
      model: model ? model.toString() : null,
      damage,
      location,
      auction,
      sale_date: saleDate,
      acv_usd: window.bibiSender.moneyToInt(acvRaw),
      sold_price_usd: window.bibiSender.moneyToInt(finalBidRaw),
      odometer_mi: window.bibiSender.moneyToInt(odoRaw),
      url: window.location.href,
      images: images.slice(0, 30),
      image_count: images.length,
    };
  }

  function parseSearchAndNavigate() {
    const links = Array.from(
      document.querySelectorAll('a[href*="/id-"]'),
    );
    for (const a of links) {
      const text = (a.innerText || '').toUpperCase();
      const img = a.querySelector('img');
      const alt = img ? (img.alt || '').toUpperCase() : '';
      if (text.includes(targetVin) || alt.includes(targetVin)) {
        window.location.href = a.href;
        return true;
      }
    }
    return false;
  }

  // Wait up to 6s for CF challenge or hydration
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (vinFromBody()) break;
    if (document.querySelector('a[href*="/id-"]')) break;
  }

  // Observation mode — try to pull a VIN out of the page.
  if (isObservation) {
    const vin = vinFromBody();
    if (!vin) return;
    targetVin = vin;
  }

  // If we are on a search page, jump to the matching lot.
  if (
    !document.body ||
    !document.body.innerText ||
    !/VIN[:\s]*[A-HJ-NPR-Z0-9]{17}/i.test(document.body.innerText)
  ) {
    if (parseSearchAndNavigate()) return; // navigation will reload page
  }

  const data = parseDetail();
  if (data) {
    if (isObservation) {
      await window.bibiSender.observe(data);
    } else {
      await window.bibiSender.send(data);
    }
  }
})();
