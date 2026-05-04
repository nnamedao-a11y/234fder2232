/**
 * ForgotPasswordPage — public page, step 1 of password-reset flow.
 *
 * This screen is part of the CUSTOMER CABINET and must ONLY speak EN/BG —
 * never Ukrainian (the admin CRM language). We read lang from useLang() but
 * force-fallback to EN when it's anything other than 'bg'.
 *
 * POST /api/customer-auth/forgot-password { email }
 *   → backend always returns 200 (no enumeration).
 *   → in dry-run mode (default dev) the response also contains { reset_link }
 *     which we expose for testing convenience.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  Envelope,
  ArrowLeft,
  CheckCircle,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useLang } from '../../i18n';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// ── Bilingual strings (EN/BG only — cabinet never speaks UK) ──────────────
const STR = {
  en: {
    backToLogin: 'Back to sign in',
    title: 'Forgot your password?',
    subtitle: 'Enter your email and we\u2019ll send you a link to reset it.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    submit: 'Send reset link',
    sending: 'Sending\u2026',
    emailRequired: 'Please enter your email',
    genericError: 'Something went wrong. Please try again.',
    successTitle: 'Request received',
    successDefault:
      'If that email exists, we\u2019ve sent a reset link. Check your inbox.',
    dryRunTitle: 'Dev mode',
    dryRunNote:
      'Emails are not actually sent. Here is the direct reset link for testing:',
    backLink: 'Return to sign in',
  },
  bg: {
    backToLogin: 'Към входа',
    title: 'Забравена парола?',
    subtitle: 'Въведете имейла си — ще изпратим линк за възстановяване.',
    emailLabel: 'Имейл',
    emailPlaceholder: 'you@example.com',
    submit: 'Изпрати линк',
    sending: 'Изпращане…',
    emailRequired: 'Моля, въведете имейл',
    genericError: 'Нещо се обърка. Моля, опитайте отново.',
    successTitle: 'Заявката е приета',
    successDefault:
      'Ако този имейл съществува, ще получите линк за възстановяване.',
    dryRunTitle: 'Dev режим',
    dryRunNote:
      'Имейли не се изпращат реално. Ето директния линк за тест:',
    backLink: 'Връщане към входа',
  },
};
const pick = (lang) => (lang === 'bg' ? STR.bg : STR.en);

export default function ForgotPasswordPage() {
  const { lang } = useLang();
  const t = pick(lang);

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // { message, dry_run?, reset_link? }

  const submit = async (e) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!clean) {
      toast.error(t.emailRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/customer-auth/forgot-password`,
        { email: clean }
      );
      setDone(res.data || { message: t.successDefault });
    } catch (err) {
      toast.error(err.response?.data?.detail || t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0C] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          to="/cabinet/login"
          className="inline-flex items-center gap-2 text-white/60 hover:text-[#FEAE00] text-sm mb-6"
          data-testid="forgot-back-link"
        >
          <ArrowLeft size={16} /> {t.backToLogin}
        </Link>

        <div className="bg-[#18181B] border border-[#2a2a2e] rounded-2xl p-7 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-[#FEAE00] text-black flex items-center justify-center mb-4">
            <Envelope size={22} weight="bold" />
          </div>
          <h1 className="text-[22px] font-bold mb-1">{t.title}</h1>
          <p className="text-white/60 text-sm mb-6">{t.subtitle}</p>

          {!done && (
            <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
              <div>
                <label className="block text-[11px] font-bold text-[#FEAE00] uppercase tracking-[0.12em] mb-2">
                  {t.emailLabel}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder={t.emailPlaceholder}
                  required
                  className="w-full h-[50px] bg-black/40 border border-white/10 rounded-md px-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FEAE00]"
                  data-testid="forgot-email-input"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[52px] bg-[#FEAE00] hover:bg-[#FFBF2D] text-black rounded-md font-extrabold text-[14px] tracking-[0.06em] uppercase disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="forgot-submit-btn"
              >
                {submitting ? (
                  <>
                    <SpinnerGap size={18} className="animate-spin" /> {t.sending}
                  </>
                ) : (
                  t.submit
                )}
              </button>
            </form>
          )}

          {done && (
            <div className="space-y-4" data-testid="forgot-success">
              <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <CheckCircle
                  size={22}
                  weight="fill"
                  className="text-emerald-400 shrink-0 mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-semibold text-emerald-300 mb-0.5">
                    {t.successTitle}
                  </div>
                  <div className="text-white/70">
                    {done.message || t.successDefault}
                  </div>
                </div>
              </div>

              {done.dry_run && done.reset_link && (
                <div
                  className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm"
                  data-testid="forgot-dry-run-box"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <WarningCircle
                      size={18}
                      className="text-amber-300 shrink-0 mt-0.5"
                      weight="fill"
                    />
                    <div className="font-semibold text-amber-200">
                      {t.dryRunTitle}
                    </div>
                  </div>
                  <p className="text-white/70 mb-2">{t.dryRunNote}</p>
                  <a
                    href={done.reset_link}
                    className="block text-[12px] font-mono bg-black/40 border border-white/10 rounded px-3 py-2 text-[#FEAE00] hover:underline break-all"
                    data-testid="forgot-dry-run-link"
                  >
                    {done.reset_link}
                  </a>
                </div>
              )}

              <div className="text-center">
                <Link
                  to="/cabinet/login"
                  className="text-[#FEAE00] hover:underline text-sm font-medium"
                >
                  {t.backLink}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
