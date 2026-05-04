/**
 * ShippingTimeline Component
 * 
 * Displays the shipment timeline with status, events, and ETA
 */

import React from 'react';
import { motion } from 'framer-motion';
import { 
  Package, 
  Ship, 
  Anchor, 
  Truck, 
  FileCheck, 
  CheckCircle,
  Clock,
  MapPin,
  Calendar,
  AlertCircle
} from 'lucide-react';

// Status configuration with icons and colors
const STATUS_CONFIG = {
  deal_created: { icon: FileCheck, label: 'Угода створена', color: 'gray' },
  contract_signed: { icon: FileCheck, label: 'Договір підписано', color: 'blue' },
  deposit_paid: { icon: CheckCircle, label: 'Депозит сплачено', color: 'green' },
  lot_paid: { icon: CheckCircle, label: 'Лот сплачено', color: 'green' },
  transport_to_port: { icon: Truck, label: 'Транспортування до порту', color: 'yellow' },
  at_origin_port: { icon: Anchor, label: 'У порту відправлення', color: 'blue' },
  loaded_on_vessel: { icon: Ship, label: 'Завантажено на судно', color: 'blue' },
  in_transit: { icon: Ship, label: 'У дорозі', color: 'purple' },
  at_destination_port: { icon: Anchor, label: 'У порту призначення', color: 'blue' },
  customs: { icon: FileCheck, label: 'Митне оформлення', color: 'orange' },
  ready_for_pickup: { icon: Package, label: 'Готово до видачі', color: 'green' },
  delivered: { icon: CheckCircle, label: 'Доставлено', color: 'green' },
  cancelled: { icon: AlertCircle, label: 'Скасовано', color: 'red' },
};

const ORDERED_STATUSES = [
  'deal_created',
  'contract_signed',
  'deposit_paid',
  'lot_paid',
  'transport_to_port',
  'at_origin_port',
  'loaded_on_vessel',
  'in_transit',
  'at_destination_port',
  'customs',
  'ready_for_pickup',
  'delivered',
];

const getStatusIndex = (status) => {
  return ORDERED_STATUSES.indexOf(status);
};

const getColorClasses = (color, isActive, isPast) => {
  if (isPast) {
    return {
      bg: 'bg-green-500',
      border: 'border-green-500',
      text: 'text-green-600',
      line: 'bg-green-500',
    };
  }
  if (isActive) {
    const colors = {
      gray: { bg: 'bg-gray-500', border: 'border-gray-500', text: 'text-gray-600', line: 'bg-gray-300' },
      blue: { bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-600', line: 'bg-blue-300' },
      green: { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-600', line: 'bg-green-300' },
      yellow: { bg: 'bg-yellow-500', border: 'border-yellow-500', text: 'text-yellow-600', line: 'bg-yellow-300' },
      orange: { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-600', line: 'bg-orange-300' },
      purple: { bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-600', line: 'bg-purple-300' },
      red: { bg: 'bg-red-500', border: 'border-red-500', text: 'text-red-600', line: 'bg-red-300' },
    };
    return colors[color] || colors.gray;
  }
  return {
    bg: 'bg-gray-200',
    border: 'border-gray-300',
    text: 'text-gray-400',
    line: 'bg-gray-200',
  };
};

export function ShippingTimeline({ shipment }) {
  if (!shipment) return null;

  const currentIndex = getStatusIndex(shipment.currentStatus);

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
        <Ship className="h-5 w-5 text-blue-600" />
        Статус доставки
      </h3>

      {/* Main info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 uppercase">VIN</p>
          <p className="font-mono text-sm font-medium">{shipment.vin}</p>
        </div>
        {shipment.containerNumber && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">Контейнер</p>
            <p className="font-mono text-sm font-medium">{shipment.containerNumber}</p>
          </div>
        )}
        {shipment.vesselName && (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">Судно</p>
            <p className="text-sm font-medium">{shipment.vesselName}</p>
          </div>
        )}
        {shipment.eta && (
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-blue-600 uppercase">Очікувана дата</p>
            <p className="text-sm font-medium text-blue-700">
              {new Date(shipment.eta).toLocaleDateString('uk-UA')}
            </p>
          </div>
        )}
      </div>

      {/* Route info */}
      {(shipment.originPort || shipment.destinationPort) && (
        <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
          <div className="text-center">
            <MapPin className="h-5 w-5 text-blue-600 mx-auto" />
            <p className="text-xs text-gray-500 mt-1">Звідки</p>
            <p className="font-medium text-sm">{shipment.originPort || 'USA'}</p>
          </div>
          <div className="flex-1 border-t-2 border-dashed border-gray-300 relative">
            <Ship className="absolute left-1/2 -translate-x-1/2 -top-3 h-6 w-6 text-blue-500 bg-white" />
          </div>
          <div className="text-center">
            <MapPin className="h-5 w-5 text-green-600 mx-auto" />
            <p className="text-xs text-gray-500 mt-1">Куди</p>
            <p className="font-medium text-sm">{shipment.destinationPort || 'Ukraine'}</p>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {ORDERED_STATUSES.slice(0, -1).map((status, index) => {
          const config = STATUS_CONFIG[status];
          const isPast = index < currentIndex;
          const isActive = index === currentIndex;
          const isFuture = index > currentIndex;
          const colors = getColorClasses(config.color, isActive, isPast);
          const Icon = config.icon;

          // Skip cancelled status in normal timeline
          if (status === 'cancelled') return null;

          return (
            <motion.div
              key={status}
              className="flex items-start mb-4 last:mb-0"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex flex-col items-center mr-4">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${colors.bg} ${
                    isFuture ? 'opacity-50' : ''
                  }`}
                >
                  <Icon className="h-4 w-4 text-white" />
                </div>
                {index < ORDERED_STATUSES.length - 2 && (
                  <div className={`w-0.5 h-8 ${isPast ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </div>
              <div className={`flex-1 ${isFuture ? 'opacity-50' : ''}`}>
                <p className={`font-medium text-sm ${isActive ? colors.text : 'text-gray-700'}`}>
                  {config.label}
                </p>
                {isActive && shipment.currentPort && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {shipment.currentPort}
                  </p>
                )}
              </div>
              {isPast && (
                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              )}
              {isActive && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                  Зараз
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function ShipmentEventsList({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-gray-600" />
          Історія подій
        </h3>
        <p className="text-gray-500 text-center py-8">Поки немає подій</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Clock className="h-5 w-5 text-gray-600" />
        Історія подій
      </h3>
      <div className="space-y-4">
        {events.map((event, index) => (
          <motion.div
            key={event.id || index}
            className="flex gap-4 p-3 bg-gray-50 rounded-lg"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Calendar className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{event.title}</p>
              {event.description && (
                <p className="text-sm text-gray-600 mt-1">{event.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                {event.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {event.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(event.eventDate).toLocaleDateString('uk-UA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default ShippingTimeline;
