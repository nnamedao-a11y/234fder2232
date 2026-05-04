import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellRinging,
  Check,
  CheckCircle,
  X,
  UserPlus,
  Handshake,
  FileText,
  CurrencyDollar,
  Warning,
  Clock,
  CaretRight,
  Gear,
  ShieldCheck,
  User,
  Users,
  Database,
} from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// Notification type config with icons, colors, and routes
const notificationConfig = {
  // Lead notifications
  new_lead: { 
    icon: UserPlus, 
    color: '#4F46E5', 
    label: 'Новий лід',
    route: '/admin/leads'
  },
  lead_assigned: { 
    icon: User, 
    color: '#7C3AED', 
    label: 'Лід призначено',
    route: '/admin/leads'
  },
  lead_status_changed: { 
    icon: Users, 
    color: '#0891B2', 
    label: 'Статус ліда',
    route: '/admin/leads'
  },
  lead_sla_warning: { 
    icon: Clock, 
    color: '#D97706', 
    label: 'SLA попередження',
    route: '/admin/leads'
  },
  lead_sla_breach: { 
    icon: Warning, 
    color: '#DC2626', 
    label: 'SLA порушено',
    route: '/admin/leads'
  },
  
  // Deal notifications
  deal_created: { 
    icon: Handshake, 
    color: '#059669', 
    label: 'Нова угода',
    route: '/admin/legal?tab=deal_pipeline'
  },
  deal_update: { 
    icon: Handshake, 
    color: '#0891B2', 
    label: 'Оновлення угоди',
    route: '/admin/legal?tab=deal_pipeline'
  },
  deal_status_changed: { 
    icon: Handshake, 
    color: '#7C3AED', 
    label: 'Статус угоди',
    route: '/admin/legal?tab=deal_pipeline'
  },
  deal_completed: { 
    icon: CheckCircle, 
    color: '#16A34A', 
    label: 'Угоду завершено',
    route: '/admin/legal?tab=deal_pipeline'
  },
  
  // Deposit notifications
  deposit_created: { 
    icon: CurrencyDollar, 
    color: '#4F46E5', 
    label: 'Новий депозит',
    route: '/admin/legal?tab=deposit_v2'
  },
  deposit_received: { 
    icon: CurrencyDollar, 
    color: '#059669', 
    label: 'Депозит отримано',
    route: '/admin/legal?tab=deposit_v2'
  },
  deposit_pending: { 
    icon: Clock, 
    color: '#D97706', 
    label: 'Депозит очікує',
    route: '/admin/legal?tab=deposit_v2'
  },
  deposit_confirmed: { 
    icon: CheckCircle, 
    color: '#16A34A', 
    label: 'Депозит підтверджено',
    route: '/admin/legal?tab=deposit_v2'
  },
  deposit_refunded: { 
    icon: CurrencyDollar, 
    color: '#DC2626', 
    label: 'Депозит повернуто',
    route: '/admin/legal?tab=deposit_v2'
  },
  
  // Document notifications
  document_uploaded: { 
    icon: FileText, 
    color: '#4F46E5', 
    label: 'Документ завантажено',
    route: '/admin/documents'
  },
  document_pending_verification: { 
    icon: ShieldCheck, 
    color: '#D97706', 
    label: 'На верифікації',
    route: '/admin/documents'
  },
  document_verified: { 
    icon: CheckCircle, 
    color: '#16A34A', 
    label: 'Документ верифіковано',
    route: '/admin/documents'
  },
  document_rejected: { 
    icon: X, 
    color: '#DC2626', 
    label: 'Документ відхилено',
    route: '/admin/documents'
  },
  
  // Task notifications
  task_due: { 
    icon: Clock, 
    color: '#D97706', 
    label: 'Задача скоро',
    route: '/admin/tasks'
  },
  task_overdue: { 
    icon: Warning, 
    color: '#DC2626', 
    label: 'Задача прострочена',
    route: '/admin/tasks'
  },
  task_assigned: { 
    icon: User, 
    color: '#4F46E5', 
    label: 'Задачу призначено',
    route: '/admin/tasks'
  },
  
  // Customer notifications
  customer_registered: { 
    icon: UserPlus, 
    color: '#059669', 
    label: 'Новий клієнт',
    route: '/admin/clients'
  },
  customer_updated: { 
    icon: User, 
    color: '#0891B2', 
    label: 'Клієнт оновлено',
    route: '/admin/clients'
  },
  
  // Parser notifications
  parser_completed: { 
    icon: Database, 
    color: '#16A34A', 
    label: 'Парсинг завершено',
    route: '/admin/parser'
  },
  parser_failed: { 
    icon: Warning, 
    color: '#DC2626', 
    label: 'Помилка парсингу',
    route: '/admin/parser'
  },
  
  // System notifications
  system: { 
    icon: Gear, 
    color: '#71717A', 
    label: 'Системне',
    route: '/admin/settings'
  },
  system_warning: { 
    icon: Warning, 
    color: '#D97706', 
    label: 'Системне попередження',
    route: '/admin/settings'
  },
  system_error: { 
    icon: Warning, 
    color: '#DC2626', 
    label: 'Системна помилка',
    route: '/admin/settings'
  },
};

