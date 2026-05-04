/**
 * BIBI Cars - Manager Shipments Page
 * Manager's shipment tracking
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  Truck,
  Warning,
  Check,
  Clock,
  MapPin,
  Plus,
  Eye
} from '@phosphor-icons/react';

const ManagerShipmentsPage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTracking, setShowAddTracking] = useState(null);
  const [trackingNumber, setTrackingNumber] = useState('');

  useEffect(() => {
    fetchShipments();
  }, []);

  const fetchShipments = async () => {
    try {
      const userId = user?._id || user?.id;
      const res = await axios.get(`${API_URL}/api/shipments?managerId=${userId}`).catch(() => ({ data: [] }));
      const shipmentsData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.shipments || []);
      setShipments(shipmentsData);
    } catch (err) {
      console.error('Error:', err);
      setShipments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTracking = async (shipmentId) => {
    if (!trackingNumber.trim()) {
      toast.error('Введіть номер трекінгу');
      return;
    }
    try {
      await axios.patch(`${API_URL}/api/shipments/${shipmentId}`, {
        containerNumber: trackingNumber,
        trackingActive: true
      });
      toast.success('Tracking added');
      setShowAddTracking(null);
      setTrackingNumber('');
      fetchShipments();
    } catch (err) {
      toast.error('Помилка');
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
      data-testid="manager-shipments-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          My Shipments
        </h1>
        <p className="text-sm text-[#71717A] mt-1">
          Відстеження доставки авто
        </p>
      </div>

      {/* Shipments List */}
      <div className="space-y-4">
        {shipments.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E4E4E7] p-12 text-center">
            <Truck size={48} className="text-[#71717A] mx-auto mb-4" weight="duotone" />
            <p className="text-lg font-medium text-[#18181B]">Немає активних відправлень</p>
            <p className="text-sm text-[#71717A]">Відправлення з'являться тут після створення угоди</p>
          </div>
        ) : (
          shipments.map((ship, idx) => (
            <motion.div
              key={ship._id || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-white rounded-2xl border border-[#E4E4E7] p-5"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-mono text-lg font-bold text-[#18181B]">
                      {ship.vin || 'VIN N/A'}
                    </h3>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                      ship.status === 'delivered' ? 'bg-[#ECFDF5] text-[#059669]' :
                      ship.status === 'in_transit' ? 'bg-[#EEF2FF] text-[#4F46E5]' :
                      ship.status === 'customs' ? 'bg-[#FEF3C7] text-[#D97706]' :
                      'bg-[#F4F4F5] text-[#71717A]'
                    }`}>
                      {ship.status?.replace('_', ' ') || 'unknown'}
                    </span>
                  </div>
                  <p className="text-sm text-[#71717A]">
                    Customer: {ship.customerName || 'N/A'}
                  </p>
                </div>
                {ship.trackingActive ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#ECFDF5] text-[#059669] text-sm font-medium rounded-xl">
                    <Check size={16} weight="bold" /> Tracking Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#FEF2F2] text-[#DC2626] text-sm font-medium rounded-xl">
                    <Warning size={16} weight="fill" /> No Tracking
                  </span>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-4 bg-[#F4F4F5] rounded-xl">
                <div>
                  <span className="text-xs text-[#71717A]">{t('containerLabel')}</span>
                  <p className="font-medium text-[#18181B]">{ship.containerNumber || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#71717A]">{t('carrierLabel')}</span>
                  <p className="font-medium text-[#18181B]">{ship.carrier || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-xs text-[#71717A]">{t('etaLabel')}</span>
                  <p className="font-medium text-[#18181B]">
                    {ship.eta ? format(new Date(ship.eta), 'dd MMM yyyy', { locale: uk }) : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-[#71717A]">{t('lastSyncLabel')}</span>
                  <p className="font-medium text-[#18181B]">
                    {ship.lastSyncAt ? format(new Date(ship.lastSyncAt), 'dd MMM, HH:mm', { locale: uk }) : t('never')}
                  </p>
                </div>
              </div>

              {/* Add Tracking */}
              {!ship.trackingActive && (
                <>
                  {showAddTracking === ship._id ? (
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={trackingNumber}
                        onChange={e => setTrackingNumber(e.target.value)}
                        placeholder="Container number or tracking ID..."
                        className="flex-1 px-3 py-2 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5]"
                      />
                      <button
                        onClick={() => handleAddTracking(ship._id)}
                        className="px-4 py-2 bg-[#059669] text-white rounded-xl font-medium hover:bg-[#047857]"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setShowAddTracking(null); setTrackingNumber(''); }}
                        className="px-4 py-2 border border-[#E4E4E7] text-[#71717A] rounded-xl hover:bg-[#F4F4F5]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddTracking(ship._id)}
                      className="flex items-center gap-2 px-4 py-2 border border-[#E4E4E7] text-[#4F46E5] rounded-xl hover:bg-[#EEF2FF] transition-colors"
                    >
                      <Plus size={16} /> Add Tracking Number
                    </button>
                  )}
                </>
              )}

              {/* Timeline (if tracking active) */}
              {ship.trackingActive && ship.timeline && ship.timeline.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#E4E4E7]">
                  <h4 className="text-sm font-medium text-[#71717A] mb-3">{t('timelineLabel')}</h4>
                  <div className="space-y-2">
                    {ship.timeline.slice(0, 3).map((event, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <div className="w-2 h-2 bg-[#4F46E5] rounded-full"></div>
                        <span className="text-[#18181B]">{event.status}</span>
                        <span className="text-[#71717A] ml-auto">
                          {event.date ? format(new Date(event.date), 'dd MMM', { locale: uk }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
};

export default ManagerShipmentsPage;
