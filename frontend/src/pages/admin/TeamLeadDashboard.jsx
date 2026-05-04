import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  UsersThree,
  ChartLineUp,
  Phone,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  Target,
  TrendUp,
  User,
  CalendarCheck,
  ArrowRight,
  Eye,
  Shield,
  Pulse,
  CreditCard,
  Truck,
  Lightning,
  Fire,
  Hourglass
} from '@phosphor-icons/react';

const TeamLeadDashboard = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [managers, setManagers] = useState([]);
  const [loginAlerts, setLoginAlerts] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [stalledShipments, setStalledShipments] = useState([]);
  const [criticalAlerts, setCriticalAlerts] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, staffRes, alertsRes, approvalsRes, invoicesRes, shipmentsRes, criticalRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/kpi/team-summary`).catch(() => ({ data: null })),
        axios.get(`${API_URL}/api/users?role=manager`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_URL}/api/admin/staff-sessions/login-alerts`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/login-approval/pending`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/invoices/overdue`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/shipments/stalled`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/alerts/critical`).catch(() => ({ data: [] })),
      ]);

      setStats(statsRes.data);
      setManagers(Array.isArray(staffRes.data) ? staffRes.data : (staffRes.data?.data || []));
      setLoginAlerts(Array.isArray(alertsRes.data) ? alertsRes.data : (alertsRes.data?.data || alertsRes.data?.alerts || []));
      setPendingApprovals(Array.isArray(approvalsRes.data) ? approvalsRes.data : (approvalsRes.data?.data || []));
      setOverdueInvoices(Array.isArray(invoicesRes.data) ? invoicesRes.data : (invoicesRes.data?.invoices || invoicesRes.data?.data || []));
      setStalledShipments(Array.isArray(shipmentsRes.data) ? shipmentsRes.data : (shipmentsRes.data?.shipments || shipmentsRes.data?.data || []));
      setCriticalAlerts(Array.isArray(criticalRes.data) ? criticalRes.data : (criticalRes.data?.alerts || criticalRes.data?.data || []));
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveLogin = async (requestId) => {
    try {
      await axios.post(`${API_URL}/api/login-approval/${requestId}/approve`);
      toast.success('Вхід схвалено');
      fetchDashboardData();
    } catch (err) {
      toast.error('Помилка при схваленні');
    }
  };

  const handleRejectLogin = async (requestId) => {
    try {
      await axios.post(`${API_URL}/api/login-approval/${requestId}/reject`);
      toast.success('Вхід відхилено');
      fetchDashboardData();
    } catch (err) {
      toast.error('Помилка при відхиленні');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const kpiCards = [
    {
      title: 'Активних менеджерів',
      value: managers.filter(m => m.isActive).length,
      total: managers.length,
      icon: UsersThree,
      color: '#4F46E5',
      bgColor: '#EEF2FF',
    },
    {
      title: 'Ліди сьогодні',
      value: stats?.leadsToday || 0,
      change: stats?.leadsChange || '+0%',
      icon: Target,
      color: '#059669',
      bgColor: '#ECFDF5',
    },
    {
      title: 'Угоди в роботі',
      value: stats?.activeDeals || 0,
      subtitle: `${stats?.completedDeals || 0} завершено`,
      icon: ChartLineUp,
      color: '#7C3AED',
      bgColor: '#F5F3FF',
    },
    {
      title: 'Дзвінки сьогодні',
      value: stats?.callsToday || 0,
      subtitle: `${stats?.missedCalls || 0} пропущено`,
      icon: Phone,
      color: '#DC2626',
      bgColor: '#FEF2F2',
    },
  ];

  return (
    <motion.div 
      data-testid="team-lead-dashboard"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Team Lead Panel
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            Керування командою та моніторинг активності
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-[#EEF2FF] rounded-xl">
          <Shield size={20} className="text-[#4F46E5]" weight="duotone" />
          <span className="text-sm font-medium text-[#4F46E5]">Team Lead</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white rounded-2xl p-5 border border-[#E4E4E7] hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="p-2.5 rounded-xl" style={{ backgroundColor: card.bgColor }}>
                <card.icon size={22} weight="duotone" style={{ color: card.color }} />
              </div>
              {card.change && (
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  card.change.startsWith('+') ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FEF2F2] text-[#DC2626]'
                }`}>
                  {card.change}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-[#18181B]">
              {card.value}
              {card.total && <span className="text-sm font-normal text-[#71717A]"> / {card.total}</span>}
            </div>
            <div className="text-sm text-[#71717A] mt-1">{card.title}</div>
            {card.subtitle && (
              <div className="text-xs text-[#A1A1AA] mt-1">{card.subtitle}</div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Login Approvals */}
        <div className="lg:col-span-1 bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={20} className="text-[#DC2626]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">Запити на вхід</h3>
            </div>
            {pendingApprovals.length > 0 && (
              <span className="px-2 py-0.5 bg-[#FEF2F2] text-[#DC2626] text-xs font-medium rounded-full">
                {pendingApprovals.length}
              </span>
            )}
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-auto">
            {pendingApprovals.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                Немає запитів на схвалення
              </div>
            ) : (
              pendingApprovals.map((req) => (
                <div key={req.id} className="p-4 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-[#F4F4F5] rounded-full flex items-center justify-center">
                        <User size={16} className="text-[#71717A]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#18181B]">{req.userName || req.email}</p>
                        <p className="text-xs text-[#71717A]">{req.ip}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApproveLogin(req.id)}
                      className="flex-1 px-3 py-1.5 bg-[#059669] text-white text-xs font-medium rounded-lg hover:bg-[#047857] transition-colors flex items-center justify-center gap-1"
                      data-testid={`approve-${req.id}`}
                    >
                      <CheckCircle size={14} />
                      Схвалити
                    </button>
                    <button
                      onClick={() => handleRejectLogin(req.id)}
                      className="flex-1 px-3 py-1.5 bg-[#DC2626] text-white text-xs font-medium rounded-lg hover:bg-[#B91C1C] transition-colors flex items-center justify-center gap-1"
                      data-testid={`reject-${req.id}`}
                    >
                      <XCircle size={14} />
                      Відхилити
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Team Activity */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pulse size={20} className="text-[#4F46E5]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">Активність команди</h3>
            </div>
            <a href="/admin/staff-sessions" className="text-sm text-[#4F46E5] hover:underline flex items-center gap-1">
              Всі сесії <ArrowRight size={14} />
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#FAFAFA]">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#71717A] uppercase">Менеджер</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#71717A] uppercase">Статус</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#71717A] uppercase">Ліди</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#71717A] uppercase">Дзвінки</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#71717A] uppercase">Останній вхід</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {managers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-[#71717A]">
                      Немає менеджерів у команді
                    </td>
                  </tr>
                ) : (
                  managers.slice(0, 5).map((manager) => (
                    <tr key={manager.id} className="hover:bg-[#FAFAFA] transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-[#18181B] rounded-full flex items-center justify-center text-xs font-bold text-white">
                            {manager.firstName?.[0]}{manager.lastName?.[0]}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[#18181B]">{manager.firstName} {manager.lastName}</p>
                            <p className="text-xs text-[#71717A]">{manager.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
                          manager.isActive 
                            ? 'bg-[#ECFDF5] text-[#059669]' 
                            : 'bg-[#F4F4F5] text-[#71717A]'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${manager.isActive ? 'bg-[#059669]' : 'bg-[#71717A]'}`}></span>
                          {manager.isActive ? 'Онлайн' : 'Офлайн'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#18181B]">{manager.activeLeads || 0}</td>
                      <td className="px-5 py-3 text-sm text-[#18181B]">{manager.callsToday || 0}</td>
                      <td className="px-5 py-3 text-sm text-[#71717A]">
                        {manager.lastLoginAt 
                          ? format(new Date(manager.lastLoginAt), 'dd MMM, HH:mm', { locale: uk })
                          : '—'
                        }
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Login Alerts */}
      {loginAlerts.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center gap-2">
            <Warning size={20} className="text-[#F59E0B]" weight="duotone" />
            <h3 className="font-semibold text-[#18181B]">Останні входи в систему</h3>
          </div>
          <div className="divide-y divide-[#E4E4E7]">
            {loginAlerts.slice(0, 5).map((alert, idx) => (
              <div key={idx} className="px-5 py-3 flex items-center justify-between hover:bg-[#FAFAFA] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#FEF3C7] rounded-full flex items-center justify-center">
                    <User size={16} className="text-[#D97706]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#18181B]">{alert.manager?.name || 'Менеджер'}</p>
                    <p className="text-xs text-[#71717A]">IP: {alert.ip}</p>
                  </div>
                </div>
                <div className="text-xs text-[#71717A]">
                  {alert.time ? format(new Date(alert.time), 'dd MMM, HH:mm', { locale: uk }) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NEW: Payments & Shipping Watch Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overdue Invoices */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={20} className="text-[#DC2626]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">Прострочені оплати</h3>
            </div>
            {overdueInvoices.length > 0 && (
              <span className="px-2.5 py-1 bg-[#FEF2F2] text-[#DC2626] text-xs font-bold rounded-full">
                {overdueInvoices.length}
              </span>
            )}
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-72 overflow-auto">
            {overdueInvoices.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                Немає прострочених інвойсів
              </div>
            ) : (
              overdueInvoices.slice(0, 5).map((invoice, idx) => (
                <div key={idx} className="px-5 py-3 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-[#18181B]">
                      {invoice.customerName || invoice.customer?.name || 'Клієнт'}
                    </span>
                    <span className="text-sm font-bold text-[#DC2626]">
                      ${invoice.amount?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>Менеджер: {invoice.managerName || invoice.manager?.name || '—'}</span>
                    <span className="text-[#DC2626]">{invoice.daysOverdue || 0} дн. прострочено</span>
                  </div>
                  <div className="mt-1">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      invoice.type === 'deposit' ? 'bg-[#EEF2FF] text-[#4F46E5]' :
                      invoice.type === 'logistics' ? 'bg-[#FEF3C7] text-[#D97706]' :
                      'bg-[#F4F4F5] text-[#71717A]'
                    }`}>
                      {invoice.type || 'Тип не вказано'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stalled Shipments */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={20} className="text-[#D97706]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">Проблеми з доставкою</h3>
            </div>
            {stalledShipments.length > 0 && (
              <span className="px-2.5 py-1 bg-[#FEF3C7] text-[#D97706] text-xs font-bold rounded-full">
                {stalledShipments.length}
              </span>
            )}
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-72 overflow-auto">
            {stalledShipments.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                Немає проблемних відправлень
              </div>
            ) : (
              stalledShipments.slice(0, 5).map((shipment, idx) => (
                <div key={idx} className="px-5 py-3 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium font-mono text-[#18181B]">
                      {shipment.vin?.slice(-8) || 'VIN N/A'}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      shipment.issue === 'no_tracking' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                      shipment.issue === 'stalled' ? 'bg-[#FEF3C7] text-[#D97706]' :
                      'bg-[#F4F4F5] text-[#71717A]'
                    }`}>
                      {shipment.issue === 'no_tracking' ? 'Без трекінгу' :
                       shipment.issue === 'stalled' ? 'Зупинено' :
                       shipment.status || 'Проблема'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>Менеджер: {shipment.managerName || shipment.manager?.name || '—'}</span>
                    <span>{shipment.daysSinceUpdate || 0} дн. без оновлення</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <div className="bg-[#FEF2F2] rounded-2xl border border-[#FECACA] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#FECACA] flex items-center gap-2">
            <Lightning size={20} className="text-[#DC2626]" weight="fill" />
            <h3 className="font-semibold text-[#DC2626]">Критичні алерти</h3>
            <span className="ml-auto px-2.5 py-1 bg-[#DC2626] text-white text-xs font-bold rounded-full">
              {criticalAlerts.length}
            </span>
          </div>
          <div className="divide-y divide-[#FECACA]">
            {criticalAlerts.slice(0, 5).map((alert, idx) => (
              <div key={idx} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    alert.type === 'hot_lead_missed' ? 'bg-[#FEF2F2]' :
                    alert.type === 'payment_overdue' ? 'bg-[#FEF3C7]' :
                    'bg-[#EEF2FF]'
                  }`}>
                    {alert.type === 'hot_lead_missed' ? <Fire size={16} className="text-[#DC2626]" /> :
                     alert.type === 'payment_overdue' ? <CreditCard size={16} className="text-[#D97706]" /> :
                     <Warning size={16} className="text-[#4F46E5]" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#DC2626]">{alert.title || alert.message}</p>
                    <p className="text-xs text-[#71717A]">
                      {alert.managerName || alert.manager?.name || '—'} • {alert.time ? format(new Date(alert.time), 'HH:mm', { locale: uk }) : '—'}
                    </p>
                  </div>
                </div>
                <button className="text-xs text-[#DC2626] hover:underline font-medium">
                  Дія
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TeamLeadDashboard;
