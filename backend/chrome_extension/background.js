/* BIBI Cars Parser v4.1 — background service worker.
 *
 * Phase 8 upgrades:
 *   - Stable client_id (uuid in chrome.storage.local) + /api/ext/register
 *   - 60s heartbeat (/api/ext/heartbeat) keeps the registry warm
 *   - Observation relay: any site-specific content script may push a
 *     parsed lot via { type: "BIBI_OBSERVATION" } regardless of whether
 *     the backend asked for it. Background forwards to /api/ext/observation.
 *
 * Legacy responsibilities (from v4.0):
 *   1. Poll /api/ext/jobs for pending VIN lookups.
 *   2. Dispatch each job in parallel by opening hidden tabs.
 *   3. Maintain a heartbeat to /api/v3/heartbeat for legacy panels.
 */

const BACKEND_BASE_KEY = 'bibi_backend_url';
const CLIENT_ID_KEY = 'bibi_ext_client_id';
const CLIENT_SECRET_KEY = 'bibi_ext_client_secret';
const CLIENT_LABEL_KEY = 'bibi_ext_client_label';
const DEFAULT_BACKEND = 'https://dev-ready-8.preview.emergentagent.com';
const POLL_INTERVAL_SEC = 8;
const JOB_TAB_LIFETIME_MS = 8000;
const HEARTBEAT_INTERVAL_SEC = 60;
const EXT_VERSION = '4.1.0';
const CAPABILITIES = ['poctra', 'carsfromwest', 'autoauctionhistory', 'salvagebid'];

// Phase 9.3 — active-job limiter to prevent Chrome overheat
const MAX_ACTIVE_JOBS = 3;
const activeJobs = new Set();

const SITE_URL_BUILDERS = {
  poctra: (vin) => `https://poctra.com/search?term=${encodeURIComponent(vin)}`,
  carsfromwest: (vin) =>
    `https://carsfromwest.com/en/search?keyword=${encodeURIComponent(vin)}`,
  autoauctionhistory: (vin) =>
    `https://autoauctionhistory.com/?s=${encodeURIComponent(vin)}`,
  salvagebid: (vin) => `https://www.salvagebid.com/search?q=${encodeURIComponent(vin)}`,
};

async function getStoredString(key, fallback = '') {
  return new Promise((res) =>
    chrome.storage.local.get([key], (out) => res(out[key] || fallback)),
  );
}
async function setStoredString(key, value) {
  return new Promise((res) =>
    chrome.storage.local.set({ [key]: value }, () => res(true)),
  );
}
async function getBackendUrl() {
  return getStoredString(BACKEND_BASE_KEY, DEFAULT_BACKEND);
}
async function getOrCreateClientId() {
  let cid = await getStoredString(CLIENT_ID_KEY, '');
  if (!cid) {
    cid =
      'bibi-' +
      (crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    await setStoredString(CLIENT_ID_KEY, cid);
  }
  return cid;
}
async function getClientLabel() {
  const lbl = await getStoredString(CLIENT_LABEL_KEY, '');
  return lbl || `chrome-${navigator.platform || 'unknown'}`;
}
async function getClientSecret() {
  return getStoredString(CLIENT_SECRET_KEY, '');
}

// HMAC-SHA256 helper. Mirrors backend/security.py format:
//    msg = `${ts}\n${METHOD}\n${PATH}\n${sha256(body)}`
async function hmacSign({ method, path, body }) {
  const secret = await getClientSecret();
  if (!secret) return { skip: true };
  const ts = Math.floor(Date.now() / 1000).toString();
  const enc = new TextEncoder();
  const bodyBytes = enc.encode(body || '');
  const bodyHashBuf = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHashHex = Array.from(new Uint8Array(bodyHashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const msg = `${ts}\n${method.toUpperCase()}\n${path}\n${bodyHashHex}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  const sig = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const nonce =
    crypto.randomUUID ? crypto.randomUUID() : `${ts}-${Math.random()}`;
  return {
    skip: false,
    headers: {
      'X-Ext-Timestamp': ts,
      'X-Ext-Signature': sig,
      'X-Ext-Client': await getOrCreateClientId(),
      'X-Ext-Nonce': nonce,
    },
  };
}

async function backendFetch(path, init = {}) {
  const base = await getBackendUrl();
  const url = base.replace(/\/$/, '') + path;
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body || '';
  const sign = await hmacSign({ method, path, body });
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    init.headers || {},
    sign.skip ? {} : sign.headers,
  );
  return fetch(url, { ...init, headers, body: body || undefined });
}

// ───────────────────────────────────────────────────────────────────
// Phase 8.1 — Self-registration (runs once per service worker boot)
// ───────────────────────────────────────────────────────────────────
async function selfRegister() {
  try {
    const cid = await getOrCreateClientId();
    const label = await getClientLabel();
    const body = JSON.stringify({
      client_id: cid,
      label,
      version: EXT_VERSION,
      capabilities: CAPABILITIES,
    });
    await backendFetch('/api/ext/register', { method: 'POST', body });
    console.log('[BIBIv4.1] registered as', cid);
  } catch (err) {
    console.warn('[BIBIv4.1] register failed', err);
  }
}

async function sendClientHeartbeat() {
  try {
    const cid = await getOrCreateClientId();
    const body = JSON.stringify({
      client_id: cid,
      online: true,
      version: EXT_VERSION,
      capabilities: CAPABILITIES,
    });
    await backendFetch('/api/ext/heartbeat', { method: 'POST', body });
  } catch (err) {
    console.warn('[BIBIv4.1] heartbeat failed', err);
  }
}

selfRegister();

// ───────────────────────────────────────────────────────────────────
// Job dispatch (Phase 9.3 — active-job limiter to prevent Chrome overheat)
// ───────────────────────────────────────────────────────────────────
async function pickJobs() {
  // Adaptive pull size: never request more jobs than we can dispatch.
  const slots = MAX_ACTIVE_JOBS - activeJobs.size;
  if (slots <= 0) return [];
  try {
    const r = await backendFetch(`/api/ext/jobs?limit=${slots}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.jobs) ? j.jobs : [];
  } catch (err) {
    console.warn('[BIBIv4.1] /api/ext/jobs failed', err);
    return [];
  }
}

async function dispatchJob(job) {
  if (activeJobs.size >= MAX_ACTIVE_JOBS) {
    console.log('[BIBIv4.1] limiter — skipping', job.request_id, 'active=', activeJobs.size);
    return;
  }
  const sources = (job.sources || []).filter((s) => SITE_URL_BUILDERS[s]);
  if (!sources.length) return;
  activeJobs.add(job.request_id);
  console.log('[BIBIv4.1] dispatch', job.request_id, job.vin, sources, 'active=', activeJobs.size);
  try {
    await Promise.all(
      sources.map(async (site) => {
        try {
          const url = SITE_URL_BUILDERS[site](job.vin);
          const tab = await chrome.tabs.create({ url, active: false });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (rid, vin, source) => {
              window.__BIBI_JOB__ = { request_id: rid, vin, source };
            },
            args: [job.request_id, job.vin, site],
          });
          setTimeout(() => {
            chrome.tabs.remove(tab.id).catch(() => {});
          }, JOB_TAB_LIFETIME_MS);
        } catch (err) {
          console.warn('[BIBIv4.1] tab open failed for', site, err);
        }
      }),
    );
  } finally {
    // Release the slot a bit after the lifetime to avoid races.
    setTimeout(() => activeJobs.delete(job.request_id), JOB_TAB_LIFETIME_MS + 500);
  }
}

