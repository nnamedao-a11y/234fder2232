/* sites/carsfromwest.js — active-lot parser for carsfromwest.com.
 *
 * VIN is hidden behind login on the listing page, so we operate on the
 * lot detail URL: /en/lot/{auction}-{lot}-{slug}.  When the user is
 * logged in, the full VIN appears as <strong>WAUS...</strong> next to
 * the "VIN" label.  Even without login we can still extract lot, year,
 * make, model, photos, damage and prices.
 */

(async function () {
  const job = window.bibiSender ? window.bibiSender.pickJob() : null;
  const isObservation = !job;
  let targetVin = job ? (job.vin || '').toUpperCase() : null;

  function findLotInUrl(href) {
    const m = href.match(/\/en\/lot\/(?:iaai|copart|aa)-(\d{6,})/i);
    return m ? m[1] : null;
  }

  async function navigateToLot() {
    if (/\/en\/lot\//.test(window.location.pathname)) return true;
    // We are on /en/search or homepage. Find a card matching the VIN.
    const cards = Array.from(document.querySelectorAll('a[href*="/en/lot/"]'));
    for (const a of cards) {
      const ctx = (a.innerText || '') + ' ' + (a.getAttribute('aria-label') || '');
      if (ctx.toUpperCase().includes(targetVin)) {
        window.location.href = a.href;
        return false;
      }
    }
    // If the VIN is not on the listing (CFW hides it before login), try
    // direct URL guess: /en/lot/copart-{lot}-{slug}… we cannot guess lot
    // without prior data, so abort silently.
    return false;
  }

  function parseDetail() {
    const txt = document.body ? document.body.innerText || '' : '';
    if (!txt) return null;

    // VIN is shown only when logged in. Without login we still send the
    // job's VIN so the resolver can correlate by request_id.
    let vin = targetVin;
    const vm = txt.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vm && vm[1].toUpperCase() === targetVin) vin = vm[1].toUpperCase();

    const lot = findLotInUrl(window.location.pathname);

    const titleEl = document.querySelector('h1');
    const title = titleEl ? titleEl.innerText.trim() : '';
    const yearMatch = title.match(/(19|20)\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
    const afterYear = yearMatch ? title.slice(yearMatch.index + 4).trim() : title;
    const make = afterYear.split(/\s+/)[0] || null;
    const model = afterYear.split(/\s+/).slice(1, 3).join(' ') || null;

    function pick(label) {
      const re = new RegExp(label + '\\s*([^\\n]+)', 'i');
      const m = txt.match(re);
      return m ? m[1].trim() : null;
    }

    const retailRaw = pick('Retail price');
    const estimatedRaw = pick('Estimated bid') || pick('Estimated repair');
    const buyNowRaw = pick('Buy now');
    const damage = pick('Primary Damage') || pick('Damage');
    const odoRaw = pick('Odometer');
    const fuel = pick('Fuel');
    const auction = /\/en\/lot\/(iaai|copart|aa)-/i.exec(window.location.pathname)?.[1]?.toUpperCase() || null;

    const images = window.bibiSender.uniqueImages(
      Array.from(document.images)
        .map((i) => i.src)
        .filter((s) => /vis\.iaai|cs\.copart|carsfromwest|cdn-cgi\/image/i.test(s))
        .filter((s) => !/logo|sprite|icon|placeholder/i.test(s)),
    );

    return {
      source: 'carsfromwest',
      vin,
      lot,
      title: title || null,
      year,
      make,
      model,
      damage,
      auction,
      fuel,
      retail_usd: window.bibiSender.moneyToInt(retailRaw),
      estimated_bid_usd: window.bibiSender.moneyToInt(estimatedRaw),
      buy_now_usd: window.bibiSender.moneyToInt(buyNowRaw),
      odometer_mi: window.bibiSender.moneyToInt(odoRaw),
      url: window.location.href,
      images: images.slice(0, 30),
      image_count: images.length,
    };
  }

  // CF challenge wait
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (document.querySelector('h1')) break;
  }

  // Observation mode — extract VIN from the page if present.
  if (isObservation) {
    const txt = document.body ? document.body.innerText || '' : '';
    const vm = txt.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (!vm) return;
    targetVin = vm[1].toUpperCase();
  }

  const ok = await navigateToLot();
  if (!ok) return;

  const data = parseDetail();
  if (data) {
    if (isObservation) {
      await window.bibiSender.observe(data);
    } else {
      await window.bibiSender.send(data);
    }
  }
})();
