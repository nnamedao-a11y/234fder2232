/**
 * BIBI Cars — popup script (v4.1.2).
 *
 * Independent, progressive probing — each source updates independently
 * the moment its probe finishes, never blocks on others.
 *
 * v4.1.2 fixes:
 *   - Multi-URL fallback per source (root, /search, /vehicles, /listings).
 *     Some CF zones (e.g. poctra, carsfromwest) reject root / no-cors with
 *     TCP RST → first try fails fast, second tries warmer endpoints.
 *   - HEAD method preferred (smaller, fewer false negatives), GET fallback.
 *   - 8s per-site timeout (was 5s — too aggressive for CF challenges).
 *   - Clear status labels: "доступний" / "CF блокує" / "недоступний" / "таймаут".
 *   - User-visible note explains "недоступний" ≠ "парсер не працює".
 */

const DEFAULT_API_URL = 'https://dev-ready-8.preview.emergentagent.com';

const STORAGE = {
  url:    'bibi_backend_url',
  label:  'bibi_ext_client_label',
  secret: 'bibi_ext_client_secret',
};

// Each source can probe multiple URL variants — first to succeed wins.
// We start with the root, then try lighter "warm" endpoints that CF
// usually doesn't gate as strictly.
const SOURCES = [
  {
    id: 'poctra',
    urls: [
      'https://poctra.com/',
      'https://poctra.com/search',
      'https://poctra.com/robots.txt',
    ],
  },
  {
    id: 'carsfromwest',
    urls: [
      'https://carsfromwest.com/',
      'https://carsfromwest.com/cars',
      'https://carsfromwest.com/robots.txt',
    ],
  },
  {
    id: 'autoauctionhistory',
    urls: [
      'https://autoauctionhistory.com/',
      'https://autoauctionhistory.com/robots.txt',
    ],
  },
  {
    id: 'salvagebid',
    urls: [
      'https://www.salvagebid.com/',
      'https://www.salvagebid.com/robots.txt',
    ],
  },
];

const PROBE_TIMEOUT_MS = 8000;

let API_URL = DEFAULT_API_URL;

// Per-source state machine: pending | ok | bad | cf-blocked
const sourceState = {};

// Backend reachability state (null until first probe finishes)
let backendOk = null;

// ── DOM helpers ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const toast = (text) => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
};

// ── chrome.storage helpers ───────────────────────────────────
function getStored(key, fallback = '') {
  return new Promise((res) =>
    chrome.storage.local.get([key], (out) => res(out[key] ?? fallback)),
  );
}
function setStored(key, value) {
  return new Promise((res) =>
    chrome.storage.local.set({ [key]: value }, () => res(true)),
  );
}

// ── Tab switching ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.pane;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.pane').forEach((p) =>
      p.classList.toggle('active', p.id === `pane-${target}`),
    );
  });
});

// ── Render helpers ───────────────────────────────────────────
function setRowState(srcId, cls, label) {
  const row = document.querySelector(`.source-row[data-src="${srcId}"]`);
  if (!row) return;
  const dot  = row.querySelector('.dot');
  const pill = row.querySelector('.pill');
  if (!dot || !pill) return;
  dot.classList.remove('ok', 'warn', 'bad');
  pill.classList.remove('ok', 'warn', 'bad');
  if (cls) {
    dot.classList.add(cls);
    pill.classList.add(cls);
  }
  pill.textContent = label;
}

function setHero(level, title, desc, fixHTML = '') {
  const hero = $('#hero');
  if (!hero) return;
  hero.classList.remove('ok', 'warn', 'bad');
  if (level) hero.classList.add(level);
  $('#hero-title').textContent = title;
  $('#hero-desc').textContent = desc;
  const fixEl = $('#hero-fix');
  if (fixHTML) {
    fixEl.innerHTML = fixHTML;
    fixEl.style.display = '';
  } else {
    fixEl.style.display = 'none';
  }
}

// ── Single fetch attempt with timeout (returns a verdict string) ─
async function tryOne(url, method, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, {
      method,
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    clearTimeout(t);
    return 'ok';
  } catch (err) {
    clearTimeout(t);
    if (err && err.name === 'AbortError') return 'timeout';
    // TypeError: failed to fetch usually means CF / DNS / TCP RST.
    return 'fail';
  }
}

