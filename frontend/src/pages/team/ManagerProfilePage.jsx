/**
 * BIBI Cars - Manager Profile Page (Team Lead View)
 * Detailed manager information and metrics
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, Link } from 'react-router-dom';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  User,
  ChartLineUp,
  Phone,
  ListChecks,
  Handshake,
  Clock,
  Fire,
  CreditCard,
  Truck,
  Warning,
  ArrowLeft,
  Eye,
  Globe,
  CalendarCheck
} from '@phosphor-icons/react';

const ManagerProfilePage = () => {
  // Support both /managers/:id and /managers/:managerId URL patterns
  const params = useParams();
  const managerId = params.managerId || params.id;
  const { user } = useAuth();
  const { t } = useLang();
  const [manager, setManager] = useState(null);
  const [leads, setLeads] = useState([]);
  const [deals, setDeals] = useState([]);
  const [payments, setPayments] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    fetchManagerData();
  }, [managerId]);

  const fetchManagerData = async () => {
    try {
      const [managerRes, leadsRes, dealsRes, paymentsRes, shipmentsRes, sessionsRes] = await Promise.all([
        axios.get(`${API_URL}/api/team/managers/${managerId}`).catch(() => 
          axios.get(`${API_URL}/api/users/${managerId}`)
        ),
        axios.get(`${API_URL}/api/leads?managerId=${managerId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/deals?managerId=${managerId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/invoices?managerId=${managerId}&status=overdue`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/shipments?managerId=${managerId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/admin/staff-sessions?userId=${managerId}`).catch(() => ({ data: [] })),
      ]);

      // Backend returns { success, data: {...} } for team endpoints.
      // Older shapes return the bare doc. Accept both.
      const mgrDoc = managerRes.data?.data && typeof managerRes.data.data === 'object'
        ? managerRes.data.data
        : managerRes.data;
      setManager(mgrDoc);
      setLeads(Array.isArray(leadsRes.data) ? leadsRes.data : (leadsRes.data?.data || leadsRes.data?.items || []));
      setDeals(Array.isArray(dealsRes.data) ? dealsRes.data : (dealsRes.data?.data || dealsRes.data?.items || []));
      setPayments(Array.isArray(paymentsRes.data) ? paymentsRes.data : (paymentsRes.data?.data || paymentsRes.data?.items || []));
      setShipments(Array.isArray(shipmentsRes.data) ? shipmentsRes.data : (shipmentsRes.data?.data || shipmentsRes.data?.items || []));
      setSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : (sessionsRes.data?.data || sessionsRes.data?.items || []));
    } catch (err) {
      console.error('Error fetching manager:', err);
      toast.error(t('dataLoadError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!manager) {
    return (
      <div className="text-center py-12">
        <p className="text-[#71717A]">{t('managerNotFound')}</p>
        <Link to="/team/managers" className="text-[#4F46E5] hover:underline mt-2 inline-block">
          {t('backToList')}
        </Link>
      </div>
    );
  }

  const tabs = [
    { id: 'summary', labelKey: 'summaryTab' },
    { id: 'leads', labelKey: 'activeLeadsTab', count: leads.length },
    { id: 'deals', labelKey: 'dealsTab', count: deals.length },
    { id: 'payments', labelKey: 'overdueTab', count: payments.length },
    { id: 'shipments', labelKey: 'shipmentsTab', count: shipments.length },
    { id: 'sessions', labelKey: 'sessionsTab' },
  ];

  return (
    <motion.div 
      data-testid="manager-profile-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Back Link */}
      <Link to="/team/managers" className="inline-flex items-center gap-2 text-sm text-[#71717A] hover:text-[#18181B]">
        <ArrowLeft size={16} /> {t('backToManagerBoard')}
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-[#EEF2FF] rounded-2xl flex items-center justify-center text-2xl font-bold text-[#4F46E5]">
              {(manager.name || 'M')[0]}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#18181B]">{manager.name || manager.email}</h1>
              <p className="text-sm text-[#71717A]">{manager.email}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                  (manager.band || '').toLowerCase() === 'high' ? 'bg-[#ECFDF5] text-[#059669]' :
                  (manager.band || '').toLowerCase() === 'medium' ? 'bg-[#FEF3C7] text-[#D97706]' :
                  'bg-[#FEF2F2] text-[#DC2626]'
                }`}>
                  {manager.band?.toUpperCase() || 'N/A'} Score: {manager.performanceScore || 0}
                </span>
                <span className="text-xs text-[#71717A]">
                  Last login: {manager.lastLoginAt ? format(new Date(manager.lastLoginAt), 'dd MMM, HH:mm', { locale: uk }) : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-[#18181B] text-white'
                : 'bg-white border border-[#E4E4E7] text-[#71717A] hover:bg-[#F4F4F5]'
            }`}
          >
            {t(tab.labelKey)}{tab.count !== undefined ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'summary' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard icon={ChartLineUp} label={t('score') || 'Score'} value={manager.performanceScore || 0} color="#4F46E5" />
          <StatCard icon={Phone} label={t('calls') || 'Calls'} value={manager.callsToday || 0} color="#059669" />
          <StatCard icon={ListChecks} label={t('tasksDone') || 'Tasks Done'} value={manager.tasksCompleted || 0} color="#0891B2" />
          <StatCard icon={Handshake} label={t('dealsWon') || 'Deals Won'} value={manager.dealsWon || 0} color="#7C3AED" />
          <StatCard icon={Clock} label={t('staleLeads') || 'Stale Leads'} value={manager.staleLeads || 0} color="#D97706" alert={manager.staleLeads > 2} />
          <StatCard icon={Warning} label={t('overdueTab') || 'Overdue'} value={manager.overdueTasks || 0} color="#DC2626" alert={manager.overdueTasks > 0} />
        </div>
      )}

      {activeTab === 'leads' && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="divide-y divide-[#E4E4E7]">
            {leads.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#71717A]">{t('noActiveLeads')}</div>
            ) : (
              leads.map((lead, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[#18181B]">{lead.name || lead.email || 'Lead'}</div>
                    <div className="text-xs text-[#71717A]">{lead.source} • {lead.country}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {lead.score >= 70 && <Fire size={16} className="text-[#DC2626]" weight="fill" />}
                    <span className="text-sm text-[#71717A]">Score: {lead.score || 0}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'deals' && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="divide-y divide-[#E4E4E7]">
            {deals.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#71717A]">Немає угод</div>
            ) : (
              deals.map((deal, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[#18181B]">{deal.vin || 'Deal'}</div>
                    <div className="text-xs text-[#71717A]">Stage: {deal.stage}</div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    deal.stage === 'delivered' ? 'bg-[#ECFDF5] text-[#059669]' :
                    deal.isBlocked ? 'bg-[#FEF2F2] text-[#DC2626]' :
                    'bg-[#F4F4F5] text-[#71717A]'
                  }`}>
                    {deal.isBlocked ? 'BLOCKED' : deal.stage}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="divide-y divide-[#E4E4E7]">
            {payments.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#71717A]">Немає прострочених платежів</div>
            ) : (
              payments.map((p, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[#18181B]">{p.customerName || 'Client'}</div>
                    <div className="text-xs text-[#71717A]">{p.type} • {p.daysOverdue} days overdue</div>
                  </div>
                  <span className="font-bold text-[#DC2626]">${p.amount?.toLocaleString() || 0}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'shipments' && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="divide-y divide-[#E4E4E7]">
            {shipments.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#71717A]">Немає відправлень</div>
            ) : (
              shipments.map((s, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] flex items-center justify-between">
                  <div>
                    <div className="font-mono font-medium text-[#18181B]">{s.vin?.slice(-8) || 'VIN'}</div>
                    <div className="text-xs text-[#71717A]">{s.status} • ETA: {s.eta || 'N/A'}</div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    s.trackingActive ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FEF2F2] text-[#DC2626]'
                  }`}>
                    {s.trackingActive ? 'Tracking' : 'No Tracking'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
          <div className="divide-y divide-[#E4E4E7]">
            {sessions.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#71717A]">Немає сесій</div>
            ) : (
              sessions.slice(0, 10).map((s, idx) => (
                <div key={idx} className="px-5 py-4 hover:bg-[#FAFAFA] flex items-center justify-between">
                  <div>
                    <div className="text-sm text-[#18181B]">IP: {s.ip || 'N/A'}</div>
                    <div className="text-xs text-[#71717A]">{s.userAgent?.slice(0, 50) || 'Browser'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#71717A]">
                      {s.createdAt ? format(new Date(s.createdAt), 'dd MMM, HH:mm', { locale: uk }) : 'N/A'}
                    </div>
                    {s.isSuspicious && <span className="text-xs text-[#DC2626]">Suspicious</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};

const StatCard = ({ icon: Icon, label, value, color, alert }) => (
  <div className={`bg-white rounded-xl p-4 border ${alert ? 'border-[#FECACA]' : 'border-[#E4E4E7]'}`}>
    <div className="flex items-center gap-2 mb-2">
      <Icon size={18} style={{ color }} weight="duotone" />
      <span className="text-xs text-[#71717A]">{label}</span>
    </div>
    <div className="text-2xl font-bold" style={{ color: alert ? '#DC2626' : '#18181B' }}>{value}</div>
  </div>
);

export default ManagerProfilePage;
