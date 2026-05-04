/**
 * MultiSourcePanel — Phase V/8/9 admin widget.
 *
 * Polls /api/ext/health and /api/ext/clients every 5s and renders, in
 * the same black-and-white Cabinet-Grotesk style as the rest of the
 * admin dashboard, the state of every multi-source resolver tier:
 *   - per-source tile (calls / hits / errors / P50 / P95 / drift)
 *   - extension-clients table (online / unhealthy / success-rate)
 *   - live AuctionAuto smoke-test
 *
 * Replaces the older inline-styled dark version.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Globe,
  Pulse,
  Plugs,
  Heartbeat,
  Lightning,
  Warning,
  CheckCircle,
  XCircle,
  Gear,
  CircleNotch,
  ArrowClockwise,
  Database,
  Clock,
  Browser,
} from '@phosphor-icons/react';
import { API_URL } from '../../App';

const POLL_INTERVAL = 5000;

const SOURCE_PRESENTATION = {
  // tier 1 — live primary (rendered separately for clarity)
  bitmotors: { label: 'BitMotors', tier: 'LIVE', icon: Lightning },
  // tier 2 — index fallbacks
  westmotors: { label: 'WestMotors', tier: 'INDEX', icon: Database },
  lemon: { label: 'Lemon', tier: 'INDEX', icon: Database },
  // tier 3 — http fallbacks
  auctionauto: { label: 'AuctionAuto', tier: 'HTTP', icon: Globe },
  // tier 4 — extension fallbacks (CF protected)
  poctra: { label: 'Poctra (archive)', tier: 'EXT', icon: Browser },
  carsfromwest: { label: 'CarsFromWest', tier: 'EXT', icon: Browser },
  autoauctionhistory: { label: 'AutoAuctionHistory', tier: 'EXT', icon: Browser },
  salvagebid: { label: 'SalvageBid', tier: 'EXT', icon: Browser },
  // synthetic / observation
  ext_observation_cache: { label: 'Observation Cache', tier: 'CACHE', icon: Pulse },
};

const TIER_ORDER = { LIVE: 0, INDEX: 1, HTTP: 2, EXT: 3, CACHE: 4 };

const TIER_BADGE = {
  LIVE: 'bg-amber-100 text-amber-800 border-amber-200',
  INDEX: 'bg-blue-100 text-blue-800 border-blue-200',
  HTTP: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXT: 'bg-purple-100 text-purple-800 border-purple-200',
  CACHE: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

function formatAge(ts) {
  if (!ts) return '—';
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── tile for a single source ────────────────────────────
const SourceTile = ({ srcKey, info }) => {
  const meta = SOURCE_PRESENTATION[srcKey] || {
    label: srcKey,
    tier: 'EXT',
    icon: Plugs,
  };
  const Icon = meta.icon || Plugs;
  const calls = info?.calls || 0;
  const hits = info?.hits || 0;
  const errors = info?.errors || 0;
  const drift = info?.drift_ratio;
  const drifting = !!info?.drifting;
  const healthy = errors === 0 && (calls === 0 || hits > 0) && !drifting;

  return (
    <div
      className="bg-white rounded-xl border border-[#E4E4E7] p-4"
      data-testid={`ms-tile-${srcKey}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#F4F4F5] flex-shrink-0">
            <Icon size={16} weight="duotone" className="text-[#18181B]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#18181B] truncate">{meta.label}</p>
            <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wide truncate">
              {srcKey}
            </p>
          </div>
        </div>
        <span
          className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${
            TIER_BADGE[meta.tier] || TIER_BADGE.EXT
          }`}
        >
          {meta.tier}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <p className="text-[9px] text-[#A1A1AA] uppercase tracking-wide">Calls</p>
          <p className="text-sm font-bold text-[#18181B]">{calls}</p>
        </div>
        <div>
          <p className="text-[9px] text-[#A1A1AA] uppercase tracking-wide">Hits</p>
          <p className="text-sm font-bold text-emerald-600">{hits}</p>
        </div>
        <div>
          <p className="text-[9px] text-[#A1A1AA] uppercase tracking-wide">Errors</p>
          <p className={`text-sm font-bold ${errors > 0 ? 'text-red-600' : 'text-[#18181B]'}`}>
            {errors}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-[#71717A] mb-3 border-t border-[#F4F4F5] pt-2">
        <span>
          P50 <span className="font-mono text-[#18181B]">{info?.latency_p50_ms || 0}ms</span>
        </span>
        <span>
          P95 <span className="font-mono text-[#18181B]">{info?.latency_p95_ms || 0}ms</span>
        </span>
        <span>
          n=<span className="font-mono text-[#18181B]">{info?.sample_size || 0}</span>
        </span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-[#71717A] mb-3">
        <span>
          Hit-ratio{' '}
          <span className="font-bold text-[#18181B]">
            {Math.round((info?.hit_ratio || 0) * 100)}%
          </span>
        </span>
        <span>last ok {formatAge(info?.last_success_at)}</span>
      </div>

      {info?.last_error && (
        <p
          className="text-[10px] text-red-600 truncate mb-2"
          title={info.last_error}
        >
          {info.last_error}
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
            healthy
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {healthy ? '● healthy' : '● degraded'}
        </span>
        {drifting && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-amber-50 text-amber-700 border border-amber-200"
            title={`drift ratio ${Math.round((drift || 0) * 100)}%`}
          >
            ⚠ drift
          </span>
        )}
        {drift !== null && drift !== undefined && drift > 0 && !drifting && (
          <span className="text-[10px] text-[#A1A1AA]">
            drift {Math.round(drift * 100)}%
          </span>
        )}
      </div>
    </div>
  );
};

// ── main panel ──────────────────────────────────────────
const MultiSourcePanel = () => {
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [testVin, setTestVin] = useState('5YJSA1E25HF199047');
  const [testRes, setTestRes] = useState(null);
  const [testing, setTesting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [hr, cr] = await Promise.all([
        axios.get(`${API_URL}/api/ext/health`),
        axios.get(`${API_URL}/api/ext/clients`),
      ]);
      setHealth(hr.data);
      setClients(cr.data);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(t);
  }, [fetchAll]);

  const orderedSources = useMemo(() => {
    const sources = (health && health.sources) || {};
    const keys = Object.keys(sources);
    keys.sort((a, b) => {
      const ta = TIER_ORDER[SOURCE_PRESENTATION[a]?.tier] ?? 99;
      const tb = TIER_ORDER[SOURCE_PRESENTATION[b]?.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, ...sources[k] }));
  }, [health]);

  const queueDepth = (health && health.queue_depth) || 0;
  const inFlight = (health && health.results_in_flight) || 0;
  const obsCount = (health && health.observation_cache_vins) || 0;
  const onlineClients = (health && health.online_clients) || 0;

  const runAaTest = async () => {
    if (!testVin || testVin.length !== 17) {
      toast.error('VIN must be 17 chars');
      return;
    }
    setTesting(true);
    setTestRes(null);
    try {
      const r = await axios.post(`${API_URL}/api/ext/auctionauto/test`, {
        vin: testVin.trim().toUpperCase(),
      });
      setTestRes(r.data);
      if (r.data?.found) toast.success('Found on AuctionAuto');
      else toast.message('Not found — VIN may have rotated out of inventory');
    } catch (e) {
      setTestRes({ error: e?.response?.data?.detail || String(e) });
      toast.error('AA smoke-test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div
      data-testid="multisource-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-6"
    >
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2
            className="text-base font-bold tracking-tight text-[#18181B]"
            style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}
          >
            Multi-Source Resolver
          </h2>
          <p className="text-xs text-[#71717A] mt-0.5">
            queue {queueDepth} · in-flight {inFlight} · obs cache {obsCount} VINs
            {(health?.degraded_sources?.length ?? 0) > 0 && (
              <>
                {' · '}
                <span className="text-red-600 font-medium">
                  degraded: {health.degraded_sources.join(', ')}
                </span>
              </>
            )}
            {(health?.drifting_sources?.length ?? 0) > 0 && (
              <>
                {' · '}
                <span className="text-amber-600 font-medium">
                  drift: {health.drifting_sources.join(', ')}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="self-start sm:self-auto p-2 border border-[#E4E4E7] rounded-lg hover:bg-[#F4F4F5] transition-colors"
          data-testid="ms-refresh"
          title="Refresh"
        >
          <ArrowClockwise size={16} className="text-[#71717A]" />
        </button>
      </div>

      {loadErr && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          load error: {loadErr}
        </div>
      )}

      {/* Source tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-5">
        {orderedSources.map(({ key, ...info }) => (
          <SourceTile key={key} srcKey={key} info={info} />
        ))}
      </div>

      {/* Extension clients */}
      <div
        className="bg-white rounded-xl border border-[#E4E4E7] p-4 mb-5"
        data-testid="ms-clients"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[#18181B]">Extension Clients</h3>
            <p className="text-[11px] text-[#71717A] mt-0.5">
              <span className="text-emerald-600 font-medium">{onlineClients} online</span>
              {clients && clients.offline > 0 && (
                <>
                  {' · '}
                  <span className="text-red-600 font-medium">
                    {clients.offline} offline
                  </span>
                </>
              )}
              {onlineClients === 0 && clients?.total === 0 && (
                <>
                  {' · '}
                  <span className="text-amber-600">
                    No extensions registered — install BIBI Cars Parser v4.1
                  </span>
                </>
              )}
            </p>
          </div>
          {onlineClients === 0 && clients?.total > 0 && (
            <span className="text-[10px] px-2 py-1 rounded-md font-medium bg-amber-50 text-amber-700 border border-amber-200">
              ⚠ All clients offline
            </span>
          )}
        </div>
        {clients?.clients?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F4F4F5]">
                  <th className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Client
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Version
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Capabilities
                  </th>
                  <th className="text-center text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Jobs
                  </th>
                  <th className="text-center text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Obs
                  </th>
                  <th className="text-center text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Success
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Last seen
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] font-medium py-2 px-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.clients.map((c) => {
                  const sr = c.success_rate_recent;
                  const srDisplay =
                    sr === null || sr === undefined
                      ? '—'
                      : `${Math.round(sr * 100)}%`;
                  const srColor =
                    sr === null || sr === undefined
                      ? 'text-[#A1A1AA]'
                      : sr < 0.3
                      ? 'text-red-600'
                      : sr < 0.7
                      ? 'text-amber-600'
                      : 'text-emerald-600';
                  const status = !c.online
                    ? { txt: '● offline', cls: 'bg-red-50 text-red-700 border-red-200' }
                    : c.unhealthy
                    ? {
                        txt: '● unhealthy',
                        cls: 'bg-amber-50 text-amber-700 border-amber-200',
                      }
                    : {
                        txt: '● online',
                        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      };
                  return (
                    <tr
                      key={c.client_id}
                      className="border-b border-[#F4F4F5] last:border-0 hover:bg-[#FAFAFA]"
                      data-testid={`ms-client-${c.client_id}`}
                    >
                      <td className="py-2.5 px-3 text-xs font-mono text-[#18181B]">
                        {(c.label || c.client_id || '').slice(0, 30)}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-[#52525B]">
                        {c.version || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[#71717A] max-w-xs truncate">
                        {(c.capabilities || []).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-center text-[#18181B]">
                        {c.jobs_received || 0}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-center text-[#18181B]">
                        {c.observations_pushed || 0}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-xs text-center font-bold ${srColor}`}
                      >
                        {srDisplay}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-[#71717A]">
                        {formatAge(c.last_seen_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-medium border ${status.cls}`}
                        >
                          {status.txt}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-[#71717A] py-3">
            No extensions registered. Install the BIBI Cars Parser v4.1 in Chrome
            and configure backend URL + secret to bring this list to life.
          </div>
        )}
      </div>

      {/* AuctionAuto smoke-test */}
      <div
        className="bg-white rounded-xl border border-[#E4E4E7] p-4"
        data-testid="ms-aa-smoketest"
      >
        <div className="flex items-center gap-2 mb-3">
          <Globe size={14} weight="duotone" className="text-emerald-600" />
          <h3 className="text-sm font-semibold text-[#18181B]">
            Live AuctionAuto Smoke-Test
          </h3>
        </div>
        <p className="text-[11px] text-[#71717A] mb-3">
          Calls <code className="font-mono">/api/ext/auctionauto/test</code> directly,
          bypassing cache and the rest of the chain — useful for verifying the AA
          httpx scraper after a deployment.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={testVin}
            onChange={(e) => setTestVin(e.target.value.toUpperCase())}
            placeholder="17-char VIN"
            data-testid="ms-test-input"
            className="flex-1 px-3 py-2 text-sm font-mono border border-[#E4E4E7] rounded-lg focus:outline-none focus:border-[#18181B] bg-white"
          />
          <button
            onClick={runAaTest}
            disabled={testing}
            data-testid="ms-test-run"
            className="px-4 py-2 text-xs font-medium bg-[#18181B] text-white rounded-lg hover:bg-[#27272A] transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center gap-2 justify-center"
          >
            {testing ? (
              <>
                <CircleNotch size={14} className="animate-spin" />
                Testing
              </>
            ) : (
              <>
                <Lightning size={14} weight="fill" />
                Run
              </>
            )}
          </button>
        </div>
        {testRes && (
          <pre
            data-testid="ms-test-result"
            className="mt-3 p-3 bg-[#FAFAFA] border border-[#F4F4F5] rounded-lg text-[11px] text-[#52525B] overflow-x-auto max-h-64"
          >
            {JSON.stringify(testRes, null, 2)}
          </pre>
        )}
      </div>
    </motion.div>
  );
};

export default MultiSourcePanel;
