/* sites/salvagebid.js — active Copart/IAAI inventory parser.
 *
 * Salvagebid is a SPA powered by /rest-api/v1.0/lots/* but the API is
 * blocked from datacenter IPs by Cloudflare.  Inside the user's real
 * browser session the SPA hydrates the page after which DOM contains
 * the VIN, lot, prices, photos and damage.
 *
 * URL pattern after navigation: /lot/{lotId}-{auction}-{slug}
 * Search URL: /search?q={VIN}
 */

(async function () {
  const job = window.bibiSender ? window.bibiSender.pickJob() : null;
  const isObservation = !job;
  let targetVin = job ? (job.vin || '').toUpperCase() : null;

  function navigateToLotIfNeeded() {
    if (/\/lot\//.test(window.location.pathname)) return true;
    const link = Array.from(document.querySelectorAll('a[href*="/lot/"]'))
      .find((a) => {
        const ctx = (a.innerText || '') + ' ' + (a.getAttribute('aria-label') || '');
        return ctx.toUpperCase().includes(targetVin);
      });
    if (link) {
      window.location.href = link.href;
      return false;
    }
    return false;
  }

  function parseDetail() {
    const txt = document.body ? document.body.innerText || '' : '';
    if (!txt) return null;
    const vm = txt.match(/\bVIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i)
      || txt.match(new RegExp('\\b' + targetVin + '\\b'));
    if (!vm) return null;
    const vin = (vm[1] || vm[0]).toUpperCase();
    if (vin !== targetVin) return null;

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

    const lotMatch = window.location.pathname.match(/\/lot\/(\d{6,})/);
    const lot = lotMatch ? lotMatch[1] : pick('Lot');
    const damage = pick('Primary Damage') || pick('Damage');
    const location = pick('Location') || pick('Branch');
    const odoRaw = pick('Odometer');
    const currentBidRaw = pick('Current bid') || pick('My max bid');
    const buyNowRaw = pick('Buy it now');
    const auction = pick('Auction');

    const images = window.bibiSender.uniqueImages(
      Array.from(document.images)
        .map((i) => i.src)
        .filter(
          (s) =>
            /salvagebid|cs\.copart|vis\.iaai|cloudfront|amazonaws/i.test(s),
        )
        .filter((s) => !/logo|sprite|icon|placeholder/i.test(s)),
    );

    return {
      source: 'salvagebid',
      vin,
      lot,
      title: title || null,
      year,
      make,
      model,
      damage,
      location,
      auction,
      current_bid_usd: window.bibiSender.moneyToInt(currentBidRaw),
      buy_now_usd: window.bibiSender.moneyToInt(buyNowRaw),
      odometer_mi: window.bibiSender.moneyToInt(odoRaw),
      url: window.location.href,
      images: images.slice(0, 30),
      image_count: images.length,
    };
  }

  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (document.querySelector('h1')) break;
  }

  if (isObservation) {
    const txt = document.body ? document.body.innerText || '' : '';
    const vm = txt.match(/\bVIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (!vm) return;
    targetVin = vm[1].toUpperCase();
  }

  if (!navigateToLotIfNeeded()) return;

  const data = parseDetail();
  if (data) {
    if (isObservation) {
      await window.bibiSender.observe(data);
    } else {
      await window.bibiSender.send(data);
    }
  }
})();
