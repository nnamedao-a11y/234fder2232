/**
 * BIBI Vessel Sync — popup logic (v3.2 / Phase 2: no backend cookies).
 *
 * WHAT CHANGED vs v3.0:
 *  - Backend no longer stores VF cookies, no `/session/sync`, `/session/status`,
 *    `/session/test`. Extension is pure "jobs executor".
 *  - HMAC shared secret is now built in at extension packaging time
 *    (placeholder `__INJECTED_AT_BUILD__`, replaced by build.sh).
 *  - "Подключить к CRM" button now: just records `connectedAt` and runs a
 *    signed heartbeat so the manager sees "CRM reachable" green tick.
 *  - "Force tick" and "Test connection" work via HMAC-signed endpoints only.
 *
 * State kept in chrome.storage.local:
 *    backendUrl            (string)
 *    extSharedSecret       (string, dev fallback — prod uses BUILD_SECRET)
 *    connectedAt           (ISO)
 *    lastTickAt, lastTickOk, lastTickJobs, lastTickSuccess, lastTickError
 */

// Build-time injection: replace this constant via
//   ./build.sh <SECRET>
// Value falls back to chrome.storage.local.extSharedSecret for developer flow.
const BUILD_SECRET = "__INJECTED_AT_BUILD__";

function $(id) { return document.getElementById(id); }

function fmtDateTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(ts); }
}
function fmtRelative(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (sec < 30) return "только что";
    if (sec < 60) return `${sec} сек назад`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ч назад`;
    return fmtDateTime(ts);
  } catch { return "—"; }
}

function setMsg(html, kind) {
  const el = $("msg");
  el.className = "msg " + (kind || "");
  el.innerHTML = html;
  el.style.display = "block";
}
function clearMsg() { const el = $("msg"); if (el) el.style.display = "none"; }

function setStatusHint(key) {
  const el = $("status-hint");
  if (!el) return;
  const HINTS = {
    healthy: { cls: "on", title: "Всё работает штатно.", body: "Расширение подписывает запросы HMAC и выполняет jobs от CRM. Трекинг идёт в фоне каждые 2 минуты." },
    off: { cls: "off", title: "Нет связи с CRM.", body: "Проверьте URL CRM или сбросьте секрет." },
    not_connected: { cls: "unknown", title: "Не подключено.", body: "Укажите адрес CRM и нажмите «Проверить подключение»." },
    error: { cls: "off", title: "Ошибка.", body: "Проверьте URL и секретный ключ." },
  };
  const h = HINTS[key] || HINTS.off;
  el.className = "status-hint " + h.cls;
  el.innerHTML = `<b>${h.title}</b><br/>${h.body}`;
  el.style.display = "block";
}

function setBusy(btnId, busy, label) {
  const btn = $(btnId);
  if (!btn) return;
  if (busy) {
    btn.dataset.originalHtml = btn.dataset.originalHtml || btn.innerHTML;
    btn.disabled = true;
    btn.style.cursor = "wait";
    btn.innerHTML = `<span class="spinner"></span>${label || "Обрабатываю…"}`;
  } else {
    btn.disabled = false;
    btn.style.cursor = "";
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

// ─── URL validation / storage ───
function normalizeUrl(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return ""; }
}
function setUrlStatus(state, text) {
  const el = $("url-status");
  if (!el) return;
  el.className = "url-status " + state;
  el.textContent = text;
}
function setUrlValidity(state) {
  const el = $("backend-url");
  if (!el) return;
  el.classList.remove("ok", "err");
  if (state === "ok") el.classList.add("ok");
  if (state === "err") el.classList.add("err");
}

async function saveBackendUrl(val, { silent } = {}) {
  const normalized = normalizeUrl(val);
  if (!normalized) {
    setUrlValidity("err");
    setUrlStatus("err", "неверный URL");
    await chrome.storage.local.remove("backendUrl");
    toggleActionButtons(false);
    return null;
  }
  setUrlStatus("saving", "сохраняю…");
  await chrome.storage.local.set({ backendUrl: normalized, backendUrlSavedAt: new Date().toISOString() });
  try { await chrome.runtime.sendMessage({ type: "VF_BACKEND_URL_CHANGED", backendUrl: normalized }); } catch {}
  setUrlValidity("ok");
  setUrlStatus("ok", "активен");
  toggleActionButtons(true);
  return normalized;
}
function toggleActionButtons(enabled) {
  ["sync", "tick", "test"].forEach((id) => { const b = $(id); if (b) b.disabled = !enabled; });
}
async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get(["backendUrl"]);
  return backendUrl || "";
}

// ─── HMAC ───
async function getExtSharedSecret() {
  // 1) Build-time injection (production)
  // Placeholder is reconstructed at runtime so sed only replaces the
  // constant value above, NOT this comparison string.
  const PLACEHOLDER = "__INJ" + "ECTED_AT_BUILD__";
  if (BUILD_SECRET && BUILD_SECRET !== PLACEHOLDER) {
    return BUILD_SECRET.trim();
  }
  // 2) Dev fallback — value set via options/popup field (non-prod flow)
  const { extSharedSecret } = await chrome.storage.local.get(["extSharedSecret"]);
  return (extSharedSecret || "").trim();
}

async function hmacSha256Hex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s || ""));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function buildHmacHeaders(method, fullUrl, bodyStr) {
  const secret = await getExtSharedSecret();
  if (!secret) return {};
  const ts = String(Math.floor(Date.now() / 1000));
  const pathOnly = new URL(fullUrl).pathname;
  const bodySha = await sha256Hex(bodyStr || "");
  const sig = await hmacSha256Hex(secret, `${ts}\n${method.toUpperCase()}\n${pathOnly}\n${bodySha}`);
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

// ─── CRM calls ───
async function hb(api) {
  const body = JSON.stringify({
    userAgent: navigator.userAgent,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const url = `${api}/api/vesselfinder/heartbeat`;
  const hmacH = await buildHmacHeaders("POST", url, body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hmacH },
      body,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  }
}

async function doConnect() {
  const api = await getBackendUrl();
  if (!api) return { ok: false, message: "Сначала укажите адрес CRM." };
  const secret = await getExtSharedSecret();
  if (!secret) {
    return { ok: false, message: "HMAC секрет не настроен. Пересоберите расширение с <code>./build.sh SECRET</code>." };
  }
  const r = await hb(api);
  if (r.ok) {
    await chrome.storage.local.set({ connectedAt: new Date().toISOString() });
    return { ok: true };
  }
  if (r.status === 401) return { ok: false, message: "HMAC отклонён (401). Неверный секрет или время клиента." };
  return { ok: false, message: `CRM недоступен: HTTP ${r.status} ${r.error || ""}` };
}
async function doTestPing() { return await doConnect(); }
async function doForceTick() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "VF_RUN_TICK" }, (resp) => {
      resolve(resp || { ok: false });
    });
  });
}

// ─── Main refresh ───
async function refresh() {
  const api = await getBackendUrl();
  const input = $("backend-url");
  if (api && input && !input.value) input.value = api;
  if (api) {
    setUrlValidity("ok"); setUrlStatus("ok", "активен"); toggleActionButtons(true);
  } else {
    setUrlValidity("idle"); setUrlStatus("idle", "не указан"); toggleActionButtons(false);
  }

  const stored = await chrome.storage.local.get([
    "connectedAt",
    "lastTickAt", "lastTickOk", "lastTickJobs", "lastTickSuccess", "lastTickError",
  ]);

  if ($("last-tick")) $("last-tick").textContent = stored?.lastTickAt ? fmtRelative(stored.lastTickAt) : "—";
  const j = stored?.lastTickJobs || 0;
  if ($("tick-stats")) {
    if (stored?.lastTickOk !== undefined && j > 0) {
      $("tick-stats").textContent = `${j} ${j === 1 ? "корабль" : j < 5 ? "корабля" : "кораблей"}`;
    } else if (stored?.lastTickOk === true && j === 0) {
      $("tick-stats").textContent = "нет активных";
    } else {
      $("tick-stats").textContent = "—";
    }
  }
  if ($("synced")) $("synced").textContent = fmtRelative(stored?.connectedAt);
  if ($("cookies")) $("cookies").textContent = "—";  // cookies no longer tracked
  if ($("success-rate")) $("success-rate").textContent = "—";

  const badge = $("status-badge");
  if (!api) {
    if (badge) { badge.className = "badge b-unknown"; badge.textContent = "—"; }
    setStatusHint("not_connected");
    return;
  }
  // Fast HMAC-signed heartbeat as health check
  const r = await hb(api);
  if (r.ok) {
    if (badge) { badge.className = "badge b-on"; badge.textContent = "активна"; }
    setStatusHint("healthy");
    clearMsg();
  } else if (r.status === 401) {
    if (badge) { badge.className = "badge b-off"; badge.textContent = "HMAC 401"; }
    setStatusHint("error");
    setMsg("HMAC отклонён сервером. Проверьте что секреты совпадают (popup ↔ backend .env).", "err");
  } else {
    if (badge) { badge.className = "badge b-off"; badge.textContent = "нет связи"; }
    setStatusHint("off");
    setMsg(`CRM недоступен: HTTP ${r.status || 0}. Проверьте URL.`, "err");
  }
}

// ─── Wiring ───
(function initUrlField() {
  const input = $("backend-url");
  if (!input) return;
  let typingTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(async () => { await saveBackendUrl(input.value); }, 700);
  });
  input.addEventListener("paste", () => {
    setTimeout(async () => { await saveBackendUrl(input.value); }, 50);
  });
  input.addEventListener("blur", async () => { await saveBackendUrl(input.value); });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") { e.preventDefault(); await saveBackendUrl(input.value); input.blur(); }
  });
})();

// Dev-only: allow entering secret in popup when build-time secret is not set
(function initSecretField() {
  const input = $("ext-secret");
  if (!input) return;
  (async () => {
    const { extSharedSecret } = await chrome.storage.local.get(["extSharedSecret"]);
    if (extSharedSecret) input.value = extSharedSecret;
    const PLACEHOLDER = "__INJ" + "ECTED_AT_BUILD__";
    if (BUILD_SECRET && BUILD_SECRET !== PLACEHOLDER) {
      input.disabled = true;
      input.placeholder = "вшит на этапе сборки";
    }
  })();
  input.addEventListener("change", async () => {
    await chrome.storage.local.set({ extSharedSecret: input.value.trim() });
  });
})();

if ($("sync")) {
  $("sync").addEventListener("click", async () => {
    clearMsg();
    setBusy("sync", true, "Подключаюсь…");
    const r = await doConnect();
    setBusy("sync", false);
    if (r.ok) {
      setMsg("CRM ответил. Расширение подключено (HMAC подтверждён).", "ok");
      await refresh();
    } else {
      setMsg(r.message, "err");
    }
  });
}
if ($("tick")) {
  $("tick").addEventListener("click", async () => {
    clearMsg();
    setBusy("tick", true, "Тяну позиции с VF…");
    const r = await doForceTick();
    setBusy("tick", false);
    if (r?.ok) {
      setMsg("Готово. Позиции обновлены, данные отправлены в CRM.", "ok");
      await new Promise((res) => setTimeout(res, 600));
      await refresh();
    } else {
      setMsg("Не удалось запустить обновление. Проверьте URL и подключение.", "err");
    }
  });
}
if ($("test")) {
  $("test").addEventListener("click", async () => {
    clearMsg();
    setBusy("test", true, "Проверяю CRM…");
    const r = await doTestPing();
    setBusy("test", false);
    if (r.ok) setMsg("CRM отвечает, HMAC подтверждён.", "ok");
    else setMsg(r.message || "CRM недоступен.", "err");
  });
}

try {
  const ver = chrome.runtime.getManifest().version;
  if (ver && $("ver")) $("ver").textContent = "v" + ver;
} catch { /* non-extension context */ }

refresh();
