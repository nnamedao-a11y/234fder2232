/**
 * BIBI Vessel Sync — background service worker (v3.0).
 *
 * KEY CHANGE vs v2.x:
 *   The CRM backend URL is no longer hardcoded at download time.
 *   It is entered by the manager in the popup and saved to
 *   chrome.storage.local.backendUrl. Every tick reads the current value
 *   from storage, so changing URL takes effect immediately.
 *
 * Everything else (VF fetch + /api/pub/mp2 + /api/pub/sfl binary,
 * endpoint candidates, 2-min alarm) stays the same.
 */

const VF = "https://www.vesselfinder.com";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const TICK_PERIOD_MIN = 2;
const MAX_JOBS_PER_TICK = 5;
const PER_REQUEST_TIMEOUT_MS = 15_000;

const VF_COORD_SCALE = 600000;
const DEFAULT_ZOOM = 8;

function scaleBboxForVF(bboxStr) {
  if (!bboxStr) return "";
  const parts = String(bboxStr).split(",").map((s) => s.trim());
  if (parts.length !== 4) return "";
  const asNums = parts.map(Number);
  if (asNums.some((n) => Number.isNaN(n))) return "";
  const alreadyScaled = asNums.every((n) => Math.abs(n) > 1000);
  const scaled = alreadyScaled
    ? asNums.map((n) => Math.floor(n))
    : asNums.map((n) => Math.floor(n * VF_COORD_SCALE));
  return scaled.join(",");
}
function buildVfQuery(bbox, zoom = DEFAULT_ZOOM) {
  const scaled = scaleBboxForVF(bbox);
  const ref = Math.floor(Math.random() * 99999);
  return `bbox=${encodeURIComponent(scaled)}&zoom=${zoom}&mmsi=0&ref=${ref}`;
}

const ENDPOINT_CANDIDATES = [
  { name: "api-pub-mp2", binary: true,  pathBuilder: (bbox) => `/api/pub/mp2?${buildVfQuery(bbox)}` },
  { name: "api-pub-sfl", binary: true,  pathBuilder: (bbox) => `/api/pub/sfl?${buildVfQuery(bbox)}` },
  { name: "mp2",     binary: true,  pathBuilder: (bbox) => `/mp2?${buildVfQuery(bbox)}` },
  { name: "sfl",     binary: true,  pathBuilder: (bbox) => `/sfl?${buildVfQuery(bbox)}` },
  { name: "refresh", binary: false, pathBuilder: ()     => `/refresh` },
];

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchWithTimeout(url, opts = {}, timeout = PER_REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

// ─── Backend URL from storage ───
async function getBackendUrl() {
  try {
    const { backendUrl } = await chrome.storage.local.get(["backendUrl"]);
    if (!backendUrl) return null;
    return String(backendUrl).replace(/\/+$/, "");
  } catch { return null; }
}

// ─── HMAC helpers (match popup.js; kept here for the SW isolation) ───
// Build-time injection: replace via ./build.sh <SECRET>
const BUILD_SECRET = "__INJECTED_AT_BUILD__";
async function _bgGetExtSecret() {
  if (BUILD_SECRET && BUILD_SECRET !== "__INJECTED_AT_BUILD__") return BUILD_SECRET.trim();
  const { extSharedSecret } = await chrome.storage.local.get(["extSharedSecret"]);
  return (extSharedSecret || "").trim();
}
async function _bgHmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function _bgSha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s || ""));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function _bgHmacHeaders(method, fullUrl, bodyStr) {
  const secret = await _bgGetExtSecret();
  if (!secret) return {};
  const ts = String(Math.floor(Date.now() / 1000));
  const pathOnly = new URL(fullUrl).pathname;
  const bodySha = await _bgSha256Hex(bodyStr || "");
  const sig = await _bgHmacHex(secret, `${ts}\n${method.toUpperCase()}\n${pathOnly}\n${bodySha}`);
  // X-Ext-Nonce: UUID v4 (crypto.randomUUID) + TS fallback — replay-guarded server-side
  const nonce = (crypto && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `${ts}-${Math.random().toString(36).slice(2, 14)}`;
  return {
    "X-Ext-Timestamp": ts,
    "X-Ext-Signature": sig,
    "X-Ext-Client": "bibi-vf-ext",
    "X-Ext-Nonce": nonce,
  };
}

async function postCRM(path, body) {
  const API = await getBackendUrl();
  if (!API) return { ok: false, status: 0, error: "no_backend_url" };
  try {
    const bodyStr = JSON.stringify(body || {});
    const url = `${API}${path}`;
    const hmacH = await _bgHmacHeaders("POST", url, bodyStr);
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hmacH },
      body: bodyStr,
    }, 20_000);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}
