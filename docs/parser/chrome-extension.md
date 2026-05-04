# Parser — Chrome Extension Guide

## Why an extension at all?

4 of our sources (poctra.com, carsfromwest.com, autoauctionhistory.com,
salvagebid.com) sit behind Cloudflare Bot Management with browser-fingerprint
challenges. Server-side scraping (httpx, even Playwright) gets 403'd within
minutes — CF compares JA3, JA4, TLS fingerprint, headless-Chrome telltales,
etc. and IP-bans us.

**The only reliable bypass:** run JS in the operator's actual logged-in
browser. The extension does this — content scripts execute in the page
context, scrape the DOM, POST it back to our backend over HMAC-signed
requests.

This is also why **the popup probe results don't reflect parser ability**:
the popup uses `fetch(... no-cors)` from the extension's origin, which CF
DOES block on the strict zones. The content scripts run from the page's own
origin and DON'T get blocked.

## Architecture

```
backend                      browser (operator)                site (CF)
   │                                │                            │
   │ POST /ext/lookup vin            │                            │
   ├──► enqueue job                  │                            │
   │                                 │                            │
   │  ◄── poll /ext/jobs   (60s)     │                            │
   ├─────────────────────────────────►│ background.js              │
   │                                 │ chrome.tabs.create(hidden) │
   │                                 ├───────────────────────────►│
   │                                 │                            │  ◄── CF challenge
   │                                 │                            │     auto-solved
   │                                 │  content_script runs       │     by browser
   │                                 │  parses DOM → payload      │
   │                                 │                            │
   │  ◄── POST /ext/observation HMAC │                            │
   ├──► cache → resolve VIN          │                            │
   │                                 │                            │
```

## Files

```
/app/backend/chrome_extension/
├── manifest.json          MV3, host_permissions for 4 sites
├── background.js          job poller, HMAC, queue runner
├── popup.html             3-tab UI (Стан/Налаштування/Довідка)
├── popup.js               popup logic — probes + settings
├── icons/                 16/32/48/128 PNG + svg + brand assets
├── utils/sender.js        shared HMAC + POST helper
└── sites/
    ├── poctra.js          DOM extractor for poctra.com
    ├── carsfromwest.js    ditto for cfw
    ├── autoauctionhistory.js
    └── salvagebid.js
```

The `bibi-cars-extension.zip` is **never stored on disk** — it's built on
the fly by `GET /api/extension/download` from this directory. So updating
a file here is instant — operators just re-download.

## Install (operator workflow)

1. Open `/admin/parser?tab=extension` in CRM (admin login required to see).
2. Click "Скачати ZIP".
3. Unzip anywhere.
4. Chrome → `chrome://extensions/` → "Developer mode" ON.
5. "Load unpacked" → select unpacked folder.
6. Click BIBI icon in toolbar → popup opens.
7. In Налаштування tab paste:
   - Backend URL — pre-filled, copy-button on the same admin page.
   - Client label — anything (e.g. `owner-laptop`).
   - HMAC secret — copy-button on the admin page (= `EXT_SHARED_SECRET` env).
8. Press Зберегти on each field.
9. Status pill should turn green within ~60 s after a heartbeat lands.

If installing on multiple operator machines, give each one a unique
`Client label` so the admin board can distinguish them.

## How content scripts work (per-site)

Each `sites/<site>.js` follows the same pattern:

```javascript
// Wait for the page to settle (CF challenge done, JS-rendered DOM stable)
function observe() {
  // 1. Find the VIN we're looking for in the DOM (URL or marker)
  const vin = parseVinFromUrl() || parseVinFromDom();
  if (!vin) return;

  // 2. Extract structured data
  const data = {
    vin,
    title: $('h1.lot-title')?.textContent,
    images: [...$$('.gallery img')].map(i => i.src),
    lot_number: $('[data-lot]')?.dataset.lot,
    odometer: parseInt($('.odometer')?.textContent),
    // ... etc, ~15 fields
  };

  // 3. Send back via shared sender (HMAC-signs + POSTs)
  bibi.send('/api/ext/observation', { source: '<site>', vin, data });
}

if (document.readyState === 'complete') observe();
else window.addEventListener('load', () => setTimeout(observe, 2000));
```

## Updating the extension

No build step — files are zipped on demand. To roll out a fix:

1. Edit files in `/app/backend/chrome_extension/`.
2. Bump `manifest.json` `version` (e.g. 4.1.0 → 4.1.1).
3. Bump the comment in `popup.js` (e.g. "v4.1.2") for traceability.
4. Done. Operators re-download the ZIP and reinstall.

**Do not** push directly to the user's installed extension — Chrome doesn't
auto-update unpacked extensions. Always notify operators to reinstall.

## Common UI states

| Hero color | What it means | Operator action |
|---|---|---|
| 🟢 OK | All 4 sites reachable AND CRM connected AND HMAC secret set | none |
| 🟡 Warn — under CF block | Some sites' fetch-probe blocked, but parser still works | none — explain to user |
| 🟡 Warn — partial | Some sites genuinely down (rare network issue) | wait or retry |
| 🟡 Warn — no secret | HMAC secret missing — extension can't talk to CRM | paste secret |
| 🔴 Bad — backend offline | Wrong Backend URL or CRM down | check URL, ping admin |
| 🔴 Bad — all sites down | No internet | check ISP / VPN |

The popup HTML has an explanatory amber callout under the source list
clarifying that "недоступний" / "CF блокує" does NOT mean the parser is
broken.

## Security notes

* HMAC secret is treated as a credential — DO NOT commit it to git, DO NOT
  embed in the manifest. Operator pastes it once into popup, browser stores
  in `chrome.storage.local`.
* `EXT_AUTH_MODE=disabled` in `backend/.env` skips HMAC for local dev. NEVER
  set this in production.
* Each request also carries a `nonce` in `ext_nonces` Mongo collection (TTL
  5 min) to prevent replay attacks.
* Heartbeats older than 5 min mark the client `unhealthy`, older than 14 days
  delete the client (TTL).
