/**
 * ProviderHealthWidget — shows a manager their own Provider Pressure
 * score / tier / pressure message. Used on the Manager dashboard.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Gauge, ArrowUpRight } from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const TIER_META = {
  high:      { color: 'from-emerald-500 to-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-300' },
  normal:    { color: 'from-amber-500 to-amber-600',     bar: 'bg-amber-500',   ring: 'ring-amber-300' },
  warning:   { color: 'from-orange-500 to-orange-600',   bar: 'bg-orange-500',  ring: 'ring-orange-300' },
  penalized: { color: 'from-red-500 to-red-600',         bar: 'bg-red-500',     ring: 'ring-red-300' },
  hidden:    { color: 'from-zinc-600 to-zinc-800',       bar: 'bg-zinc-600',    ring: 'ring-zinc-400' },
};

export default function ProviderHealthWidget({ className = '' }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const r = await axios.get(`${API_URL}/api/providers/me/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setStats(r.data.stats);
      } catch (e) {
        console.warn('[ProviderHealthWidget] failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className={`rounded-2xl bg-zinc-100 h-36 animate-pulse ${className}`} data-testid="provider-health-widget-loading" />
    );
  }
  if (!stats) return null;

  const meta = TIER_META[stats.tier] || TIER_META.normal;
  const score = stats.score ?? 0;

  return (
    <div
      className={`rounded-2xl p-5 shadow-lg text-white bg-gradient-to-br ${meta.color} ring-1 ${meta.ring} ${className}`}
      data-testid="provider-health-widget"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium opacity-90">
            <Gauge size={16} weight="bold" />
            Мій Health-Score
          </div>
          <div className="mt-2 text-4xl font-bold tracking-tight" data-testid="provider-health-score">{score}<span className="text-xl opacity-70">/100</span></div>
          <div className="mt-1 text-xs uppercase tracking-wider font-semibold opacity-90" data-testid="provider-health-tier">
            {stats.tier}
          </div>
        </div>
        <div className="text-right text-xs opacity-80">
          <div>Замовлень: <b className="text-white">{stats.metrics?.totalOrders ?? 0}</b></div>
          <div>Виконано: <b className="text-white">{stats.metrics?.completedOrders ?? 0}</b></div>
          {stats.metrics?.responseTimeAvg !== null && stats.metrics?.responseTimeAvg !== undefined && (
            <div>Avg старт: <b className="text-white">{stats.metrics.responseTimeAvg} хв</b></div>
          )}
        </div>
      </div>

      {/* score bar */}
      <div className="mt-4 h-2 bg-white/20 rounded-full overflow-hidden">
        <div className="h-full bg-white/80 transition-all duration-700" style={{ width: `${Math.max(3, score)}%` }} />
      </div>

      <div className="mt-3 text-sm font-medium leading-snug" data-testid="provider-health-message">
        {stats.message || '—'}
      </div>
    </div>
  );
}