async function getCRM(path) {
  const API = await getBackendUrl();
  if (!API) return { ok: false, status: 0, error: "no_backend_url" };
  try {
    const url = `${API}${path}`;
    const hmacH = await _bgHmacHeaders("GET", url, "");
    const res = await fetchWithTimeout(url, {
      method: "GET", cache: "no-store",
      headers: { ...hmacH },
    }, 20_000);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

async function sendHeartbeat() {
  try {
    await postCRM("/api/vesselfinder/heartbeat", {
      userAgent: navigator.userAgent,
      extensionVersion: EXTENSION_VERSION,
    });
  } catch (e) {
    console.warn("[BIBI VS] heartbeat failed:", e);
  }
}

async function vfFetch(candidate, bbox) {
  const path = candidate.pathBuilder(bbox);
  const url = VF + path;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      credentials: "include",
      headers: {
        "Accept": "application/octet-stream, application/json, text/plain, */*",
        "Referer": VF + "/",
      },
    });
    const ct = res.headers.get("content-type") || "";
    const isBinary = candidate.binary === true || ct.includes("octet-stream") || ct.includes("application/binary");
    let payload; let contentTypeHint = "unknown"; let rawSize = 0;
    if (isBinary) {
      const buf = await res.arrayBuffer();
      rawSize = buf.byteLength;
      payload = { format: "binary-b64", size: rawSize, data: rawSize > 0 ? arrayBufferToBase64(buf) : "" };
      contentTypeHint = "binary";
    } else {
      const text = await res.text();
      rawSize = (text || "").length;
      const firstChar = (text || "").trim().slice(0, 1);
      if (ct.includes("json") || firstChar === "[" || firstChar === "{") {
        try { payload = JSON.parse(text); contentTypeHint = "json"; }
        catch { payload = text; contentTypeHint = "text"; }
      } else { payload = text; contentTypeHint = "text"; }
    }
    return { ok: res.ok, status: res.status, contentType: ct, contentTypeHint, payload, rawSize, durationMs: Date.now() - t0, url, endpointName: candidate.name };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e), durationMs: Date.now() - t0, url, endpointName: candidate.name };
  }
}