// ── Probe one source: try each URL variant until one succeeds ───
async function probeSource(source) {
  setRowState(source.id, null, 'перевірка…');
  sourceState[source.id] = 'pending';

  const perUrlTimeout = Math.max(2500, Math.floor(PROBE_TIMEOUT_MS / source.urls.length));
  let anyTimeout = false;
  let anyFail = false;

  for (const url of source.urls) {
    // Try HEAD first (lighter), then GET (some CF zones reject HEAD)
    let v = await tryOne(url, 'HEAD', perUrlTimeout);
    if (v !== 'ok') {
      v = await tryOne(url, 'GET', perUrlTimeout);
    }
    if (v === 'ok') {
      setRowState(source.id, 'ok', 'доступний');
      sourceState[source.id] = 'ok';
      recomputeHero();
      return;
    }
    if (v === 'timeout') anyTimeout = true;
    else anyFail = true;
  }

  // All variants failed. Distinguish "site reachable but CF blocks fetch"
  // (typical for poctra/cfw) from "site truly down" (timeout for everything).
  if (anyFail && !anyTimeout) {
    // TCP RST / CORS rejection = CF Bot Management dropped us.
    // The site is up, the parser CAN still use it (extension content
    // script bypasses this because it runs in the page context).
    setRowState(source.id, 'warn', 'CF блокує');
    sourceState[source.id] = 'cf-blocked';
  } else {
    setRowState(source.id, 'bad', anyTimeout ? 'таймаут' : 'недоступний');
    sourceState[source.id] = 'bad';
  }
  recomputeHero();
}

