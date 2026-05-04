/**
 * ShipmentNotificationToast Component
 * 
 * Displays real-time shipment notifications as toast messages
 * Auto-dismisses after 10 seconds
 */

import React, { useEffect, useState } from 'react';
import { useShipmentNotifications } from '../../hooks/useShipmentNotifications';
import { X, Ship, Calendar, MapPin, CheckCircle } from 'lucide-react';

const STATUS_LABELS = {
  'deal_created': 'Угоду створено',
  'contract_signed': 'Контракт підписано',
  'deposit_paid': 'Депозит оплачено',
  'lot_paid': 'Лот оплачено',
  'transport_to_port': 'Транспортування в порт',
  'at_origin_port': 'В порту відправлення',
  'loaded_on_vessel': 'Завантажено на судно',
  'in_transit': 'В дорозі',
  'at_destination_port': 'Прибуло в порт',
  'customs': 'На митниці',
  'ready_for_pickup': 'Готово до видачі',
  'delivered': 'Доставлено',
};

export function ShipmentNotificationToast() {
  const { lastUpdate, clearUpdate, isConnected } = useShipmentNotifications();
  const [visible, setVisible] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    if (lastUpdate) {
      setNotification(lastUpdate);
      setVisible(true);

      // Auto-dismiss after 10 seconds
      const timer = setTimeout(() => {
        setVisible(false);
        clearUpdate();
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [lastUpdate, clearUpdate]);

  const handleClose = () => {
    setVisible(false);
    clearUpdate();
  };

  if (!visible || !notification) return null;

  const { type, data } = notification;

  const getIcon = () => {
    switch (type) {
      case 'status':
        return <Ship className="w-6 h-6 text-blue-500" />;
      case 'eta':
        return <Calendar className="w-6 h-6 text-yellow-500" />;
      case 'arrived':
        return <MapPin className="w-6 h-6 text-green-500" />;
      case 'ready':
        return <CheckCircle className="w-6 h-6 text-emerald-500" />;
      default:
        return <Ship className="w-6 h-6 text-gray-500" />;
    }
  };

  const getTitle = () => {
    switch (type) {
      case 'status':
        return 'Статус доставки оновлено';
      case 'eta':
        return 'Дата прибуття змінилась';
      case 'arrived':
        return '🎉 Ваше авто прибуло!';
      case 'ready':
        return '🚗 Готово до видачі!';
      default:
        return 'Оновлення доставки';
    }
  };

  const getMessage = () => {
    switch (type) {
      case 'status':
        const newStatusLabel = STATUS_LABELS[data.newStatus] || data.newStatus;
        return `Новий статус: ${newStatusLabel}`;
      case 'eta':
        return `Нова дата: ${data.formattedEta}`;
      case 'arrived':
        return `${data.vehicleTitle || data.vin} прибув у порт`;
      case 'ready':
        return `${data.vehicleTitle || data.vin} можна забирати`;
      default:
        return data.message || 'Перевірте кабінет';
    }
  };

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-white rounded-lg shadow-2xl border border-gray-200 p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-2 bg-gray-50 rounded-full">
            {getIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">
              {getTitle()}
            </h4>
            <p className="mt-1 text-sm text-gray-600">
              {getMessage()}
            </p>
            {data.vin && (
              <p className="mt-1 text-xs text-gray-400">
                VIN: {data.vin}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Progress bar for auto-dismiss */}
        <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 animate-shrink-width"
            style={{ 
              animation: 'shrink 10s linear forwards',
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
        
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
        
        .animate-shrink-width {
          animation: shrink 10s linear forwards;
        }
      `}</style>
    </div>
  );
}

/**
 * Connection Status Indicator
 */
export function WebSocketStatus() {
  const { isConnected } = useShipmentNotifications();

  return (
    <div className="flex items-center gap-2 text-xs">
      <span 
        className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
      <span className="text-gray-500">
        {isConnected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
}

export default ShipmentNotificationToast;
