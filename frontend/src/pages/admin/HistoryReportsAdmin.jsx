/**
 * History Reports Admin Dashboard
 * 
 * /admin/history-reports
 * 
 * Блоки:
 * - Total purchased reports
 * - Total cached reuses  
 * - Cost total / cost saved
 * - Reports → leads %
 * - Reports → deals %
 * - ROI by manager
 * - Abuse flags
 * - Unlock approval queue
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  FileText, 
  CurrencyCircleDollar, 
  ChartLine, 
  Warning,
  Check,
  X,
  User,
  Clock,
  Phone,
  ArrowRight,
  TrendUp,
  Database,
  ShieldCheck
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Stats Card
const StatCard = ({ icon: Icon, title, value, subtitle, color = 'zinc', trend }) => (
  <div className="bg-white rounded-2xl border border-zinc-200 p-6 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between">
      <div className={`p-3 rounded-xl bg-${color}-100`}>
        <Icon size={24} className={`text-${color}-600`} weight="fill" />
      </div>
      {trend && (
        <span className={`text-sm font-medium ${trend > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <div className="mt-4">
      <h3 className="text-3xl font-bold text-zinc-900">{value}</h3>
      <p className="text-sm text-zinc-500 mt-1">{title}</p>
      {subtitle && <p className="text-xs text-zinc-400 mt-1">{subtitle}</p>}
    </div>
  </div>
);

// Approval Queue Item
const ApprovalItem = ({ report, onApprove, onDeny, loading }) => (
  <div className="bg-white rounded-xl border border-zinc-200 p-4 hover:border-zinc-300 transition-colors">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-sm font-semibold text-zinc-900">
            {report.vin}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium
            ${report.callVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {report.callVerified ? 'Дзвінок підтверджено' : 'Очікує дзвінка'}
          </span>
        </div>
        
        <div className="flex items-center gap-4 text-sm text-zinc-500">
          <span className="flex items-center gap-1">
            <User size={14} />
            {report.customerName || 'Клієнт'}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={14} />
            {new Date(report.createdAt).toLocaleDateString('uk')}
          </span>
          {report.callDuration && (
            <span className="flex items-center gap-1">
              <Phone size={14} />
              {Math.floor(report.callDuration / 60)}:{String(report.callDuration % 60).padStart(2, '0')}
            </span>
          )}
        </div>

        {report.leadIntent && (
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
              ${report.leadIntent === 'hot' ? 'bg-red-100 text-red-700' : 
                report.leadIntent === 'warm' ? 'bg-amber-100 text-amber-700' : 
                'bg-blue-100 text-blue-700'}`}>
              {report.leadIntent.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDeny(report.id)}
          disabled={loading}
          className="p-2 rounded-lg border border-zinc-200 hover:bg-red-50 hover:border-red-200 
                     hover:text-red-600 transition-colors disabled:opacity-50"
          data-testid={`deny-report-${report.id}`}
        >
          <X size={20} />
        </button>
        <button
          onClick={() => onApprove(report.id)}
          disabled={loading || !report.callVerified}
          className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`approve-report-${report.id}`}
        >
          <Check size={20} />
        </button>
      </div>
    </div>
  </div>
);

// Manager ROI Card
const ManagerROICard = ({ manager }) => (
  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center">
        <User size={20} className="text-zinc-600" />
      </div>
      <div>
        <p className="font-medium text-zinc-900">{manager.name || manager._id}</p>
        <p className="text-sm text-zinc-500">
          {manager.count} звітів · ${manager.cost} витрачено
        </p>
      </div>
    </div>
    <div className="text-right">
      <p className={`text-lg font-bold ${manager.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {manager.roi >= 0 ? '+' : ''}{manager.roi}%
      </p>
      <p className="text-xs text-zinc-500">ROI</p>
    </div>
  </div>
);

// Abuse Alert Card
const AbuseAlert = ({ alert }) => (
  <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
    <Warning size={24} className="text-red-600 flex-shrink-0" />
    <div>
      <p className="font-medium text-red-900">{alert.managerId}</p>
      <p className="text-sm text-red-700">
        {alert.reportsCount} звітів / {alert.dealsFromReports} угод = {(alert.conversionRate * 100).toFixed(1)}% конверсія
      </p>
      <p className="text-xs text-red-600 mt-1">
        Витрачено: ${alert.totalCost} · Прапор: {alert.flag}
      </p>
    </div>
  </div>
);

export default function HistoryReportsAdmin() {
  const { t } = useLang();
  const [analytics, setAnalytics] = useState(null);
  const [pendingReports, setPendingReports] = useState([]);
  const [abuseAlerts, setAbuseAlerts] = useState([]);
  const [managerStats, setManagerStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [analyticsRes, pendingRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/history-reports/analytics`),
        axios.get(`${API_URL}/api/admin/history-reports/pending`),
      ]);

      setAnalytics(analyticsRes.data);
      setPendingReports(pendingRes.data);
      
      // Extract manager stats with ROI calculation
      if (analyticsRes.data.byManager) {
        const stats = analyticsRes.data.byManager.map(m => ({
          ...m,
          name: m._id,
          roi: m.cost > 0 ? Math.round(((m.profit || 0) - m.cost) / m.cost * 100) : 0,
        }));
        setManagerStats(stats);
      }

      // Check for abuse
      const abuseChecks = [];
      for (const manager of analyticsRes.data.byManager || []) {
        try {
          const abuseRes = await axios.get(`${API_URL}/api/admin/history-reports/abuse-check/${manager._id}`);
          if (abuseRes.data.isAbusive) {
            abuseChecks.push(abuseRes.data);
          }
        } catch (e) {
          // Ignore errors
        }
      }
      setAbuseAlerts(abuseChecks);
    } catch (err) {
      console.error('Failed to load history reports data:', err);
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (reportId) => {
    setActionLoading(true);
    try {
      await axios.put(`${API_URL}/api/admin/history-reports/approve/${reportId}`);
      toast.success('Звіт підтверджено та куплено');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Помилка підтвердження');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeny = async (reportId) => {
    setActionLoading(true);
    try {
      await axios.put(`${API_URL}/api/admin/history-reports/deny/${reportId}`, {
        reason: 'Відхилено адміністратором'
      });
      toast.success('Звіт відхилено');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Помилка відхилення');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="history-reports-admin">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t('historyReports')}</h1>
          <p className="text-zinc-500">{t('analytics')}</p>
        </div>
        <button
          onClick={loadData}
          className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors text-sm font-medium"
        >
          {t('refresh')}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          title="Всього звітів"
          value={analytics?.totalReports || 0}
          subtitle={`За ${analytics?.periodDays || 30} днів`}
          color="zinc"
        />
        <StatCard
          icon={Database}
          title="З кешу"
          value={analytics?.cachedReports || 0}
          subtitle={`${((analytics?.cacheHitRate || 0) * 100).toFixed(0)}% cache hit rate`}
          color="blue"
        />
        <StatCard
          icon={CurrencyCircleDollar}
          title="Витрачено"
          value={`$${analytics?.totalCost || 0}`}
          subtitle={`Зекономлено: $${analytics?.costSaved || 0}`}
          color="emerald"
        />
        <StatCard
          icon={ChartLine}
          title="Approval Rate"
          value={`${((analytics?.approvalRate || 0) * 100).toFixed(0)}%`}
          subtitle="Підтверджених звітів"
          color="violet"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Approval Queue */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-zinc-900">
              Черга на підтвердження
            </h2>
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              {pendingReports.length} очікує
            </span>
          </div>

          {pendingReports.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <ShieldCheck size={48} className="mx-auto mb-3 text-zinc-300" />
              <p>Немає звітів, що очікують підтвердження</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingReports.map(report => (
                <ApprovalItem
                  key={report.id}
                  report={report}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                  loading={actionLoading}
                />
              ))}
            </div>
          )}
        </div>

        {/* Manager ROI & Abuse */}
        <div className="space-y-6">
          {/* Abuse Alerts */}
          {abuseAlerts.length > 0 && (
            <div className="bg-white rounded-2xl border border-red-200 p-6">
              <h2 className="text-lg font-semibold text-red-900 mb-4 flex items-center gap-2">
                <Warning size={20} />
                Підозріла активність
              </h2>
              <div className="space-y-3">
                {abuseAlerts.map((alert, idx) => (
                  <AbuseAlert key={idx} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {/* Manager ROI */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-6">
            <h2 className="text-lg font-semibold text-zinc-900 mb-4 flex items-center gap-2">
              <TrendUp size={20} />
              ROI по менеджерах
            </h2>
            {managerStats.length === 0 ? (
              <p className="text-zinc-500 text-center py-8">Немає даних</p>
            ) : (
              <div className="space-y-3">
                {managerStats.slice(0, 5).map((manager, idx) => (
                  <ManagerROICard key={idx} manager={manager} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
