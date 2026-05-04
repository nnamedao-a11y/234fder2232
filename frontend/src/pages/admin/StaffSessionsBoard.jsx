/**
 * Staff Sessions Board
 * 
 * /admin/staff-sessions
 * 
 * - Хто зараз онлайн
 * - Хто коли зайшов
 * - З якого IP/device
 * - Тривалість сесії
 * - Підозрілі входи
 * - Force logout
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  User, 
  SignOut, 
  ShieldWarning, 
  Globe,
  DeviceMobile,
  Clock,
  CheckCircle,
  XCircle,
  Warning,
  ArrowClockwise,
  Eye,
  LockKey
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Session Card
const SessionCard = ({ session, onForceLogout, loading }) => {
  const isActive = session.status === 'active';
  const startTime = new Date(session.startedAt);
  const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt) : startTime;
  const duration = Math.round((lastSeen - startTime) / 1000 / 60);

  return (
    <div className={`bg-white rounded-xl border p-4 transition-all hover:shadow-md
      ${session.isSuspicious ? 'border-red-200 bg-red-50/30' : 
        session.isNewDevice ? 'border-amber-200' : 'border-zinc-200'}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold
            ${session.role === 'team_lead' ? 'bg-blue-600' : 'bg-zinc-600'}`}>
            {session.email?.charAt(0).toUpperCase() || 'U'}
          </div>

          <div>
            {/* User Info */}
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-zinc-900">{session.email}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase
                ${session.role === 'team_lead' ? 'bg-blue-100 text-blue-700' : 
                  'bg-zinc-100 text-zinc-600'}`}>
                {session.role}
              </span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500">
              <span className="flex items-center gap-1">
                {isActive ? (
                  <CheckCircle size={14} className="text-emerald-500" weight="fill" />
                ) : (
                  <XCircle size={14} className="text-zinc-400" weight="fill" />
                )}
                {isActive ? 'Онлайн' : session.status}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {duration} хв
              </span>
            </div>

            {/* Device & IP */}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-zinc-400">
              {session.ipAddress && (
                <span className="flex items-center gap-1">
                  <Globe size={12} />
                  {session.ipAddress}
                </span>
              )}
              {session.deviceId && (
                <span className="flex items-center gap-1">
                  <DeviceMobile size={12} />
                  {session.deviceId.slice(0, 8)}...
                </span>
              )}
            </div>

            {/* Flags */}
            <div className="flex items-center gap-2 mt-2">
              {session.twoFactorVerified && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs">
                  <LockKey size={12} />
                  2FA
                </span>
              )}
              {session.isNewDevice && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">
                  <DeviceMobile size={12} />
                  Новий пристрій
                </span>
              )}
              {session.isUnusualLocation && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-xs">
                  <Globe size={12} />
                  Незвична IP
                </span>
              )}
              {session.isSuspicious && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs">
                  <ShieldWarning size={12} />
                  Підозріло
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {isActive && (
          <button
            onClick={() => onForceLogout(session.id, session.email)}
            disabled={loading}
            className="p-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-red-50 
                       hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
            data-testid={`force-logout-${session.id}`}
            title="Force Logout"
          >
            <SignOut size={20} />
          </button>
        )}
      </div>

      {/* Suspicious Reason */}
      {session.suspiciousReason && (
        <div className="mt-3 p-2 rounded bg-red-50 border border-red-100 text-sm text-red-700">
          <Warning size={14} className="inline mr-1" />
          {session.suspiciousReason}
        </div>
      )}

      {/* Session Times */}
      <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-400">
        <span>Вхід: {startTime.toLocaleString('uk')}</span>
        <span>Остання активність: {lastSeen.toLocaleString('uk')}</span>
      </div>
    </div>
  );
};

// Analytics Card
const AnalyticsCard = ({ title, value, subtitle, icon: Icon, color = 'zinc' }) => (
  <div className="bg-white rounded-xl border border-zinc-200 p-4">
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-${color}-100`}>
        <Icon size={20} className={`text-${color}-600`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-zinc-900">{value}</p>
        <p className="text-sm text-zinc-500">{title}</p>
        {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
      </div>
    </div>
  </div>
);

export default function StaffSessionsBoard() {
  const { t } = useLang();
  const [sessions, setSessions] = useState([]);
  const [suspiciousSessions, setSuspiciousSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [filter, setFilter] = useState('active'); // active, suspicious, all

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [sessionsRes, suspiciousRes, analyticsRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/staff-sessions/active`),
        axios.get(`${API_URL}/api/admin/staff-sessions/suspicious`),
        axios.get(`${API_URL}/api/admin/staff-sessions/analytics`),
      ]);

      setSessions(sessionsRes.data);
      setSuspiciousSessions(suspiciousRes.data);
      setAnalytics(analyticsRes.data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      // Don't show error on auto-refresh failures
      if (!sessions.length) {
        toast.error('Помилка завантаження сесій');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForceLogout = async (sessionId, email) => {
    if (!confirm(`Примусово завершити сесію для ${email}?`)) return;
    
    setActionLoading(true);
    try {
      await axios.post(`${API_URL}/api/admin/staff-sessions/force-logout/${sessionId}`, {
        reason: 'Примусове завершення адміністратором'
      });
      toast.success(`Сесію ${email} завершено`);
      loadData();
    } catch (err) {
      toast.error('Помилка завершення сесії');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredSessions = filter === 'suspicious' 
    ? suspiciousSessions 
    : filter === 'active' 
      ? sessions.filter(s => s.status === 'active')
      : sessions;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="staff-sessions-board">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t('staffSessions')}</h1>
          <p className="text-zinc-500">{t('teamLoadControl')}</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 
                     transition-colors text-sm font-medium disabled:opacity-50"
        >
          <ArrowClockwise size={16} className={loading ? 'animate-spin' : ''} />
          {t('refresh')}
        </button>
      </div>

      {/* Analytics */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <AnalyticsCard
            icon={User}
            title="Активних сесій"
            value={analytics.activeSessions}
            color="emerald"
          />
          <AnalyticsCard
            icon={ShieldWarning}
            title="Підозрілих"
            value={analytics.suspiciousSessions}
            color="red"
          />
          <AnalyticsCard
            icon={SignOut}
            title="Примусових виходів"
            value={analytics.forcedLogouts}
            subtitle={`За ${analytics.periodDays} днів`}
            color="amber"
          />
          <AnalyticsCard
            icon={Clock}
            title="Середня тривалість"
            value={`${analytics.avgDurationMinutes} хв`}
            color="blue"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {[
          { key: 'active', label: 'Активні', count: sessions.filter(s => s.status === 'active').length },
          { key: 'suspicious', label: 'Підозрілі', count: suspiciousSessions.length },
          { key: 'all', label: 'Всі', count: sessions.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${filter === key 
                ? 'bg-zinc-900 text-white' 
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
            data-testid={`filter-${key}`}
          >
            {label}
            <span className="ml-2 px-1.5 py-0.5 rounded bg-white/20 text-xs">
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Sessions List */}
      {filteredSessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center">
          <Eye size={48} className="mx-auto mb-4 text-zinc-300" />
          <p className="text-zinc-500">Немає сесій для відображення</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredSessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              onForceLogout={handleForceLogout}
              loading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