async function processJob(job) {
  const stored = await chrome.storage.local.get(["lastGoodEndpoint"]);
  const ordered = [...ENDPOINT_CANDIDATES].sort((a, b) => {
    if (a.name === stored?.lastGoodEndpoint) return -1;
    if (b.name === stored?.lastGoodEndpoint) return 1;
    return 0;
  });

  let anyMatch = false;
  for (const cand of ordered) {
    const hasBbox = !!job.bbox;
    const needsBbox = cand.name !== "refresh";
    if (needsBbox && !hasBbox) continue;
    const fetchRes = await vfFetch(cand, job.bbox);
    const rep = await postCRM("/api/vesselfinder/jobs/result", {
      jobId: job.jobId,
      shipmentId: job.shipmentId,
      source: cand.name,
      ok: !!fetchRes.ok,
      status_code: fetchRes.status ?? 0,
      contentType: fetchRes.contentType || null,
      contentTypeHint: fetchRes.contentTypeHint || null,
      rawSize: fetchRes.rawSize ?? 0,
      payload: fetchRes.payload ?? null,
      error: fetchRes.error || null,
      fetchedAt: new Date().toISOString(),
    });
    const useful = fetchRes.ok &&
      ((fetchRes.contentTypeHint === "json" && fetchRes.payload && typeof fetchRes.payload !== "string") ||
       (fetchRes.contentTypeHint === "binary" && (fetchRes.rawSize || 0) >= 4));
    if (useful) await chrome.storage.local.set({ lastGoodEndpoint: cand.name });
    if (rep?.data?.ok) { anyMatch = true; return { shipmentId: job.shipmentId, ok: true, source: cand.name }; }
    const vfWorked = fetchRes.ok && fetchRes.status >= 200 && fetchRes.status < 300 && (fetchRes.rawSize || 0) > 100;
    if (vfWorked) return { shipmentId: job.shipmentId, ok: false, source: cand.name, vfWorked: true };
    await sleep(300);
  }
  return { shipmentId: job.shipmentId, ok: anyMatch };
}

async function runTick(reason = "alarm") {
  const t0 = Date.now();
  const API = await getBackendUrl();
  if (!API) {
    console.log("[BIBI VS] tick skipped — no backendUrl configured");
    await chrome.storage.local.set({
      lastTickAt: new Date().toISOString(), lastTickOk: false,
      lastTickReason: reason, lastTickError: "no_backend_url",
    });
    return;
  }
  try {
    await sendHeartbeat();
    const jobsRes = await getCRM(`/api/vesselfinder/jobs?limit=${MAX_JOBS_PER_TICK}`);
    if (!jobsRes.ok) {
      console.warn("[BIBI VS] jobs fetch failed", jobsRes);
      await chrome.storage.local.set({
        lastTickAt: new Date().toISOString(), lastTickOk: false,
        lastTickReason: reason, lastTickError: `jobs_fetch_http_${jobsRes.status}`,
      });
      return;
    }
    const jobs = jobsRes.data?.jobs || [];
    if (!jobs.length) {
      await chrome.storage.local.set({
        lastTickAt: new Date().toISOString(), lastTickOk: true,
        lastTickReason: reason, lastTickJobs: 0, lastTickSuccess: 0,
      });
      return;
    }
    let success = 0;
    for (const j of jobs) {
      try { const r = await processJob(j); if (r?.ok) success++; }
      catch (e) { console.warn("[BIBI VS] job error", j.shipmentId, e); }
      await sleep(600);
    }
    await chrome.storage.local.set({
      lastTickAt: new Date().toISOString(), lastTickOk: true,
      lastTickReason: reason, lastTickJobs: jobs.length,
      lastTickSuccess: success, lastTickDurationMs: Date.now() - t0,
    });
    console.log(`[BIBI VS] tick done — ${success}/${jobs.length} ok in ${Date.now() - t0}ms`);
  } catch (e) {
    console.warn("[BIBI VS] tick crashed", e);
    await chrome.storage.local.set({
      lastTickAt: new Date().toISOString(), lastTickOk: false,
      lastTickReason: reason, lastTickError: String(e),
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[BIBI VS] installed v" + EXTENSION_VERSION);
  await chrome.alarms.create("vf_tick", { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.2 });
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[BIBI VS] startup");
  await chrome.alarms.create("vf_tick", { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.2 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "vf_tick") return;
  await runTick("alarm");
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "VF_RUN_TICK") {
    (async () => { await runTick("manual"); sendResponse({ ok: true }); })();
    return true;
  }
  if (msg?.type === "VF_BACKEND_URL_CHANGED") {
    (async () => {
      console.log("[BIBI VS] backend URL changed → re-scheduling alarm");
      await chrome.alarms.create("vf_tick", { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.1 });
      sendResponse({ ok: true });
    })();
    return true;
  }
});
