/**
 * Parser Control Center — monitoring-grade UI (v3 · ops hardening).
 *
 * v3 upgrades:
 *   1. Role guard           — master_admin/owner only see mutation controls.
 *                              Regular admin/manager/team_lead get a clean
 *                              read-only view (same data, no buttons, with a
 *                              visible "READ-ONLY" banner).
 *   2. Extension block      — per-client "Last seen Xs ago" + success rate,
 *                              aggregate freshness pill, 2-minute critical
 *                              auto-alert when no client has pinged back.
 *
 * v2 (preserved):
 *   - SystemStatusBar with inline REASON
 *   - Extension CRITICAL alarm (pulse, red card)
 *   - Source tier chips (PRIMARY / INDEX / HTTP / CRITICAL · CF)
 *   - "X sources disabled" banner
 *   - Performance rollup (🟢 OK / 🟡 DEGRADED / 🔴 BAD)
 *   - Debug Retry button
 *   - "Updated Xs ago" freshness indicator
 *
 * Single fetch from /api/control/overview every 5 s.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ShieldCheck,
  Warning,
  WarningCircle,
  CheckCircle,
  XCircle,
  Plugs,
  PlugsConnected,
  Browser,
  Lightning,
  Database,
  Globe,
  Pulse,
  ArrowClockwise,
  ArrowSquareOut,
  CircleNotch,
  MagnifyingGlass,
  CaretRight,
  Siren,
  Download,
  Copy,
  Check,
} from '@phosphor-icons/react';
import { useAuth, API_URL } from '../App';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const POLL_INTERVAL = 5000;

const STATUS_PRESET = {
  ok: {
    label: 'OK',
    bg: 'bg-emerald-500',
    bgSoft: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  warn: {
    label: 'WARN',
    bg: 'bg-amber-500',
    bgSoft: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  drift: {
    label: 'DRIFT',
    bg: 'bg-amber-500',
    bgSoft: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  down: {
    label: 'DOWN',
    bg: 'bg-red-500',
    bgSoft: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
};

const TIER_ICON = {
  LIVE: Lightning,
  INDEX: Database,
  HTTP: Globe,
  EXT: Browser,
};

// Tier chip meta — explicit hierarchy. Extension is the critical fallback:
// Cloudflare-protected sources depend on it, so we mark it red-accent.
const TIER_META = {
  LIVE: {
    label: 'PRIMARY',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    chipBorder: 'border-emerald-200',
  },
  INDEX: {
    label: 'INDEX',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
    chipBorder: 'border-blue-200',
  },
  HTTP: {
    label: 'HTTP',
    chipBg: 'bg-violet-50',
    chipText: 'text-violet-700',
    chipBorder: 'border-violet-200',
  },
  EXT: {
    label: 'CRITICAL · CF',
    chipBg: 'bg-red-50',
    chipText: 'text-red-700',
    chipBorder: 'border-red-200',
  },
};

// ── 1. SystemStatusBar ──────────────────────────────────
const SystemStatusBar = ({ system, alerts }) => {
  const status = system?.status || 'green';
  const isRed = status === 'red';
  const isYellow = status === 'yellow';
  const cls = isRed
    ? 'from-red-600 to-red-700 border-red-700'
    : isYellow
    ? 'from-amber-500 to-amber-600 border-amber-600'
    : 'from-emerald-600 to-emerald-700 border-emerald-700';
  const Icon = isRed ? XCircle : isYellow ? Warning : ShieldCheck;
  const headline = isRed
    ? 'SYSTEM DEGRADED'
    : isYellow
    ? 'SYSTEM PARTIAL'
    : 'SYSTEM HEALTHY';

  // Prefer backend-computed reason (most accurate); fall back to alert list
  const backendReason = system?.reason;
  const reasonItems = Array.isArray(alerts) ? alerts.slice(0, 2) : [];
  const extraAlerts =
    Array.isArray(alerts) && alerts.length > 2 ? alerts.length - 2 : 0;

  return (
    <div
      className={`relative bg-gradient-to-r ${cls} border-l-4 rounded-xl p-5 mb-5 text-white overflow-hidden`}
      data-testid="system-status-bar"
    >
      <div className="flex items-start gap-4">
        <Icon size={36} weight="fill" className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p
            className="text-lg sm:text-xl font-bold tracking-tight"
            style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
          >
            {headline}
          </p>
          {backendReason ? (
            <div className="mt-1.5" data-testid="system-reason">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/70 font-semibold mb-0.5">
                Reason
              </p>
              <p className="text-xs sm:text-sm text-white/95 leading-snug">
                {backendReason}
              </p>
              {reasonItems.length > 0 && (
                <p className="text-[11px] text-white/80 leading-snug mt-1.5">
                  {reasonItems.join(' • ')}
                  {extraAlerts > 0 && (
                    <span className="ml-1.5 text-white/60">
                      (+{extraAlerts} more)
                    </span>
                  )}
                </p>
              )}
            </div>
          ) : reasonItems.length > 0 ? (
            <div className="mt-1.5" data-testid="system-reason">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/70 font-semibold mb-0.5">
                Reason
              </p>
              <p className="text-xs sm:text-sm text-white/95 leading-snug">
                {reasonItems.join(' • ')}
                {extraAlerts > 0 && (
                  <span className="ml-1.5 text-white/70">
                    (+{extraAlerts} more)
                  </span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-white/85 mt-1">
              All sources operational · resolver chain intact
            </p>
          )}
        </div>
        <div className="hidden sm:block text-right flex-shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-white/70">
            Status
          </p>
          <p className="text-2xl font-bold">{system?.label || '—'}</p>
        </div>
      </div>
    </div>
  );
};

// ── 2. ExtensionStatusCard — CRITICAL alarm + health telemetry ──────────
// Helper: humanise a duration in seconds → "3s" / "42s" / "2m" / "1h 12m".
const fmtAge = (secs) => {
  if (secs === null || secs === undefined) return 'never';
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
};

const ExtensionStatusCard = ({ extension, canManage, onOpenExtensionTab }) => {
  const online = extension?.online || 0;
  const total = extension?.total || 0;
  const obsVins = extension?.obs_cache_vins || 0;
  const queue = extension?.queue_depth || 0;
  const inFlight = extension?.in_flight || 0;
  const clients = extension?.clients || [];

  // Aggregated freshness: min age across all known clients.
  const minAge = clients.length
    ? Math.min(...clients.map((c) => Number(c.age_sec || 0)))
    : null;
  // Aggregated success rate (average of non-null rates, 0 → 1).
  const rates = clients
    .map((c) => c.success_rate_recent)
    .filter((v) => v !== null && v !== undefined);
  const avgSr =
    rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  // Critical state — escalate if stale > 120s (2 min) even if someone is
  // technically "online" but just sent a heartbeat long ago.
  const isStale = minAge !== null && minAge > 120;
  const isCritical = online === 0 || (total > 0 && isStale);
  const isWarn = online === 1 && !isCritical;

  const wrapperCls = isCritical
    ? 'border-red-500 bg-red-50 ring-2 ring-red-200 animate-[pulse_2.4s_ease-in-out_infinite]'
    : isWarn
    ? 'border-amber-300 bg-amber-50'
    : 'border-emerald-300 bg-emerald-50';

  const Icon = isCritical ? Siren : isWarn ? Warning : PlugsConnected;

  const headline = isCritical
    ? online === 0
      ? '🔥 CRITICAL · EXTENSION OFFLINE'
      : '🔥 CRITICAL · EXTENSION STALE (>2 min)'
    : isWarn
    ? 'EXTENSION SPOF — install a second client'
    : 'EXTENSION OK';

  const headlineCls = isCritical
    ? 'text-red-900'
    : isWarn
    ? 'text-amber-800'
    : 'text-emerald-800';

  return (
    <div
      className={`border-2 rounded-xl p-5 mb-5 ${wrapperCls}`}
      data-testid="extension-status-card"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isCritical
                ? 'bg-red-600 text-white'
                : isWarn
                ? 'bg-amber-100 text-amber-600'
                : 'bg-emerald-100 text-emerald-600'
            }`}
          >
            <Icon size={26} weight="fill" />
          </div>
          <div className="min-w-0">
            <p
              className={`text-base sm:text-lg font-bold tracking-tight ${headlineCls}`}
              style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
            >
              {headline}
            </p>
            <p className="text-xs text-[#52525B] mt-0.5">
              {online} online · {Math.max(0, total - online)} offline · queue{' '}
              {queue} · in-flight {inFlight} · obs cache {obsVins} VINs
            </p>
            {/* Aggregate freshness + success-rate row */}
            <div
              className="mt-1.5 flex flex-wrap gap-2 text-[11px]"
              data-testid="ext-aggregate-health"
            >
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium ${
                  isStale
                    ? 'bg-red-100 text-red-800 border-red-200'
                    : 'bg-white text-[#52525B] border-[#E4E4E7]'
                }`}
              >
                Last seen:{' '}
                <span className="font-mono">
                  {minAge === null ? 'never' : `${fmtAge(minAge)} ago`}
                </span>
              </span>
              {avgSr !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium ${
                    avgSr >= 0.9
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : avgSr >= 0.6
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  Success rate:{' '}
                  <span className="font-mono">
                    {Math.round(avgSr * 100)}%
                  </span>
                </span>
              )}
            </div>
            {isCritical && (
              <p
                className="text-[11px] sm:text-xs text-red-800 mt-2 font-semibold bg-red-100 border border-red-200 rounded-md px-2.5 py-1.5 inline-block"
                data-testid="ext-critical-reason"
              >
                ⚠ Cloudflare sources DISABLED ·{' '}
                <span className="font-mono">poctra · cfw · aah · salvagebid</span>{' '}
                will not answer until a client registers.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
          <button
            type="button"
            onClick={async () => {
              try {
                toast.info('Готую ZIP...');
                const res = await axios.get(`${API_URL}/api/extension/download`, {
                  responseType: 'blob',
                });
                const blob = new Blob([res.data], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'bibi-cars-extension.zip';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 1500);
                toast.success(`Завантажено ${(blob.size / 1024).toFixed(1)} KB`);
              } catch (err) {
                toast.error(`Помилка завантаження: ${err?.response?.status || err.message}`);
              }
            }}
            className="px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
            data-testid="ext-download-cta"
            title="Скачати ZIP-архів розширення для встановлення в Chrome"
          >
            <Download size={14} weight="bold" />
            Download Extension
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => onOpenExtensionTab && onOpenExtensionTab()}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors ${
                isCritical
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30'
                  : 'bg-white text-[#18181B] border border-[#E4E4E7] hover:bg-[#FAFAFA]'
              }`}
              data-testid="ext-setup-cta"
            >
              {isCritical ? 'Setup Extension' : 'Manage'}
              <CaretRight size={14} />
            </button>
          )}
        </div>
      </div>
      {clients.length > 0 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {clients.map((c) => {
            const sr = c.success_rate_recent;
            const srTxt =
              sr === null || sr === undefined ? '—' : `${Math.round(sr * 100)}%`;
            const age = Number(c.age_sec || 0);
            const stale = !c.online || age > 120;
            return (
              <div
                key={c.client_id}
                className="flex items-center justify-between bg-white border border-[#E4E4E7] rounded-md px-3 py-2"
                data-testid={`ext-client-${c.client_id}`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-mono text-[#18181B] truncate">
                    {(c.label || c.client_id).slice(0, 28)}
                  </p>
                  <p className="text-[10px] text-[#A1A1AA]">
                    {c.version || '—'}
                    <span className="mx-1.5 text-[#D4D4D8]">·</span>
                    <span
                      className={stale ? 'text-red-600 font-semibold' : ''}
                    >
                      seen {fmtAge(age)} ago
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-[10px] font-mono ${
                      sr !== null && sr !== undefined && sr < 0.6
                        ? 'text-red-600 font-semibold'
                        : 'text-[#71717A]'
                    }`}
                    title="Success rate (last 20 jobs)"
                  >
                    {srTxt}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      !c.online
                        ? 'bg-red-500'
                        : c.unhealthy
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    title={
                      !c.online
                        ? 'offline'
                        : c.unhealthy
                        ? 'unhealthy'
                        : 'online'
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── 3. Source row ───────────────────────────────────────
const SourceRow = ({ row }) => {
  const preset = STATUS_PRESET[row.status] || STATUS_PRESET.ok;
  const TierIcon = TIER_ICON[row.tier] || Plugs;
  const tierMeta = TIER_META[row.tier] || TIER_META.HTTP;
  return (
    <div
      className="bg-white rounded-xl border border-[#E4E4E7] p-4 flex flex-col sm:flex-row sm:items-center gap-4"
      data-testid={`source-row-${row.key}`}
    >
      <div className="flex items-center gap-3 sm:w-72 min-w-0">
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${preset.dot} ${
            row.status === 'down' ? 'animate-pulse' : ''
          }`}
        />
        <div className="w-9 h-9 rounded-lg bg-[#F4F4F5] flex items-center justify-center flex-shrink-0">
          <TierIcon size={16} weight="duotone" className="text-[#18181B]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#18181B] truncate">
            {row.label}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border ${tierMeta.chipBg} ${tierMeta.chipText} ${tierMeta.chipBorder}`}
              data-testid={`source-tier-${row.key}`}
            >
              {tierMeta.label}
            </span>
            <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wide">
              {row.tier}
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 sm:gap-6 flex-1">
        <div>
          <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide">
            P50
          </p>
          <p className="text-sm font-bold font-mono text-[#18181B]">
            {row.latency_p50_ms ? `${row.latency_p50_ms}ms` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide">
            Hit
          </p>
          <p className="text-sm font-bold text-emerald-600">
            {row.calls > 0 ? `${Math.round((row.hit_ratio || 0) * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide">
            Calls
          </p>
          <p className="text-sm font-bold text-[#18181B]">{row.calls}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide">
            Errors
          </p>
          <p
            className={`text-sm font-bold ${
              row.errors > 0 ? 'text-red-600' : 'text-[#18181B]'
            }`}
          >
            {row.errors}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-[10px] px-2 py-1 rounded-md font-bold uppercase tracking-wider ${preset.bgSoft} ${preset.text} border ${preset.border}`}
        >
          {row.status === 'ok'
            ? '● OK'
            : row.status === 'down'
            ? '● DOWN'
            : row.status === 'drift'
            ? '⚠ DRIFT'
            : '● WARN'}
        </span>
        {row.circuit_open && (
          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-red-50 text-red-700 border border-red-200">
            circuit open
          </span>
        )}
        {row.key === 'extension' && row.clients_online === 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-red-50 text-red-700 border border-red-200">
            0 clients
          </span>
        )}
      </div>
    </div>
  );
};

// ── 3b. SourcesGrid with disabled-count banner ───────────
const SourcesGrid = ({ sources }) => {
  const safeSources = Array.isArray(sources) ? sources : [];
  const disabledCount = safeSources.filter((s) => s.status === 'down').length;
  // Extension aggregates 4 Cloudflare sub-sources; if it's down they all are off.
  const extOff = safeSources.find(
    (s) => s.key === 'extension' && s.status === 'down',
  );
  const extSubsources = extOff?.subsources?.length || 0;
  const effectiveDisabled = disabledCount + (extSubsources > 0 ? extSubsources : 0);

  return (
    <div className="mb-5" data-testid="sources-grid">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-bold text-[#18181B] tracking-tight"
          style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
        >
          SOURCES
        </h2>
        <p className="text-[11px] text-[#A1A1AA]">
          Resolver chain order: LIVE → INDEX → HTTP → EXT
        </p>
      </div>

      {effectiveDisabled > 0 && (
        <div
          className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 flex items-center gap-2.5"
          data-testid="sources-disabled-banner"
        >
          <WarningCircle
            size={16}
            weight="fill"
            className="text-red-600 flex-shrink-0"
          />
          <p className="text-xs text-red-800 font-semibold">
            ⚠ {effectiveDisabled} source{effectiveDisabled === 1 ? '' : 's'}{' '}
            disabled
            {extSubsources > 0 && (
              <span className="font-normal text-red-700">
                {' '}
                — Cloudflare group:{' '}
                <span className="font-mono">
                  {extOff.subsources.join(' · ')}
                </span>
              </span>
            )}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {safeSources.map((row) => (
          <SourceRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
};

// ── 4. PerformancePanel with rollup status ──────────────
const PerformancePanel = ({ performance }) => {
  const hitRate = performance?.hit_rate || 0;
  const errorRate = performance?.error_rate || 0;
  const totalCalls = performance?.total_calls ?? 0;

  // rollup: BAD if error>20%, WARN if hit<50% (and any traffic), OK otherwise.
  let rollup = 'ok';
  if (totalCalls > 0) {
    if (errorRate > 0.2) rollup = 'bad';
    else if (hitRate < 0.5) rollup = 'warn';
  }

  const rollupMeta = {
    ok: {
      label: '🟢 OK',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
    },
    warn: {
      label: '🟡 DEGRADED',
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
    },
    bad: {
      label: '🔴 BAD',
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
    },
  }[rollup];

  const tiles = [
    {
      label: 'P50 latency',
      value: performance?.p50_ms ? `${performance.p50_ms}ms` : '—',
    },
    {
      label: 'P95 latency',
      value: performance?.p95_ms ? `${performance.p95_ms}ms` : '—',
    },
    {
      label: 'Hit rate',
      value: `${Math.round(hitRate * 100)}%`,
      tone: hitRate >= 0.7 ? 'ok' : hitRate >= 0.4 ? 'warn' : 'down',
    },
    {
      label: 'Error rate',
      value: `${Math.round(errorRate * 100)}%`,
      tone: errorRate <= 0.05 ? 'ok' : errorRate <= 0.2 ? 'warn' : 'down',
    },
    {
      label: 'Total calls',
      value: totalCalls,
    },
  ];

  return (
    <div className="mb-5" data-testid="performance-panel">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-bold text-[#18181B] tracking-tight"
          style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
        >
          PERFORMANCE
        </h2>
        <span
          className={`text-[11px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider border ${rollupMeta.bg} ${rollupMeta.text} ${rollupMeta.border}`}
          data-testid="performance-rollup"
        >
          {rollupMeta.label}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="bg-white rounded-xl border border-[#E4E4E7] p-4"
            data-testid={`perf-${t.label}`}
          >
            <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide mb-1">
              {t.label}
            </p>
            <p
              className={`text-2xl font-bold tracking-tight ${
                t.tone === 'down'
                  ? 'text-red-600'
                  : t.tone === 'warn'
                  ? 'text-amber-600'
                  : 'text-[#18181B]'
              }`}
            >
              {t.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 5. AlertsPanel ───────────────────────────────────────
const AlertsPanel = ({ alerts }) => {
  if (!alerts || alerts.length === 0) {
    return (
      <div
        className="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3"
        data-testid="alerts-panel-empty"
      >
        <CheckCircle size={20} weight="fill" className="text-emerald-600 flex-shrink-0" />
        <p className="text-sm text-emerald-800 font-medium">
          No active alerts — system fully healthy.
        </p>
      </div>
    );
  }
  return (
    <div className="mb-5" data-testid="alerts-panel">
      <h2
        className="text-sm font-bold text-[#18181B] tracking-tight mb-3"
        style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
      >
        ALERTS · <span className="text-red-600">{alerts.length}</span>
      </h2>
      <div className="bg-white border border-red-200 rounded-xl divide-y divide-red-100">
        {alerts.map((a, i) => (
          <div
            key={i}
            className="px-4 py-3 flex items-start gap-3"
            data-testid={`alert-${i}`}
          >
            <WarningCircle
              size={18}
              weight="fill"
              className="text-red-500 flex-shrink-0 mt-0.5"
            />
            <p className="text-xs text-[#27272A]">{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 7. OpsGuardianPanel ──────────────────────────────────
// Shows alerter/autoheal status so operators know the system will shout
// when they're not looking. Master-admin can fire a test alert to verify
// Telegram / webhook wiring before a real incident.
const OpsGuardianPanel = ({ canTest }) => {
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/control/ops/status`);
      setStatus(r.data);
    } catch (e) {
      // Read-only admins without token get 401 here — silently keep old state.
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 10000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const runTest = async () => {
    if (!canTest || testing) return;
    setTesting(true);
    try {
      const r = await axios.post(`${API_URL}/api/control/ops/test-alert`, {
        title: 'ops test alert',
        message: 'Synthetic alert from admin UI.',
        severity: 'info',
      });
      if (r.data?.dispatched) toast.success('Alert dispatched to external channels');
      else toast.message('Dispatched to audit log (no external channel configured)');
      loadStatus();
    } catch (e) {
      const detail = e?.response?.data?.detail || String(e);
      toast.error(detail);
    } finally {
      setTesting(false);
    }
  };

  if (!status) return null;

  const telegramOn = !!status?.channels?.telegram;
  const webhookOn = !!status?.channels?.webhook;
  const enabled = !!status?.enabled;
  const loopAge = status?.last_loop_age_sec;
  const loopStale = loopAge === null || loopAge === undefined || loopAge > (status?.interval_sec || 60) * 2;

  const chips = [
    {
      label: 'guardian',
      on: enabled,
      onTxt: enabled ? 'running' : 'disabled',
      tone: enabled ? (loopStale ? 'warn' : 'ok') : 'down',
    },
    {
      label: 'telegram',
      on: telegramOn,
      onTxt: telegramOn ? 'wired' : 'not set',
      tone: telegramOn ? 'ok' : 'warn',
    },
    {
      label: 'webhook',
      on: webhookOn,
      onTxt: webhookOn ? 'wired' : 'not set',
      tone: webhookOn ? 'ok' : 'warn',
    },
  ];

  const toneCls = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    down: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className="mb-5" data-testid="ops-guardian-panel">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-bold text-[#18181B] tracking-tight flex items-center gap-2"
          style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
        >
          <Siren size={16} weight="duotone" />
          OPS GUARDIAN · alerts &amp; auto-heal
        </h2>
        {canTest && (
          <button
            onClick={runTest}
            disabled={testing}
            data-testid="ops-test-alert"
            className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#18181B] text-white hover:bg-[#27272A] disabled:opacity-50 flex items-center gap-1.5"
          >
            {testing ? (
              <CircleNotch size={12} className="animate-spin" />
            ) : (
              <Lightning size={12} weight="fill" />
            )}
            Fire test alert
          </button>
        )}
      </div>
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((c) => (
            <span
              key={c.label}
              className={`text-[11px] px-2.5 py-1 rounded-md font-semibold border ${toneCls[c.tone]}`}
              data-testid={`ops-chip-${c.label}`}
            >
              <span className="uppercase tracking-wide">{c.label}</span>
              <span className="mx-1.5 text-[#D4D4D8]">·</span>
              <span>{c.onTxt}</span>
            </span>
          ))}
          <span className="text-[11px] px-2.5 py-1 rounded-md font-mono text-[#71717A] bg-[#FAFAFA] border border-[#E4E4E7]">
            tick {loopAge !== null && loopAge !== undefined ? `${loopAge}s ago` : 'never'}
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-md font-mono text-[#71717A] bg-[#FAFAFA] border border-[#E4E4E7]">
            alerts {status?.counters?.total_alerts_sent || 0}
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-md font-mono text-[#71717A] bg-[#FAFAFA] border border-[#E4E4E7]">
            heals {status?.counters?.total_heal_actions || 0}
          </span>
        </div>
        {(!telegramOn && !webhookOn) && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            ⚠ No external alert channels configured. Set{' '}
            <code className="font-mono">TELEGRAM_BOT_TOKEN</code> +{' '}
            <code className="font-mono">TELEGRAM_CHAT_ID</code> or{' '}
            <code className="font-mono">ALERT_WEBHOOK_URL</code> in backend env
            and restart to receive pages when the system degrades.
          </p>
        )}
        {status?.recent_audit?.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#A1A1AA] mb-1.5 font-semibold">
              Recent audit ({status.recent_audit.length})
            </p>
            <ul className="space-y-1">
              {status.recent_audit.slice(0, 5).map((row, i) => (
                <li
                  key={i}
                  className="text-[11px] text-[#52525B] flex items-start gap-2"
                >
                  <span className="font-mono text-[#A1A1AA] flex-shrink-0 w-14">
                    {row.ts
                      ? new Date(row.ts * 1000).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : '—'}
                  </span>
                  <span
                    className={`font-bold text-[10px] uppercase tracking-wider flex-shrink-0 w-28 ${
                      row.kind === 'alert_emitted'
                        ? 'text-red-600'
                        : row.kind === 'heal_action'
                        ? 'text-amber-700'
                        : 'text-[#71717A]'
                    }`}
                  >
                    {row.kind || '—'}
                  </span>
                  <span className="truncate">
                    {row.title || row.action || row.fingerprint || '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

// ── 8. DebugPanel — with Retry ──────────────────────────
const CHAIN_STEPS = [
  { src: 'CACHE', label: 'Cache' },
  { src: 'SEARCH', label: 'BitMotors' },
  { src: 'WESTMOTORS', label: 'WestMotors' },
  { src: 'LEMON', label: 'Lemon' },
  { src: 'AUCTIONAUTO', label: 'AuctionAuto' },
  { src: 'POCTRA', label: 'Poctra' },
  { src: 'CARSFROMWEST', label: 'CarsFromWest' },
  { src: 'AUTOAUCTIONHISTORY', label: 'AAH' },
  { src: 'SALVAGEBID', label: 'SalvageBid' },
  { src: 'PAGE', label: 'BitMotors PAGE' },
];

const DebugPanel = ({ canProbe }) => {
  const [query, setQuery] = useState('5YJSA1E25HF199047');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [lastRan, setLastRan] = useState(null);

  const run = useCallback(
    async (overrideQuery) => {
      if (!canProbe) return;
      const q = (overrideQuery ?? query ?? '').trim().toUpperCase();
      if (!q) return;
      setRunning(true);
      setResult(null);
      try {
        const r = await axios.post(`${API_URL}/api/control/debug/probe`, {
          query: q,
        });
        setResult(r.data);
        setLastRan(q);
        if (r.data?.found) toast.success(`Found via ${r.data.source}`);
        else toast.message('Not found in any source');
      } catch (e) {
        const detail = e?.response?.data?.detail || String(e);
        setResult({ error: detail });
        toast.error(detail);
      } finally {
        setRunning(false);
      }
    },
    [query, canProbe],
  );

  // Mark every chain step as ❌ except the one that answered.
  const winnerSource = (result?.source || '').toUpperCase();
  const winnerKey = winnerSource.replace(/_CACHED$/, '').replace(/_/g, '');

  return (
    <div className="mb-5" data-testid="debug-panel">
      <h2
        className="text-sm font-bold text-[#18181B] tracking-tight mb-3 flex items-center gap-2"
        style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
      >
        <MagnifyingGlass size={16} weight="duotone" />
        DEBUG · VIN / LOT PROBE
      </h2>
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-4">
        {!canProbe && (
          <div
            className="mb-3 px-3 py-2 rounded-md bg-[#FAFAFA] border border-[#E4E4E7] text-[11px] text-[#71717A] flex items-center gap-2"
            data-testid="debug-readonly"
          >
            <WarningCircle size={13} weight="fill" className="text-[#A1A1AA]" />
            Read-only mode · debug probe requires <b>master_admin</b> role.
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && canProbe && run()}
            placeholder="VIN (17 chars) or LOT number"
            data-testid="debug-input"
            disabled={!canProbe}
            className="flex-1 px-3 py-2 text-sm font-mono border border-[#E4E4E7] rounded-lg focus:outline-none focus:border-[#18181B] disabled:bg-[#FAFAFA] disabled:text-[#A1A1AA] disabled:cursor-not-allowed"
          />
          <button
            onClick={() => run()}
            disabled={running || !canProbe}
            data-testid="debug-run"
            className="px-5 py-2 text-xs font-semibold bg-[#18181B] text-white rounded-lg hover:bg-[#27272A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
          >
            {running ? (
              <>
                <CircleNotch size={14} className="animate-spin" />
                Probing…
              </>
            ) : (
              <>
                <Lightning size={14} weight="fill" />
                RUN
              </>
            )}
          </button>
        </div>
        {result && !result.error && (
          <div data-testid="debug-result">
            <div className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-[#F4F4F5]">
              <div className="flex items-center gap-2">
                {result.found ? (
                  <CheckCircle size={18} weight="fill" className="text-emerald-600" />
                ) : (
                  <XCircle size={18} weight="fill" className="text-red-500" />
                )}
                <span className="text-sm font-bold text-[#18181B]">
                  {result.found ? 'FOUND' : 'NOT FOUND'}
                </span>
              </div>
              {result.found && (
                <>
                  <span className="text-xs text-[#71717A]">
                    via{' '}
                    <code className="font-mono font-semibold text-[#18181B]">
                      {result.source}
                    </code>
                  </span>
                  <span className="text-xs text-[#71717A]">
                    {result.latency_ms}ms
                  </span>
                  {result.title && (
                    <span className="text-xs text-[#52525B]">
                      — {result.title}
                    </span>
                  )}
                </>
              )}
              {!result.found && (
                <span className="text-xs text-[#71717A]">
                  walked full chain · {result.latency_ms}ms
                </span>
              )}
              {/* Retry button — re-runs the last probe without retyping */}
              {lastRan && (
                <button
                  onClick={() => run(lastRan)}
                  disabled={running}
                  data-testid="debug-retry"
                  className="ml-auto text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50"
                >
                  <ArrowClockwise size={12} weight="bold" />
                  Retry
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {CHAIN_STEPS.map((step) => {
                const matches =
                  result.found && winnerKey === step.src.replace(/_/g, '');
                const Icon = matches ? CheckCircle : XCircle;
                return (
                  <div
                    key={step.src}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
                      matches
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold'
                        : 'bg-[#FAFAFA] border-[#F4F4F5] text-[#A1A1AA]'
                    }`}
                  >
                    <Icon
                      size={12}
                      weight="fill"
                      className={matches ? 'text-emerald-600' : 'text-[#D4D4D8]'}
                    />
                    {step.label}
                  </div>
                );
              })}
            </div>
            {result.found && result.image_count > 0 && (
              <p className="text-[11px] text-[#71717A] mt-3">
                year:{' '}
                <span className="text-[#18181B] font-medium">
                  {result.year || '—'}
                </span>{' '}
                · make:{' '}
                <span className="text-[#18181B] font-medium">
                  {result.make || '—'}
                </span>{' '}
                · model:{' '}
                <span className="text-[#18181B] font-medium">
                  {result.model || '—'}
                </span>{' '}
                · images:{' '}
                <span className="text-[#18181B] font-medium">
                  {result.image_count}
                </span>
              </p>
            )}
          </div>
        )}
        {result?.error && (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {result.error}
            </p>
            {lastRan && (
              <button
                onClick={() => run(lastRan)}
                disabled={running}
                data-testid="debug-retry-err"
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 self-center whitespace-nowrap disabled:opacity-50"
              >
                <ArrowClockwise size={12} weight="bold" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// EXTENSION SETUP TAB — embedded inside Parser Control
// (replaces the old standalone /admin/parser/chrome-extension page)
// ═══════════════════════════════════════════════════════════════════
const ExtensionSetupTab = () => {
  const [info, setInfo] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/extension/info`);
        if (!cancelled) setInfo(r.data);
      } catch (_) { /* ok */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const copyToClipboard = (text, field, label = 'Скопійовано') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDownload = async () => {
    try {
      toast.info('Готую ZIP...');
      const res = await axios.get(`${API_URL}/api/extension/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bibi-cars-extension.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success(`Завантажено ${(blob.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      toast.error(`Помилка завантаження: ${err?.response?.status || err.message}`);
    }
  };

  const fmtSize = (b) => {
    if (!b) return '~18 KB';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const backendUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://your-backend.example.com';

  const SOURCES = [
    { id: 'poctra',             label: 'poctra.com',             role: 'CF · INDEX' },
    { id: 'carsfromwest',       label: 'carsfromwest.com',       role: 'CF · INDEX' },
    { id: 'autoauctionhistory', label: 'autoauctionhistory.com', role: 'CF · INDEX' },
    { id: 'salvagebid',         label: 'salvagebid.com',         role: 'CF · LIVE'  },
  ];

  const CopyBtn = ({ value, field, label }) => (
    <button
      type="button"
      onClick={() => copyToClipboard(value, field, label)}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
      title="Скопіювати"
    >
      {copiedField === field ? <Check size={13} weight="bold" /> : <Copy size={13} />}
    </button>
  );

  return (
    <div className="space-y-5" data-testid="ext-setup-tab">
      {/* ─── Download card ─────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <Browser size={20} weight="duotone" className="text-[#18181B]" />
              <h3 className="text-base font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
                Chrome Extension v{info?.version || '4.1.0'}
              </h3>
              <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                MULTI-SOURCE · CF-BYPASS
              </span>
            </div>
            <p className="text-sm text-[#52525B] max-w-2xl">
              Чистий single-purpose агент. Працює з 4 Cloudflare-захищеними джерелами:
              poctra, carsfromwest, autoauctionhistory, salvagebid. Старий потік
              Copart / bid.cars / carfast прибрано в v4.1.
            </p>
            <p className="mt-2 text-[11px] font-mono text-[#A1A1AA]">
              Розмір ZIP: {fmtSize(info?.file_size)}
              {info?.file_count ? ` · ${info.file_count} файлів` : ''} · без legacy
            </p>
          </div>
          <button
            onClick={handleDownload}
            data-testid="setup-download-extension"
            className="px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors"
          >
            <Download size={16} weight="bold" />
            Скачати ZIP
          </button>
        </div>
      </div>

      {/* ─── Install steps ─────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lightning size={18} weight="duotone" className="text-amber-500" />
          <h3 className="text-base font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Інсталяція (3 хв)
          </h3>
        </div>
        <ol className="space-y-2.5 text-sm text-[#3F3F46]">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">1</span>
            <span>Скачайте ZIP за кнопкою вище.</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">2</span>
            <span>Розпакуйте архів у будь-яку зручну папку.</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">3</span>
            <span>
              Відкрийте{' '}
              <code className="bg-[#F4F4F5] px-1.5 py-0.5 rounded font-mono text-xs">
                chrome://extensions/
              </code>{' '}
              у Chrome.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">4</span>
            <span>Увімкніть <strong>«Режим розробника»</strong> (top-right).</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">5</span>
            <span>Натисніть <strong>«Завантажити розпаковане»</strong> та виберіть розпаковану папку.</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">6</span>
            <span>Клікніть на іконку BIBI у тулбарі — відкриється popup.</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">7</span>
            <div className="flex-1 space-y-2">
              <span>У popup введіть наступні значення (натисніть на іконку, щоб скопіювати):</span>
              <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#52525B] w-24 flex-shrink-0">Backend URL</span>
                  <code className="flex-1 bg-white border border-[#E4E4E7] px-2 py-1 rounded font-mono text-xs text-[#18181B] break-all">
                    {backendUrl}
                  </code>
                  <CopyBtn value={backendUrl} field="backend" label="Backend URL скопійовано" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#52525B] w-24 flex-shrink-0">Client label</span>
                  <code className="flex-1 bg-white border border-[#E4E4E7] px-2 py-1 rounded font-mono text-xs text-[#A1A1AA]">
                    owner-laptop
                  </code>
                  <span className="text-[10px] text-[#A1A1AA]">будь-яка назва</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#52525B] w-24 flex-shrink-0">HMAC секрет</span>
                  {info?.hmac_secret ? (
                    <>
                      <code
                        className="flex-1 bg-white border border-[#E4E4E7] px-2 py-1 rounded font-mono text-xs text-[#18181B] break-all"
                        data-testid="hmac-secret-value"
                      >
                        {info.hmac_secret}
                      </code>
                      <CopyBtn value={info.hmac_secret} field="hmac" label="HMAC секрет скопійовано" />
                    </>
                  ) : (
                    <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                      EXT_SHARED_SECRET не задано в backend/.env
                    </span>
                  )}
                </div>
              </div>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#18181B] text-white text-[11px] font-bold flex items-center justify-center">8</span>
            <span>
              Натисніть <strong>«Зберегти»</strong> для кожного поля. Розширення авто-зареєструється на бекенді (
              <code className="bg-[#F4F4F5] px-1 rounded font-mono text-xs">/api/ext/register</code>) та почне відправляти heartbeat кожні 60 c.
            </span>
          </li>
        </ol>

        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5 flex items-start gap-2">
          <CheckCircle size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-900">
            Після успішного підключення на цій сторінці у блоці <strong>Extension Status</strong> з'явиться 1 online client з last seen ≤ 5 c, а 4 Cloudflare джерела вийдуть із критичного стану.
          </p>
        </div>
      </div>

      {/* ─── Sources ─────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Plugs size={18} weight="duotone" className="text-[#18181B]" />
          <h3 className="text-base font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Підтримувані джерела
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SOURCES.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-2.5 rounded-lg border border-[#E4E4E7] bg-[#FAFAFA]"
            >
              <div className="flex items-center gap-2">
                <CheckCircle size={15} weight="fill" className="text-emerald-500" />
                <span className="text-sm font-medium text-[#18181B]">{s.label}</span>
              </div>
              <span className="text-[10px] font-mono text-[#71717A] bg-white border border-[#E4E4E7] px-1.5 py-0.5 rounded">
                {s.role}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Troubleshooting ─────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Warning size={18} weight="duotone" className="text-amber-500" />
          <h3 className="text-base font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Часті проблеми
          </h3>
        </div>
        <div className="space-y-3 text-sm text-[#3F3F46]">
          <div>
            <p className="font-semibold text-[#18181B] mb-1">1. Popup нічого не показує</p>
            <ul className="list-disc list-inside text-xs text-[#52525B] space-y-0.5 ml-2">
              <li>Перезавантажте extension у chrome://extensions/.</li>
              <li>Переконайтесь що Backend URL вказано правильно і збережено кнопкою.</li>
              <li>Відкрийте Inspect views → background, перевірте логи реєстрації.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-[#18181B] mb-1">2. У статусі вище 0 clients</p>
            <ul className="list-disc list-inside text-xs text-[#52525B] space-y-0.5 ml-2">
              <li>HMAC секрет у popup має точно збігатися зі значенням <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">EXT_SHARED_SECRET</code> у <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">backend/.env</code>.</li>
              <li>У Network tab background-сторінки повинні бути POST на <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">/api/ext/heartbeat</code> кожні 60 с (200 OK).</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-[#18181B] mb-1">3. JSON parse error «Unexpected non-whitespace…»</p>
            <p className="text-xs text-[#52525B] ml-2">У вас все ще встановлена стара версія розширення (v3.x або v4.0). Видаліть її в chrome://extensions та встановіть ZIP з цієї сторінки.</p>
          </div>
          <div>
            <p className="font-semibold text-[#18181B] mb-1">4. 410 Gone на старих endpoint-ах</p>
            <p className="text-xs text-[#52525B] ml-2">
              Це не помилка — це навмисна поведінка v4.1: legacy маршрути{' '}
              <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">/api/copart/*</code>,{' '}
              <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">/api/bidcars/*</code>,{' '}
              <code className="bg-[#F4F4F5] px-1 rounded font-mono text-[10px]">/api/carfast/*</code> повертають JSON 410 Gone, щоб старі клієнти явно бачили що потрібно оновитись.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};



// ── ParserControl page ───────────────────────────────────
const ParserControl = () => {
  const { user } = useAuth();
  // Only master_admin / owner can mutate infrastructure. Everybody else
  // (admin / team_lead / manager / moderator) gets the full dashboard
  // read-only. This mirrors the backend guard (require_master_admin).
  const role = (user?.role || '').toLowerCase();
  const isMasterAdmin = role === 'master_admin';

  // Tab state — supports deep-link via ?tab=extension (back-compat for the
  // legacy /admin/parser/chrome-extension URL which now redirects here).
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'overview';
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tab');
    return t === 'extension' ? 'extension' : 'overview';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const handleTabChange = (val) => {
    setActiveTab(val);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (val === 'extension') url.searchParams.set('tab', 'extension');
      else url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const [overview, setOverview] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(Date.now());
  const nowTick = useRef(null);

  const fetchOverview = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/control/overview`);
      setOverview(r.data);
      setLastUpdate(Date.now());
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const t = setInterval(fetchOverview, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchOverview]);

  // 1s ticker for the "Updated Xs ago" freshness indicator
  useEffect(() => {
    nowTick.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(nowTick.current);
  }, []);

  const total = overview?.sources?.length || 0;
  const healthy = useMemo(
    () => (overview?.sources || []).filter((r) => r.status === 'ok').length,
    [overview?.sources],
  );

  const freshSeconds = lastUpdate
    ? Math.max(0, Math.floor((now - lastUpdate) / 1000))
    : null;
  const freshStale = freshSeconds !== null && freshSeconds > POLL_INTERVAL / 1000 + 3;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CircleNotch size={32} className="animate-spin text-[#18181B]" />
      </div>
    );
  }

  return (
    <motion.div
      data-testid="parser-control-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Header with freshness indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1
            className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B]"
            style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
          >
            VIN Парсер · Control Center
          </h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1 flex flex-wrap items-center gap-1.5">
            <span>
              {healthy}/{total} sources healthy
            </span>
            <CaretRight size={10} className="text-[#D4D4D8]" />
            <span>polled every {POLL_INTERVAL / 1000}s</span>
            {freshSeconds !== null && (
              <>
                <CaretRight size={10} className="text-[#D4D4D8]" />
                <span
                  className={`inline-flex items-center gap-1 ${
                    freshStale ? 'text-amber-600 font-medium' : 'text-[#71717A]'
                  }`}
                  data-testid="freshness"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      freshStale
                        ? 'bg-amber-500'
                        : 'bg-emerald-500 animate-pulse'
                    }`}
                  />
                  Updated {freshSeconds}s ago
                </span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={fetchOverview}
          className="self-start sm:self-auto p-2 border border-[#E4E4E7] rounded-lg hover:bg-[#F4F4F5] transition-colors"
          data-testid="pc-refresh"
          title="Refresh"
        >
          <ArrowClockwise size={16} className="text-[#71717A]" />
        </button>
      </div>

      {loadErr && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          load error: {loadErr}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-5">
          <TabsTrigger value="overview" data-testid="tab-overview">
            Огляд
          </TabsTrigger>
          <TabsTrigger value="extension" data-testid="tab-extension">
            Chrome Extension
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-0 mt-0">
          {/* Read-only banner for non-master viewers ─────────────────── */}
          {!isMasterAdmin && (
            <div
              className="mb-5 bg-[#18181B] text-white rounded-xl px-4 py-3 flex items-center gap-3"
              data-testid="readonly-banner"
            >
              <ShieldCheck size={18} weight="fill" className="flex-shrink-0 text-white/80" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold tracking-tight">
                  READ-ONLY · Infrastructure is managed by master_admin
                </p>
                <p className="text-[11px] text-white/70 mt-0.5">
                  You can see system health and alerts. Parser run/stop, scheduler
                  control, extension provisioning and live probes are reserved to
                  the master_admin role (ops guard).
                </p>
              </div>
              <span className="hidden sm:inline-block text-[10px] font-mono uppercase tracking-wider bg-white/10 px-2 py-0.5 rounded border border-white/20">
                role: {role || 'unknown'}
              </span>
            </div>
          )}

          <SystemStatusBar
            system={overview?.system}
            alerts={overview?.alerts}
          />
          <ExtensionStatusCard
            extension={overview?.extension}
            canManage={isMasterAdmin}
            onOpenExtensionTab={() => handleTabChange('extension')}
          />
          <SourcesGrid sources={overview?.sources} />
          <PerformancePanel performance={overview?.performance} />
          <AlertsPanel alerts={overview?.alerts} />
          <OpsGuardianPanel canTest={isMasterAdmin} />
          <DebugPanel canProbe={isMasterAdmin} />

          {/* Quick links — master_admin only (ops surface) ───────────── */}
          {isMasterAdmin && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
              {[
                { href: '/admin/parser/proxies', icon: Pulse, label: 'Proxy Manager' },
                { href: '/admin/parser/logs', icon: ArrowClockwise, label: 'Parser Logs' },
                { href: '/admin/parser/settings', icon: Database, label: 'Parser Settings' },
              ].map(({ href, icon: Icon, label }) => (
                <a
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-[#E4E4E7] hover:border-[#18181B] transition-colors group"
                >
                  <Icon
                    size={18}
                    weight="duotone"
                    className="text-[#71717A] group-hover:text-[#18181B] transition-colors"
                  />
                  <span className="text-xs font-medium text-[#52525B] group-hover:text-[#18181B] transition-colors">
                    {label}
                  </span>
                  <ArrowSquareOut
                    size={12}
                    className="text-[#D4D4D8] ml-auto"
                  />
                </a>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="extension" className="mt-0">
          <ExtensionSetupTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default ParserControl;
