/**
 * TrackingLayout — единый хаб для всей логики отслеживания контейнеров/судов.
 *
 * Раньше в левом sidebar были разрозненные пункты:
 *   • /admin/vesselfinder           → VesselFinder Session
 *   • /admin/shipments/exceptions   → Shipment Exceptions (stale/no vessel/no container)
 *   • /admin/identity/exceptions    → Automation Exceptions (resolver confirm/reject)
 *   • /admin/ext-clients            → Ext Clients (HMAC)
 *   • /admin/shipment-journey       → Shipment Journey Manager
 *
 * Теперь в левом sidebar — ОДНА точка входа `/admin/tracking`, а переключение
 * между разделами — через внутренний горизонтальный хедер (tabs) на этой странице.
 * Каждая вкладка — отдельный route под `/admin/tracking/*`, старые URL
 * остаются рабочими через redirect (см. App.js).
 *
 * Верхняя плашка показывает live-состояние системы трекинга:
 *   • TRACKING_ENABLED kill switch
 *   • HMAC window · ENFORCE_NONCE · resolver/transfer intervals
 *   • extension heartbeat
 *   • pending Automation Exceptions (badge)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  Anchor,
  Warning,
  Shield,
  Compass,
  Truck,
  CircleNotch,
  CheckCircle,
  WarningCircle,
  Broadcast,
} from '@phosphor-icons/react';

const API = process.env.REACT_APP_BACKEND_URL || '';

function authHeaders() {
  const t = localStorage.getItem('auth_token') || localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Ukrainian-first labels, short + icon per tab.  */
const TABS = [
  {
    to: '/admin/tracking/vesselfinder',
    label: 'VesselFinder',
    sub: 'Session + live AIS',
    icon: Anchor,
    testid: 'tab-vesselfinder',
  },
  {
    to: '/admin/tracking/shipments',
    label: 'Shipment журнал',
    sub: 'Історія етапів, контейнер, перевалки',
    icon: Compass,
    testid: 'tab-shipment-journey',
  },
  {
    to: '/admin/tracking/exceptions/shipments',
    label: 'Shipment exceptions',
    sub: 'Stale · No vessel · No container',
    icon: Truck,
    testid: 'tab-shipment-exceptions',
  },
  {
    to: '/admin/tracking/exceptions/automation',
    label: 'Automation exceptions',
    sub: 'Resolver · Confirm / Reject',
    icon: Warning,
    testid: 'tab-automation-exceptions',
    badgeKey: 'automationExceptions',
  },
  {
    to: '/admin/tracking/ext-clients',
    label: 'Ext clients',
    sub: 'Per-manager HMAC secrets',
    icon: Shield,
    testid: 'tab-ext-clients',
  },
];

