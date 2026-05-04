/**
 * User Engagement Control Center
 * 
 * Адмін-панель для:
 * - Перегляду топ авто по інтересу (favorites/compare)
 * - Перегляду топ користувачів
 * - Запуску масових кампаній по VIN
 * - Аналітики кампаній
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { 
  Heart, 
  Scales, 
  Fire, 
  Users,
  PaperPlaneTilt,
  MagnifyingGlass,
  ChatCircle,
  EnvelopeSimple,
  Phone,
  ChartLine,
  Lightning,
  CaretDown,
  CaretUp,
  Eye,
  Clock
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';

const UserEngagementPage = () => {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState('vehicles');
  const [loading, setLoading] = useState(true);
  
  // Data
  const [topVehicles, setTopVehicles] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [campaignHistory, setCampaignHistory] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  
  // Campaign form
  const [selectedVin, setSelectedVin] = useState('');
  const [vinSearch, setVinSearch] = useState('');
  const [vinStats, setVinStats] = useState(null);
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  
  // Campaign params
  const [campaignChannel, setCampaignChannel] = useState('sms');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignIntentMin, setCampaignIntentMin] = useState(0);
  const [campaignOnlyHot, setCampaignOnlyHot] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesRes, usersRes, templatesRes, historyRes, analyticsRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/engagement/top-vehicles?limit=50`),
        axios.get(`${API_URL}/api/admin/engagement/top-users?limit=50`),
        axios.get(`${API_URL}/api/admin/engagement/templates`),
        axios.get(`${API_URL}/api/admin/engagement/history?limit=20`),
        axios.get(`${API_URL}/api/admin/engagement/analytics`),
      ]);
      
      setTopVehicles(vehiclesRes.data || []);
      setTopUsers(usersRes.data || []);
      setTemplates(templatesRes.data || []);
      setCampaignHistory(historyRes.data?.items || []);
      setAnalytics(analyticsRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Search VIN stats
  const searchVinStats = async () => {
    if (!vinSearch.trim()) return;
    try {
      const [statsRes, audienceRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/engagement/vin-stats?vin=${vinSearch.trim()}`),
        axios.get(`${API_URL}/api/admin/engagement/audience?vin=${vinSearch.trim()}&intentMin=${campaignIntentMin}&onlyHot=${campaignOnlyHot}`),
      ]);
      setVinStats(statsRes.data);
      setAudiencePreview(audienceRes.data);
      setSelectedVin(vinSearch.trim().toUpperCase());
    } catch (err) {
      toast.error('VIN не знайдено');
    }
  };

  // Open campaign modal for VIN
  const openCampaignModal = (vin) => {
    setSelectedVin(vin);
    setVinSearch(vin);
    setShowCampaignModal(true);
    // Load audience
    axios.get(`${API_URL}/api/admin/engagement/audience?vin=${vin}`).then(res => {
      setAudiencePreview(res.data);
    });
  };

  // Send campaign
  const sendCampaign = async () => {
    if (!selectedVin || !campaignMessage.trim()) {
      toast.error('Заповніть VIN та повідомлення');
      return;
    }

    setSendingCampaign(true);
    try {
      const res = await axios.post(`${API_URL}/api/admin/engagement/campaign`, {
        vin: selectedVin,
        channel: campaignChannel,
        message: campaignMessage,
        filterFavorites: true,
        filterCompare: true,
        intentMin: campaignIntentMin,
        onlyHot: campaignOnlyHot,
      });
      
      toast.success(`Кампанію відправлено! Sent: ${res.data.sentCount}, Failed: ${res.data.failedCount}`);
      setShowCampaignModal(false);
      setCampaignMessage('');
      fetchData();
    } catch (err) {
      toast.error('Помилка відправки кампанії');
    } finally {
      setSendingCampaign(false);
    }
  };

  // Apply template
  const applyTemplate = (template) => {
    setCampaignMessage(template.message);
  };

  const tabs = [
    { id: 'vehicles', label: 'Топ авто', icon: Heart },
    { id: 'users', label: 'Користувачі', icon: Users },
    { id: 'history', label: 'Історія', icon: Clock },
  ];

  if (loading) {
    return (
      <div className="p-6 animate-pulse" data-testid="engagement-loading">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl"></div>)}
        </div>
        <div className="h-96 bg-gray-100 rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6" data-testid="user-engagement-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Lightning className="w-5 h-5 md:w-6 md:h-6 text-amber-500 flex-shrink-0" weight="fill" />
            <span>User Engagement Control</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Масові розсилки та аналітика по favorites/compare
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          Оновити
        </button>
      </div>

      {/* Stats Cards */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard 
            icon={PaperPlaneTilt}
            label="Кампаній"
            value={analytics.totalCampaigns}
            color="purple"
          />
          <StatCard 
            icon={EnvelopeSimple}
            label="Відправлено"
            value={analytics.totalSent}
            color="blue"
          />
          <StatCard 
            icon={Heart}
            label="Топ авто"
            value={topVehicles.length}
            color="red"
          />
          <StatCard 
            icon={Fire}
            label="HOT users"
            value={topUsers.filter(u => u.level === 'hot').length}
            color="orange"
          />
        </div>
      )}

      {/* VIN Search & Quick Campaign */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <MagnifyingGlass className="w-5 h-5 flex-shrink-0" />
          <span>Швидка кампанія по VIN</span>
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={vinSearch}
            onChange={(e) => setVinSearch(e.target.value.toUpperCase())}
            placeholder="Введіть VIN..."
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
            data-testid="vin-search-input"
          />
          <div className="flex gap-2">
            <button
              onClick={searchVinStats}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm whitespace-nowrap"
            >
              Пошук
            </button>
            <button
              onClick={() => vinSearch && openCampaignModal(vinSearch)}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 text-sm whitespace-nowrap"
              data-testid="send-campaign-btn"
            >
              <PaperPlaneTilt className="w-4 h-4 flex-shrink-0" />
              <span>Відправити</span>
            </button>
          </div>
        </div>

        {/* VIN Stats Preview */}
        {vinStats && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-red-600">{vinStats.favoritesCount}</div>
                <div className="text-xs text-gray-500">❤️ Favorites</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{vinStats.comparesCount}</div>
                <div className="text-xs text-gray-500">⚖️ Compare</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-600">{vinStats.hotUsersCount}</div>
                <div className="text-xs text-gray-500">🔥 HOT</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{vinStats.totalInterested}</div>
                <div className="text-xs text-gray-500">👥 Total</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <div className="flex gap-1 min-w-max">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 md:px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'vehicles' && (
          <motion.div
            key="vehicles"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <TopVehiclesTable 
              vehicles={topVehicles} 
              onCampaign={openCampaignModal}
            />
          </motion.div>
        )}

        {activeTab === 'users' && (
          <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <TopUsersTable users={topUsers} />
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CampaignHistoryTable campaigns={campaignHistory} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Campaign Modal */}
      {showCampaignModal && (
        <CampaignModal
          vin={selectedVin}
          audience={audiencePreview}
          templates={templates}
          channel={campaignChannel}
          setChannel={setCampaignChannel}
          message={campaignMessage}
          setMessage={setCampaignMessage}
          intentMin={campaignIntentMin}
          setIntentMin={setCampaignIntentMin}
          onlyHot={campaignOnlyHot}
          setOnlyHot={setCampaignOnlyHot}
          onApplyTemplate={applyTemplate}
          onSend={sendCampaign}
          onClose={() => setShowCampaignModal(false)}
          sending={sendingCampaign}
        />
      )}
    </div>
  );
};

