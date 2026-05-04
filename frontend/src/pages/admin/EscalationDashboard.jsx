import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../i18n';
import {
  AlertTriangle,
  Clock,
  User,
  Users,
  Crown,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronRight,
  Zap,
  Shield,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// Escalation level colors and icons
const LEVEL_CONFIG = {
  manager_pending: {
    color: 'bg-amber-500',
    textColor: 'text-amber-600',
    bgLight: 'bg-amber-50',
    icon: User,
    label: { uk: 'Менеджер', en: 'Manager', bg: 'Мениджър' },
  },
  teamlead_pending: {
    color: 'bg-orange-500',
    textColor: 'text-orange-600',
    bgLight: 'bg-orange-50',
    icon: Users,
    label: { uk: 'Team Lead', en: 'Team Lead', bg: 'Тийм Лийд' },
  },
  owner_pending: {
    color: 'bg-red-500',
    textColor: 'text-red-600',
    bgLight: 'bg-red-50',
    icon: Crown,
    label: { uk: 'Owner', en: 'Owner', bg: 'Собственик' },
  },
  resolved: {
    color: 'bg-green-500',
    textColor: 'text-green-600',
    bgLight: 'bg-green-50',
    icon: CheckCircle,
    label: { uk: 'Вирішено', en: 'Resolved', bg: 'Решено' },
  },
};

// Event type labels
const EVENT_LABELS = {
  'lead.hot_not_contacted': { uk: 'HOT лід без контакту', en: 'HOT lead not contacted', bg: 'HOT лид без контакт' },
  'invoice.overdue': { uk: 'Прострочений рахунок', en: 'Overdue invoice', bg: 'Просрочена фактура' },
  'shipment.stalled': { uk: 'Доставка зупинена', en: 'Shipment stalled', bg: 'Спряна доставка' },
  'shipment.tracking_missing': { uk: 'Немає трекінгу', en: 'No tracking', bg: 'Няма проследяване' },
  'payment.failed': { uk: 'Помилка оплати', en: 'Payment failed', bg: 'Неуспешно плащане' },
  'staff.session_suspicious': { uk: 'Підозріла сесія', en: 'Suspicious session', bg: 'Подозрителна сесия' },
};

export default function EscalationDashboard() {
  const { lang } = useLang();
  const [escalations, setEscalations] = useState([]);
  const [stats, setStats] = useState({
    managerPending: 0,
    teamLeadPending: 0,
    ownerPending: 0,
    resolvedToday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedEscalation, setSelectedEscalation] = useState(null);
  const [resolving, setResolving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      const [escRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/escalations`, { headers }),
        fetch(`${API_URL}/api/escalations/stats`, { headers }),
      ]);

      const escData = await escRes.json();
      const statsData = await statsRes.json();

      setEscalations(Array.isArray(escData) ? escData : escData.escalations || []);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to fetch escalations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleResolve = async (escalation) => {
    setResolving(true);
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/escalations/${escalation._id}/resolve`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventType: escalation.eventType,
          entityId: escalation.entityId,
          reason: 'resolved_from_dashboard',
        }),
      });
      await fetchData();
      setSelectedEscalation(null);
    } catch (error) {
      console.error('Failed to resolve:', error);
    } finally {
      setResolving(false);
    }
  };

  const triggerManualProcess = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/escalations/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchData();
    } catch (error) {
      console.error('Failed to trigger processing:', error);
    }
  };

  const getTimeRemaining = (deadline) => {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diff = deadlineDate - now;
    
    if (diff <= 0) return { text: 'ПРОСТРОЧЕНО', isOverdue: true };
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return { text: `${hours}год ${minutes % 60}хв`, isOverdue: false };
    }
    return { text: `${minutes}хв`, isOverdue: false };
  };

  const getEventLabel = (eventType) => {
    return EVENT_LABELS[eventType]?.[lang] || eventType;
  };

  const totalActive = stats.managerPending + stats.teamLeadPending + stats.ownerPending;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="escalation-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <Zap className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {lang === 'uk' ? 'Ескалації' : lang === 'bg' ? 'Ескалации' : 'Escalations'}
            </h1>
            <p className="text-sm text-gray-500">
              {lang === 'uk' ? 'Контроль реакції команди' : lang === 'bg' ? 'Контрол на реакцията' : 'Team reaction control'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={triggerManualProcess}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
            {lang === 'uk' ? 'Оновити' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatsCard
          title={lang === 'uk' ? 'Менеджер' : 'Manager'}
          count={stats.managerPending}
          color="amber"
          icon={User}
        />
        <StatsCard
          title="Team Lead"
          count={stats.teamLeadPending}
          color="orange"
          icon={Users}
        />
        <StatsCard
          title="Owner"
          count={stats.ownerPending}
          color="red"
          icon={Crown}
        />
        <StatsCard
          title={lang === 'uk' ? 'Вирішено сьогодні' : 'Resolved Today'}
          count={stats.resolvedToday}
          color="green"
          icon={CheckCircle}
        />
      </div>

      {/* Active Escalations List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            {lang === 'uk' ? 'Активні ескалації' : 'Active Escalations'}
            {totalActive > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-bold bg-red-100 text-red-600 rounded-full">
                {totalActive}
              </span>
            )}
          </h2>
        </div>

        {escalations.length === 0 ? (
          <div className="p-8 text-center">
            <Shield className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-gray-600">
              {lang === 'uk' ? 'Немає активних ескалацій' : 'No active escalations'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {lang === 'uk' ? 'Команда працює вчасно' : 'Team is responding on time'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {escalations.map((esc) => {
              const levelConfig = LEVEL_CONFIG[esc.status] || LEVEL_CONFIG.manager_pending;
              const LevelIcon = levelConfig.icon;
              const deadline = esc.status === 'manager_pending' 
                ? esc.managerDeadlineAt 
                : esc.teamLeadDeadlineAt;
              const timeInfo = getTimeRemaining(deadline);

              return (
                <div
                  key={esc._id}
                  className={`p-4 hover:bg-gray-50 cursor-pointer transition ${
                    selectedEscalation?._id === esc._id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => setSelectedEscalation(esc)}
                  data-testid={`escalation-item-${esc._id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* Level indicator */}
                      <div className={`p-2 rounded-lg ${levelConfig.bgLight}`}>
                        <LevelIcon className={`w-5 h-5 ${levelConfig.textColor}`} />
                      </div>

                      {/* Event info */}
                      <div>
                        <div className="font-medium text-gray-900">
                          {getEventLabel(esc.eventType)}
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-2">
                          <span>{esc.entityType}: {esc.entityId?.slice(0, 8)}...</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${levelConfig.bgLight} ${levelConfig.textColor}`}>
                            {levelConfig.label[lang] || levelConfig.label.en}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Time remaining */}
                    <div className="flex items-center gap-4">
                      <div className={`flex items-center gap-1 ${timeInfo.isOverdue ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">{timeInfo.text}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEscalation && (
        <EscalationModal
          escalation={selectedEscalation}
          lang={lang}
          onClose={() => setSelectedEscalation(null)}
          onResolve={() => handleResolve(selectedEscalation)}
          resolving={resolving}
          getEventLabel={getEventLabel}
          getTimeRemaining={getTimeRemaining}
        />
      )}
    </div>
  );
}

