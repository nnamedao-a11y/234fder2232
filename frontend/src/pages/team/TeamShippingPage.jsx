/**
 * BIBI Cars - Team Shipping Watch
 * Shipment monitoring and issue tracking for team lead
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk, enUS, bg } from 'date-fns/locale';
import {
  Truck,
  Warning,
  Clock,
  MapPin,
  ArrowUp,
  ListChecks,
  Eye,
  Check,
  X
} from '@phosphor-icons/react';
import ShipmentTrackingMap from '../../components/shipping/ShipmentTrackingMap';

const TeamShippingPage = () => {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stalled');
  const [selectedShipment, setSelectedShipment] = useState(null);

  const dateLocale = lang === 'uk' ? uk : lang === 'bg' ? bg : enUS;

  useEffect(() => {
    fetchShipments();
  }, [activeTab]);

  const fetchShipments = async () => {
    setLoading(true);
    try {
      let url = `${API_URL}/api/team/shipping`;
      if (activeTab === 'stalled') url = `${API_URL}/api/team/shipping/stalled`;
      else if (activeTab === 'risky') url = `${API_URL}/api/team/shipping/risky`;
      else if (activeTab === 'no_tracking') url += '?issue=no_tracking';
      else if (activeTab === 'eta_changed') url += '?issue=eta_changed';
      else if (activeTab === 'delivered') url += '?status=delivered';

      const res = await axios.get(url).catch(() =>
        axios.get(`${API_URL}/api/shipments`)
      );
      const shipmentsData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.shipments || []);
      setShipments(shipmentsData);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePingManager = async (shipmentId, managerId) => {
    try {
      await axios.post(`${API_URL}/api/notifications`, {
        userId: managerId,
        type: 'shipment_reminder',
        message: t('checkShipmentStatus'),
        entityId: shipmentId
      });
      toast.success(t('managerNotified'));
    } catch (err) {
      toast.error(t('error'));
    }
  };

  const handleCreateTask = async (shipmentId, managerId) => {
    try {
      await axios.post(`${API_URL}/api/tasks`, {
        type: 'shipment_check',
        assigneeId: managerId,
        shipmentId,
        priority: 'high',
        title: t('checkShipmentStatusTask')
      });
      toast.success(t('taskCreated'));
    } catch (err) {
      toast.error(t('error'));
    }
  };

  const handleEscalate = async (shipmentId) => {
    try {
      await axios.post(`${API_URL}/api/alerts`, {
        type: 'shipment_critical',
        severity: 'critical',
        entityId: shipmentId,
        message: t('shipmentEscalated')
      });
      toast.success(t('escalatedToOwner'));
    } catch (err) {
      toast.error(t('error'));
    }
  };

  const tabs = [
    { id: 'no_tracking', label: t('noTracking'), color: '#DC2626' },
    { id: 'stalled', label: t('stalled'), color: '#D97706' },
    { id: 'eta_changed', label: t('etaChanged'), color: '#7C3AED' },
    { id: 'risky', label: t('risky'), color: '#DB2777' },
    { id: 'delivered', label: t('deliveredRecently'), color: '#059669' },
  ];

  const handleViewMap = async (shipmentId) => {
    try {
      const res = await axios.get(`${API_URL}/api/shipments/${shipmentId}`);
      setSelectedShipment(res.data);
    } catch (err) {
      toast.error('Помилка завантаження даних');
    }
  };

  return (
    <motion.div 
      data-testid="team-shipping-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          {t('teamShippingWatch')}
        </h1>
        <p className="text-sm text-[#71717A] mt-1">
          {t('teamShippingWatchDesc')}
        </p>
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
            {tab.label}
          </button>
        ))}
      </div>

      {/* Shipments Table */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full mx-auto"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F4F4F5]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#71717A] uppercase">{t('shipment')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#71717A] uppercase">{t('deal')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('manager')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('tracking')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('status')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('eta')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('lastSync')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('riskScore')}</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {shipments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-[#71717A]">
                      {t('noShipments')}
                    </td>
                  </tr>
                ) : (
                  shipments.map((ship, idx) => (
                    <motion.tr
                      key={ship._id || idx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="hover:bg-[#FAFAFA] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm font-medium text-[#18181B]">
                          {ship.vin?.slice(-8) || 'N/A'}
                        </div>
                        <div className="text-xs text-[#71717A]">
                          {ship.containerNumber || ship.bookingNumber || t('noContainer')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#71717A]">
                          {ship.dealId?.slice(-6) || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">
                        {ship.managerName || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ship.trackingActive ? (
                          <span className="inline-flex items-center gap-1 text-[#059669] text-xs">
                            <Check size={14} weight="bold" /> {t('active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#DC2626] text-xs">
                            <Warning size={14} weight="fill" /> {t('none')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          ship.status === 'delivered' ? 'bg-[#ECFDF5] text-[#059669]' :
                          ship.status === 'in_transit' ? 'bg-[#EEF2FF] text-[#4F46E5]' :
                          ship.status === 'customs' ? 'bg-[#FEF3C7] text-[#D97706]' :
                          'bg-[#F4F4F5] text-[#71717A]'
                        }`}>
                          {t(`shipmentStatus_${ship.status}`) || ship.status?.replace('_', ' ') || t('unknown')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-[#71717A]">
                        {ship.eta ? format(new Date(ship.eta), 'dd MMM', { locale: dateLocale }) : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-[#71717A]">
                        {ship.lastSyncAt ? format(new Date(ship.lastSyncAt), 'dd MMM, HH:mm', { locale: dateLocale }) : t('never')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${
                          (ship.riskScore || 0) >= 70 ? 'text-[#DC2626]' :
                          (ship.riskScore || 0) >= 40 ? 'text-[#D97706]' : 'text-[#059669]'
                        }`}>
                          {ship.riskScore || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleViewMap(ship._id || ship.id)}
                            className="p-2 text-[#71717A] hover:text-[#3B82F6] hover:bg-[#EFF6FF] rounded-lg transition-colors"
                            title="Показати на карті"
                          >
                            <MapPin size={16} />
                          </button>
                          <button
                            onClick={() => handlePingManager(ship._id, ship.managerId)}
                            className="p-2 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                            title={t('pingManager')}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => handleCreateTask(ship._id, ship.managerId)}
                            className="p-2 text-[#71717A] hover:text-[#059669] hover:bg-[#ECFDF5] rounded-lg transition-colors"
                            title={t('createTask')}
                          >
                            <ListChecks size={16} />
                          </button>
                          <button
                            onClick={() => handleEscalate(ship._id)}
                            className="p-2 text-[#71717A] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                            title={t('escalate')}
                          >
                            <ArrowUp size={16} />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Map Modal */}
      {selectedShipment && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedShipment(null)}
        >
          <div 
            className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg text-zinc-900">Трекінг доставки</h3>
                <p className="text-sm text-zinc-500 font-mono mt-1">VIN: {selectedShipment.vin}</p>
              </div>
              <button
                onClick={() => setSelectedShipment(null)}
                className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <ShipmentTrackingMap shipment={selectedShipment} />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TeamShippingPage;