// Stat Card Component
const StatCard = ({ icon: Icon, label, value, color }) => {
  const colors = {
    purple: 'bg-purple-50 text-purple-600',
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-4" data-testid="stat-card">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs md:text-sm text-gray-500 truncate">{label}</p>
          <p className="text-xl md:text-2xl font-bold mt-0.5">{value}</p>
        </div>
        <div className={`p-2 md:p-3 rounded-lg flex-shrink-0 ${colors[color]}`}>
          <Icon className="w-4 h-4 md:w-5 md:h-5" weight="fill" />
        </div>
      </div>
    </div>
  );
};

// Top Vehicles Table
const TopVehiclesTable = ({ vehicles, onCampaign }) => {
  if (!vehicles.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
        <Heart className="w-12 h-12 mx-auto text-gray-300 mb-2" />
        <p>Немає даних про favorites/compare</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="top-vehicles-table">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">VIN</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">❤️ Favorites</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">⚖️ Compare</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">🔥 HOT</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">👥 Total</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vehicles.map((vehicle, idx) => (
              <tr key={vehicle.vin} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {vehicle.vin}
                  </code>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                    <Heart className="w-4 h-4" weight="fill" />
                    {vehicle.favoritesCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-blue-600 font-semibold">
                    <Scales className="w-4 h-4" weight="fill" />
                    {vehicle.comparesCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-orange-600 font-semibold">
                    <Fire className="w-4 h-4" weight="fill" />
                    {vehicle.hotUsersCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-center font-bold text-purple-600">
                  {vehicle.totalInterested}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onCampaign(vehicle.vin)}
                    className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium flex items-center gap-1 ml-auto"
                    data-testid={`campaign-btn-${vehicle.vin}`}
                  >
                    <PaperPlaneTilt className="w-4 h-4" />
                    Campaign
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Top Users Table
const TopUsersTable = ({ users }) => {
  const getIntentBadge = (level, score) => {
    if (level === 'hot') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
          <Fire className="w-3 h-3" weight="fill" /> HOT {score}
        </span>
      );
    }
    if (level === 'warm') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">
          WARM {score}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
        COLD {score}
      </span>
    );
  };

  if (!users.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
        <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
        <p>Немає даних</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="top-users-table">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Intent</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">❤️</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">⚖️</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">📋</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.userId || user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">
                    {user.context?.name || user.name || (user.userId || user.id || '').substring(0, 12) || '-'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {user.context?.email || user.email || user.context?.phone || '-'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {getIntentBadge(user.level, user.score)}
                </td>
                <td className="px-4 py-3 text-center text-sm">{user.favoritesCount || 0}</td>
                <td className="px-4 py-3 text-center text-sm">{user.comparesCount || 0}</td>
                <td className="px-4 py-3 text-center text-sm">{user.historyRequestsCount || 0}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {user.lastActivityAt 
                    ? new Date(user.lastActivityAt).toLocaleDateString('uk-UA')
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Campaign History Table
const CampaignHistoryTable = ({ campaigns }) => {
  const getStatusBadge = (status) => {
    const colors = {
      completed: 'bg-green-100 text-green-700',
      sending: 'bg-yellow-100 text-yellow-700',
      pending: 'bg-gray-100 text-gray-700',
      failed: 'bg-red-100 text-red-700',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
        {status?.toUpperCase()}
      </span>
    );
  };

  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'sms': return <Phone className="w-4 h-4" />;
      case 'telegram': return <ChatCircle className="w-4 h-4" />;
      case 'whatsapp': return <ChatCircle className="w-4 h-4" />;
      case 'email': return <EnvelopeSimple className="w-4 h-4" />;
      default: return <PaperPlaneTilt className="w-4 h-4" />;
    }
  };

  if (!campaigns.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
        <Clock className="w-12 h-12 mx-auto text-gray-300 mb-2" />
        <p>Немає історії кампаній</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid="campaign-history-table">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">VIN</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Channel</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sent</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Failed</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {campaigns.map((campaign, idx) => (
              <tr key={campaign._id || idx} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {campaign.vin}
                  </code>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    {getChannelIcon(campaign.channel)}
                    {campaign.channel?.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {getStatusBadge(campaign.status)}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-green-600">
                  {campaign.sentCount}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-red-600">
                  {campaign.failedCount}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {campaign.createdAt 
                    ? new Date(campaign.createdAt).toLocaleString('uk-UA')
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Campaign Modal
const CampaignModal = ({
  vin,
  audience,
  templates,
  channel,
  setChannel,
  message,
  setMessage,
  intentMin,
  setIntentMin,
  onlyHot,
  setOnlyHot,
  onApplyTemplate,
  onSend,
  onClose,
  sending,
}) => {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" data-testid="campaign-modal">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6"
        >
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <PaperPlaneTilt className="w-6 h-6 text-purple-600" />
            Кампанія для VIN
          </h2>
          
          <div className="mb-4 p-3 bg-gray-100 rounded-lg">
            <code className="text-sm font-mono">{vin}</code>
            {audience && (
              <div className="text-xs text-gray-500 mt-1">
                {audience.totalUsers} користувачів буде отримати повідомлення
              </div>
            )}
          </div>

          {/* Channel Select */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Канал</label>
            <div className="grid grid-cols-4 gap-2">
              {['sms', 'telegram', 'whatsapp', 'email'].map(ch => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    channel === ch
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {ch.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Templates */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Шаблони</label>
            <div className="flex flex-wrap gap-2">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => onApplyTemplate(template)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Повідомлення</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Текст повідомлення... Використовуйте {vin}, {name}"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              data-testid="campaign-message-input"
            />
            <div className="text-xs text-gray-500 mt-1">
              Placeholder: {'{vin}'}, {'{name}'}, {'{score}'}
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700">Мін. Intent Score</label>
              <input
                type="number"
                min={0}
                max={100}
                value={intentMin}
                onChange={(e) => setIntentMin(parseInt(e.target.value) || 0)}
                className="w-20 px-3 py-1 border border-gray-300 rounded-lg text-center"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700">Тільки HOT users</label>
              <button
                onClick={() => setOnlyHot(!onlyHot)}
                className={`w-12 h-6 rounded-full transition-colors ${
                  onlyHot ? 'bg-purple-600' : 'bg-gray-300'
                }`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  onlyHot ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Скасувати
            </button>
            <button
              onClick={onSend}
              disabled={sending || !message.trim()}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="send-campaign-confirm-btn"
            >
              {sending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Відправка...
                </>
              ) : (
                <>
                  <PaperPlaneTilt className="w-4 h-4" />
                  Відправити
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default UserEngagementPage;
