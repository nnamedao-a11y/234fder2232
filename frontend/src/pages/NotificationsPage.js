import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRinging, Check, CheckCircle, X, UserPlus, Handshake, FileText, CurrencyDollar, Warning, Clock, Gear, ShieldCheck, User, Users, Database, Funnel, ArrowsClockwise, Trash, Eye } from '@phosphor-icons/react';
import { useLang } from '../i18n';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const NotificationsPage = () => {
  const { t, lang } = useLang();
  const [notifications, setNotifications] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const notificationConfig = {
    new_lead: { icon: UserPlus, color: '#4F46E5', label: t('notifNewLeadLabel'), route: '/admin/leads' },
    lead_assigned: { icon: User, color: '#7C3AED', label: t('notifLeadAssigned'), route: '/admin/leads' },
    lead_status_changed: { icon: Users, color: '#0891B2', label: t('notifLeadStatusChanged'), route: '/admin/leads' },
    lead_sla_warning: { icon: Clock, color: '#D97706', label: t('notifSlaWarning'), route: '/admin/leads' },
    lead_sla_breach: { icon: Warning, color: '#DC2626', label: t('notifSlaBreach'), route: '/admin/leads' },
    deal_created: { icon: Handshake, color: '#059669', label: t('notifNewDeal'), route: '/admin/deals' },
    deal_update: { icon: Handshake, color: '#0891B2', label: t('notifDealUpdateLabel'), route: '/admin/deals' },
    deal_status_changed: { icon: Handshake, color: '#7C3AED', label: t('notifDealStatusChanged'), route: '/admin/deals' },
    deal_completed: { icon: CheckCircle, color: '#16A34A', label: t('notifDealCompleted'), route: '/admin/deals' },
    deposit_created: { icon: CurrencyDollar, color: '#4F46E5', label: t('notifDepositCreated'), route: '/admin/deposits' },
    deposit_received: { icon: CurrencyDollar, color: '#059669', label: t('notifDepositReceived'), route: '/admin/deposits' },
    deposit_pending: { icon: Clock, color: '#D97706', label: t('notifDepositPending'), route: '/admin/deposits' },
    deposit_confirmed: { icon: CheckCircle, color: '#16A34A', label: t('notifDepositConfirmed'), route: '/admin/deposits' },
    deposit_refunded: { icon: CurrencyDollar, color: '#DC2626', label: t('notifDepositRefunded'), route: '/admin/deposits' },
    document_uploaded: { icon: FileText, color: '#4F46E5', label: t('notifDocUploaded'), route: '/admin/documents' },
    document_pending_verification: { icon: ShieldCheck, color: '#D97706', label: t('notifDocPendingVerification'), route: '/admin/documents' },
    document_verified: { icon: CheckCircle, color: '#16A34A', label: t('notifDocVerified'), route: '/admin/documents' },
    document_rejected: { icon: X, color: '#DC2626', label: t('notifDocRejected'), route: '/admin/documents' },
    task_due: { icon: Clock, color: '#D97706', label: t('notifTaskDueLabel'), route: '/admin/tasks' },
    task_overdue: { icon: Warning, color: '#DC2626', label: t('notifTaskOverdue'), route: '/admin/tasks' },
    task_assigned: { icon: User, color: '#4F46E5', label: t('notifTaskAssigned'), route: '/admin/tasks' },
    customer_registered: { icon: UserPlus, color: '#059669', label: t('notifCustomerRegistered'), route: '/admin/clients' },
    customer_updated: { icon: User, color: '#0891B2', label: t('notifCustomerUpdated'), route: '/admin/clients' },
    parser_completed: { icon: Database, color: '#16A34A', label: t('notifParserCompleted'), route: '/admin/parser' },
    parser_failed: { icon: Warning, color: '#DC2626', label: t('notifParserFailed'), route: '/admin/parser' },
    system: { icon: Gear, color: '#71717A', label: t('notifSystem'), route: '/admin/settings' },
    system_warning: { icon: Warning, color: '#D97706', label: t('notifSystemWarning'), route: '/admin/settings' },
    system_error: { icon: Warning, color: '#DC2626', label: t('notifSystemError'), route: '/admin/settings' },
  };

  const priorityLabels = { low: t('priorityLow'), medium: t('priorityMedium'), high: t('priorityHigh'), urgent: t('priorityUrgent') };
  const priorityColors = { low: 'bg-[#F4F4F5] text-[#71717A]', medium: 'bg-[#EEF2FF] text-[#4F46E5]', high: 'bg-[#FEF3C7] text-[#D97706]', urgent: 'bg-[#FEE2E2] text-[#DC2626]' };

  const formatTimeAgo = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return t('justNow');
    if (minutes < 60) return `${minutes} ${t('minutesAgo')}`;
    if (hours < 24) return `${hours} ${t('hoursAgo')}`;
    if (days < 7) return `${days} ${t('daysAgo')}`;
    return new Date(date).toLocaleDateString(lang === 'uk' ? 'uk-UA' : lang === 'bg' ? 'bg-BG' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const [notifRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/notifications?limit=100`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/notifications/stats`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (notifRes.ok) { const data = await notifRes.json(); setNotifications(data); }
      if (statsRes.ok) { const data = await statsRes.json(); setStats(data); }
    } catch (error) { console.error('Failed to fetch notifications:', error); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = async (id) => {
    try { await fetch(`${API_URL}/api/notifications/${id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }); setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n)); }
    catch (error) { console.error('Failed to mark as read:', error); }
  };

  const markAllAsRead = async () => {
    try { await fetch(`${API_URL}/api/notifications/read-all`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }); setNotifications(prev => prev.map(n => ({ ...n, isRead: true }))); }
    catch (error) { console.error('Failed to mark all as read:', error); }
  };

  const handleNavigate = (notification) => {
    const config = notificationConfig[notification.type] || notificationConfig.system;
    if (!notification.isRead) markAsRead(notification.id);
    let route = config.route;
    if (notification.entityId) route = `${route}/${notification.entityId}`;
    navigate(route);
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread' && n.isRead) return false;
    if (filter === 'read' && !n.isRead) return false;
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    return true;
  });

  const notificationTypes = [...new Set(notifications.map(n => n.type))];
  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="max-w-5xl mx-auto" data-testid="notifications-page">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('notifications')}</h1>
          <p className="text-sm text-[#71717A] mt-1">{t('allSystemNotifications')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchNotifications} className="flex items-center gap-2 px-4 py-2 text-[#71717A] hover:text-[#18181B] border border-[#E4E4E7] rounded-xl hover:bg-[#F4F4F5] transition-colors"><ArrowsClockwise size={18} />{t('refresh')}</button>
          {unreadCount > 0 && <button onClick={markAllAsRead} className="flex items-center gap-2 px-4 py-2 bg-[#4F46E5] text-white rounded-xl hover:bg-[#4338CA] transition-colors"><CheckCircle size={18} />{t('readAllBtn')} ({unreadCount})</button>}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-5 mb-8">
          <div className="kpi-card"><div className="mb-3"><Bell size={24} weight="duotone" className="text-[#4F46E5]" /></div><div className="kpi-value">{stats.total}</div><div className="kpi-label">{t('totalNotifications')}</div></div>
          <div className="kpi-card"><div className="mb-3"><BellRinging size={24} weight="duotone" className="text-[#DC2626]" /></div><div className="kpi-value text-[#DC2626]">{stats.unread}</div><div className="kpi-label">{t('unreadNotifications')}</div></div>
          <div className="kpi-card"><div className="mb-3"><Warning size={24} weight="duotone" className="text-[#D97706]" /></div><div className="kpi-value text-[#D97706]">{stats.byPriority?.urgent || 0}</div><div className="kpi-label">{t('urgentNotifications')}</div></div>
          <div className="kpi-card"><div className="mb-3"><CheckCircle size={24} weight="duotone" className="text-[#059669]" /></div><div className="kpi-value text-[#059669]">{stats.total - stats.unread}</div><div className="kpi-label">{t('readNotifications')}</div></div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2 bg-[#F4F4F5] rounded-xl p-1">
          {['all', 'unread', 'read'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${filter === f ? 'bg-white text-[#18181B] shadow-sm' : 'text-[#71717A] hover:text-[#18181B]'}`}>
              {f === 'all' ? t('allFilter') : f === 'unread' ? t('unreadFilter') : t('readFilter')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Funnel size={18} className="text-[#71717A]" />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-3 py-2 text-sm bg-white border border-[#E4E4E7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F46E5]">
            <option value="all">{t('allTypesFilter')}</option>
            {notificationTypes.map(type => <option key={type} value={type}>{notificationConfig[type]?.label || type}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-3 border-[#4F46E5] border-t-transparent rounded-full"></div></div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center py-20"><Bell size={48} weight="duotone" className="mx-auto text-[#D4D4D8] mb-4" /><p className="text-[#71717A]">{t('noNotifications')}</p></div>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            <AnimatePresence mode="popLayout">
              {filteredNotifications.map(notification => {
                const config = notificationConfig[notification.type] || notificationConfig.system;
                const Icon = config.icon;
                return (
                  <motion.div key={notification.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }} className={`flex items-start gap-4 p-5 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${!notification.isRead ? 'bg-[#F8FAFC]' : ''}`} onClick={() => handleNavigate(notification)} data-testid={`notification-row-${notification.id}`}>
                    <div className="flex-shrink-0"><Icon size={24} weight="duotone" style={{ color: config.color }} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-[#71717A]">{config.label}</span>
                        {notification.priority && notification.priority !== 'medium' && <span className={`px-2 py-0.5 rounded text-xs font-semibold ${priorityColors[notification.priority]}`}>{priorityLabels[notification.priority]}</span>}
                        {!notification.isRead && <span className="w-2 h-2 rounded-full bg-[#4F46E5]"></span>}
                      </div>
                      <p className="text-sm font-medium text-[#18181B]">{notification.title}</p>
                      {notification.message && <p className="text-sm text-[#71717A] mt-1">{notification.message}</p>}
                      <p className="text-xs text-[#A1A1AA] mt-2">{formatTimeAgo(notification.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!notification.isRead && <button onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }} className="p-2 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors" title={t('markReadTooltip')}><Check size={18} /></button>}
                      <button onClick={(e) => { e.stopPropagation(); handleNavigate(notification); }} className="p-2 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors" title={t('viewTooltip')}><Eye size={18} /></button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
