import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCircle, Warning, WarningCircle, X } from '@phosphor-icons/react';
import { useNotifications } from '../hooks/useNotifications';
import { useLang } from '../i18n';
import { useAuth } from '../App';
import { motion, AnimatePresence } from 'framer-motion';

const NotificationBell = () => {
  const { t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const {
    notifications,
    unreadCount,
    connected,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
  } = useNotifications({
    userId: user?.id || user?.sub,
    role: user?.role,
    soundEnabled: true,
    onNotification: (notification) => {
      // Show toast or other UI feedback
      console.log('New notification:', notification);
    },
  });

  // Fetch notifications on mount
  useEffect(() => {
    if (user?.id || user?.sub) {
      fetchNotifications();
    }
  }, [user, fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return <WarningCircle size={16} className="text-red-500" weight="fill" />;
      case 'warning':
        return <Warning size={16} className="text-amber-500" weight="fill" />;
      default:
        return <Bell size={16} className="text-blue-500" weight="fill" />;
    }
  };

  const getSeverityBg = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-100';
      case 'warning':
        return 'bg-amber-50 border-amber-100';
      default:
        return 'bg-blue-50 border-blue-100';
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = (now - date) / 1000;

    if (diff < 60) return t('justNow') || 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} ${t('minutesAgo') || 'min ago'}`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ${t('hoursAgo') || 'h ago'}`;
    return date.toLocaleDateString();
  };

  const handleNotificationClick = (notification) => {
    if (!notification.isRead) {
      markAsRead(notification.id);
    }
    const link = notification.meta?.link;
    if (link) {
      // SPA navigation — no full page reload
      if (link.startsWith('http://') || link.startsWith('https://')) {
        window.open(link, '_blank', 'noopener,noreferrer');
      } else {
        navigate(link);
      }
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef} data-testid="notification-bell">
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl hover:bg-zinc-100 transition-colors"
        data-testid="notification-bell-button"
      >
        <Bell size={22} weight={unreadCount > 0 ? 'fill' : 'regular'} className="text-zinc-600" />
        
        {/* Unread Badge */}
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center 
                       rounded-full bg-red-500 text-white text-xs font-bold px-1"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
        
        {/* Connection indicator */}
        <span 
          className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${
            connected ? 'bg-emerald-500' : 'bg-zinc-300'
          }`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-96 max-h-[480px] bg-white rounded-2xl shadow-xl 
                       border border-zinc-200 overflow-hidden z-50"
            data-testid="notification-dropdown"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">
                {t('notifications') || 'Notifications'}
              </h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 
                               hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Check size={14} />
                    {t('markAllRead') || 'Mark all read'}
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-zinc-100 rounded-lg transition-colors"
                >
                  <X size={16} className="text-zinc-400" />
                </button>
              </div>
            </div>

            {/* Notifications List */}
            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell size={40} className="mx-auto text-zinc-300 mb-3" />
                  <p className="text-zinc-500 text-sm">
                    {t('noNotifications') || 'No notifications yet'}
                  </p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`p-4 border-b border-zinc-50 cursor-pointer hover:bg-zinc-50 transition-colors
                               ${!notification.isRead ? 'bg-blue-50/30' : ''}`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex gap-3">
                      {/* Icon */}
                      <div className={`flex-shrink-0 p-2 rounded-xl ${getSeverityBg(notification.severity)}`}>
                        {getSeverityIcon(notification.severity)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm text-zinc-900 truncate">
                            {notification.title}
                          </p>
                          {!notification.isRead && (
                            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                          )}
                        </div>
                        <p className="text-sm text-zinc-600 mt-0.5 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-zinc-400 mt-1">
                          {formatTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="p-3 border-t border-zinc-100 bg-zinc-50">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/admin/notifications');
                  }}
                  className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  {t('viewAll') || 'View all notifications'}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationBell;
