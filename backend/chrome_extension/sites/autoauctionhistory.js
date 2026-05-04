/* sites/autoauctionhistory.js — archive parser.
 *
 * autoauctionhistory.com mirrors past Copart / IAAI lots.  The detail
 * URL pattern is /vin-{VIN} or /lot-{lot}-{slug}.  Most fields are
 * publicly visible without login; "Premium" sections (auction date,
 * full bid history) are gated behind a paid plan and are skipped.
 */

(async function () {
  const job = window.bibiSender ? window.bibiSender.pickJob() : null;
  const isObservation = !job;
  let targetVin = job ? (job.vin || '').toUpperCase() : null;

  function navigateToVinIfNeeded() {
    if (window.location.pathname.toUpperCase().includes(targetVin)) return true;
    const candidate = Array.from(document.querySelectorAll('a[href]'))
      .find((a) => (a.href || '').toUpperCase().includes(targetVin));
    if (candidate) {
      window.location.href = candidate.href;
      return false;
    }
    return false;
  }

  function parseDetail() {
    const txt = document.body ? document.body.innerText || '' : '';
    if (!txt) return null;
    const vm = txt.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    if (!vm || vm[0].toUpperCase() !== targetVin) return null;

    const titleEl = document.querySelector('h1');
    const title = titleEl ? titleEl.innerText.trim() : '';
    const yearMatch = title.match(/(19|20)\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
    const afterYear = yearMatch ? title.slice(yearMatch.index + 4).trim() : title;
    const make = afterYear.split(/\s+/)[0] || null;
    const model = afterYear.split(/\s+/).slice(1, 3).join(' ') || null;

    function pick(label) {
      const re = new RegExp(label + '[\\s\\W]*([^\\n]+)', 'i');
      const m = txt.match(re);
      return m ? m[1].trim() : null;
    }

    const damage = pick('Primary damage') || pick('Damage');
    const location = pick('Location');
    const odoRaw = pick('Odometer');
    const finalBidRaw = pick('Final bid') || pick('Sold for') || pick('Sale price');
    const auction = pick('Auction');

    const images = window.bibiSender.uniqueImages(
      Array.from(document.images)
        .map((i) => i.src)
        .filter(
          (s) => /autoauctionhistory|iaai|copart|amazonaws/i.test(s),
        )
        .filter((s) => !/logo|sprite|icon/i.test(s)),
    );

    return {
      source: 'autoauctionhistory',
      vin: targetVin,
      title: title || null,
      year,
      make,
      model,
      damage,
      location,
      auction,
      sold_price_usd: window.bibiSender.moneyToInt(finalBidRaw),
      odometer_mi: window.bibiSender.moneyToInt(odoRaw),
      url: window.location.href,
      images: images.slice(0, 30),
      image_count: images.length,
    };
  }

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (document.querySelector('h1')) break;
  }

  if (isObservation) {
    const txt = document.body ? document.body.innerText || '' : '';
    const vm = txt.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    if (!vm) return;
    targetVin = vm[0].toUpperCase();
  }

  if (!navigateToVinIfNeeded()) return;

  const data = parseDetail();
  if (data) {
    if (isObservation) {
      await window.bibiSender.observe(data);
    } else {
      await window.bibiSender.send(data);
    }
  }
})();
