/**
 * WestMotorsPanel.js
 *
 * Admin dashboard for the Phase IV WestMotors INDEX-based fallback.
 *
 * Polls /api/westmotors/status every 5s. Shows:
 *   - Scheduler state (full + incremental loops)
 *   - Live progress when full sync is running (page X/Y)
 *   - DB counts (total, active, archived per region)
 *   - Last full + incremental run summaries
 *   - Action bar: Run-now (full / incremental), Cancel, Start/Stop schedulers
 *   - Settings: enabled, full daily hour UTC, incremental interval, delay,
 *     archive safety threshold
 *   - Recent runs table (joined full + incremental)
 */

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Database,
  Lightning,
  Pulse,
  Heartbeat,
  Play,
  Pause,
  StopCircle,
  ArrowClockwise,
  Clock,
  CheckCircle,
  XCircle,
  Gear,
  Globe,
  CircleNotch,
} from '@phosphor-icons/react';
import { API_URL } from '../../App';

const POLL_INTERVAL = 5000;

const Tile = ({ icon: Icon, label, value, accent = false, sub }) => (
  <div
    className="bg-white rounded-xl border border-[#E4E4E7] p-4"
    data-testid={`wm-tile-${label}`}
  >
    <div className="flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          accent ? 'bg-[#3B82F6]' : 'bg-[#F4F4F5]'
        }`}
      >
        <Icon size={20} weight="duotone" className={accent ? 'text-white' : 'text-[#18181B]'} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-[#18181B] tracking-tight truncate">{value}</p>
        <p className="text-[11px] text-[#71717A] uppercase tracking-wide">{label}</p>
        {sub ? <p className="text-[10px] text-[#A1A1AA]">{sub}</p> : null}
      </div>
    </div>
  </div>
);

const StatusBadge = ({ active, label }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
      active
        ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40'
        : 'bg-red-500/10 text-red-600 border-red-500/30'
    }`}
    data-testid={`wm-badge-${label.toLowerCase().replace(/\s+/g, '-')}`}
  >
    <span
      className={`w-1.5 h-1.5 rounded-full ${
        active ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
      }`}
    />
    {label} {active ? 'ON' : 'OFF'}
  </span>
);