// Priority badge colors
const priorityColors = {
  low: 'bg-[#F4F4F5] text-[#71717A]',
  medium: 'bg-[#EEF2FF] text-[#4F46E5]',
  high: 'bg-[#FEF3C7] text-[#D97706]',
  urgent: 'bg-[#FEE2E2] text-[#DC2626]',
};

// Format relative time
const formatTimeAgo = (date) => {
  const now = new Date();
  const diff = now - new Date(date);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Щойно';
  if (minutes < 60) return `${minutes} хв тому`;
  if (hours < 24) return `${hours} год тому`;
  if (days < 7) return `${days} дн тому`;
  return new Date(date).toLocaleDateString('uk-UA');
};

// Single notification item
const NotificationItem = ({ notification, onMarkRead, onNavigate }) => {
  const config = notificationConfig[notification.type] || notificationConfig.system;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`flex items-start gap-3 p-4 border-b border-[#E4E4E7] last:border-0 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${
        !notification.isRead ? 'bg-[#F8FAFC]' : ''
      }`}
      onClick={() => onNavigate(notification)}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={22} weight="duotone" style={{ color: config.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-[#71717A]">{config.label}</span>
          {notification.priority && notification.priority !== 'medium' && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${priorityColors[notification.priority]}`}>
              {notification.priority === 'urgent' ? 'ТЕРМІНОВО' : notification.priority === 'high' ? 'ВАЖЛИВО' : 'LOW'}
            </span>
          )}
          {!notification.isRead && (
            <span className="w-2 h-2 rounded-full bg-[#4F46E5]"></span>
          )}
        </div>
        <p className="text-sm font-medium text-[#18181B] line-clamp-1">{notification.title}</p>
        {notification.message && (
          <p className="text-xs text-[#71717A] mt-0.5 line-clamp-2">{notification.message}</p>
        )}
        <p className="text-xs text-[#A1A1AA] mt-1">{formatTimeAgo(notification.createdAt)}</p>
      </div>
      {!notification.isRead && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(notification.id);
          }}
          className="flex-shrink-0 p-1.5 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors"
          title="Позначити прочитаним"
        >
          <Check size={16} />
        </button>
      )}
    </motion.div>
  );
};

// Main AdminNotifications component
const AdminNotifications = ({ token }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all, unread
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/notifications?limit=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return;
    
    try {
      const response = await fetch(`${API_URL}/api/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const { count } = await response.json();
        setUnreadCount(count);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, [token]);

  // Initial load and polling
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full list when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark single notification as read
  const markAsRead = async (id) => {
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, isRead: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Navigate to entity
  const handleNavigate = (notification) => {
    const config = notificationConfig[notification.type] || notificationConfig.system;
    
    // Mark as read
    if (!notification.isRead) {
      markAsRead(notification.id);
    }
    
    // Navigate
    let route = config.route;
    if (notification.entityId) {
      route = `${route}/${notification.entityId}`;
    }
    
    setIsOpen(false);
    navigate(route);
  };

  // Filter notifications
  const filteredNotifications = filter === 'unread' 
    ? notifications.filter(n => !n.isRead)
    : notifications;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2.5 rounded-xl transition-all ${
          isOpen 
            ? 'bg-[#EEF2FF] text-[#4F46E5]' 
            : 'text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5]'
        }`}
        data-testid="admin-notifications-btn"
      >
        {unreadCount > 0 ? (
          <BellRinging size={20} weight="duotone" className="animate-pulse" />
        ) : (
          <Bell size={20} weight="duotone" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-[#DC2626] text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed md:absolute right-2 md:right-0 left-2 md:left-auto top-16 md:top-full md:mt-2 w-auto md:w-[400px] max-w-[calc(100vw-16px)] bg-white rounded-2xl shadow-xl border border-[#E4E4E7] overflow-hidden z-50"
            data-testid="notifications-dropdown"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA]">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
                  Сповіщення
                </h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-[#4F46E5] text-white text-xs font-semibold rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-[#4F46E5] hover:underline font-medium"
                >
                  Прочитати всі
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-[#E4E4E7]">
              <button
                onClick={() => setFilter('all')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  filter === 'all' 
                    ? 'text-[#4F46E5] border-b-2 border-[#4F46E5]' 
                    : 'text-[#71717A] hover:text-[#18181B]'
                }`}
              >
                Усі
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  filter === 'unread' 
                    ? 'text-[#4F46E5] border-b-2 border-[#4F46E5]' 
                    : 'text-[#71717A] hover:text-[#18181B]'
                }`}
              >
                Непрочитані
              </button>
            </div>

            {/* Notifications List */}
            <div className="max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <Bell size={40} weight="duotone" className="mx-auto text-[#D4D4D8] mb-3" />
                  <p className="text-sm text-[#71717A]">
                    {filter === 'unread' ? 'Немає непрочитаних сповіщень' : 'Немає сповіщень'}
                  </p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {filteredNotifications.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={markAsRead}
                      onNavigate={handleNavigate}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-[#E4E4E7] p-3">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/admin/notifications');
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                >
                  Переглянути всі сповіщення
                  <CaretRight size={16} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminNotifications;
