/**
 * AdminSettingsPage — Production-clean admin settings
 * 2 tabs: CRM | Security
 * (Integrations live in their own dedicated page at /admin/integrations
 *  to avoid duplication.)
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Gear,
  ShieldCheck,
  CheckCircle,
  WarningCircle,
  Copy,
  X,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// ────────────────────────────────────────────────────
// Tabs
// ────────────────────────────────────────────────────
const TABS = [
  { id: 'crm', label: 'CRM', icon: Gear },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

export default function AdminSettingsPage() {
  const [tab, setTab] = useState('crm');
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#18181B]">Налаштування</h1>
        <p className="text-sm text-[#71717A] mt-1">
          Production-ready settings — тільки те, що реально використовується
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[#E4E4E7]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`settings-tab-${t.id}`}
              className={`px-5 py-3 flex items-center gap-2 font-medium border-b-2 transition-colors ${
                active
                  ? 'border-[#18181B] text-[#18181B]'
                  : 'border-transparent text-[#71717A] hover:text-[#18181B]'
              }`}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tab === 'crm' && <CRMSettings />}
      {tab === 'security' && <SecurityTab />}
    </div>
  );
}

// ────────────────────────────────────────────────────
// CRM Settings
// ────────────────────────────────────────────────────
const LEAD_STATUSES = [
  { code: 'new', label: 'Новий', color: 'bg-blue-100 text-blue-700' },
  { code: 'contacted', label: 'Зв\'язалися', color: 'bg-cyan-100 text-cyan-700' },
  { code: 'qualified', label: 'Кваліфікований', color: 'bg-indigo-100 text-indigo-700' },
  { code: 'negotiation', label: 'Переговори', color: 'bg-purple-100 text-purple-700' },
  { code: 'won', label: 'Виграно', color: 'bg-emerald-100 text-emerald-700' },
  { code: 'lost', label: 'Втрачено', color: 'bg-zinc-100 text-zinc-600' },
];

const DEAL_STATUSES = [
  { code: 'pending', label: 'Очікує', color: 'bg-amber-100 text-amber-700' },
  { code: 'in_progress', label: 'В роботі', color: 'bg-blue-100 text-blue-700' },
  { code: 'contract', label: 'Договір', color: 'bg-indigo-100 text-indigo-700' },
  { code: 'payment', label: 'Оплата', color: 'bg-purple-100 text-purple-700' },
  { code: 'shipping', label: 'Доставка', color: 'bg-cyan-100 text-cyan-700' },
  { code: 'delivered', label: 'Доставлено', color: 'bg-emerald-100 text-emerald-700' },
  { code: 'cancelled', label: 'Скасовано', color: 'bg-zinc-100 text-zinc-600' },
];

function CRMSettings() {
  return (
    <div className="space-y-5">
      <Block title="Статуси лідів" description="Пайплайн воронки продажів — від ліда до угоди">
        <div className="flex flex-wrap gap-2">
          {LEAD_STATUSES.map((s) => (
            <div key={s.code} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${s.color}`}>
              {s.label} <span className="text-xs opacity-60 ml-1">· {s.code}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Статуси угод" description="Життєвий цикл угоди від створення до доставки">
        <div className="flex flex-wrap gap-2">
          {DEAL_STATUSES.map((s) => (
            <div key={s.code} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${s.color}`}>
              {s.label} <span className="text-xs opacity-60 ml-1">· {s.code}</span>
            </div>
          ))}
        </div>
      </Block>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <WarningCircle size={18} className="inline mr-1" weight="fill" />
        <b>Pipeline locked.</b> Статуси — частина бізнес-логіки системи. Зміна потребує міграції
        існуючих даних — зверніться до розробки.
      </div>
    </div>
  );
}

function Block({ title, description, children }) {
  return (
    <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-[#18181B]">{title}</h2>
        {description && <p className="text-xs text-[#71717A] mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Security — 2FA (Google Authenticator / TOTP)
// ────────────────────────────────────────────────────
function SecurityTab() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/security/2fa/status`);
      setStatus(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startSetup = async () => {
    try {
      const res = await axios.post(`${API_URL}/api/admin/security/2fa/setup`);
      setSetup(res.data);
      setCode('');
    } catch {
      toast.error('Не вдалося згенерувати QR');
    }
  };

  const verify = async () => {
    if (!code.trim()) return;
    setVerifying(true);
    try {
      await axios.post(`${API_URL}/api/admin/security/2fa/verify`, { code: code.trim() });
      toast.success('2FA увімкнено');
      setSetup(null);
      setCode('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Невірний код');
    } finally {
      setVerifying(false);
    }
  };

  const disable = async () => {
    const c = prompt('Введіть поточний код із Google Authenticator для відключення:');
    if (!c) return;
    try {
      await axios.post(`${API_URL}/api/admin/security/2fa/disable`, { code: c.trim() });
      toast.success('2FA вимкнено');
      setSetup(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка');
    }
  };

  if (loading) {
    return <div className="text-center text-[#71717A] py-10">Завантаження…</div>;
  }

  return (
    <div className="space-y-5">
      <Block
        title="Двофакторна автентифікація (Google Authenticator)"
        description="Захистіть доступ до адмін-панелі одноразовими кодами TOTP"
      >
        {status?.enabled ? (
          <div>
            <div className="flex items-center gap-2 text-emerald-600 mb-4">
              <CheckCircle size={22} weight="fill" /> <span className="font-medium">2FA увімкнено</span>
            </div>
            <button
              onClick={disable}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm"
            >
              Вимкнути 2FA
            </button>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <p className="text-sm text-[#71717A]">
              1. Відскануйте QR-код у Google Authenticator або Authy
            </p>
            <div className="flex gap-5 items-start flex-wrap">
              {setup.qrCode && (
                <img
                  src={setup.qrCode}
                  alt="2FA QR"
                  className="w-44 h-44 border border-[#E4E4E7] rounded-xl bg-white"
                />
              )}
              <div className="flex-1 min-w-[280px]">
                <p className="text-xs text-[#71717A] mb-1">Або введіть вручну:</p>
                <div className="flex items-center gap-2 mb-4">
                  <code className="bg-[#F4F4F5] px-3 py-2 rounded-lg text-sm font-mono flex-1">
                    {setup.secret}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(setup.secret);
                      toast.success('Скопійовано');
                    }}
                    className="p-2 rounded-lg bg-[#F4F4F5] hover:bg-[#E4E4E7]"
                  >
                    <Copy size={16} />
                  </button>
                </div>

                <p className="text-sm text-[#71717A] mb-2">2. Введіть код із застосунку:</p>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-[#E4E4E7] text-center font-mono text-lg tracking-widest"
                    data-testid="2fa-code-input"
                  />
                  <button
                    onClick={verify}
                    disabled={verifying || code.length !== 6}
                    className="px-5 py-2.5 rounded-lg bg-[#18181B] text-white disabled:opacity-40 text-sm font-semibold"
                    data-testid="2fa-verify-btn"
                  >
                    {verifying ? '…' : 'Підтвердити'}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSetup(null)}
              className="text-sm text-[#71717A] hover:underline flex items-center gap-1"
            >
              <X size={14} /> Скасувати
            </button>
          </div>
        ) : (
          <button
            onClick={startSetup}
            className="px-5 py-2.5 rounded-lg bg-[#18181B] text-white text-sm font-semibold hover:bg-[#27272A]"
            data-testid="2fa-enable-btn"
          >
            Увімкнути 2FA
          </button>
        )}
      </Block>
    </div>
  );
}