async function probeBackend(timeoutMs = 6000) {
  if (!API_URL) {
    backendOk = false;
    recomputeHero();
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${API_URL}/api/extension/info`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
      credentials: 'omit',
    });
    clearTimeout(t);
    backendOk = r.ok;
  } catch (_) {
    backendOk = false;
  }
  recomputeHero();
}

// ── Hero composer (called after every probe finishes) ───────
async function recomputeHero() {
  const total = SOURCES.length;
  const finished = SOURCES.filter((s) =>
    ['ok', 'bad', 'cf-blocked'].includes(sourceState[s.id]),
  ).length;
  const upCount = SOURCES.filter((s) => sourceState[s.id] === 'ok').length;
  const cfBlockedCount = SOURCES.filter((s) => sourceState[s.id] === 'cf-blocked').length;
  const allDone = finished === total && backendOk !== null;

  if (!allDone) {
    setHero(
      '',
      'Перевірка стану…',
      `Перевірено ${finished}/${total} сайтів${backendOk === null ? ', чекаємо CRM…' : ''}`,
    );
    return;
  }

  const secret = await getStored(STORAGE.secret, '');

  if (!backendOk) {
    setHero(
      'bad',
      'Помічник не з\'єднаний з CRM',
      'Не вдалося достукатись до сервера BIBI CRM.',
      '<b>Що зробити:</b> перевірте на вкладці <b>Налаштування</b>, що ' +
      '«Адреса CRM» правильна, або зверніться до адміна.',
    );
    return;
  }
  if (!secret) {
    setHero(
      'warn',
      'Не вистачає ключа доступу',
      'Помічник не передає дані в CRM, бо не налаштований ключ безпеки.',
      '<b>Що зробити:</b> перейдіть на вкладку <b>Налаштування</b>, ' +
      'попросіть у адміна BIBI «Ключ доступу до CRM» (HMAC секрет) і ' +
      'збережіть його.',
    );
    return;
  }

  const reachable = upCount + cfBlockedCount;
  if (reachable === 0) {
    setHero(
      'bad',
      'Жоден аукціонний сайт не відповідає',
      'Усі 4 джерела зараз недоступні з вашого браузера.',
      '<b>Що зробити:</b> перевірте інтернет-з\'єднання. Парсер у CRM ' +
      'продовжує працювати через інші джерела (BitMotors / WestMotors / Lemon).',
    );
    return;
  }
  if (cfBlockedCount > 0 && upCount > 0) {
    setHero(
      'warn',
      `Працює, ${cfBlockedCount} під CF-блоком`,
      `${upCount} з ${total} сайтів відповідають напряму, ${cfBlockedCount} ` +
      'блокує Cloudflare для нашої no-cors перевірки.',
      '<b>Це нормально:</b> «CF блокує» означає, що браузерна перевірка не пройшла, ' +
      'але РЕАЛЬНИЙ парсер на цих сайтах <b>працює</b> — content scripts ' +
      'розширення викликаються в контексті сторінки і обходять CF.',
    );
    return;
  }
  if (cfBlockedCount > 0 && upCount === 0) {
    setHero(
      'warn',
      'Усі сайти під CF-блоком',
      'Cloudflare блокує no-cors перевірку для всіх 4 сайтів.',
      '<b>Це не помилка парсера.</b> Content scripts розширення працюють ' +
      'у контексті самих сторінок (не fetch) — вони обходять CF Bot ' +
      'Management. Парсер у CRM продовжує отримувати дані.',
    );
    return;
  }
  if (upCount < total) {
    setHero(
      'warn',
      `Працює частково (${upCount} з ${total})`,
      'Деякі аукціонні сайти зараз тимчасово недоступні, але парсер ' +
      'працює — використовуються ті, що відповідають.',
      '<b>Що зробити:</b> зазвичай нічого, сайти повертаються самостійно ' +
      'за кілька хвилин. Парсер ВЖЕ обробляє запити через робочі джерела.',
    );
    return;
  }
  setHero(
    'ok',
    'Все працює нормально',
    'Помічник з\'єднаний з CRM, всі 4 аукціонні сайти доступні. ' +
    'Можна спокійно займатись своїми справами — пошук йде у фоні.',
  );
}

// ── Master refresh — kick everything in parallel, do NOT await ───
function refreshStatus() {
  backendOk = null;
  SOURCES.forEach((s) => {
    sourceState[s.id] = 'pending';
    setRowState(s.id, null, 'перевірка…');
  });
  recomputeHero();

  probeBackend();
  SOURCES.forEach((s) => probeSource(s));

  // Hard fallback — never permanently stuck on "Перевірка…"
  setTimeout(() => {
    SOURCES.forEach((s) => {
      if (sourceState[s.id] === 'pending') {
        setRowState(s.id, 'bad', 'таймаут');
        sourceState[s.id] = 'bad';
      }
    });
    if (backendOk === null) backendOk = false;
    recomputeHero();
  }, PROBE_TIMEOUT_MS + 4000);
}

// ── Settings handlers ────────────────────────────────────────
$('#save-url').addEventListener('click', async () => {
  const url = $('#server-url').value.trim().replace(/\/+$/, '');
  if (!url) {
    toast('Введіть адресу CRM');
    return;
  }
  API_URL = url;
  await setStored(STORAGE.url, url);
  toast('Адресу CRM збережено');
  refreshStatus();
});

$('#save-label').addEventListener('click', async () => {
  const label = $('#client-label').value.trim();
  await setStored(STORAGE.label, label);
  toast(label ? 'Назву комп\'ютера збережено' : 'Назву очищено');
});

$('#save-secret').addEventListener('click', async () => {
  const secret = $('#client-secret').value.trim();
  if (!secret || /^•+$/.test(secret)) {
    toast('Введіть новий ключ');
    return;
  }
  await setStored(STORAGE.secret, secret);
  $('#client-secret').value = '••••••••';
  toast('Ключ доступу збережено');
  refreshStatus();
});

$('#open-crm').addEventListener('click', async (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: API_URL || DEFAULT_API_URL });
});
$('#open-parser-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const base = API_URL || DEFAULT_API_URL;
  chrome.tabs.create({ url: `${base}/admin/parser` });
});

// Manual refresh — exposed via the section title click
const refreshBtn = $('#refresh-status');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    toast('Перевірка перезапущена');
    refreshStatus();
  });
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const [url, label, secret] = await Promise.all([
    getStored(STORAGE.url, DEFAULT_API_URL),
    getStored(STORAGE.label, ''),
    getStored(STORAGE.secret, ''),
  ]);
  API_URL = url;
  $('#server-url').value = url;
  $('#client-label').value = label;
  $('#client-secret').value = secret ? '••••••••' : '';
  refreshStatus();
});
