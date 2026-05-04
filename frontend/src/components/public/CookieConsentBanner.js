/**
 * BIBI Cars — Cookie Consent Banner (V3 — minimal)
 *
 * Лёгкая ненавязчивая плашка внизу экрана. Не блокирует контент.
 * Только базовая логика согласия (essential cookies).
 * Никакой кастомизации / чекбоксов / marketing / analytics.
 *
 * Поведение:
 *   • Показывается на первом визите для публичного сайта
 *   • Одна кнопка «Accept» (+ «X» для закрытия — эквивалент accept)
 *   • Согласие сохраняется в localStorage и больше не показывается
 *
 * Storage: bibi_cookie_consent = { essential: true, ts }
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, Check, Cookie } from '@phosphor-icons/react';
import axios from 'axios';
import { useLang } from '../../i18n';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';
const STORAGE_KEY = 'bibi_cookie_consent';

const hasConsent = () => {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
};

const persist = () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ essential: true, ts: new Date().toISOString() })
    );
  } catch {}
};

export default function CookieConsentBanner() {
  const { lang } = useLang();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [bannerCopy, setBannerCopy] = useState(null);
  const [enabled, setEnabled] = useState(true);

  // Hide on admin/team/manager routes
  const isPublicRoute =
    !pathname.startsWith('/admin') &&
    !pathname.startsWith('/team') &&
    !pathname.startsWith('/manager');

  useEffect(() => {
    if (!isPublicRoute) return;
    if (hasConsent()) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/site-info`);
        if (cancelled) return;
        const cb = r.data?.cookie_banner || {};
        setEnabled(cb.enabled !== false);
        setBannerCopy(cb);
        if (cb.enabled !== false) {
          setTimeout(() => !cancelled && setOpen(true), 600);
        }
      } catch {
        if (!cancelled) {
          setBannerCopy({});
          setTimeout(() => !cancelled && setOpen(true), 600);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPublicRoute]);

  if (!isPublicRoute || !open || !enabled) return null;

  const isBg = lang === 'bg';
  const body =
    (isBg ? bannerCopy?.body_bg : bannerCopy?.body_en) ||
    (isBg
      ? 'Използваме бисквитки, за да подобрим Вашето изживяване в сайта.'
      : 'We use cookies to improve your experience on BIBI Cars.');

  const T = isBg
    ? {
        accept: 'Приемам',
        learnMore: 'Научете повече',
        close: 'Затвори',
      }
    : {
        accept: 'Accept',
        learnMore: 'Learn more',
        close: 'Close',
      };

  const accept = () => {
    persist();
    setOpen(false);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] px-3 pb-3 md:px-5 md:pb-5 pointer-events-none"
      data-testid="cookie-banner"
    >
      <div
        className="relative mx-auto max-w-[1180px] pointer-events-auto rounded-xl border border-[#FEAE00]/35 bg-[#0F0F0E]/95 backdrop-blur-md shadow-[0_18px_48px_rgba(0,0,0,0.55)] animate-[bibi-cookie-in_0.35s_ease-out_both]"
      >
        {/* Header row */}
        <div className="flex items-start gap-3 md:gap-4 px-4 md:px-5 py-3 md:py-4">
          <div className="w-9 h-9 rounded-lg bg-[#FEAE00] text-black flex items-center justify-center shrink-0 mt-0.5">
            <Cookie size={18} weight="fill" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[13px] md:text-[14px] text-[#E7E7E7] leading-relaxed">
              {body}{' '}
              <Link
                to="/cookies"
                className="text-[#FEAE00] underline underline-offset-2 hover:brightness-110 whitespace-nowrap"
              >
                {T.learnMore}
              </Link>
            </p>
          </div>

          {/* Actions (desktop) */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={accept}
              className="inline-flex items-center gap-1.5 bg-[#FEAE00] hover:bg-[#FFBF2D] text-black text-[12.5px] font-semibold uppercase tracking-[0.06em] rounded-md px-4 h-9 transition-colors shadow-[0_6px_18px_rgba(254,174,0,0.22)]"
              data-testid="cookie-accept"
            >
              <Check size={14} weight="bold" /> {T.accept}
            </button>
          </div>

          {/* Close (equivalent to accept) */}
          <button
            type="button"
            onClick={accept}
            aria-label={T.close}
            className="shrink-0 w-8 h-8 -mr-1 -mt-1 rounded-md text-[#7A7A7A] hover:text-[#FEAE00] hover:bg-white/5 flex items-center justify-center transition-colors"
            data-testid="cookie-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions (mobile) */}
        <div className="md:hidden flex items-center gap-2 px-4 pb-3 -mt-1">
          <button
            type="button"
            onClick={accept}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#FEAE00] text-black text-[12px] font-semibold uppercase tracking-[0.06em] rounded-md h-9 px-3"
          >
            <Check size={13} weight="bold" /> {T.accept}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bibi-cookie-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
