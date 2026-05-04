/**
 * Customer Auth — direct Google Sign-In via Google Identity Services (GIS).
 *
 * Flow:
 *   1. Page loads → fetches the Google Client ID from /api/auth/google-client-id
 *      (configured in Admin → Integrations → Google Sign-In).
 *   2. Loads https://accounts.google.com/gsi/client once, initialises GIS with
 *      the Client ID, renders a Google-branded button (or falls back to our
 *      own styled button that triggers google.accounts.id.prompt()).
 *   3. User chooses account in the Google popup → GIS returns an ID token.
 *   4. We POST { credential } to /api/customer-auth/google/verify, which
 *      validates the token server-side and returns our customer + sessionToken.
 *
 * No Emergent intermediate screen. No extra redirect.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from 'react';
import { useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import axios from 'axios';
import { useLang } from '../../i18n';
import { useAuth } from '../../App';
import BibiLogo from '../../components/public/BibiLogo';
import {
  User,
  Lock,
  Envelope,
  Eye,
  EyeSlash,
  ArrowLeft,
  Warning,
  SpinnerGap,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

// ----------------------------------------------------------------------------
// Inline EN/BG strings — the cabinet auth screen must ONLY speak EN/BG, never
// Ukrainian (admin) even if the user toggled lang=uk elsewhere.
// ----------------------------------------------------------------------------
const STR = {
  en: {
    welcomeBack: 'Welcome Back',
    createAccount: 'Create Account',
    signInSubtitle: 'Sign in to access your BIBI Cars dashboard.',
    signUpSubtitle: 'Join BIBI Cars to unlock your personal dashboard.',
    continueWithGoogle: 'Continue with Google',
    or: 'or',
    loginWithEmail: 'Continue with Email',
    yourName: 'Your Name',
    namePlaceholder: 'John Doe',
    emailLabel: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    passwordMinHint: 'At least 6 characters.',
    loading: 'Loading…',
    signInCta: 'Sign In',
    signUpCta: 'Create Account',
    noAccount: "Don't have an account?",
    haveAccount: 'Already have an account?',
    register: 'Register',
    login: 'Sign in',
    mustAgreeLegal: 'Please accept the Privacy Policy and Terms of Use to continue.',
    legalNotice: 'I agree with the',
    and: 'and',
    privacy: 'Privacy Policy',
    terms: 'Terms of Use',
    backToSite: 'Back to site',
    secureLogin: 'Secure login',
    authorizing: 'Authorizing…',
    googleNotConfigured: 'Google Sign-In is not configured yet. Admin can set it up in Integrations.',
    authError: 'Authentication failed. Please try again.',
  },
  bg: {
    welcomeBack: 'Добре дошли отново',
    createAccount: 'Създайте акаунт',
    signInSubtitle: 'Влезте, за да достъпите своето BIBI Cars табло.',
    signUpSubtitle: 'Регистрирайте се в BIBI Cars, за да получите своето табло.',
    continueWithGoogle: 'Продължете с Google',
    or: 'или',
    loginWithEmail: 'Продължи с имейл',
    yourName: 'Вашето име',
    namePlaceholder: 'Иван Иванов',
    emailLabel: 'Имейл',
    password: 'Парола',
    forgotPassword: 'Забравена парола?',
    passwordMinHint: 'Поне 6 символа.',
    loading: 'Зареждане…',
    signInCta: 'Вход',
    signUpCta: 'Регистрация',
    noAccount: 'Нямате акаунт?',
    haveAccount: 'Вече имате акаунт?',
    register: 'Регистрация',
    login: 'Вход',
    mustAgreeLegal: 'Моля, приемете Политиката за поверителност и Условията за ползване.',
    legalNotice: 'Съгласен съм с',
    and: 'и',
    privacy: 'Политиката за поверителност',
    terms: 'Условията за ползване',
    backToSite: 'Обратно към сайта',
    secureLogin: 'Защитен вход',
    authorizing: 'Оторизация…',
    googleNotConfigured: 'Google Sign-In все още не е настроен. Администраторът може да го конфигурира в Integrations.',
    authError: 'Неуспешно удостоверяване. Моля, опитайте отново.',
  },
};
const pick = (lang) => (lang === 'bg' ? STR.bg : STR.en);

// ============================================================================
// AUTH CONTEXT
// ============================================================================

const CustomerAuthContext = createContext(null);
export const useCustomerAuth = () => useContext(CustomerAuthContext);

export const CustomerAuthProvider = ({ children }) => {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { checkAuth(); }, []);

  const checkAuth = async () => {
    try {
      const savedSession = localStorage.getItem('customer_session');
      let sessionToken = null;
      if (savedSession) {
        try { sessionToken = JSON.parse(savedSession)?.sessionToken || null; } catch {}
      }
      if (sessionToken) {
        try {
          const res = await axios.get(`${API_URL}/api/customer-auth/google/me`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          });
          setCustomer(res.data);
          localStorage.setItem('customer_session', JSON.stringify({
            ...res.data,
            sessionToken: res.data.sessionToken || sessionToken,
          }));
          return;
        } catch {
          localStorage.removeItem('customer_session');
        }
      }
      const token = localStorage.getItem('customer_token');
      if (token) {
        try {
          const res = await axios.get(`${API_URL}/api/customer-auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setCustomer(res.data);
          if (res.data?.customerId) {
            localStorage.setItem('customer_session', JSON.stringify(res.data));
          }
          return;
        } catch {
          localStorage.removeItem('customer_token');
          localStorage.removeItem('customer_session');
        }
      }
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  // Verify Google ID token (from GIS) with our backend
  const verifyGoogleCredential = async (credential) => {
    const res = await axios.post(`${API_URL}/api/customer-auth/google/verify`, { credential });
    const customerData = res.data;
    if (customerData?.customerId) {
      localStorage.setItem(
        'customer_session',
        JSON.stringify({ ...customerData, sessionToken: customerData.sessionToken }),
      );
    }
    setCustomer(customerData);
    return customerData;
  };

  // Legacy email/password login
  const login = async (email, password) => {
    const res = await axios.post(`${API_URL}/api/customer-auth/login`, { email, password });
    const customerData = res.data;
    localStorage.setItem('customer_token', customerData.accessToken);
    localStorage.setItem('customer_session', JSON.stringify(customerData));
    setCustomer(customerData);
    return customerData;
  };
  const register = async (email, password, name) => {
    const res = await axios.post(`${API_URL}/api/customer-auth/register`, {
      email, password, name, customerId: '',
    });
    const customerData = res.data;
    localStorage.setItem('customer_token', customerData.accessToken);
    localStorage.setItem('customer_session', JSON.stringify(customerData));
    setCustomer(customerData);
    return customerData;
  };

  const logout = async () => {
    try {
      const saved = localStorage.getItem('customer_session');
      const token = saved ? JSON.parse(saved)?.sessionToken : null;
      if (token) {
        await axios.post(
          `${API_URL}/api/customer-auth/google/logout`,
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        );
      }
    } catch {}
    localStorage.removeItem('customer_token');
    localStorage.removeItem('customer_session');
    setCustomer(null);
  };

  return (
    <CustomerAuthContext.Provider
      value={{
        customer,
        loading,
        login,
        register,
        logout,
        verifyGoogleCredential,
        checkAuth,
      }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
};

// ============================================================================
// PROTECTED ROUTE
// ============================================================================

export const CustomerProtectedRoute = ({ children }) => {
  const { customer, loading } = useCustomerAuth();
  const location = useLocation();
  if (location.state?.user) return children;
  if (loading) {
    return (
      <div className="public-theme min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <SpinnerGap size={40} className="animate-spin text-[#FEAE00]" />
          <span className="text-[12px] uppercase tracking-[0.18em] text-white/50">loading</span>
        </div>
      </div>
    );
  }
  if (!customer) return <Navigate to="/cabinet/login" replace />;
  return children;
};

// ============================================================================
// AUTH CALLBACK — Emergent flow is removed; this route redirects to /cabinet/login
// (kept for any old bookmarks / external links).
// ============================================================================

export const AuthCallback = () => {
  const navigate = useNavigate();
  useEffect(() => { navigate('/cabinet/login', { replace: true }); }, [navigate]);
  return null;
};

// ============================================================================
// Google Identity Services loader — reloaded when language changes so that the
// native button text follows the user's EN/BG choice (GIS reads locale only
// on script init, not from renderButton options).
// ============================================================================

let gsiLoaderPromise = null;
let gsiLoadedLocale = null;

const loadGsiWithLocale = (locale) => {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (gsiLoaderPromise && gsiLoadedLocale === locale) return gsiLoaderPromise;

  // Remove any existing script + reset window.google.accounts so re-init works
  try {
    document
      .querySelectorAll('script[src*="accounts.google.com/gsi/client"]')
      .forEach((s) => s.remove());
    if (window.google && window.google.accounts) {
      try { delete window.google.accounts; } catch { window.google.accounts = undefined; }
    }
  } catch {}
  gsiLoaderPromise = null;
  gsiLoadedLocale = locale;

  gsiLoaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${GSI_SRC}?hl=${encodeURIComponent(locale)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gsi failed'));
    document.head.appendChild(s);
  });
  return gsiLoaderPromise;
};

// ============================================================================
// LOGIN PAGE
// ============================================================================

export const CustomerLoginPage = () => {
  const { lang } = useLang();
  const t = pick(lang);
  const navigate = useNavigate();
  const auth = useCustomerAuth();
  const staffAuth = useAuth();
  const { customer, verifyGoogleCredential } = auth;

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  // Google Sign-In state
  const [clientId, setClientId] = useState('');
  const [googleReady, setGoogleReady] = useState(false);
  const [googleAuthorizing, setGoogleAuthorizing] = useState(false);
  // Hidden GIS button — we click it programmatically from our own styled button
  // so we have full control over the visible text/icon (and locale).
  const hiddenGoogleRef = useRef(null);

  // Redirect if already logged in (staff or customer — whichever is active)
  useEffect(() => {
    // 1. Staff session takes priority (they came here from the site's profile icon
    //    but are already signed in as admin/team_lead/manager → send them to
    //    their proper cabinet without any extra click).
    const staffUser = staffAuth?.user;
    if (staffUser?.id) {
      const role = (staffUser.role || '').toLowerCase();
      if (role === 'manager') navigate('/manager', { replace: true });
      else if (role === 'team_lead') navigate('/team/dashboard', { replace: true });
      else if (role === 'admin' || role === 'master_admin') navigate('/admin', { replace: true });
      return;
    }
    // 2. Otherwise — standard customer redirect
    if (customer?.customerId) {
      navigate(`/cabinet/${customer.customerId}`);
    }
  }, [customer, staffAuth?.user, navigate]);

  // Fetch Client ID once
  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/api/auth/google-client-id`)
      .then((r) => { if (!cancelled) setClientId(r.data?.clientId || ''); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Handle Google credential response (from GIS popup)
  const handleGoogleCredential = useCallback(async (response) => {
    if (!response?.credential) return;
    setError('');
    setGoogleAuthorizing(true);
    try {
      const data = await verifyGoogleCredential(response.credential);
      navigate(`/cabinet/${data.customerId}`, { replace: true, state: { user: data } });
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
      setError(typeof detail === 'string' ? detail : t.authError);
      setGoogleAuthorizing(false);
    }
  }, [verifyGoogleCredential, navigate, t.authError]);

  // Initialise GIS once we have Client ID. The native button is hidden, so we
  // don't need to re-init on language change anymore.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setGoogleReady(false);
    loadGsiWithLocale('en')
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleGoogleCredential,
            auto_select: false,
            ux_mode: 'popup',
          });
          setGoogleReady(true);
        } catch (e) {
          console.warn('[gsi] initialize failed', e);
        }
      })
      .catch((e) => console.warn('[gsi] load failed', e));
    return () => { cancelled = true; };
  }, [clientId, handleGoogleCredential]);

  // Render the hidden, native Google button — we never show this to the user.
  // It exists only so that our visible custom button can programmatically
  // dispatch a click on it, which triggers the Google account-picker popup.
  // This way the user only sees OUR text/icon (in EN/BG) and Google's iframe
  // language no longer matters.
  useEffect(() => {
    if (!googleReady || !hiddenGoogleRef.current || !window.google?.accounts?.id) return;
    try {
      hiddenGoogleRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(hiddenGoogleRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 380,
      });
    } catch (e) {
      console.warn('[gsi] renderButton failed', e);
    }
  }, [googleReady]);

  // Trigger the hidden GIS button (= opens Google's native account-picker popup).
  const triggerGoogleSignIn = () => {
    const host = hiddenGoogleRef.current;
    if (!host) return;
    // GIS renders its button inside a div[role="button"] inside an iframe wrapper.
    const native = host.querySelector('div[role="button"]') || host.querySelector('button');
    if (native) {
      native.click();
      return;
    }
    // Fallback: try one-tap prompt.
    try { window.google?.accounts?.id?.prompt(); } catch {}
  };

  const handleGoogleClick = () => {
    if (!agreed) { setError(t.mustAgreeLegal); return; }
    if (!clientId) { setError(t.googleNotConfigured); return; }
    if (!window.google?.accounts?.id) return;
    triggerGoogleSignIn();
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    // Consent required only for REGISTRATION — existing accounts (customers or
    // staff) already accepted the legal terms when they were created. Re-
    // asking on every login is hostile UX, especially for staff who log in
    // through this form too (see role-based redirect below).
    if (!isLogin && !agreed) { setError(t.mustAgreeLegal); return; }
    setError(''); setSubmitting(true);
    try {
      if (isLogin) {
        // ── 1. Try STAFF login first (admin / master_admin / team_lead / manager) ──
        //    Staff table ≠ customer table — so we attempt /api/auth/login first.
        //    If we get a 401 we fall back to customer login. Any other 2xx → role-based redirect.
        try {
          const staffUser = await staffAuth.login(email, password);
          const role = (staffUser?.role || '').toLowerCase();
          if (role === 'manager') {
            navigate('/manager', { replace: true });
          } else if (role === 'team_lead') {
            navigate('/team/dashboard', { replace: true });
          } else if (role === 'admin' || role === 'master_admin') {
            // `master_admin` is a legacy alias kept only for back-compat tokens.
            navigate('/admin', { replace: true });
          } else {
            // Unknown staff role — safe default
            navigate('/admin', { replace: true });
          }
          return;
        } catch (staffErr) {
          const code = staffErr?.response?.status;
          // 401 / 404 → not a staff account → try customer login below.
          // 403 / 429 / 500 → bubble up.
          if (code && code !== 401 && code !== 404 && code !== 422) {
            throw staffErr;
          }
        }

        // ── 2. Fallback to CUSTOMER login ──
        const data = await auth.login(email, password);
        navigate(`/cabinet/${data.customerId}`);
      } else {
        const data = await auth.register(email, password, name);
        navigate(`/cabinet/${data.customerId}`);
      }
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data?.detail || err.message;
      setError(typeof detail === 'string' ? detail : t.authError);
    } finally {
      setSubmitting(false);
    }
  };

  const title = isLogin ? t.welcomeBack : t.createAccount;
  const subtitle = isLogin ? t.signInSubtitle : t.signUpSubtitle;

  const inputBase =
    'w-full h-[52px] pl-11 pr-4 bg-[#0F0F0D] border border-[#3A3A37] rounded-md text-[15px] font-medium text-white placeholder:text-[#6A6A66] outline-none transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_0_rgba(0,0,0,0.4)] focus:border-[#FEAE00] focus:ring-2 focus:ring-[#FEAE00]/35 focus:shadow-[0_0_0_4px_rgba(254,174,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-[#55544E]';

  return (
    <div
      className="public-theme min-h-screen bg-black relative overflow-hidden flex flex-col"
      data-testid="customer-login-page"
    >
      {/* Ambient accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(700px 480px at 12% -10%, rgba(254,174,0,0.14) 0%, rgba(0,0,0,0) 55%),' +
            'radial-gradient(620px 420px at 95% 110%, rgba(254,174,0,0.10) 0%, rgba(0,0,0,0) 60%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='1' cy='1' r='1'/%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10 flex items-center justify-between px-6 xl:px-12 pt-6 lg:pt-8">
        <BibiLogo height={40} />
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10 lg:py-14">
        <div className="w-full max-w-[440px]">
          <div className="text-center mb-8">
            <h1
              className="text-[32px] lg:text-[40px] leading-[1.05] font-extrabold tracking-tight text-white"
              style={{ fontFamily: "'Mazzard', 'Mazzard H', 'Mazzard M', system-ui, sans-serif" }}
            >
              {title}
            </h1>
            <p className="text-[14px] lg:text-[15px] text-white/75 mt-3 max-w-[380px] mx-auto leading-relaxed">
              {subtitle}
            </p>
          </div>

          <div className="rounded-2xl border border-[#FEAE00]/25 bg-[#1D1D1B] shadow-[0_20px_60px_rgba(0,0,0,0.55),0_0_0_1px_rgba(254,174,0,0.08),inset_0_1px_0_rgba(255,255,255,0.04)] p-6 sm:p-8">
            {error && (
              <div
                className="mb-5 p-3 rounded-md bg-[#3A1212] border border-[#5B1B1B] flex items-start gap-2.5"
                role="alert"
                data-testid="auth-error"
              >
                <Warning size={18} className="text-[#FF6B6B] mt-[1px] flex-shrink-0" />
                <span className="text-[13px] text-[#FFCACA] leading-snug">{error}</span>
              </div>
            )}

            {/* Google Sign-In — fully custom button so we control text + icon
                in the user's chosen language (EN/BG). The native GIS button is
                rendered hidden off-screen and clicked programmatically when the
                user taps our button. This bypasses the GIS limitation where the
                native button text follows browser Accept-Language (e.g. Russian). */}
            <div className="relative" data-testid="google-signin-wrap">
              {/* Hidden native GIS button (mounted only when ready) */}
              <div
                ref={hiddenGoogleRef}
                aria-hidden="true"
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  top: 0, left: 0,
                  width: 1, height: 1,
                  overflow: 'hidden',
                  opacity: 0,
                  pointerEvents: 'none',
                  visibility: 'hidden',
                }}
                data-testid="google-signin-native-hidden"
              />

              {googleAuthorizing ? (
                <div className="w-full h-[54px] rounded-md bg-black border border-[#3A3A37] flex items-center justify-center gap-2.5 text-white">
                  <SpinnerGap size={18} className="animate-spin text-[#FEAE00]" />
                  <span className="text-[13px] font-medium">{t.authorizing}</span>
                </div>
              ) : !agreed ? (
                /* DISABLED state — only a lock icon, no text, fully darkened */
                <button
                  type="button"
                  onClick={handleGoogleClick}
                  aria-label={t.mustAgreeLegal}
                  title={t.mustAgreeLegal}
                  className="w-full h-[54px] rounded-md bg-[#0A0A09] border border-[#2A2A28] cursor-not-allowed flex items-center justify-center transition-colors hover:bg-[#0F0F0E] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FEAE00]/40"
                  data-testid="google-signin-disabled"
                >
                  <Lock size={20} weight="fill" className="text-white/50" />
                </button>
              ) : (
                /* ENABLED state — our localized text + Google logo */
                <button
                  type="button"
                  onClick={handleGoogleClick}
                  disabled={!googleReady || !clientId}
                  className={[
                    'w-full h-[54px] rounded-md font-semibold text-[14px] transition-all flex items-center justify-center gap-3 border',
                    googleReady && clientId
                      ? 'bg-black hover:bg-[#121212] active:bg-[#0A0A0A] text-white border-[#3A3A37] hover:border-[#FEAE00]/55 shadow-[0_4px_14px_-2px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]'
                      : 'bg-black/60 text-white/55 border-[#2A2A28] cursor-not-allowed',
                  ].join(' ')}
                  data-testid="google-signin-btn"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#EA4335" d="M9 3.48c1.69 0 2.85.73 3.5 1.34l2.56-2.5C13.5.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.57 5.1 6.62 3.48 9 3.48z"/>
                    <path fill="#34A853" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 01-1.79 2.71l2.84 2.2c1.66-1.53 2.75-3.78 2.75-6.56z"/>
                    <path fill="#FBBC05" d="M3.88 10.78a5.4 5.4 0 010-3.56L.96 4.96a9 9 0 000 8.08l2.92-2.26z"/>
                    <path fill="#4285F4" d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.84-2.2c-.79.53-1.81.85-3.12.85-2.38 0-4.43-1.62-5.13-3.82L.96 13.04C2.44 15.98 5.48 18 9 18z"/>
                  </svg>
                  <span>{t.continueWithGoogle}</span>
                </button>
              )}
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#3A3A37]" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 bg-[#1D1D1B] text-[11px] uppercase tracking-[0.22em] text-white/60 font-semibold">
                  {t.or}
                </span>
              </div>
            </div>

            {!showEmailForm ? (
              <button
                onClick={() => setShowEmailForm(true)}
                className="w-full h-[54px] rounded-md border border-[#3A3A37] bg-[#0F0F0D] hover:border-[#FEAE00] hover:bg-[#171614] hover:shadow-[0_0_0_3px_rgba(254,174,0,0.18)] text-white font-semibold text-[14px] transition-all flex items-center justify-center gap-3"
                data-testid="show-email-form-btn"
              >
                <Envelope size={18} className="text-[#FEAE00]" />
                {t.loginWithEmail}
              </button>
            ) : (
              <form onSubmit={handleEmailSubmit} className="space-y-5" data-testid="email-auth-form">
                {!isLogin && (
                  <div>
                    <label className="block text-[12px] font-bold text-[#FEAE00] mb-2 uppercase tracking-[0.12em]">
                      {t.yourName}
                    </label>
                    <div className="relative">
                      <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FEAE00]/80" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t.namePlaceholder}
                        className={inputBase}
                        data-testid="register-name-input"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[12px] font-bold text-[#FEAE00] mb-2 uppercase tracking-[0.12em]">
                    {t.emailLabel}
                  </label>
                  <div className="relative">
                    <Envelope size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FEAE00]/80" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      required
                      className={inputBase}
                      data-testid="login-email-input"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[12px] font-bold text-[#FEAE00] uppercase tracking-[0.12em]">
                      {t.password}
                    </label>
                    {isLogin && (
                      <Link
                        to="/cabinet/forgot-password"
                        className="text-[11px] text-white/70 hover:text-[#FEAE00] font-medium transition-colors"
                        tabIndex={-1}
                        data-testid="forgot-password-link"
                      >
                        {t.forgotPassword}
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FEAE00]/80" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className={`${inputBase} pr-11`}
                      data-testid="login-password-input"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-[#FEAE00] transition-colors p-1"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {!isLogin && <p className="mt-1.5 text-[11px] text-white/55">{t.passwordMinHint}</p>}
                </div>

                <button
                  type="submit"
                  disabled={submitting || (!isLogin && !agreed)}
                  className="w-full h-[54px] mt-2 bg-[#FEAE00] hover:bg-[#FFBF2D] active:bg-[#E89D00] text-black rounded-md font-extrabold text-[14px] tracking-[0.06em] uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_8px_30px_-4px_rgba(254,174,0,0.65),inset_0_1px_0_rgba(255,255,255,0.25)]"
                  data-testid="login-submit-btn"
                >
                  {submitting ? (
                    <>
                      <SpinnerGap size={18} className="animate-spin" />
                      {t.loading}
                    </>
                  ) : isLogin ? t.signInCta : t.signUpCta}
                </button>
              </form>
            )}

            {showEmailForm && (
              <div className="mt-6 text-center text-[13px]">
                <span className="text-white/70">
                  {isLogin ? t.noAccount : t.haveAccount}
                </span>
                <button
                  onClick={() => { setIsLogin((v) => !v); setError(''); }}
                  className="ml-2 text-[#FEAE00] font-bold hover:underline underline-offset-4"
                  data-testid="toggle-auth-mode-btn"
                >
                  {isLogin ? t.register : t.login}
                </button>
              </div>
            )}
          </div>

          {/* Legal consent + Back link */}
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => { setAgreed((v) => !v); if (!agreed) setError(''); }}
              className={[
                'w-full flex items-start gap-3 text-left p-3 rounded-lg border transition-colors',
                agreed
                  ? 'bg-[#FEAE00]/10 border-[#FEAE00]/40'
                  : 'bg-[#0F0F0D] border-[#3A3A37] hover:border-[#FEAE00]/40',
              ].join(' ')}
              data-testid="auth-consent-checkbox"
              aria-pressed={agreed}
            >
              <span
                className={[
                  'w-5 h-5 rounded border flex items-center justify-center mt-0.5 shrink-0 transition-colors',
                  agreed ? 'bg-[#FEAE00] border-[#FEAE00]' : 'bg-transparent border-[#5A5A56]',
                ].join(' ')}
              >
                {agreed && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12.5l5 5L20 6" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="flex-1 text-[12.5px] text-white/85 leading-relaxed">
                {t.legalNotice}{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[#FEAE00] underline underline-offset-2 hover:brightness-110 font-medium"
                >
                  {t.privacy}
                </a>{' '}
                {t.and}{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[#FEAE00] underline underline-offset-2 hover:brightness-110 font-medium"
                >
                  {t.terms}
                </a>.
              </span>
            </button>

            <div className="text-center">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.14em] text-white/75 hover:text-[#FEAE00] transition-colors"
                data-testid="back-to-site-link"
              >
                <ArrowLeft size={14} />
                {t.backToSite}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Footer trust strip */}
      <div className="relative z-10 border-t border-[#1A1A18] bg-black/40">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-white/35 uppercase tracking-[0.14em]">
          <span>© {new Date().getFullYear()} BIBI CARS</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FEAE00] shadow-[0_0_8px_rgba(254,174,0,0.8)]" />
            {t.secureLogin}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CustomerLoginPage;
