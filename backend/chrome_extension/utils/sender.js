/* utils/sender.js — shared helper used by every site-specific content
 * script.  Wraps chrome.runtime.sendMessage so individual parsers can
 * focus on DOM extraction and not worry about HMAC signing or backend
 * URL configuration (all that is centralised in background.js).
 *
 * Usage from a content script:
 *    bibiSender.send({ source: "poctra", vin, lot, ... });
 *
 * Notes:
 *   - The content script is run in the page "isolated world", so this
 *     file MUST be loaded BEFORE the site-specific parser via the
 *     manifest "js" array.
 *   - We always include the request_id captured from window.__BIBI_JOB__,
 *     so the resolver can stitch replies back to the originating job.
 */

(function () {
  if (window.bibiSender) return;

  const RING_KEY = '__BIBI_SENT_FOR_JOB__';

  function pickJob() {
    return window.__BIBI_JOB__ || null;
  }

  function alreadySent(rid) {
    if (!rid) return false;
    return (window[RING_KEY] || {})[rid] === true;
  }

  function markSent(rid) {
    if (!rid) return;
    window[RING_KEY] = window[RING_KEY] || {};
    window[RING_KEY][rid] = true;
  }

  async function send(payload) {
    if (!payload || typeof payload !== 'object') return;
    const job = pickJob();
    const enriched = Object.assign({}, payload);
    if (job) {
      enriched.request_id = job.request_id;
      if (!enriched.vin) enriched.vin = job.vin;
      if (!enriched.source) enriched.source = job.source;
      if (alreadySent(job.request_id)) return;
      markSent(job.request_id);
    }
    try {
      await chrome.runtime.sendMessage({
        type: 'BIBI_PUSH',
        payload: enriched,
      });
      console.log('[BIBI sender] pushed', enriched.source, enriched.vin || '');
    } catch (err) {
      console.warn('[BIBI sender] push failed', err);
    }
  }

  function findVinAnywhere(rootText) {
    const m = rootText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    return m ? m[0] : null;
  }

  function moneyToInt(s) {
    if (!s) return null;
    const n = String(s).replace(/[^\d]/g, '');
    return n ? parseInt(n, 10) : null;
  }

  function uniqueImages(srcs) {
    const out = [];
    const seen = new Set();
    for (const s of srcs) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  async function observe(payload) {
    /* Observation push — fires regardless of an active job.  Used by
     * content scripts when the user is just browsing a CF site so we
     * can pre-warm the resolver cache.  Payload MUST include source
     * and 17-char vin; everything else is optional but encouraged.
     */
    if (!payload || typeof payload !== 'object') return;
    const vin = (payload.vin || '').toString().trim().toUpperCase();
    if (vin.length !== 17) return;
    const enriched = Object.assign({}, payload, { vin });
    try {
      await chrome.runtime.sendMessage({
        type: 'BIBI_OBSERVATION',
        payload: enriched,
      });
      console.log('[BIBI sender] observed', enriched.source, vin);
    } catch (err) {
      console.warn('[BIBI sender] observation failed', err);
    }
  }

  window.bibiSender = {
    send,
    observe,
    pickJob,
    findVinAnywhere,
    moneyToInt,
    uniqueImages,
  };
})();