// ───────────────────────────────────────────────────────────────────
// Push relay — content scripts call us via runtime.sendMessage to
// bypass CORS on the destination domain.
// ───────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'BIBI_PUSH') {
    (async () => {
      try {
        const cid = await getOrCreateClientId();
        const enriched = Object.assign({}, msg.payload || {}, { client_id: cid });
        const body = JSON.stringify(enriched);
        const r = await backendFetch('/api/ext/push', { method: 'POST', body });
        sendResponse({ ok: true, response: await r.json() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }
  if (msg && msg.type === 'BIBI_OBSERVATION') {
    (async () => {
      try {
        const cid = await getOrCreateClientId();
        const enriched = Object.assign({}, msg.payload || {}, { client_id: cid });
        const body = JSON.stringify(enriched);
        const r = await backendFetch('/api/ext/observation', {
          method: 'POST',
          body,
        });
        sendResponse({ ok: true, response: await r.json() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'BIBI_HEALTH_GET') {
    backendFetch('/api/ext/health')
      .then((r) => r.json())
      .then((j) => sendResponse(j))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg && msg.type === 'BIBI_CLIENT_INFO') {
    (async () => {
      sendResponse({
        client_id: await getOrCreateClientId(),
        label: await getClientLabel(),
        version: EXT_VERSION,
        capabilities: CAPABILITIES,
        backend: await getBackendUrl(),
        active_jobs: activeJobs.size,
        max_active_jobs: MAX_ACTIVE_JOBS,
      });
    })();
    return true;
  }
  return false;
});

// ───────────────────────────────────────────────────────────────────
// Polling + heartbeat alarms
// ───────────────────────────────────────────────────────────────────
chrome.alarms.create('bibi_pull', {
  delayInMinutes: 0.05,
  periodInMinutes: POLL_INTERVAL_SEC / 60,
});
chrome.alarms.create('bibi_heartbeat', {
  delayInMinutes: 0.05,
  periodInMinutes: HEARTBEAT_INTERVAL_SEC / 60,
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'bibi_pull') {
    const jobs = await pickJobs();
    for (const j of jobs) {
      dispatchJob(j).catch((e) => console.warn('[BIBIv4.1] dispatch err', e));
    }
  }
  if (alarm.name === 'bibi_heartbeat') {
    sendClientHeartbeat();
    try {
      await backendFetch('/api/v3/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          extension: 'BIBI Cars Parser',
          version: EXT_VERSION,
          ts: Date.now(),
        }),
      });
    } catch (err) {
      // soft-fail
    }
  }
});

console.log('[BIBIv4.1] background ready, poll=' + POLL_INTERVAL_SEC + 's');
