import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { motion } from 'framer-motion';
import { 
  UsersThree, 
  Warning,
  Wallet, 
  Clock,
  Phone,
  FileText,
  ChartPie,
  Heartbeat,
  Lightning,
  UserCircle,
  ClipboardText,
  CurrencyCircleDollar,
  ShieldCheck,
  ArrowsClockwise,
  Pulse,
  Users,
  CheckCircle,
  XCircle,
  HourglassMedium,
  ChatCircleDots,
  EnvelopeSimple,
  PhoneCall,
  UserPlus,
  TrendUp,
  Briefcase
} from '@phosphor-icons/react';

const Dashboard = () => {
  const { t, lang } = useLang();
  const [masterData, setMasterData] = useState(null);
  const [period, setPeriod] = useState('day');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMasterDashboard();
  }, [period]);

  const fetchMasterDashboard = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/dashboard/master?period=${period}`);
      setMasterData(response.data);
    } catch (err) {
      console.error('Master Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !masterData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const { sla, workload, leads, callbacks, deposits, documents, routing, system } = masterData;

  const periodLabels = {
    day: t('today'),
    week: t('week'),
    month: t('month'),
  };

  return (
    <motion.div 
      data-testid="master-dashboard-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            {t('controlPanel')}
          </h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1">
            {t('updated')}: {new Date(masterData.generatedAt).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US')}
          </p>
        </div>
        
        {/* Period Selector */}
        <div className="period-tabs overflow-x-auto flex-shrink-0" data-testid="period-selector">
          {['day', 'week', 'month'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`period-tab whitespace-nowrap ${period === p ? 'active' : ''}`}
              data-testid={`period-${p}`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 lg:gap-5 mb-6 lg:mb-8" data-testid="kpi-summary-row">
        <KpiCard 
          icon={UserPlus} 
          label={t('newLeads')} 
          value={leads.newCount} 
          color="#4F46E5"
        />
        <KpiCard 
          icon={HourglassMedium} 
          label={t('overdue')} 
          value={sla.overdueLeads} 
          color="#DC2626"
          alert={sla.overdueLeads > 0}
        />
        <KpiCard 
          icon={CurrencyCircleDollar} 
          label={t('pendingDeposits')} 
          value={deposits.pendingDeposits} 
          color="#7C3AED"
        />
        <KpiCard 
          icon={ShieldCheck} 
          label={t('forVerification')} 
          value={documents.pendingVerification} 
          color="#D97706"
          alert={documents.pendingVerification > 5}
        />
        <KpiCard 
          icon={UsersThree} 
          label={t('overloaded')} 
          value={workload.overloadedManagers} 
          color={workload.overloadedManagers > 0 ? "#DC2626" : "#059669"}
          alert={workload.overloadedManagers > 0}
        />
        <KpiCard 
          icon={Lightning} 
          label={t('failedJobs')} 
          value={system.failedJobs} 
          color={system.failedJobs > 0 ? "#DC2626" : "#059669"}
        />
      </div>

      {/* Main Grid - Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 mb-4 lg:mb-5">
        {/* SLA Control */}
        <div className="section-card" data-testid="sla-control">
          <div className="section-title-clean">
            <Clock size={22} weight="duotone" className="text-[#DC2626]" />
            <span>{t('slaControl')}</span>
          </div>
          <div>
            <MetricRow icon={HourglassMedium} label={t('overdueLeads')} value={sla.overdueLeads} alert={sla.overdueLeads > 0} />
            <MetricRow icon={ClipboardText} label={t('overdueTasks')} value={sla.overdueTasks} alert={sla.overdueTasks > 0} />
            <MetricRow icon={PhoneCall} label={t('overdueCallbacks')} value={sla.overdueCallbacks} alert={sla.overdueCallbacks > 0} />
            <MetricRow icon={TrendUp} label={t('avgFirstResponse')} value={`${sla.avgFirstResponseMinutes} ${lang === 'uk' ? 'хв' : 'min'}`} alert={sla.avgFirstResponseMinutes > 30} />
            <MetricRow icon={ChartPie} label={t('missedSlaRate')} value={`${sla.missedSlaRate}%`} alert={sla.missedSlaRate > 15} />
          </div>
        </div>

        {/* Lead Flow */}
        <div className="section-card" data-testid="lead-flow">
          <div className="section-title-clean">
            <Users size={22} weight="duotone" className="text-[#4F46E5]" />
            <span>{t('leadFlow')}</span>
          </div>
          <div>
            <MetricRow icon={UserPlus} label={t('new')} value={leads.newCount} color="#4F46E5" />
            <MetricRow icon={ArrowsClockwise} label={t('inProgress')} value={leads.inProgressCount} color="#D97706" />
            <MetricRow icon={CheckCircle} label={t('converted')} value={leads.convertedCount} color="#059669" />
            <MetricRow icon={XCircle} label={t('lost')} value={leads.lostCount} color="#DC2626" />
            <MetricRow icon={UserCircle} label={t('unassigned')} value={leads.unassignedCount} alert={leads.unassignedCount > 0} />
          </div>
        </div>

        {/* Callback Control */}
        <div className="section-card" data-testid="callback-control">
          <div className="section-title-clean">
            <Phone size={22} weight="duotone" className="text-[#7C3AED]" />
            <span>{t('callbackControl')}</span>
          </div>
          <div>
            <MetricRow icon={PhoneCall} label={t('missedCalls')} value={callbacks.missedCalls} alert={callbacks.missedCalls > 0} />
            <MetricRow icon={Phone} label={t('noAnswer')} value={callbacks.noAnswerLeads} alert={callbacks.noAnswerLeads > 3} />
            <MetricRow icon={Clock} label={t('followUpsDue')} value={callbacks.followUpsDue} alert={callbacks.followUpsDue > 0} />
            <MetricRow icon={ChatCircleDots} label={t('callbackScheduled')} value={callbacks.callbacksScheduled} />
            <MetricRow icon={EnvelopeSimple} label={t('smsSent')} value={callbacks.smsTriggered} color="#4F46E5" />
          </div>
        </div>
      </div>

      {/* Main Grid - Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
        {/* Workload Heatmap */}
        <div className="section-card" data-testid="workload-heatmap">
          <div className="section-title-clean">
            <Briefcase size={22} weight="duotone" className="text-[#D97706]" />
            <span>{t('workload')}</span>
            <span className="text-[#71717A] font-normal text-sm ml-1">({workload.totalManagers})</span>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {workload.managers.map((manager) => (
              <div 
                key={manager.managerId}
                className={`flex items-center justify-between p-3 rounded-xl ${getWorkloadBg(manager.status)}`}
              >
                <div className="flex items-center gap-3">
                  <StatusDot status={manager.status} />
                  <span className="text-sm font-medium text-[#18181B] truncate max-w-[100px]">{manager.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#71717A]">
                  <span>{manager.activeLeads} {lang === 'uk' ? 'лідів' : 'leads'}</span>
                  <span>{manager.openTasks} {lang === 'uk' ? 'задач' : 'tasks'}</span>
                  <span className="font-semibold text-[#18181B] bg-white px-2 py-1 rounded-lg">
                    {manager.score}
                  </span>
                </div>
              </div>
            ))}
            {workload.managers.length === 0 && (
              <p className="text-sm text-[#71717A] text-center py-4">{t('noActiveManagers')}</p>
            )}
          </div>
        </div>

        {/* Deposits & Documents */}
        <div className="section-card" data-testid="deposits-docs">
          <div className="section-title-clean">
            <Wallet size={22} weight="duotone" className="text-[#059669]" />
            <span>{t('depositsAndDocs')}</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-3">{t('deposits')}</p>
              <div className="space-y-1">
                <MetricRowSimple label={t('pending')} value={deposits.pendingDeposits} />
                <MetricRowSimple label={t('withoutProof')} value={deposits.depositsWithoutProof} alert={deposits.depositsWithoutProof > 0} />
                <MetricRowSimple label={t('verified')} value={deposits.verifiedToday} color="#059669" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-3">{t('documents')}</p>
              <div className="space-y-1">
                <MetricRowSimple label={t('forVerification')} value={documents.pendingVerification} alert={documents.pendingVerification > 3} />
                <MetricRowSimple label={t('rejected')} value={documents.rejectedCount} color="#DC2626" />
                <MetricRowSimple label={t('uploaded')} value={documents.uploadedToday} color="#4F46E5" />
              </div>
            </div>
          </div>
        </div>

        {/* Routing & System Health */}
        <div className="section-card" data-testid="routing-health">
          <div className="section-title-clean">
            <Pulse size={22} weight="duotone" className="text-[#059669]" />
            <span>{t('routingAndSystem')}</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-3">{t('routing')}</p>
              <div className="space-y-1">
                <MetricRowSimple label={t('fallback')} value={routing.fallbackAssignments} alert={routing.fallbackAssignments > 5} />
                <MetricRowSimple label={t('reassignRate')} value={`${routing.reassignmentRate}%`} />
                <MetricRowSimple label={t('unassigned')} value={routing.unassignedLeads} alert={routing.unassignedLeads > 0} />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-3">{t('system')}</p>
              <div className="space-y-1">
                <div className="metric-row">
                  <span className="metric-label">{t('status')}</span>
                  <SystemStatusBadge status={system.systemStatus} />
                </div>
                <MetricRowSimple label={t('queue')} value={system.queueBacklog} />
                <MetricRowSimple label={t('errors')} value={system.failedJobs} alert={system.failedJobs > 0} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Helper Components - Clean style without background blocks

const KpiCard = ({ icon: Icon, label, value, color, alert }) => (
  <div className={`kpi-card p-4 sm:p-5 ${alert ? 'border-[#DC2626]' : ''}`} data-testid={`kpi-${label.toLowerCase().replace(/\s/g, '-')}`}>
    <div className="mb-3 sm:mb-4">
      <Icon size={24} className="sm:hidden" weight="duotone" style={{ color }} />
      <Icon size={28} className="hidden sm:block" weight="duotone" style={{ color }} />
    </div>
    <div className={`text-xl sm:text-2xl lg:text-[2.25rem] font-bold tracking-tight leading-none ${alert ? 'text-[#DC2626]' : 'text-[#18181B]'}`} style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{value}</div>
    <div className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-[#71717A] mt-1.5 sm:mt-2">{label}</div>
  </div>
);

const MetricRow = ({ icon: Icon, label, value, color, alert }) => (
  <div className="metric-row">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={16} weight="duotone" className="text-[#A1A1AA]" />}
      <span className="metric-label">{label}</span>
    </div>
    <span className={`metric-value ${alert ? 'alert' : ''}`} style={{ color: !alert && color ? color : undefined }}>
      {value}
    </span>
  </div>
);

const MetricRowSimple = ({ label, value, color, alert }) => (
  <div className="metric-row">
    <span className="metric-label">{label}</span>
    <span className={`metric-value ${alert ? 'alert' : ''}`} style={{ color: !alert && color ? color : undefined }}>
      {value}
    </span>
  </div>
);

const StatusDot = ({ status }) => {
  const colors = {
    ok: '#059669',
    busy: '#D97706',
    overloaded: '#DC2626',
    idle: '#71717A',
  };
  return (
    <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors[status] || '#71717A' }} />
  );
};

const getWorkloadBg = (status) => {
  const bgs = {
    ok: 'bg-[#D1FAE5]',
    busy: 'bg-[#FEF3C7]',
    overloaded: 'bg-[#FEE2E2]',
    idle: 'bg-[#F4F4F5]',
  };
  return bgs[status] || 'bg-[#F4F4F5]';
};

const SystemStatusBadge = ({ status }) => {
  const configs = {
    healthy: { bg: '#D1FAE5', color: '#059669', label: 'HEALTHY' },
    warning: { bg: '#FEF3C7', color: '#D97706', label: 'WARNING' },
    critical: { bg: '#FEE2E2', color: '#DC2626', label: 'CRITICAL' },
  };
  const config = configs[status] || configs.healthy;
  return (
    <span className="badge" style={{ background: config.bg, color: config.color }}>
      {config.label}
    </span>
  );
};

export default Dashboard;
