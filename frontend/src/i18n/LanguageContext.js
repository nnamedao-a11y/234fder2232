/**
 * Language Context
 *
 * Languages:
 *   • Public site: EN + BG only (auto-detected from browser on first visit)
 *   • Admin / Manager / Team-lead: also UK (Ukrainian) for legacy reasons
 *
 * Default behaviour:
 *   • If user has a stored preference  → use it
 *   • Else if browser locale starts with 'bg' → BG
 *   • Else if browser locale starts with 'uk' → UK   (admin only)
 *   • Else → EN  (default for everyone else)
 *
 * Persistence: localStorage["bibi_lang"].
 * Public togggle order on click: EN → BG → EN.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import translations from './translations';

const LanguageContext = createContext(null);

// All available languages — EN first (public default), BG second, UK last (admin only).
export const LANGUAGES = [
  { code: 'en', label: 'EN', flag: '🇬🇧', name: 'English' },
  { code: 'bg', label: 'BG', flag: '🇧🇬', name: 'Български' },
  { code: 'uk', label: 'UK', flag: '🇺🇦', name: 'Українська' },
];

// Public site only supports EN + BG — UK stays inside admin.
export const PUBLIC_LANGUAGES = LANGUAGES.filter((l) => l.code === 'en' || l.code === 'bg');

const SUPPORTED = LANGUAGES.map((l) => l.code);
const PUBLIC_SUPPORTED = PUBLIC_LANGUAGES.map((l) => l.code);
const DEFAULT_LANG = 'en';

/**
 * Return the user's preferred language from the browser (navigator.languages),
 * restricted to languages we actually support.
 * Public sites get EN/BG only; admin can also see UK.
 */
const detectBrowserLang = () => {
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  const langs = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || ''];
  for (const raw of langs) {
    if (!raw) continue;
    const code = raw.toLowerCase().slice(0, 2);
    if (PUBLIC_SUPPORTED.includes(code)) return code;
    if (code === 'uk' || code === 'ua') return 'uk'; // Ukrainian (admin)
  }
  return DEFAULT_LANG;
};

const normalizeLang = (raw) => {
  if (!raw) return null;
  if (raw === 'ua') return 'uk';
  return SUPPORTED.includes(raw) ? raw : null;
};

export const LanguageProvider = ({ children }) => {
  const [lang, setLang] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LANG;
    let stored = null;
    try { stored = localStorage.getItem('bibi_lang'); } catch {}
    const fromStored = normalizeLang(stored);
    if (fromStored) return fromStored;
    // First visit — pick from browser locale (en/bg/uk fallback)
    const detected = detectBrowserLang();
    try { localStorage.setItem('bibi_lang', detected); } catch {}
    return detected;
  });

  // Save language preference to localStorage + reflect on <html lang="…">
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('bibi_lang', lang); } catch {}
    try { document.documentElement.setAttribute('lang', lang); } catch {}
  }, [lang]);

  // Translation function — EN first, then BG, then UK, then key itself
  const t = (key) => (
    translations[lang]?.[key]
    ?? translations.en?.[key]
    ?? translations.bg?.[key]
    ?? translations.uk?.[key]
    ?? key
  );

  // Toggle between EN ↔ BG (public-friendly cycle).
  // If user is on UK (admin only), this cycle keeps the value: only public switcher will be visible.
  const toggleLang = () => {
    const idx = PUBLIC_LANGUAGES.findIndex((l) => l.code === lang);
    const next = PUBLIC_LANGUAGES[(idx + 1) % PUBLIC_LANGUAGES.length];
    setLang(next.code);
  };

  // Set specific language (ignores unknown codes; aliases 'ua' → 'uk')
  const changeLang = (newLang) => {
    const normalized = normalizeLang(newLang);
    if (normalized) setLang(normalized);
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        setLang: changeLang,
        t,
        toggleLang,
        changeLang,
        languages: LANGUAGES,
        publicLanguages: PUBLIC_LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLang = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      t: (key) => translations[DEFAULT_LANG]?.[key] || key,
      toggleLang: () => {},
      changeLang: () => {},
      languages: LANGUAGES,
      publicLanguages: PUBLIC_LANGUAGES,
    };
  }
  return context;
};

export default LanguageContext;