function StatsCard({ title, count, color, icon: Icon }) {
  const colorClasses = {
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
    orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
    red: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
    green: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
  };

  const c = colorClasses[color];

  return (
    <div className={`p-4 rounded-xl border ${c.border} ${c.bg}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className={`text-3xl font-bold ${c.text}`}>{count}</p>
        </div>
        <div className={`p-3 rounded-lg bg-white/50`}>
          <Icon className={`w-6 h-6 ${c.text}`} />
        </div>
      </div>
    </div>
  );
}

function EscalationModal({ escalation, lang, onClose, onResolve, resolving, getEventLabel, getTimeRemaining }) {
  const levelConfig = LEVEL_CONFIG[escalation.status] || LEVEL_CONFIG.manager_pending;
  const deadline = escalation.status === 'manager_pending' 
    ? escalation.managerDeadlineAt 
    : escalation.teamLeadDeadlineAt;
  const timeInfo = getTimeRemaining(deadline);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 ${levelConfig.bgLight} border-b`}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className={`w-5 h-5 ${levelConfig.textColor}`} />
              {getEventLabel(escalation.eventType)}
            </h3>
            <button onClick={onClose} className="p-1 hover:bg-white/50 rounded">
              <XCircle className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">
                {lang === 'uk' ? 'Рівень' : 'Level'}
              </p>
              <p className={`font-medium ${levelConfig.textColor}`}>
                {levelConfig.label[lang] || levelConfig.label.en}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">
                {lang === 'uk' ? 'Час' : 'Time'}
              </p>
              <p className={`font-medium ${timeInfo.isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                {timeInfo.text}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">
                {lang === 'uk' ? 'Тип сутності' : 'Entity Type'}
              </p>
              <p className="font-medium text-gray-900">{escalation.entityType}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">ID</p>
              <p className="font-medium text-gray-900 font-mono text-sm">
                {escalation.entityId}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500 mb-2">
              {lang === 'uk' ? 'Таймлайн' : 'Timeline'}
            </p>
            <div className="space-y-2">
              <TimelineItem
                label={lang === 'uk' ? 'Створено' : 'Created'}
                time={new Date(escalation.createdAt).toLocaleString()}
                done
              />
              <TimelineItem
                label={lang === 'uk' ? 'Дедлайн менеджера' : 'Manager deadline'}
                time={new Date(escalation.managerDeadlineAt).toLocaleString()}
                done={escalation.escalationLevel >= 1}
              />
              {escalation.teamLeadDeadlineAt && (
                <TimelineItem
                  label={lang === 'uk' ? 'Дедлайн Team Lead' : 'Team Lead deadline'}
                  time={new Date(escalation.teamLeadDeadlineAt).toLocaleString()}
                  done={escalation.escalationLevel >= 2}
                />
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 bg-gray-50 border-t flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {lang === 'uk' ? 'Закрити' : 'Close'}
          </button>
          <button
            onClick={onResolve}
            disabled={resolving}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {resolving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {lang === 'uk' ? 'Вирішити' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ label, time, done }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full ${done ? 'bg-green-500' : 'bg-gray-300'}`} />
      <div className="flex-1 flex justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm text-gray-400">{time}</span>
      </div>
    </div>
  );
}
