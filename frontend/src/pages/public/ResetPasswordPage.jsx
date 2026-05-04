/**
 * ResetPasswordPage — public page, step 2 of password-reset flow.
 *
 * Customer-facing → EN/BG only, never Ukrainian.
 *
 * 1. GET  /api/customer-auth/validate-reset-token?token=... → {valid, email}
 * 2. POST /api/customer-auth/reset-password { token, password } → session
 *
 * On success: stores session token in localStorage (same keys as the main
 * login flow) and redirects to /cabinet home.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Lock,
  Eye,
  EyeSlash,
  CheckCircle,
  SpinnerGap,
  ArrowLeft,
  WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useLang } from '../../i18n';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// ── Bilingual strings (EN/BG only) ──────────────────────────────────
const STR = {
  en: {
    backToLogin: 'Back to sign in',
    validating: 'Checking link\u2026',
    invalidTitle: 'Link is not valid',
    invalidBody:
      'This link is incorrect, expired, or has already been used. Please request a new one.',
    requestNew: 'Request a new link',
    title: 'Set a new password',
    accountLabel: 'Account:',
    genericIntro: 'Choose a new password for your account.',
    newPassword: 'New password',
    repeatPassword: 'Repeat password',
    mismatch: 'Passwords do not match',
    minLengthError: 'Password must be at least 6 characters',
    submit: 'Save password',
    submitting: 'Saving\u2026',
    genericError: 'Could not update password',
    successTitle: 'Password updated',
    successSub: 'Redirecting to your cabinet\u2026',
    loggedIn: 'Password changed \u2014 you are signed in',
  },
  bg: {
    backToLogin: 'Към входа',
    validating: 'Проверка на линка…',
    invalidTitle: 'Невалиден линк',
    invalidBody:
      'Този линк е неправилен, изтекъл или вече е използван. Моля, поискайте нов.',
    requestNew: 'Поискай нов линк',
    title: 'Нова парола',
    accountLabel: 'Акаунт:',
    genericIntro: 'Изберете нова парола за акаунта си.',
    newPassword: 'Нова парола',
    repeatPassword: 'Повторете паролата',
    mismatch: 'Паролите не съвпадат',
    minLengthError: 'Паролата трябва да съдържа поне 6 символа',
    submit: 'Запази паролата',
    submitting: 'Запазване…',
    genericError: 'Паролата не беше променена',
    successTitle: 'Паролата е променена',
    successSub: 'Пренасочване към кабинета…',
    loggedIn: 'Паролата е променена — вече сте влезли',
  },
};
const pick = (lang) => (lang === 'bg' ? STR.bg : STR.en);

export default function ResetPasswordPage() {
  const { lang } = useLang();
  const t = pick(lang);

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [valid, setValid] = useState(null); // null=loading, false=invalid, {email}=ok
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // 1. validate token on mount
  useEffect(() => {
    if (!token) {
      setValid(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(
          `${API_URL}/api/customer-auth/validate-reset-token`,
          { params: { token } }
        );
        if (!cancelled) setValid(res.data || { valid: true });
      } catch (e) {
        if (!cancelled) setValid(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pwd.length < 6) {
      toast.error(t.minLengthError);
      return;
    }
    if (pwd !== pwd2) {
      toast.error(t.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/customer-auth/reset-password`,
        { token, password: pwd }
      );
      const data = res.data || {};
      if (data.sessionToken) {
        localStorage.setItem('customer_token', data.sessionToken);
        localStorage.setItem('customer', JSON.stringify(data.user || {}));
      }
      setDone(true);
      toast.success(t.loggedIn);
      setTimeout(() => navigate('/cabinet', { replace: true }), 1500);
    } catch (err) {
      toast.error(err.response?.data?.detail || t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────────
  if (valid === null) {
    return (
      <div className="min-h-screen bg-[#0B0B0C] text-white flex items-center justify-center">
        <div className="text-center">
          <SpinnerGap size={32} className="animate-spin text-[#FEAE00] mx-auto mb-3" />
          <div className="text-white/60 text-sm">{t.validating}</div>
        </div>
      </div>
    );
  }

  if (valid === false) {
    return (
      <div className="min-h-screen bg-[#0B0B0C] text-white flex items-center justify-center p-4">
        <div
          className="w-full max-w-md bg-[#18181B] border border-[#2a2a2e] rounded-2xl p-7 text-center"
          data-testid="reset-invalid"
        >
          <div className="w-12 h-12 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
            <WarningCircle size={22} weight="fill" />
          </div>
          <h1 className="text-[22px] font-bold mb-2">{t.invalidTitle}</h1>
          <p className="text-white/60 text-sm mb-5">{t.invalidBody}</p>
          <Link
            to="/cabinet/forgot-password"
            className="inline-block w-full h-[50px] leading-[50px] bg-[#FEAE00] hover:bg-[#FFBF2D] text-black rounded-md font-extrabold text-[13px] tracking-[0.06em] uppercase"
            data-testid="reset-request-new"
          >
            {t.requestNew}
          </Link>
          <Link
            to="/cabinet/login"
            className="mt-3 inline-flex items-center gap-2 text-white/60 hover:text-[#FEAE00] text-sm"
          >
            <ArrowLeft size={14} /> {t.backToLogin}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0B0C] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          to="/cabinet/login"
          className="inline-flex items-center gap-2 text-white/60 hover:text-[#FEAE00] text-sm mb-6"
        >
          <ArrowLeft size={16} /> {t.backToLogin}
        </Link>

        <div className="bg-[#18181B] border border-[#2a2a2e] rounded-2xl p-7 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-[#FEAE00] text-black flex items-center justify-center mb-4">
            <Lock size={22} weight="bold" />
          </div>
          <h1 className="text-[22px] font-bold mb-1">{t.title}</h1>
          <p className="text-white/60 text-sm mb-6">
            {valid.email ? (
              <>
                {t.accountLabel}{' '}
                <span className="text-[#FEAE00]">{valid.email}</span>
              </>
            ) : (
              t.genericIntro
            )}
          </p>

          {done ? (
            <div
              className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center"
              data-testid="reset-success"
            >
              <CheckCircle
                size={28}
                weight="fill"
                className="text-emerald-400 mx-auto mb-2"
              />
              <div className="font-semibold text-emerald-300">
                {t.successTitle}
              </div>
              <div className="text-white/60 text-sm mt-1">{t.successSub}</div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
              <div>
                <label className="block text-[11px] font-bold text-[#FEAE00] uppercase tracking-[0.12em] mb-2">
                  {t.newPassword}
                </label>
                <div className="relative">
                  <Lock
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FEAE00]/80"
                  />
                  <input
                    type={show ? 'text' : 'password'}
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    minLength={6}
                    required
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full h-[50px] bg-black/40 border border-white/10 rounded-md pl-11 pr-11 text-white placeholder-white/30 focus:outline-none focus:border-[#FEAE00]"
                    data-testid="reset-pwd-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-[#FEAE00] p-1"
                    tabIndex={-1}
                  >
                    {show ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#FEAE00] uppercase tracking-[0.12em] mb-2">
                  {t.repeatPassword}
                </label>
                <div className="relative">
                  <Lock
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FEAE00]/80"
                  />
                  <input
                    type={show ? 'text' : 'password'}
                    value={pwd2}
                    onChange={(e) => setPwd2(e.target.value)}
                    minLength={6}
                    required
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full h-[50px] bg-black/40 border border-white/10 rounded-md pl-11 pr-4 text-white placeholder-white/30 focus:outline-none focus:border-[#FEAE00]"
                    data-testid="reset-pwd2-input"
                  />
                </div>
                {pwd2 && pwd !== pwd2 && (
                  <p className="text-[11px] text-red-400 mt-1">{t.mismatch}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !pwd || pwd !== pwd2}
                className="w-full h-[52px] bg-[#FEAE00] hover:bg-[#FFBF2D] text-black rounded-md font-extrabold text-[14px] tracking-[0.06em] uppercase disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="reset-submit-btn"
              >
                {submitting ? (
                  <>
                    <SpinnerGap size={18} className="animate-spin" /> {t.submitting}
                  </>
                ) : (
                  t.submit
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
