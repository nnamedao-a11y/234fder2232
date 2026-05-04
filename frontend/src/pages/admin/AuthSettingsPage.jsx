/**
 * AuthSettingsPage — admin UI for dynamic auth configuration
 * ------------------------------------------------------------
 * GET  /api/admin/settings/auth   — current values (jwt.secret masked)
 * PATCH /api/admin/settings/auth  — deep-merge update
 *
 * Fields grouped into five blocks:
 *   1. URLs             (baseUrl, frontendUrl)
 *   2. Google Sign-In   (clientId, enable/disable)
 *   3. JWT              (secret, expiries)
 *   4. Feature flags    (password / google / register / reset toggles)
 *   5. Password policy  (min length, reset TTL)
 *   6. Email            (mode, from, reply-to)
 *
 * All changes are applied via a single "Save" button per block — each block
 * sends only its own slice via PATCH, so partial failures don't lose other
 * edits. The "Resolved effective values" panel at the top always shows the
 * URLs/IDs that are actually in effect (after fallbacks).
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Link as LinkIcon,
  GoogleLogo,
  Key,
  ToggleLeft,
  ShieldCheck,
  EnvelopeSimple,
  FloppyDisk,
  ArrowCounterClockwise,
  CheckCircle,
  WarningCircle,
  Info,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// ── small building blocks ──────────────────────────────────────────
const Block = ({ icon: Icon, title, description, children, onSave, saving, testId }) => (
  <div
    className="bg-white border border-[#E4E4E7] rounded-2xl p-6 shadow-sm"
    data-testid={testId}
  >
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-[#18181B] text-white flex items-center justify-center shrink-0">
            <Icon size={20} weight="duotone" />
          </div>
        )}
        <div>
          <h2 className="font-semibold text-[#18181B] text-lg">{title}</h2>
          {description && (
            <p className="text-sm text-[#71717A] mt-1 max-w-2xl">{description}</p>
          )}
        </div>
      </div>
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="shrink-0 px-4 py-2 rounded-lg bg-[#FEAE00] hover:bg-[#FFBF2D] text-black font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
          data-testid={`${testId}-save`}
        >
          <FloppyDisk size={16} weight="bold" />
          {saving ? 'Збереження…' : 'Зберегти'}
        </button>
      )}
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

const Field = ({ label, hint, error, children }) => (
  <div>
    <label className="block text-xs font-semibold text-[#52525B] mb-1.5 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {hint && <p className="text-xs text-[#71717A] mt-1">{hint}</p>}
    {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    className={
      'w-full px-3 py-2.5 rounded-lg border border-[#E4E4E7] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FEAE00]/40 focus:border-[#FEAE00] ' +
      (props.className || '')
    }
  />
);

const Toggle = ({ checked, onChange, disabled, ...rest }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
      checked ? 'bg-[#18181B]' : 'bg-[#E4E4E7]'
    } disabled:opacity-40`}
    {...rest}
  >
    <span
      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`}
    />
  </button>
);

// ── main page ──────────────────────────────────────────────────────
export default function AuthSettingsPage() {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  // local draft state for editable fields
  const [urls, setUrls] = useState({ baseUrl: '', frontendUrl: '' });
  const [google, setGoogle] = useState({ clientId: '' });
  const [jwt, setJwt] = useState({ secret: '', accessExpires: '15m', refreshExpires: '7d' });
  const [features, setFeatures] = useState({
    googleEnabled: true,
    passwordEnabled: true,
    registerEnabled: true,
    resetPasswordEnabled: true,
  });
  const [password, setPassword] = useState({ minLength: 6, resetTokenTtlMinutes: 60 });
  const [email, setEmail] = useState({ mode: 'dry_run', from: '', replyTo: '' });
  const [jwtDirty, setJwtDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/admin/settings/auth`);
      const data = res.data || {};
      setDoc(data);
      setUrls({ baseUrl: data.baseUrl || '', frontendUrl: data.frontendUrl || '' });
      setGoogle({ clientId: (data.google && data.google.clientId) || '' });
      setJwt({
        secret: (data.jwt && data.jwt.secret) || '',
        accessExpires: (data.jwt && data.jwt.accessExpires) || '15m',
        refreshExpires: (data.jwt && data.jwt.refreshExpires) || '7d',
      });
      setJwtDirty(false);
      setFeatures({
        googleEnabled: data.features?.googleEnabled ?? true,
        passwordEnabled: data.features?.passwordEnabled ?? true,
        registerEnabled: data.features?.registerEnabled ?? true,
        resetPasswordEnabled: data.features?.resetPasswordEnabled ?? true,
      });
      setPassword({
        minLength: Number(data.password?.minLength ?? 6),
        resetTokenTtlMinutes: Number(data.password?.resetTokenTtlMinutes ?? 60),
      });
      setEmail({
        mode: data.email?.mode || 'dry_run',
        from: data.email?.from || '',
        replyTo: data.email?.replyTo || '',
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Не вдалося завантажити налаштування');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (slice, key) => {
    setSaving(key);
    try {
      await axios.patch(`${API_URL}/api/admin/settings/auth`, slice);
      toast.success('Збережено');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка збереження');
    } finally {
      setSaving('');
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-[#71717A]">
        <div className="animate-spin w-6 h-6 border-2 border-[#18181B] border-t-transparent rounded-full mx-auto mb-3" />
        Завантаження…
      </div>
    );
  }

  const resolved = doc?._resolved || {};

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="auth-settings-page">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={28} weight="duotone" className="text-[#18181B]" />
          <h1 className="text-2xl font-bold text-[#18181B]">Auth & URL Settings</h1>
        </div>
        <p className="text-sm text-[#71717A] mt-1 ml-11">
          Динамічна конфігурація автентифікації — base URL, Google OAuth, JWT,
          feature flags і password policy. Все читається з БД (колекція
          <code className="mx-1 px-1.5 py-0.5 bg-[#F4F4F5] rounded text-[#18181B]">app_settings</code>),
          тому для переносу на новий домен достатньо змінити одне поле без деплою.
        </p>
      </div>

      {/* ── Effective values (read-only) ─────────────────────────── */}
      <div
        className="bg-blue-50/60 border border-blue-200 rounded-2xl p-4 mb-6 text-sm"
        data-testid="auth-resolved-panel"
      >
        <div className="flex items-start gap-2 text-blue-900">
          <Info size={18} weight="fill" className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold mb-2">Зараз ефективно (з урахуванням fallback)</div>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-blue-800/80">baseUrl</dt>
                <dd className="font-mono text-blue-950 truncate" data-testid="resolved-baseUrl">
                  {resolved.baseUrl || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-blue-800/80">frontendUrl</dt>
                <dd className="font-mono text-blue-950 truncate" data-testid="resolved-frontendUrl">
                  {resolved.frontendUrl || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-blue-800/80">google.clientId</dt>
                <dd className="font-mono text-blue-950 truncate">
                  {resolved.googleClientId ? (
                    <span className="text-emerald-700 flex items-center gap-1">
                      <CheckCircle size={14} weight="fill" /> встановлено
                    </span>
                  ) : (
                    <span className="text-amber-700 flex items-center gap-1">
                      <WarningCircle size={14} weight="fill" /> не налаштовано
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-blue-800/80">request base_url</dt>
                <dd className="font-mono text-blue-900/70 truncate">{resolved.requestBaseUrl || '—'}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {/* ── 1. URLs ─────────────────────────────────────────────── */}
        <Block
          icon={LinkIcon}
          title="Public URLs"
          description="baseUrl — публічний URL бекенду (callback, email); frontendUrl — URL фронтенду (reset links, пост-OAuth редірект). Якщо frontendUrl порожній, використовується baseUrl."
          testId="auth-urls-block"
          saving={saving === 'urls'}
          onSave={() =>
            patch({ baseUrl: urls.baseUrl, frontendUrl: urls.frontendUrl }, 'urls')
          }
        >
          <Field
            label="Base URL (backend)"
            hint="Приклад: https://bibicars.bg — без слешу в кінці"
          >
            <Input
              value={urls.baseUrl}
              onChange={(e) => setUrls({ ...urls, baseUrl: e.target.value })}
              placeholder="https://bibicars.bg"
              data-testid="auth-input-baseUrl"
            />
          </Field>
          <Field
            label="Frontend URL"
            hint="Куди ведуть reset-password листи та redirect після логіну. Для single-domain залишайте порожнім → підставиться baseUrl."
          >
            <Input
              value={urls.frontendUrl}
              onChange={(e) => setUrls({ ...urls, frontendUrl: e.target.value })}
              placeholder="https://bibicars.bg"
              data-testid="auth-input-frontendUrl"
            />
          </Field>
        </Block>

        {/* ── 2. Google Sign-In ───────────────────────────────────── */}
        <Block
          icon={GoogleLogo}
          title="Google Sign-In (GIS popup)"
          description="Використовується Google Identity Services popup + ID token верифікація — redirect_uri не потрібен, тому працює на будь-якому preview-домені. Дзеркалиться у legacy integration_configs для зворотної сумісності."
          testId="auth-google-block"
          saving={saving === 'google'}
          onSave={() => patch({ google: { clientId: google.clientId.trim() } }, 'google')}
        >
          <Field
            label="Client ID"
            hint="xxxxxxxxxxxx.apps.googleusercontent.com — з Google Cloud Console (OAuth 2.0 Client IDs). Secret не потрібен для GIS."
          >
            <Input
              value={google.clientId}
              onChange={(e) => setGoogle({ clientId: e.target.value })}
              placeholder="123456789-abc.apps.googleusercontent.com"
              data-testid="auth-input-googleClientId"
            />
          </Field>
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium text-sm text-[#18181B]">Увімкнути Google Sign-In</div>
              <div className="text-xs text-[#71717A] mt-0.5">
                Якщо вимкнено — кнопка Google ховається на login-сторінці
              </div>
            </div>
            <Toggle
              checked={features.googleEnabled}
              onChange={(v) => {
                setFeatures({ ...features, googleEnabled: v });
                patch({ features: { googleEnabled: v } }, 'features-google');
              }}
              data-testid="auth-toggle-googleEnabled"
            />
          </div>
        </Block>

        {/* ── 3. Password auth & reset policy ─────────────────────── */}
        <Block
          icon={Key}
          title="Password Auth & Reset"
          description="Параметри реєстрації email+пароль та скидання пароля через одноразовий токен."
          testId="auth-password-block"
          saving={saving === 'password'}
          onSave={() =>
            patch(
              {
                password: {
                  minLength: Number(password.minLength) || 6,
                  resetTokenTtlMinutes: Number(password.resetTokenTtlMinutes) || 60,
                },
              },
              'password'
            )
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Мін. довжина пароля" hint="Застосовується при register і reset">
              <Input
                type="number"
                min={4}
                max={64}
                value={password.minLength}
                onChange={(e) =>
                  setPassword({ ...password, minLength: e.target.value })
                }
                data-testid="auth-input-minLength"
              />
            </Field>
            <Field label="TTL reset-токена (хв)" hint="Скільки часу діє посилання">
              <Input
                type="number"
                min={1}
                max={1440}
                value={password.resetTokenTtlMinutes}
                onChange={(e) =>
                  setPassword({
                    ...password,
                    resetTokenTtlMinutes: e.target.value,
                  })
                }
                data-testid="auth-input-resetTtl"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {[
              ['passwordEnabled', 'Password login'],
              ['registerEnabled', 'Реєстрація'],
              ['resetPasswordEnabled', 'Скидання пароля'],
            ].map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg px-3 py-2"
              >
                <span className="text-sm text-[#18181B]">{label}</span>
                <Toggle
                  checked={features[key]}
                  onChange={(v) => {
                    setFeatures({ ...features, [key]: v });
                    patch({ features: { [key]: v } }, `features-${key}`);
                  }}
                  data-testid={`auth-toggle-${key}`}
                />
              </div>
            ))}
          </div>
        </Block>

        {/* ── 4. JWT ──────────────────────────────────────────────── */}
        <Block
          icon={ToggleLeft}
          title="JWT (staff tokens)"
          description="Секрет для підпису staff-токенів. Якщо поле порожнє — використовується env JWT_SECRET. Видаляється з видачі API (ніколи не розкривається)."
          testId="auth-jwt-block"
          saving={saving === 'jwt'}
          onSave={() => {
            const slice = {
              jwt: {
                accessExpires: jwt.accessExpires,
                refreshExpires: jwt.refreshExpires,
              },
            };
            // Only send secret if user actually typed a new one
            if (jwtDirty) slice.jwt.secret = jwt.secret;
            patch(slice, 'jwt');
          }}
        >
          <Field
            label="Secret"
            hint={
              doc?.jwt?.secretIsSet
                ? 'Вже встановлено — поле замасковане. Введіть нове значення, щоб замінити.'
                : 'Залиште порожнім, щоб використовувати env JWT_SECRET.'
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={jwt.secret}
                onChange={(e) => {
                  setJwt({ ...jwt, secret: e.target.value });
                  setJwtDirty(true);
                }}
                placeholder={doc?.jwt?.secretIsSet ? '********' : 'super-secret-string'}
                data-testid="auth-input-jwtSecret"
              />
              {jwtDirty && (
                <button
                  type="button"
                  onClick={() => {
                    setJwt({ ...jwt, secret: doc?.jwt?.secret || '' });
                    setJwtDirty(false);
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm text-[#71717A] hover:bg-[#F4F4F5] flex items-center gap-1"
                >
                  <ArrowCounterClockwise size={14} /> Reset
                </button>
              )}
            </div>
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Access token TTL" hint="Формат Go duration: 15m, 1h, 24h">
              <Input
                value={jwt.accessExpires}
                onChange={(e) => setJwt({ ...jwt, accessExpires: e.target.value })}
                data-testid="auth-input-accessExpires"
              />
            </Field>
            <Field label="Refresh token TTL">
              <Input
                value={jwt.refreshExpires}
                onChange={(e) => setJwt({ ...jwt, refreshExpires: e.target.value })}
                data-testid="auth-input-refreshExpires"
              />
            </Field>
          </div>
        </Block>

        {/* ── 5. Email ────────────────────────────────────────────── */}
        <Block
          icon={EnvelopeSimple}
          title="Email (reset-password transport)"
          description={
            email.mode === 'dry_run'
              ? 'Dry-run режим: листи НЕ відправляються, посилання пишеться в лог і в response reset-password API. Перевірте /admin/settings/email-outbox.'
              : 'SMTP/Resend режим: листи реально відправляються. Перевірте outbox перед деплоєм.'
          }
          testId="auth-email-block"
          saving={saving === 'email'}
          onSave={() =>
            patch(
              {
                email: {
                  mode: email.mode,
                  from: email.from.trim(),
                  replyTo: email.replyTo.trim(),
                },
              },
              'email'
            )
          }
        >
          <Field label="Режим">
            <select
              value={email.mode}
              onChange={(e) => setEmail({ ...email, mode: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border border-[#E4E4E7] text-sm bg-white"
              data-testid="auth-select-emailMode"
            >
              <option value="dry_run">Dry-run (лог, без реальної відправки)</option>
              <option value="smtp" disabled>
                SMTP (згодом)
              </option>
              <option value="resend" disabled>
                Resend (згодом)
              </option>
            </select>
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="From">
              <Input
                value={email.from}
                onChange={(e) => setEmail({ ...email, from: e.target.value })}
                placeholder="no-reply@bibicars.bg"
                data-testid="auth-input-emailFrom"
              />
            </Field>
            <Field label="Reply-To">
              <Input
                value={email.replyTo}
                onChange={(e) => setEmail({ ...email, replyTo: e.target.value })}
                placeholder="support@bibicars.bg"
                data-testid="auth-input-emailReplyTo"
              />
            </Field>
          </div>
        </Block>
      </div>
    </div>
  );
}
