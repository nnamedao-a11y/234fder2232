/**
 * Owner Payment Analytics Dashboard
 * 
 * /admin/owner-dashboard
 * 
 * Complete payment analytics for owner role
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  CurrencyDollar,
  TrendUp,
  TrendDown,
  ChartLineUp,
  ChartPieSlice,
  Users,
  Invoice,
  Truck,
  Warning,
  ArrowsClockwise,
  CaretDown,
  Check,
  Clock,
  ShieldWarning,
  User,
  Handshake,
  Package
} from '@phosphor-icons/react';

// KPI Card Component
const KPICard = ({ title, value, subtitle, icon: Icon, iconColor, trend, trendLabel }) => (
  <motion.div 
    className="bg-white rounded-2xl border border-[#E4E4E7] p-6 hover:shadow-lg transition-all"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    data-testid={`kpi-${title.toLowerCase().replace(/\s/g, '-')}`}
  >
    <div className="flex items-start justify-between">
      <div className={`p-3 rounded-xl bg-${iconColor}-50`}>
        <Icon size={24} weight="duotone" className={`text-${iconColor}-600`} />
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-sm font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {trend >= 0 ? <TrendUp size={16} /> : <TrendDown size={16} />}
          {Math.abs(trend)}%
        </div>
      )}
    </div>
    <div className="mt-4">
      <p className="text-3xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
        {value}
      </p>
      <p className="text-sm text-[#71717A] mt-1">{title}</p>
      {subtitle && <p className="text-xs text-[#A1A1AA] mt-1">{subtitle}</p>}
    </div>
  </motion.div>
);

// Funnel Stage
const FunnelStage = ({ label, value, total, color, icon: Icon }) => {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <div className={`p-2 rounded-lg bg-${color}-100`}>
        <Icon size={18} className={`text-${color}-600`} />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-[#18181B]">{label}</span>
          <span className="text-sm font-bold text-[#18181B]">{value}</span>
        </div>
        <div className="h-2 bg-[#F4F4F5] rounded-full overflow-hidden">
          <div 
            className={`h-full bg-${color}-500 rounded-full transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-[#71717A] w-10">{percentage}%</span>
    </div>
  );
};

// Risk Alert
const RiskAlert = ({ type, count, severity, description }) => {
  const severityConfig = {
    critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: ShieldWarning },
    warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: Warning },
    info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: Clock },
  };
  const config = severityConfig[severity] || severityConfig.info;
  const Icon = config.icon;
  
  return (
    <div className={`${config.bg} ${config.border} border rounded-xl p-4 flex items-center gap-4`}>
      <Icon size={24} weight="duotone" className={config.text} />
      <div className="flex-1">
        <p className={`font-semibold ${config.text}`}>{type}</p>
        <p className="text-sm text-[#71717A]">{description}</p>
      </div>
      <div className={`px-3 py-1 rounded-full ${config.bg} ${config.text} font-bold`}>{count}</div>
    </div>
  );
};

// Team Member Row
const TeamMemberRow = ({ member, rank }) => (
  <div className="flex items-center gap-4 p-4 hover:bg-[#F4F4F5] rounded-xl transition-colors">
    <span className="w-8 h-8 rounded-full bg-[#18181B] text-white flex items-center justify-center text-sm font-bold">
      {rank}
    </span>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-[#18181B] truncate">{member.managerName}</p>
      <p className="text-xs text-[#71717A]">{member.email}</p>
    </div>
    <div className="text-right">
      <p className="font-semibold text-[#18181B]">${member.revenue?.toLocaleString() || 0}</p>
      <p className="text-xs text-[#71717A]">{member.totalDeals} угод</p>
    </div>
    <div className="flex items-center gap-2">
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
        member.paidRate >= 80 ? 'bg-emerald-100 text-emerald-700' :
        member.paidRate >= 50 ? 'bg-amber-100 text-amber-700' :
        'bg-red-100 text-red-700'
      }`}>
        {member.paidRate}% paid
      </span>
      {member.overdueCount > 0 && (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
          {member.overdueCount} overdue
        </span>
      )}
    </div>
  </div>
);

const OwnerPaymentDashboard = () => {
  const { t } = useLang();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/owner-dashboard?days=${period}`);
      setData(res.data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-[#71717A]">
        Немає даних
      </div>
    );
  }

  const { revenue = {}, funnel = {}, shipping = {}, risk = {}, team = [] } = data || {};

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="space-y-8"
      data-testid="owner-payment-dashboard"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Payment Analytics
          </h1>
          <p className="text-sm text-[#71717A] mt-1">Огляд фінансової активності</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="px-4 py-2 bg-white border border-[#E4E4E7] rounded-xl text-sm focus:ring-2 focus:ring-[#18181B]"
            data-testid="period-select"
          >
            <option value={7}>7 днів</option>
            <option value={14}>14 днів</option>
            <option value={30}>30 днів</option>
            <option value={90}>90 днів</option>
          </select>
          <button
            onClick={fetchDashboard}
            className="p-2 hover:bg-[#F4F4F5] rounded-xl transition-colors"
            data-testid="refresh-btn"
          >
            <ArrowsClockwise size={20} className="text-[#71717A]" />
          </button>
        </div>
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Загальний дохід"
          value={`$${(revenue.totalRevenue || 0).toLocaleString()}`}
          icon={CurrencyDollar}
          iconColor="emerald"
          trend={revenue.revenueGrowth}
        />
        <KPICard
          title="Оплачені інвойси"
          value={revenue.totalPaidInvoices || 0}
          subtitle="За період"
          icon={Check}
          iconColor="blue"
        />
        <KPICard
          title="Очікують оплати"
          value={revenue.totalUnpaidInvoices || 0}
          subtitle="Відкриті інвойси"
          icon={Clock}
          iconColor="amber"
        />
        <KPICard
          title="Прострочена сума"
          value={`$${(revenue.overdueAmount || 0).toLocaleString()}`}
          subtitle={`Avg. ${revenue.avgPaymentDelayDays || 0} днів затримки`}
          icon={Warning}
          iconColor="red"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E4E4E7] p-6">
          <h2 className="text-lg font-semibold text-[#18181B] mb-6" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Воронка продажів
          </h2>
          <div className="space-y-4">
            <FunnelStage
              label="Договори створено"
              value={funnel.contractsCreated || 0}
              total={funnel.contractsCreated || 1}
              color="violet"
              icon={Handshake}
            />
            <FunnelStage
              label="Договори підписано"
              value={funnel.contractsSigned || 0}
              total={funnel.contractsCreated || 1}
              color="indigo"
              icon={Check}
            />
            <FunnelStage
              label="Інвойси надіслано"
              value={funnel.invoicesSent || 0}
              total={funnel.contractsCreated || 1}
              color="blue"
              icon={Invoice}
            />
            <FunnelStage
              label="Інвойси оплачено"
              value={funnel.invoicesPaid || 0}
              total={funnel.contractsCreated || 1}
              color="emerald"
              icon={CurrencyDollar}
            />
            <FunnelStage
              label="Доставки розпочато"
              value={funnel.shipmentsStarted || 0}
              total={funnel.contractsCreated || 1}
              color="amber"
              icon={Truck}
            />
            <FunnelStage
              label="Доставлено"
              value={funnel.delivered || 0}
              total={funnel.contractsCreated || 1}
              color="teal"
              icon={Package}
            />
          </div>
        </div>

        {/* Risk Alerts */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
          <h2 className="text-lg font-semibold text-[#18181B] mb-6" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Ризики та сповіщення
          </h2>
          <div className="space-y-4">
            {(risk.criticalOverdueInvoices || 0) > 0 && (
              <RiskAlert
                type="Критичні прострочки"
                count={risk.criticalOverdueInvoices}
                severity="critical"
                description="Інвойси прострочені більше 5 днів"
              />
            )}
            {(risk.stalledShipments || 0) > 0 && (
              <RiskAlert
                type="Застряглі доставки"
                count={risk.stalledShipments}
                severity="warning"
                description="Без оновлень більше 7 днів"
              />
            )}
            {(risk.riskyManagers || 0) > 0 && (
              <RiskAlert
                type="Ризикові менеджери"
                count={risk.riskyManagers}
                severity="warning"
                description="3+ прострочених інвойси"
              />
            )}
            {(risk.totalAtRiskAmount || 0) > 0 && (
              <RiskAlert
                type="Сума під ризиком"
                count={`$${(risk.totalAtRiskAmount || 0).toLocaleString()}`}
                severity="info"
                description="Загальна сума overdue"
              />
            )}
            {!(risk.criticalOverdueInvoices || 0) && !(risk.stalledShipments || 0) && !(risk.riskyManagers || 0) && (
              <div className="text-center py-8 text-[#71717A]">
                <Check size={48} className="mx-auto mb-2 text-emerald-500" />
                <p>Немає критичних ризиків</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Shipping Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Активні доставки"
          value={shipping.activeShipments || 0}
          icon={Truck}
          iconColor="blue"
        />
        <KPICard
          title="Затримані"
          value={shipping.delayedShipments || 0}
          icon={Warning}
          iconColor="amber"
        />
        <KPICard
          title="On-time Rate"
          value={`${shipping.onTimeDeliveryRate || 0}%`}
          icon={ChartLineUp}
          iconColor="emerald"
        />
        <KPICard
          title="Avg. Transit"
          value={`${shipping.avgTransitDays || 0} днів`}
          icon={Clock}
          iconColor="violet"
        />
      </div>

      {/* Team Performance */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
        <h2 className="text-lg font-semibold text-[#18181B] mb-6" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          Команда - рейтинг за доходом
        </h2>
        <div className="space-y-2">
          {team && team.length > 0 ? (
            team.slice(0, 10).map((member, idx) => (
              <TeamMemberRow key={member.managerId} member={member} rank={idx + 1} />
            ))
          ) : (
            <div className="text-center py-8 text-[#71717A]">
              <Users size={48} className="mx-auto mb-2" />
              <p>Немає даних про команду</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default OwnerPaymentDashboard;
