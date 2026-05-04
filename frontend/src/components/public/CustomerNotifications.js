import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellRinging,
  Car,
  Tag,
  Clock,
  Check,
  X,
  CaretRight,
  TelegramLogo,
} from '@phosphor-icons/react';
import { API_URL } from '../../App';

/**
 * Customer Notifications Page
 * 
 * Shows all notifications for the customer:
 * - Auction soon alerts
 * - Price drop alerts
 * - Deal status changes
 * - Recommendations
 */

export const CustomerNotificationsPage = ({ customerId, customerToken }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // all, unread

  useEffect(() => {
    loadNotifications();
    loadUnreadCount();
  }, [customerId, filter]);

  const loadNotifications = async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'unread') params.append('unread', 'true');
      params.append('limit', '50');

      const res = await axios.get(
        `${API_URL}/api/notifications/customer/me?${params.toString()}`,
        { headers: { Authorization: `Bearer ${customerToken}` } }
      );
      setNotifications(res.data || []);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const res = await axios.get(
        `${API_URL}/api/notifications/customer/unread-count`,
        { headers: { Authorization: `Bearer ${customerToken}` } }
      );
      setUnreadCount(res.data.count || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  const markAsRead = async (id) => {
    try {
      await axios.patch(
        `${API_URL}/api/notifications/customer/${id}/read`,
        {},
        { headers: { Authorization: `Bearer ${customerToken}` } }
      );
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, isRead: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      toast.error('Помилка при оновленні');
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'auction_soon':
        return <Clock size={20} weight="fill" className="text-amber-500" />;
      case 'price_drop':
        return <Tag size={20} weight="fill" className="text-green-500" />;
      case 'deal_status_changed':
        return <Car size={20} weight="fill" className="text-blue-500" />;
      case 'listing_sold':
        return <X size={20} weight="fill" className="text-red-500" />;
      case 'recommendation':
        return <BellRinging size={20} weight="fill" className="text-purple-500" />;
      default:
        return <Bell size={20} className="text-gray-500" />;
    }
  };

  const getNotificationBg = (type, isRead) => {
    if (isRead) return 'bg-white';
    switch (type) {
      case 'auction_soon':
        return 'bg-amber-50 border-amber-200';
      case 'price_drop':
        return 'bg-green-50 border-green-200';
      case 'deal_status_changed':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="customer-notifications-page">
      {/* Header */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#18181B] flex items-center gap-3">
              <Bell size={28} />
              Сповіщення
            </h1>
            <p className="text-[#71717A] mt-1">
              {unreadCount > 0 ? `${unreadCount} непрочитаних` : 'Всі прочитані'}
            </p>
          </div>
          
          {/* Filter buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-[#18181B] text-white'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:bg-[#E4E4E7]'
              }`}
              data-testid="filter-all"
            >
              Всі
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === 'unread'
                  ? 'bg-[#18181B] text-white'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:bg-[#E4E4E7]'
              }`}
              data-testid="filter-unread"
            >
              Непрочитані
            </button>
          </div>
        </div>
      </div>

      {/* Telegram link banner */}
      <div className="bg-gradient-to-r from-[#0088cc] to-[#229ED9] text-white rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <TelegramLogo size={40} weight="fill" />
          <div className="flex-1">
            <h3 className="font-semibold">Отримуйте сповіщення в Telegram</h3>
            <p className="text-white/80 text-sm mt-1">
              Миттєві сповіщення про аукціони та зниження цін
            </p>
          </div>
          <a
            href="https://t.me/BIBICarsBot"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-[#0088cc] px-5 py-2 rounded-xl font-medium hover:bg-white/90 transition-colors"
            data-testid="telegram-link"
          >
            Підключити
          </a>
        </div>
      </div>

      {/* Notifications list */}
      {notifications.length > 0 ? (
        <div className="space-y-3">
          <AnimatePresence>
            {notifications.map((notification, idx) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: idx * 0.05 }}
                className={`border rounded-2xl p-5 transition-colors ${getNotificationBg(notification.type, notification.isRead)}`}
                data-testid={`notification-${notification.id}`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                    {getNotificationIcon(notification.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className={`font-semibold ${notification.isRead ? 'text-[#71717A]' : 'text-[#18181B]'}`}>
                          {notification.title}
                        </h3>
                        <p className="text-sm text-[#71717A] mt-1 whitespace-pre-line">
                          {notification.message}
                        </p>
                      </div>
                      
                      {!notification.isRead && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="text-[#71717A] hover:text-[#18181B] transition-colors p-1"
                          title="Позначити як прочитане"
                          data-testid={`mark-read-${notification.id}`}
                        >
                          <Check size={20} />
                        </button>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 mt-3">
                      <span className="text-xs text-[#A1A1AA]">
                        {new Date(notification.createdAt).toLocaleString('uk-UA')}
                      </span>
                      
                      {notification.meta?.link && (
                        <a
                          href={notification.meta.link}
                          className="text-sm text-[#4F46E5] hover:underline flex items-center gap-1"
                        >
                          Переглянути <CaretRight size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-12 text-center">
          <Bell size={48} className="text-[#D4D4D8] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#18181B]">Немає сповіщень</h3>
          <p className="text-[#71717A] mt-1">
            {filter === 'unread' ? 'Всі сповіщення прочитані' : 'Сповіщення з\'являться тут'}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Notification Bell Component (for header)
 */
export const NotificationBell = ({ customerToken, onClick }) => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!customerToken) return;
    
    const loadCount = async () => {
      try {
        const res = await axios.get(
          `${API_URL}/api/notifications/customer/unread-count`,
          { headers: { Authorization: `Bearer ${customerToken}` } }
        );
        setUnreadCount(res.data.count || 0);
      } catch (error) {
        console.error('Failed to load unread count:', error);
      }
    };

    loadCount();
    // Poll every 30 seconds
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, [customerToken]);

  return (
    <button
      onClick={onClick}
      className="relative p-2 rounded-lg hover:bg-[#F4F4F5] transition-colors"
      data-testid="notification-bell"
    >
      <Bell size={24} className="text-[#71717A]" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-xs font-medium rounded-full flex items-center justify-center px-1">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
};

export default CustomerNotificationsPage;
