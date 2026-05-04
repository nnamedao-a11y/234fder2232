/**
 * BIBI Cars - Manager Workspace (Daily Cockpit)
 * Main workspace with 4 blocks: HOT Leads, Tasks, Payments, Shipments
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  Fire,
  ListChecks,
  CreditCard,
  Truck,
  Phone,
  Clock,
  Warning,
  ArrowRight,
  Eye,
  Check,
  CalendarCheck
} from '@phosphor-icons/react';
import ProviderHealthWidget from '../../components/ProviderHealthWidget';

const ManagerWorkspacePage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [hotLeads, setHotLeads] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [shipments, setShipments] = useState([]);

  useEffect(() => {
    fetchWorkspaceData();
  }, []);

  const fetchWorkspaceData = async () => {
    try {
      const userId = user?._id || user?.id;
      
      const [leadsRes, tasksRes, paymentsRes, shipmentsRes] = await Promise.all([
        axios.get(`${API_URL}/api/leads?managerId=${userId}&score_gte=70`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/tasks?assigneeId=${userId}&status=pending`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/invoices?managerId=${userId}&status=overdue`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/shipments?managerId=${userId}`).catch(() => ({ data: [] })),
      ]);

      setHotLeads(Array.isArray(leadsRes.data) ? leadsRes.data : (leadsRes.data?.data || []));
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : (tasksRes.data?.data || []));
      setPayments(Array.isArray(paymentsRes.data) ? paymentsRes.data : (paymentsRes.data?.data || []));
      setShipments(Array.isArray(shipmentsRes.data) ? shipmentsRes.data : (shipmentsRes.data?.data || []));
    } catch (err) {
      console.error('Workspace error:', err);
      setHotLeads([]);
      setTasks([]);
      setPayments([]);
      setShipments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      await axios.patch(`${API_URL}/api/tasks/${taskId}`, { status: 'completed' });
      toast.success(t('taskCompleted'));
      fetchWorkspaceData();
    } catch (err) {
      toast.error(t('error'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <motion.div 
      data-testid="manager-workspace-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          {t('myWorkspace')}
        </h1>
        <p className="text-sm text-[#71717A] mt-1">
          {user?.name || t('manager')}
        </p>
      </div>

      {/* Provider Pressure self-view */}
      <ProviderHealthWidget className="max-w-md" />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickStat icon={Fire} label={t('hotLeads')} value={hotLeads.length} color="#DC2626" alert={hotLeads.length > 0} />
        <QuickStat icon={ListChecks} label={t('myTasks')} value={tasks.length} color="#4F46E5" alert={tasks.filter(t => t.priority === 'high').length > 0} />
        <QuickStat icon={CreditCard} label={t('paymentsToChase')} value={payments.length} color="#D97706" alert={payments.length > 0} />
        <QuickStat icon={Truck} label={t('myShipments')} value={shipments.length} color="#059669" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My HOT Leads */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between bg-[#FEF2F2]">
            <div className="flex items-center gap-2">
              <Fire size={20} className="text-[#DC2626]" weight="fill" />
              <h3 className="font-semibold text-[#DC2626]">{t('myHotLeads')}</h3>
            </div>
            <Link to="/manager/leads" className="text-sm text-[#DC2626] hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-auto">
            {hotLeads.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                {t('noHotLeads')}
              </div>
            ) : (
              hotLeads.slice(0, 5).map((lead, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-[#18181B]">{lead.name || 'Client'}</div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FEF2F2] text-[#DC2626] text-xs font-bold rounded-full">
                      <Fire size={12} weight="fill" /> {lead.score || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>Last action: {lead.lastActionAt ? format(new Date(lead.lastActionAt), 'HH:mm', { locale: uk }) : 'N/A'}</span>
                    <span className={`font-medium ${!lead.lastContactAt ? 'text-[#DC2626]' : 'text-[#71717A]'}`}>
                      {!lead.lastContactAt ? 'URGENT - No contact' : 'Call'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <button className="flex items-center gap-1 text-xs text-[#4F46E5] hover:underline">
                      <Phone size={12} /> Call now
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* My Tasks */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks size={20} className="text-[#4F46E5]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">{t('myTasks')}</h3>
            </div>
            <Link to="/manager/tasks" className="text-sm text-[#4F46E5] hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-auto">
            {tasks.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                {t('noOverdueTasks')}
              </div>
            ) : (
              tasks.slice(0, 5).map((task, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-[#18181B]">{task.title || task.type}</span>
                        {task.priority === 'high' && (
                          <span className="px-2 py-0.5 bg-[#FEF2F2] text-[#DC2626] text-xs font-medium rounded-full">
                            High
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#71717A]">
                        {task.dueAt ? `Due: ${format(new Date(task.dueAt), 'dd MMM, HH:mm', { locale: uk })}` : 'No due date'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCompleteTask(task._id)}
                      className="p-2 text-[#71717A] hover:text-[#059669] hover:bg-[#ECFDF5] rounded-lg transition-colors"
                    >
                      <Check size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* My Payments to Chase */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={20} className="text-[#D97706]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">{t('paymentsToChase')}</h3>
            </div>
            <Link to="/manager/invoices" className="text-sm text-[#4F46E5] hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-auto">
            {payments.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                {t('noOverduePayments')}
              </div>
            ) : (
              payments.slice(0, 5).map((inv, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-[#18181B]">{inv.customerName || 'Client'}</span>
                    <span className="font-bold text-[#DC2626]">${inv.amount?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>{inv.type || 'Invoice'}</span>
                    <span className="text-[#DC2626]">{inv.daysOverdue || 0} days overdue</span>
                  </div>
                  <div className="mt-2">
                    <button className="flex items-center gap-1 text-xs text-[#4F46E5] hover:underline">
                      <Phone size={12} /> Call
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* My Shipments */}
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={20} className="text-[#059669]" weight="duotone" />
              <h3 className="font-semibold text-[#18181B]">{t('myShipments')}</h3>
            </div>
            <Link to="/manager/shipments" className="text-sm text-[#4F46E5] hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-auto">
            {shipments.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#71717A]">
                {t('noShipmentIssues')}
              </div>
            ) : (
              shipments.slice(0, 5).map((ship, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm font-medium text-[#18181B]">
                      {ship.vin?.slice(-8) || 'VIN'}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      ship.trackingActive ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FEF2F2] text-[#DC2626]'
                    }`}>
                      {ship.trackingActive ? 'Tracking' : 'No Tracking'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>{ship.status?.replace('_', ' ') || 'Status'}</span>
                    <span>ETA: {ship.eta ? format(new Date(ship.eta), 'dd MMM', { locale: uk }) : 'N/A'}</span>
                  </div>
                  {!ship.trackingActive && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-[#DC2626]">
                      <Warning size={12} /> Action needed: Add tracking
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const QuickStat = ({ icon: Icon, label, value, color, alert }) => (
  <div className={`bg-white rounded-xl p-4 border ${alert ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#E4E4E7]'}`}>
    <div className="flex items-center gap-2 mb-2">
      <Icon size={18} style={{ color }} weight={alert ? 'fill' : 'duotone'} />
      <span className="text-xs font-medium text-[#71717A]">{label}</span>
    </div>
    <div className="text-2xl font-bold" style={{ color: alert ? '#DC2626' : '#18181B' }}>
      {value}
    </div>
  </div>
);

export default ManagerWorkspacePage;
