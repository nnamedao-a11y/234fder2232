/**
 * Source Health Dashboard Page
 * 
 * Показує статус всіх джерел парсингу
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../i18n';
import { 
  Spinner, 
  CheckCircle, 
  Warning, 
  XCircle, 
  Clock,
  TrendUp,
  Database,
  ArrowClockwise,
  Lightning
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const SourceHealthDashboard = () => {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/source-health`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setError('');
    } catch (err) {
      setError('Failed to load health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchData]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-emerald-100 text-emerald-700';
      case 'degraded': return 'bg-amber-100 text-amber-700';
      case 'quarantine': return 'bg-red-100 text-red-700';
      case 'disabled': return 'bg-zinc-100 text-zinc-500';
      default: return 'bg-zinc-100 text-zinc-500';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active': return <CheckCircle weight="fill" className="text-emerald-500" />;
      case 'degraded': return <Warning weight="fill" className="text-amber-500" />;
      case 'quarantine': return <XCircle weight="fill" className="text-red-500" />;
      case 'disabled': return <XCircle className="text-zinc-400" />;
      default: return null;
    }
  };

  const getTierBadge = (tier) => {
    const colors = {
      1: 'bg-emerald-500',
      2: 'bg-blue-500',
      3: 'bg-purple-500',
      4: 'bg-zinc-400',
    };
    return (
      <span className={`px-2 py-0.5 text-xs text-white rounded ${colors[tier] || colors[4]}`}>
        Tier {tier}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Spinner size={48} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900">{t('sourceHealthDashboard')}</h1>
              <p className="text-sm text-zinc-500 mt-1">
                {t('teamLoadControl')}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                {t('realtime')}
              </label>
              <button
                onClick={fetchData}
                className="p-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors"
              >
                <ArrowClockwise size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="container mx-auto px-4 py-4">
          <div className="p-4 bg-red-50 text-red-600 rounded-lg">
            {error}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              icon={<CheckCircle weight="fill" className="text-emerald-500" />}
              label="Active"
              value={data.activeSources}
              total={data.totalSources}
              color="emerald"
            />
            <SummaryCard
              icon={<Warning weight="fill" className="text-amber-500" />}
              label="Degraded"
              value={data.degradedSources}
              total={data.totalSources}
              color="amber"
            />
            <SummaryCard
              icon={<TrendUp className="text-blue-500" />}
              label="Hit Rate"
              value={`${Math.round(data.overallHitRate * 100)}%`}
              color="blue"
            />
            <SummaryCard
              icon={<Clock className="text-purple-500" />}
              label="Avg Latency"
              value={`${data.avgLatency}ms`}
              color="purple"
            />
          </div>

          {/* Sources Table */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="p-4 border-b border-zinc-100">
              <h2 className="font-semibold text-zinc-900">{t('sourceStatus')}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-50 text-left text-sm text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('tableSource')}</th>
                    <th className="px-4 py-3 font-medium">{t('tableStatus')}</th>
                    <th className="px-4 py-3 font-medium">{t('tier')}</th>
                    <th className="px-4 py-3 font-medium">{t('score')}</th>
                    <th className="px-4 py-3 font-medium">{t('hitRate')}</th>
                    <th className="px-4 py-3 font-medium">{t('latency')}</th>
                    <th className="px-4 py-3 font-medium">{t('requests')}</th>
                    <th className="px-4 py-3 font-medium">{t('lastSuccess')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.sources.map((source) => (
                    <tr key={source.name} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(source.status)}
                          <span className="font-medium text-zinc-900">{source.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(source.status)}`}>
                          {source.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {getTierBadge(source.tier)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-zinc-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.round(source.score * 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-zinc-600">
                            {Math.round(source.score * 100)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm ${source.hitRate > 0.5 ? 'text-emerald-600' : 'text-zinc-500'}`}>
                          {Math.round(source.hitRate * 100)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-600">
                        {source.avgLatency > 0 ? `${Math.round(source.avgLatency)}ms` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-zinc-600">
                          {source.successfulRequests}/{source.totalRequests}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-500">
                        {source.lastSuccess 
                          ? new Date(source.lastSuccess).toLocaleTimeString()
                          : '-'
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tier Legend */}
          <div className="mt-6 p-4 bg-white rounded-xl border border-zinc-200">
            <h3 className="font-medium text-zinc-900 mb-3">{t('tierDefinitions')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                {getTierBadge(1)}
                <span className="ml-2 text-zinc-600">{t('trustedStable')}</span>
              </div>
              <div>
                {getTierBadge(2)}
                <span className="ml-2 text-zinc-600">{t('competitorAggregator')}</span>
              </div>
              <div>
                {getTierBadge(3)}
                <span className="ml-2 text-zinc-600">{t('publicFallback')}</span>
              </div>
              <div>
                {getTierBadge(4)}
                <span className="ml-2 text-zinc-600">{t('difficultOptional')}</span>
              </div>
            </div>
          </div>

          {/* Last Updated */}
          <div className="mt-4 text-sm text-zinc-500 text-right">
            Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryCard = ({ icon, label, value, total, color }) => {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className="text-sm text-zinc-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-zinc-900">
        {value}
        {total !== undefined && (
          <span className="text-sm font-normal text-zinc-400">/{total}</span>
        )}
      </div>
    </div>
  );
};

export default SourceHealthDashboard;