const fmtDuration = (sec) => {
  if (!sec && sec !== 0) return '—';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${Math.round(sec - m * 60)}s`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uk-UA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
};

const WestMotorsPanel = () => {
  const [status, setStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [draftCfg, setDraftCfg] = useState(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const adminHeaders = useCallback(() => {
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('access_token') ||
      'demo-token-12345';
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/westmotors/status`);
      setStatus(r.data);
      if (!draftCfg && r.data?.settings) {
        setDraftCfg({ ...r.data.settings });
      }
    } catch (e) {
      // keep last status, panel may be loading
    }
  }, [draftCfg]);

  const fetchRuns = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/westmotors/runs?limit=10`, {
        headers: adminHeaders(),
      });
      setRuns(r.data?.runs || []);
    } catch (e) {
      // ignore — non-admin users still see status
    }
  }, [adminHeaders]);

  useEffect(() => {
    fetchStatus();
    fetchRuns();
    const id = setInterval(() => {
      fetchStatus();
      fetchRuns();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus, fetchRuns]);

  const fireOp = async (path, label) => {
    setBusy(true);
    try {
      await axios.post(
        `${API_URL}${path}`,
        {},
        { headers: { ...adminHeaders(), 'Content-Type': 'application/json' } },
      );
      toast.success(`${label} scheduled`);
      fetchStatus();
    } catch (e) {
      toast.error(`${label} failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (kind) => {
    setBusy(true);
    try {
      await axios.post(
        `${API_URL}/api/westmotors/sync/run-now`,
        { kind },
        { headers: { ...adminHeaders(), 'Content-Type': 'application/json' } },
      );
      toast.success(`WestMotors ${kind} sync scheduled`);
      fetchStatus();
    } catch (e) {
      toast.error(`Failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    setBusy(true);
    try {
      await axios.post(
        `${API_URL}/api/westmotors/sync/cancel`,
        {},
        { headers: adminHeaders() },
      );
      toast.success('Cancellation signal sent');
    } catch (e) {
      toast.error(`Cancel failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleScheduler = async (start) => {
    setBusy(true);
    try {
      const path = start ? 'start' : 'stop';
      await axios.post(
        `${API_URL}/api/westmotors/sync/scheduler/${path}`,
        {},
        { headers: adminHeaders() },
      );
      toast.success(`Schedulers ${start ? 'started' : 'stopped'}`);
      fetchStatus();
    } catch (e) {
      toast.error(`Scheduler op failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!draftCfg) return;
    setSavingCfg(true);
    try {
      const r = await axios.post(
        `${API_URL}/api/westmotors/sync/configure`,
        draftCfg,
        { headers: { ...adminHeaders(), 'Content-Type': 'application/json' } },
      );
      toast.success('Settings saved');
      if (r.data?.settings) setDraftCfg({ ...r.data.settings });
      fetchStatus();
    } catch (e) {
      toast.error(`Save failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setSavingCfg(false);
    }
  };

  if (!status) {
    return (
      <div className="bg-white rounded-xl border border-[#E4E4E7] p-6 flex items-center gap-3">
        <CircleNotch size={20} className="animate-spin text-[#3B82F6]" />
        <span className="text-sm text-[#52525B]">Loading WestMotors status…</span>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        WestMotors module unavailable: {status.reason || status.error || 'unknown'}
      </div>
    );
  }

  const { settings, db, progress, last_full_run, last_incremental_run } = status;
  const cfg = draftCfg || settings;
  const fullRunning = status.is_running_full;
  const incRunning = status.is_running_incremental;
  const fullSchedulerOn = !!status.scheduler_full_active;
  const incSchedulerOn = !!status.scheduler_incremental_active;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-white rounded-2xl border border-[#E4E4E7] p-5 mb-6"
      data-testid="westmotors-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] flex items-center justify-center">
            <Globe size={22} weight="duotone" className="text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#18181B]">WestMotors INDEX (Phase IV)</h3>
            <p className="text-xs text-[#71717A]">
              Sitemap-driven VIN fallback for west-motors.pl — fires when BitMotors live search misses.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge active={fullSchedulerOn} label="Full daily" />
          <StatusBadge active={incSchedulerOn} label="Incremental hourly" />
          {(fullRunning || incRunning) ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-700 border border-blue-500/40">
              <CircleNotch size={10} className="animate-spin" />
              {fullRunning ? 'Full Running' : 'Incremental Running'}
            </span>
          ) : null}
        </div>
      </div>

      {/* DB stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Tile icon={Database} label="Indexed VINs" value={db?.total ?? 0} accent />
        <Tile icon={CheckCircle} label="Active" value={db?.active ?? 0} />
        <Tile icon={XCircle} label="Archived" value={db?.archived ?? 0} />
        <Tile
          icon={Lightning}
          label="Prefetched (warm)"
          value={db?.prefetched ?? 0}
          sub={
            db?.total
              ? `${Math.round(((db?.prefetched || 0) / db.total) * 100)}% coverage`
              : null
          }
        />
      </div>

      {/* Latency tiles (Phase IV-1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Tile
          icon={Pulse}
          label="P50 latency"
          value={
            status.latency?.p50_ms
              ? `${status.latency.p50_ms < 100 ? status.latency.p50_ms.toFixed(1) : Math.round(status.latency.p50_ms)} ms`
              : '—'
          }
          sub={`sample n=${status.latency?.sample_size ?? 0}`}
        />
        <Tile
          icon={Pulse}
          label="P95 latency"
          value={
            status.latency?.p95_ms
              ? `${status.latency.p95_ms < 100 ? status.latency.p95_ms.toFixed(1) : Math.round(status.latency.p95_ms)} ms`
              : '—'
          }
        />
        <Tile
          icon={CheckCircle}
          label="Prefetch hit ratio"
          value={`${Math.round((status.latency?.prefetched_hit_ratio ?? 0) * 100)}%`}
          sub={`${status.latency?.hits_prefetched ?? 0} of ${status.latency?.lookups_total ?? 0}`}
        />
        <Tile
          icon={XCircle}
          label="Timeouts (3.5s cap)"
          value={status.latency?.timeouts ?? 0}
          sub={`errors: ${status.latency?.errors ?? 0}`}
        />
      </div>

      {/* Live progress (only during full run) */}
      {fullRunning && progress?.kind === 'full' ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
              Full sync in progress
            </span>
            <span className="text-xs text-blue-800">
              {progress.sitemaps_done}/{progress.sitemaps_total} sitemaps · {progress.items_seen} VINs seen
            </span>
          </div>
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] transition-all"
              style={{
                width: progress.sitemaps_total
                  ? `${Math.min(100, (progress.sitemaps_done / progress.sitemaps_total) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          <p className="text-[11px] text-blue-800 mt-1.5">{progress.stage}</p>
        </div>
      ) : null}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          type="button"
          onClick={() => runNow('incremental')}
          disabled={busy || incRunning}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#18181B] text-white text-sm font-medium hover:bg-[#27272A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="wm-run-incremental"
        >
          <Lightning size={16} weight="bold" />
          Run incremental now
        </button>
        <button
          type="button"
          onClick={() => runNow('full')}
          disabled={busy || fullRunning}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="wm-run-full"
        >
          <ArrowClockwise size={16} weight="bold" />
          Run FULL sync now
        </button>
        <button
          type="button"
          onClick={() => fireOp('/api/westmotors/sync/prefetch', 'Top-N prefetch')}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="wm-prefetch"
          title="Pre-fetch top-N freshest VIN detail pages into the warm cache"
        >
          <Pulse size={16} weight="bold" />
          Prefetch top-N
        </button>
        <button
          type="button"
          onClick={() => fireOp('/api/westmotors/sync/warmup', 'Search-log warmup')}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="wm-warmup"
          title="Pre-fetch the most-searched VINs from search_logs"
        >
          <Heartbeat size={16} weight="bold" />
          Warm up popular
        </button>
        <button
          type="button"
          onClick={cancelRun}
          disabled={busy || (!fullRunning && !incRunning)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E4E7] text-[#52525B] text-sm font-medium hover:bg-[#F4F4F5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="wm-cancel"
        >
          <StopCircle size={16} weight="bold" />
          Cancel current
        </button>
        <button
          type="button"
          onClick={() => toggleScheduler(!(fullSchedulerOn && incSchedulerOn))}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E4E7] text-[#52525B] text-sm font-medium hover:bg-[#F4F4F5] disabled:opacity-50 transition-colors ml-auto"
          data-testid="wm-toggle-scheduler"
        >
          {(fullSchedulerOn && incSchedulerOn) ? <Pause size={16} /> : <Play size={16} />}
          {(fullSchedulerOn && incSchedulerOn) ? 'Stop schedulers' : 'Start schedulers'}
        </button>
      </div>

      {/* Config form */}
      <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Gear size={16} weight="duotone" className="text-[#52525B]" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#52525B]">
            Configuration
          </h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="flex flex-col">
            <span className="text-[11px] text-[#71717A] mb-1">Full daily hour (UTC)</span>
            <input
              type="number"
              min={0}
              max={23}
              value={cfg.full_daily_hour_utc ?? 4}
              onChange={(e) =>
                setDraftCfg({ ...cfg, full_daily_hour_utc: parseInt(e.target.value || '0', 10) })
              }
              className="px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm focus:border-[#3B82F6] focus:outline-none"
              data-testid="wm-cfg-daily-hour"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-[11px] text-[#71717A] mb-1">Incremental interval (sec)</span>
            <input
              type="number"
              min={300}
              step={60}
              value={cfg.incremental_interval_sec ?? 3600}
              onChange={(e) =>
                setDraftCfg({ ...cfg, incremental_interval_sec: parseInt(e.target.value || '3600', 10) })
              }
              className="px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm focus:border-[#3B82F6] focus:outline-none"
              data-testid="wm-cfg-interval"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-[11px] text-[#71717A] mb-1">Delay between sitemaps (sec)</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={cfg.delay_between_sitemaps_sec ?? 2}
              onChange={(e) =>
                setDraftCfg({ ...cfg, delay_between_sitemaps_sec: parseFloat(e.target.value || '2') })
              }
              className="px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm focus:border-[#3B82F6] focus:outline-none"
              data-testid="wm-cfg-delay"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-[11px] text-[#71717A] mb-1">Archive safety threshold (0-1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={cfg.archive_safety_threshold ?? 0.8}
              onChange={(e) =>
                setDraftCfg({ ...cfg, archive_safety_threshold: parseFloat(e.target.value || '0.8') })
              }
              className="px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm focus:border-[#3B82F6] focus:outline-none"
              data-testid="wm-cfg-threshold"
            />
          </label>
          <label className="flex items-center gap-2 col-span-1 sm:col-span-2 lg:col-span-3 mt-2">
            <input
              type="checkbox"
              checked={!!cfg.enabled}
              onChange={(e) => setDraftCfg({ ...cfg, enabled: e.target.checked })}
              className="w-4 h-4 accent-[#3B82F6]"
              data-testid="wm-cfg-enabled"
            />
            <span className="text-sm text-[#18181B] font-medium">
              Enabled (when off, scheduler skips ticks but stays alive)
            </span>
          </label>
        </div>
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={saveConfig}
            disabled={savingCfg}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#18181B] text-white text-sm font-medium hover:bg-[#27272A] disabled:opacity-50 transition-colors"
            data-testid="wm-save-cfg"
          >
            {savingCfg ? <CircleNotch size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Save settings
          </button>
        </div>
      </div>

      {/* Recent runs */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} weight="duotone" className="text-[#52525B]" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#52525B]">
            Recent runs
          </h4>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#E4E4E7]">
          <table className="w-full text-sm" data-testid="wm-runs-table">
            <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-[#71717A]">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-right">Seen</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Updated</th>
                <th className="px-3 py-2 text-right">Archived</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[#A1A1AA]">
                    No runs yet — fire one with the buttons above.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r._id} className="hover:bg-[#FAFAFA]">
                    <td className="px-3 py-2 text-[#18181B] whitespace-nowrap">
                      {fmtDate(r.started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          r.kind === 'full'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {r.kind || 'unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#52525B]">{r.seen ?? 0}</td>
                    <td className="px-3 py-2 text-right font-medium text-emerald-700">{r.new ?? 0}</td>
                    <td className="px-3 py-2 text-right text-[#52525B]">{r.updated ?? 0}</td>
                    <td className="px-3 py-2 text-right text-orange-700">{r.archived ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-red-700">{r.errors ?? 0}</td>
                    <td className="px-3 py-2 text-right text-[#52525B]">
                      {fmtDuration(r.duration_sec)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export default WestMotorsPanel;
