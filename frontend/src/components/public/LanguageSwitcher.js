import React from 'react';
import { useLang, LANGUAGES } from '../../i18n';

/**
 * LanguageSwitcher — interactive BG / EN toggle for the public header
 * and auth screens.
 *
 * Public site languages only: EN + BG.
 * (Ukrainian remains in the global LANGUAGES list because it is still used by
 * admin / manager / team-lead workspaces. We filter it out here.)
 *
 * Visual: segmented pill control tuned for the BIBI dark theme
 *   • active pill  → amber (#FEAE00) on black
 *   • idle pill    → light grey text on transparent
 *   • hover        → amber text
 *
 * Variants:
 *   • 'header'  (default) — borderless, compact, sits inside dark header
 *   • 'floating' — with subtle border + dark card background for standalone pages
 */
export const LanguageSwitcher = ({ className = '', variant = 'header' }) => {
  const { lang, changeLang } = useLang();

  // Public site supports only EN + BG; UK stays admin-only.
  const PUBLIC_LANGS = LANGUAGES.filter((l) => l.code === 'en' || l.code === 'bg');

  // If currently on a UK preference, surface as EN visually (no auto-mutation).
  const effectiveLang = lang === 'uk' ? 'en' : lang;

  const wrapperBase =
    'inline-flex items-center gap-1 rounded-md p-0.5 select-none';
  const wrapperVariant =
    variant === 'floating'
      ? 'bg-[#1D1D1B]/80 border border-[#2A2A28] backdrop-blur-sm shadow-lg'
      : '';

  return (
    <div
      className={`${wrapperBase} ${wrapperVariant} ${className}`}
      role="group"
      aria-label="Language switcher"
      data-testid="header-language-switcher"
    >
      {PUBLIC_LANGS.map((l) => {
        const active = effectiveLang === l.code;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => changeLang(l.code)}
            aria-pressed={active}
            aria-label={l.name}
            className={[
              'px-2.5 py-1 text-[12px] font-semibold tracking-[0.08em] uppercase rounded transition-all duration-150',
              active
                ? 'bg-[#FEAE00] text-black shadow-[0_1px_0_rgba(0,0,0,0.25)]'
                : 'text-[#E7E7E7] hover:text-[#FEAE00]',
            ].join(' ')}
            data-testid={`lang-switch-${l.code}`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
