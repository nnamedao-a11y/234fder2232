/**
 * Intent Dashboard Page
 * 
 * Admin page for monitoring user intent scores and HOT leads
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { 
  Fire, 
  ThermometerHot, 
  Snowflake,
  Users,
  TrendUp,
  Phone,
  Eye,
  ArrowRight,
  ChartLine,
  Lightning,
  Robot
} from '@phosphor-icons/react';
import ManagerAIWidget from '../components/crm/ManagerAIWidget';
import { motion } from 'framer-motion';

const IntentDashboard = () => {
  const { t, lang } = useLang();
  const [analytics, setAnalytics] = useState(null);
  const [hotLeads, setHotLeads] = useState([]);
  const [allScores, setAllScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showAIPanel, setShowAIPanel] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [analyticsRes, hotRes, scoresRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/intent/analytics`),
        axios.get(`${API_URL}/api/admin/intent/hot-leads`),
        axios.get(`${API_URL}/api/admin/intent/scores?limit=50`),
      ]);
      setAnalytics(analyticsRes.data);
      setHotLeads(hotRes.data);
      setAllScores(scoresRes.data.items || []);
    } catch (err) {
      toast.error('Помилка завантаження даних');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const markNotified = async (userId) => {
    try {
      await axios.post(`${API_URL}/api/admin/intent/mark-notified/${userId}`);
      toast.success('Позначено як оброблено');
      fetchData();
    } catch (err) {
      toast.error('Помилка');
    }
  };

  const getIntentBadge = (level, score) => {
    if (level === 'hot') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" data-testid="intent-badge-hot">
          <Fire className="w-3 h-3" weight="fill" /> HOT {score}
        </span>
      );
    }
    if (level === 'warm') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700" data-testid="intent-badge-warm">
          <ThermometerHot className="w-3 h-3" weight="fill" /> WARM {score}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700" data-testid="intent-badge-cold">
        <Snowflake className="w-3 h-3" weight="fill" /> COLD {score}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-6 animate-pulse" data-testid="intent-dashboard-loading">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl"></div>
          ))}
        </div>
        <div className="h-64 bg-gray-100 rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="intent-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ChartLine className="w-6 h-6 text-purple-600" weight="bold" />
            {t('intentDashboardTitle')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('intentDashboardSubtitle')}
          </p>
        </div>
        <button 
          onClick={fetchData}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
        >
          <TrendUp className="w-4 h-4" />
          {t('refresh')}
        </button>
      </div>

      {/* Stats Cards */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            icon={Fire} 
            label={t('hotLeads')}
            value={analytics.levels.hot}
            color="red"
            testId="stat-hot"
          />
          <StatCard 
            icon={ThermometerHot} 
            label={t('warmUsers')}
            value={analytics.levels.warm}
            color="yellow"
            testId="stat-warm"
          />
          <StatCard 
            icon={Snowflake} 
            label={t('coldUsers')}
            value={analytics.levels.cold}
            color="blue"
            testId="stat-cold"
          />
          <StatCard 
            icon={Lightning} 
            label={t('autoLeads')}
            value={analytics.autoLeadsCreated || 0}
            color="green"
            testId="stat-autoleads"
          />
        </div>
      )}

      {/* Additional Stats */}
      {analytics && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">{t('totalUsersWithIntent')}</div>
            <div className="text-3xl font-bold text-gray-900">{analytics.total}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">{t('averageScore')}</div>
            <div className="text-3xl font-bold text-purple-600">{analytics.avgScore?.toFixed(1) || 0}</div>
          </div>
        </div>
      )}

      {/* HOT Leads Section */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 bg-red-50">
          <div className="flex items-center gap-2">
            <Fire className="w-5 h-5 text-red-600" weight="fill" />
            <h2 className="font-semibold text-red-800">🔥 HOT Leads - Терміново!</h2>
            <span className="ml-auto px-2 py-1 bg-red-100 text-red-700 text-sm font-bold rounded-full">
              {hotLeads.length}
            </span>
          </div>
        </div>

        {hotLeads.length === 0 ? (
          <div className="p-8 text-center text-gray-500" data-testid="no-hot-leads">
            <Fire className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Немає HOT leads</p>
            <p className="text-sm">Користувачі набирають score через favorites, compare, history</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {hotLeads.map((lead, idx) => (
              <motion.div 
                key={lead.userId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <Fire className="w-5 h-5 text-red-600" weight="fill" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {lead.context?.name || `User ${lead.userId.substring(0, 8)}`}
                      </div>
                      <div className="text-sm text-gray-500">
                        {lead.context?.email || lead.context?.phone || lead.userId}
                      </div>
                    </div>
                    {getIntentBadge(lead.level, lead.score)}
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Activity Stats */}
                    <div className="text-right text-xs text-gray-500">
                      <div>♥ {lead.favoritesCount} • ⚖ {lead.comparesCount} • 📋 {lead.historyRequestsCount}</div>
                      <div className="text-gray-400">
                        {lead.lastActivityAt && new Date(lead.lastActivityAt).toLocaleString('uk-UA')}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <button
                      onClick={() => {
                        setSelectedUser(lead);
                        setShowAIPanel(true);
                      }}
                      className="p-2 rounded-lg bg-purple-100 text-purple-600 hover:bg-purple-200 transition-colors"
                      title="AI Рекомендація"
                      data-testid={`ai-btn-${lead.userId}`}
                    >
                      <Robot className="w-4 h-4" weight="bold" />
                    </button>

                    <button
                      onClick={() => markNotified(lead.userId)}
                      className={`p-2 rounded-lg transition-colors ${
                        lead.managerNotified 
                          ? 'bg-green-100 text-green-600' 
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      title={lead.managerNotified ? 'Оброблено' : 'Позначити як оброблено'}
                    >
                      <Phone className="w-4 h-4" weight={lead.managerNotified ? 'fill' : 'bold'} />
                    </button>
                  </div>
                </div>

                {/* Context info */}
                {(lead.context?.favoriteVins?.length > 0 || lead.context?.compareVins?.length > 0) && (
                  <div className="mt-2 ml-14 text-xs text-gray-500">
                    {lead.context.favoriteVins?.length > 0 && (
                      <span className="mr-3">Favorites: {lead.context.favoriteVins.slice(0, 2).join(', ')}</span>
                    )}
                    {lead.context.compareVins?.length > 0 && (
                      <span>Compare: {lead.context.compareVins.slice(0, 2).join(', ')}</span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* All Users Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-600" />
            <h2 className="font-semibold text-gray-800">Всі користувачі з Intent Score</h2>
          </div>
        </div>

        {allScores.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Немає даних</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="intent-scores-table">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Intent</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">♥</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">⚖</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">📋</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Activity</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allScores.map((score) => (
                  <tr key={score.userId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {score.context?.name || score.userId.substring(0, 12)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {score.context?.email || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getIntentBadge(score.level, score.score)}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">{score.favoritesCount || 0}</td>
                    <td className="px-4 py-3 text-center text-sm">{score.comparesCount || 0}</td>
                    <td className="px-4 py-3 text-center text-sm">{score.historyRequestsCount || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {score.lastActivityAt 
                        ? new Date(score.lastActivityAt).toLocaleDateString('uk-UA')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setSelectedUser(score);
                          setShowAIPanel(true);
                        }}
                        className="p-1.5 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                      >
                        <Robot className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI Panel Slide-over */}
      {showAIPanel && selectedUser && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowAIPanel(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">AI Рекомендація</h3>
              <button 
                onClick={() => setShowAIPanel(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto h-[calc(100%-60px)]">
              <div className="mb-4">
                <div className="text-sm text-gray-500">Користувач:</div>
                <div className="font-medium">{selectedUser.context?.name || selectedUser.userId}</div>
                {getIntentBadge(selectedUser.level, selectedUser.score)}
              </div>
              <ManagerAIWidget userId={selectedUser.userId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color, testId }) => {
  const colors = {
    red: 'bg-red-50 text-red-600 border-red-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" weight="fill" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
};

export default IntentDashboard;
