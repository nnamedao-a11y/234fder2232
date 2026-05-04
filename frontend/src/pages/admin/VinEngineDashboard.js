/**
 * VIN Engine Dashboard - Admin Page
 * 
 * Real-time VIN/LOT resolver з 11 джерелами
 * Інтегровано в існуючу админку BIBI Cars
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth, API_URL } from '../../App';
import { useLang } from '../../i18n';
import {
  Lightning,
  Database,
  Clock,
  CheckCircle,
  XCircle,
  Warning,
  ArrowClockwise,
  MagnifyingGlass,
  Gauge,
  ToggleLeft,
  ToggleRight,
  CaretRight,
  CircleNotch,
  Trash,
  Eye,
  ShieldCheck,
  Timer,
} from '@phosphor-icons/react';

// Status Badge Component (light theme)
const StatusBadge = ({ status }) => {
  const config = {
    online: { color: 'bg-emerald-100 text-emerald-700', label: 'ONLINE' },
    degraded: { color: 'bg-amber-100 text-amber-700', label: 'DEGRADED' },
    offline: { color: 'bg-red-100 text-red-700', label: 'OFFLINE' },
  }[status] || { color: 'bg-zinc-100 text-zinc-500', label: status?.toUpperCase() };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
};

// Tier Badge Component
const TierBadge = ({ tier }) => {
  const config = {
    1: { color: 'bg-blue-500 text-white', label: 'T1 FAST' },
    2: { color: 'bg-purple-500 text-white', label: 'T2 MID' },
    3: { color: 'bg-orange-500 text-white', label: 'T3 DEEP' },
  }[tier] || { color: 'bg-zinc-400 text-white', label: `T${tier}` };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${config.color}`}>
      {config.label}
    </span>
  );
};

// Summary Card Component
const SummaryCard = ({ icon, label, value, subValue, color = 'zinc' }) => {
  const colorClasses = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    blue: 'text-blue-500',
    purple: 'text-purple-500',
    red: 'text-red-500',
    zinc: 'text-zinc-500',
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E4E4E7] p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={colorClasses[color]}>{icon}</div>
        <span className="text-sm text-[#71717A]">{label}</span>
      </div>
      <div className="text-3xl font-bold text-[#18181B]">
        {value}
        {subValue && (
          <span className="text-base font-normal text-[#71717A] ml-1">{subValue}</span>
        )}
      </div>
    </div>
  );
};

// Main Component
const VinEngineDashboard = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const isMasterAdmin = ['master_admin'].includes(user?.role);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await axios.get(`${API_URL}/api/admin/overview`);
      setOverview(res.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch VIN engine data:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleSource = async (sourceId, currentEnabled) => {
    if (!isMasterAdmin) return;
    setActionLoading(sourceId);
    try {
      await axios.post(`${API_URL}/api/admin/sources/${sourceId}/toggle`, null, {
        params: { enabled: !currentEnabled }
      });
      toast.success(t('success'));
      fetchData();
    } catch (err) {
      toast.error(t('error'));
    } finally {
      setActionLoading(null);
    }
  };

  const clearCache = async () => {
    if (!isMasterAdmin) return;
    try {
      await axios.post(`${API_URL}/api/admin/cache/clear`);
      toast.success(t('success'));
      fetchData();
    } catch (err) {
      toast.error(t('error'));
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return <CheckCircle size={18} weight="fill" className="text-emerald-500" />;
      case 'degraded':
        return <Warning size={18} weight="fill" className="text-amber-500" />;
      case 'offline':
        return <XCircle size={18} weight="fill" className="text-red-500" />;
      default:
        return <CircleNotch size={18} className="text-zinc-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CircleNotch size={32} className="animate-spin text-[#18181B]" />
      </div>
    );
  }

  const { sources, cache, recent_searches, tiers } = overview || {};

  return (
    <div data-testid="vin-engine-dashboard">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
              {t('vinEngineTitle')}
            </h1>
            <p className="text-sm text-[#71717A] mt-1">{t('vinEngineSubtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#71717A]">
              {t('lastUpdate')}: {lastUpdate?.toLocaleTimeString()}
            </span>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#18181B] text-white rounded-xl hover:bg-[#27272A] transition-colors disabled:opacity-50"
              data-testid="refresh-btn"
            >
              <ArrowClockwise size={16} className={refreshing ? 'animate-spin' : ''} />
              {t('refresh')}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          icon={<CheckCircle size={24} weight="fill" />}
          label={t('sourcesOnline')}
          value={sources?.online || 0}
          subValue={`/ ${sources?.total || 0}`}
          color="emerald"
        />
        <SummaryCard
          icon={<Warning size={24} weight="fill" />}
          label={t('degraded')}
          value={sources?.degraded || 0}
          color="amber"
        />
        <SummaryCard
          icon={<Database size={24} weight="duotone" />}
          label={t('cacheHitRate')}
          value={`${cache?.hit_rate || 0}%`}
          color="blue"
        />
        <SummaryCard
          icon={<Lightning size={24} weight="fill" />}
          label={t('recentSuccessRate')}
          value={`${recent_searches?.success_rate || 0}%`}
          color="purple"
        />
      </div>

      {/* Sources Table */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] mb-6 overflow-hidden">
        <div className="p-4 border-b border-[#E4E4E7] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge size={20} className="text-[#18181B]" />
            <h2 className="font-semibold text-[#18181B]">
              {t('sourceRegistry')} ({sources?.total || 0})
            </h2>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
              T1: {tiers?.tier_1?.length || 0}
            </span>
            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
              T2: {tiers?.tier_2?.length || 0}
            </span>
            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full">
              T3: {tiers?.tier_3?.length || 0}
            </span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="sources-table">
            <thead className="bg-[#F4F4F5] text-left text-sm text-[#71717A]">
              <tr>
                <th className="px-4 py-3 font-medium">{t('tableSource')}</th>
                <th className="px-4 py-3 font-medium">{t('tier')}</th>
                <th className="px-4 py-3 font-medium">{t('tableStatus')}</th>
                <th className="px-4 py-3 font-medium">{t('successRate')}</th>
                <th className="px-4 py-3 font-medium">{t('avgLatency')}</th>
                <th className="px-4 py-3 font-medium">VIN/LOT</th>
                <th className="px-4 py-3 font-medium">{t('lastSuccess')}</th>
                {isMasterAdmin && <th className="px-4 py-3 font-medium">{t('tableActions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {sources?.details?.map((source) => (
                <tr 
                  key={source.id} 
                  className={`hover:bg-[#F4F4F5] transition-colors ${!source.enabled ? 'opacity-50' : ''}`}
                  data-testid={`source-row-${source.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(source.status)}
                      <div>
                        <div className="font-medium text-[#18181B]">{source.name}</div>
                        <div className="text-xs text-[#71717A]">{source.source_type}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={source.tier} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={source.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-[#E4E4E7] rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            source.success_rate >= 70 ? 'bg-emerald-500' :
                            source.success_rate >= 40 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(source.success_rate || 0, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm text-[#71717A]">{(source.success_rate || 0).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#71717A]">
                    {source.avg_latency_ms ? `${source.avg_latency_ms}ms` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {source.supports_vin && (
                        <span className="px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded">VIN</span>
                      )}
                      {source.supports_lot && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">LOT</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#71717A]">
                    {source.last_success 
                      ? new Date(source.last_success).toLocaleTimeString()
                      : t('never')
                    }
                  </td>
                  {isMasterAdmin && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleSource(source.id, source.enabled)}
                        disabled={actionLoading === source.id}
                        className="p-1.5 rounded-lg hover:bg-[#E4E4E7] transition-colors disabled:opacity-50"
                        title={source.enabled ? t('disable') : t('enable')}
                        data-testid={`toggle-${source.id}`}
                      >
                        {source.enabled 
                          ? <ToggleRight size={24} weight="fill" className="text-emerald-500" />
                          : <ToggleLeft size={24} className="text-zinc-400" />
                        }
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cache Stats */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Database size={20} className="text-[#18181B]" />
              <h2 className="font-semibold text-[#18181B]">{t('cacheStatistics')}</h2>
            </div>
            {isMasterAdmin && (
              <button
                onClick={clearCache}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                data-testid="clear-cache-btn"
              >
                <Trash size={14} />
                {t('clearCache')}
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[#F4F4F5] rounded-xl">
              <p className="text-xs text-[#71717A] mb-1">{t('cachedItems')}</p>
              <p className="text-2xl font-bold text-[#18181B]">{cache?.cached_items || 0}</p>
            </div>
            <div className="p-4 bg-[#F4F4F5] rounded-xl">
              <p className="text-xs text-[#71717A] mb-1">TTL</p>
              <p className="text-2xl font-bold text-[#18181B]">{cache?.ttl_hours || 12}h</p>
            </div>
            <div className="p-4 bg-[#F4F4F5] rounded-xl">
              <p className="text-xs text-[#71717A] mb-1">Hits</p>
              <p className="text-2xl font-bold text-emerald-600">{cache?.hits || 0}</p>
            </div>
            <div className="p-4 bg-[#F4F4F5] rounded-xl">
              <p className="text-xs text-[#71717A] mb-1">Misses</p>
              <p className="text-2xl font-bold text-red-500">{cache?.misses || 0}</p>
            </div>
          </div>
        </div>

        {/* Recent Searches */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
          <div className="flex items-center gap-2 mb-4">
            <MagnifyingGlass size={20} className="text-[#18181B]" />
            <h2 className="font-semibold text-[#18181B]">{t('recentSearches')}</h2>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto" data-testid="search-logs">
            {recent_searches?.logs?.length > 0 ? (
              recent_searches.logs.map((log, idx) => (
                <div 
                  key={idx} 
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    log.success ? 'bg-emerald-50' : 'bg-red-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {log.success 
                      ? <CheckCircle size={16} weight="fill" className="text-emerald-500" />
                      : <XCircle size={16} weight="fill" className="text-red-500" />
                    }
                    <div>
                      <span className="font-mono text-sm text-[#18181B]">{log.input}</span>
                      <span className="text-xs text-[#71717A] ml-2">({log.input_type})</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-[#18181B]">{log.winning_source || '—'}</div>
                    <div className="text-xs text-[#71717A] flex items-center gap-1">
                      <Timer size={12} />
                      {log.duration_ms}ms
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-[#71717A] py-8">
                {t('noSearches')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Links for master_admin */}
      {isMasterAdmin && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a href="/admin/parser" className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:shadow-md transition-shadow">
            <Lightning size={24} weight="duotone" className="text-[#18181B]" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{t('parserControlTitle')}</p>
              <p className="text-xs text-[#71717A] truncate">{t('parserControlSubtitle')}</p>
            </div>
            <CaretRight size={16} className="flex-shrink-0 text-[#71717A]" />
          </a>
          <a href="/admin/parser/logs" className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:shadow-md transition-shadow">
            <Clock size={24} weight="duotone" className="text-[#18181B]" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{t('parserLogsTitle')}</p>
              <p className="text-xs text-[#71717A] truncate">{t('searchHistory')}</p>
            </div>
            <CaretRight size={16} className="flex-shrink-0 text-[#71717A]" />
          </a>
          <a href="/admin/source-health" className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:shadow-md transition-shadow">
            <ShieldCheck size={24} weight="duotone" className="text-[#18181B]" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{t('sourceHealthDashboard')}</p>
              <p className="text-xs text-[#71717A] truncate">{t('sourceStatus')}</p>
            </div>
            <CaretRight size={16} className="flex-shrink-0 text-[#71717A]" />
          </a>
        </div>
      )}
    </div>
  );
};

export default VinEngineDashboard;