function HealthPill({ label, value, tone = 'neutral', testid }) {
  const tones = {
    ok: { bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
    warn: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
    danger: { bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
    neutral: { bg: '#f1f5f9', fg: '#334155', border: '#e2e8f0' },
    info: { bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' },
  };
  const c = tones[tone] || tones.neutral;
  return (
    <div
      data-testid={testid}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        padding: '8px 14px',
        minWidth: 130,
      }}
    >
      <span style={{ fontSize: 10, color: c.fg, opacity: 0.75, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: c.fg, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export default function TrackingLayout() {
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [automationCount, setAutomationCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const [sR, cR] = await Promise.all([
        axios.get(`${API}/api/admin/identity/tracking-status`, { headers: authHeaders() }),
        axios.get(`${API}/api/admin/identity/exceptions/count`, { headers: authHeaders() }),
      ]);
      setStatus(sR.data);
      setAutomationCount(cR.data?.pending || 0);
    } catch {
      // soft-fail — controls page still usable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 30000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  const trackingTone = status?.trackingEnabled ? 'ok' : 'danger';
  const nonceTone = status?.enforceNonce ? 'ok' : 'warn';
  const lastHb = status?.extensionLastHeartbeatAt;
  const hbAge = lastHb ? Math.round((Date.now() - new Date(lastHb).getTime()) / 1000) : null;
  const hbTone = hbAge == null ? 'neutral' : hbAge < 180 ? 'ok' : hbAge < 600 ? 'warn' : 'danger';

  return (
    <div
      /* ── Break out of <main>'s p-4/p-6/p-8 padding so the sticky
       *    tab-bar actually pins to the TRUE top of the scroll area,
       *    not to the inset padding-edge. Inline style so we don't
       *    depend on Tailwind JIT picking up negative-margin classes. */
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        background: '#f8fafc',
        // cancel <main>'s responsive padding (p-4 / p-6 / p-8)
        marginTop: 'calc(-1 * var(--tracking-pad, 32px))',
        marginLeft: 'calc(-1 * var(--tracking-pad, 32px))',
        marginRight: 'calc(-1 * var(--tracking-pad, 32px))',
      }}
      ref={(el) => {
        if (!el) return;
        // Detect the actual padding of the scroll container <main> so
        // our negative margins are pixel-perfect across md/lg breakpoints.
        const main = el.closest('main');
        if (!main) return;
        const pad = parseFloat(getComputedStyle(main).paddingTop || '32') || 32;
        el.style.setProperty('--tracking-pad', `${pad}px`);
      }}
    >
      {/* ═══════════════════ Internal header ═══════════════════ */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#fff',
          padding: '22px 28px 18px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div
            style={{
              width: 46,
              height: 46,
              background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 20px rgba(14,165,233,0.25)',
            }}
          >
            <Broadcast size={26} weight="duotone" color="#fff" />
          </div>
          <div>
            <h1 data-testid="tracking-title" style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>
              Відстеження контейнерів та суден
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#cbd5e1', fontWeight: 400 }}>
              Єдиний центр керування: VesselFinder session · Shipment журнал · Exceptions · HMAC clients
            </p>
          </div>
        </div>

        {/* Health strip */}
        <div
          data-testid="tracking-health-strip"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {loading && (
            <div style={{ color: '#94a3b8', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CircleNotch size={14} className="animate-spin" /> завантаження health…
            </div>
          )}
          {!loading && status && (
            <>
              <HealthPill
                label="Tracking"
                tone={trackingTone}
                testid="pill-tracking"
                value={status.trackingEnabled ? '🟢 ON (kill-switch armed)' : '🔴 OFF'}
              />
              <HealthPill
                label="ENFORCE_NONCE"
                tone={nonceTone}
                testid="pill-nonce"
                value={status.enforceNonce ? '🔒 strict' : '⚠ soft (post-rollout)'}
              />
              <HealthPill
                label="HMAC window"
                tone="info"
                testid="pill-hmac-window"
                value={`±${status.hmacWindowSec}s`}
              />
              <HealthPill
                label="Ext heartbeat"
                tone={hbTone}
                testid="pill-heartbeat"
                value={
                  hbAge == null
                    ? '— no signal'
                    : hbAge < 180
                    ? `✓ ${hbAge}s ago`
                    : hbAge < 600
                    ? `⚠ ${Math.round(hbAge / 60)} min`
                    : `🚫 ${Math.round(hbAge / 60)} min (stale)`
                }
              />
              <HealthPill
                label="Resolver tick"
                tone="info"
                testid="pill-resolver"
                value={`${status.resolverIntervalSec}s`}
              />
              <HealthPill
                label="Transfer tick"
                tone="info"
                testid="pill-transfer"
                value={`${status.transferDetectIntervalSec}s`}
              />
              <HealthPill
                label="Pending exceptions"
                tone={automationCount > 0 ? 'warn' : 'ok'}
                testid="pill-pending-exceptions"
                value={automationCount === 0 ? '0 · clean' : `${automationCount} чекають`}
              />
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════ Tabs (sub-navigation) ═══════════════════ */}
      <nav
        data-testid="tracking-tabs"
        style={{
          display: 'flex',
          gap: 4,
          padding: '0 20px',
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          overflowX: 'auto',
          position: 'sticky',
          top: 'calc(-1 * var(--tracking-pad, 32px))',
          zIndex: 30,
          boxShadow: '0 1px 3px rgba(15,23,42,0.04), 0 4px 10px rgba(15,23,42,0.02)',
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const showBadge = t.badgeKey === 'automationExceptions' && automationCount > 0;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={t.testid}
              className={({ isActive }) =>
                `tracking-tab${isActive ? ' tracking-tab-active' : ''}`
              }
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 16px',
                color: isActive ? '#0ea5e9' : '#334155',
                borderBottom: isActive ? '2px solid #0ea5e9' : '2px solid transparent',
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                background: isActive ? 'rgba(14,165,233,0.06)' : 'transparent',
                transition: 'all 0.15s',
                marginBottom: -1,
              })}
            >
              <Icon size={18} weight={location.pathname.startsWith(t.to) ? 'fill' : 'duotone'} />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                <span>{t.label}</span>
                <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 400 }}>{t.sub}</span>
              </div>
              {showBadge && (
                <span
                  data-testid={`${t.testid}-badge`}
                  style={{
                    background: '#f59e0b',
                    color: '#fff',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    marginLeft: 4,
                  }}
                >
                  {automationCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ═══════════════════ Active tab content ═══════════════════
        * Re-apply horizontal/bottom padding that we stripped at the
        * outer wrapper — individual tab pages can still manage their
        * own inner padding on top of this. */}
      <div
        style={{ flex: 1, background: '#f8fafc', minHeight: 400, padding: '0 16px 24px' }}
        data-testid="tracking-outlet"
      >
        <Outlet />
      </div>
    </div>
  );
}

/** Empty index — redirects to default tab. Used when the user lands on
 *  `/admin/tracking` without a sub-path. */
export function TrackingIndex() {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: '#64748b',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <CheckCircle size={40} weight="duotone" color="#0ea5e9" />
      <div style={{ fontSize: 15, fontWeight: 600, color: '#334155' }}>
        Оберіть розділ у верхньому хедері
      </div>
      <div style={{ fontSize: 12, maxWidth: 420 }}>
        Усі інструменти відстеження тепер зібрані в одному місці. Перемикайтеся між
        VesselFinder, shipment журналом, exceptions і HMAC-клієнтами через вкладки вище.
      </div>
    </div>
  );
}
