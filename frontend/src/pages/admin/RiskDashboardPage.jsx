/**
 * Risk Dashboard Page
 * 
 * Візуальне представлення ризиків:
 * - Користувачі з високим ризиком
 * - Менеджери з проблемами
 * - Підозрілі сесії
 * - Real-time алерти
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Users,
  UserX,
  Activity,
  RefreshCw,
  Eye,
  XCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  Monitor,
  Wifi,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const RISK_COLORS = {
  low: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-600', icon: CheckCircle },
  medium: { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-600', icon: AlertTriangle },
  high: { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-600', icon: AlertCircle },
  critical: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-600', icon: XCircle },
};

const RiskDashboardPage = () => {
  const { t, lang } = useLang();
  const [loading, setLoading] = useState(true);
  const [criticalAlerts, setCriticalAlerts] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [selectedRisk, setSelectedRisk] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      const [alertsRes, dashboardRes] = await Promise.all([
        axios.get(`${API_URL}/api/alerts/critical?limit=20`, { headers }).catch(() => ({ data: { alerts: [] } })),
        axios.get(`${API_URL}/api/owner-dashboard`, { headers }).catch(() => ({ data: null })),
      ]);

      setCriticalAlerts(alertsRes.data?.alerts || []);
      setDashboardStats(dashboardRes.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch risk data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Auto refresh every 30 seconds
    if (autoRefresh) {
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefresh]);

  const runDailyCheck = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/risk/daily-check`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (err) {
      console.error('Daily check failed:', err);
    }
  };

  const assessManager = async (managerId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/risk/manager/${managerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedRisk(res.data);
    } catch (err) {
      console.error('Manager assessment failed:', err);
    }
  };

  const risk = dashboardStats?.risk || { 
    suspiciousSessions: 0, 
    criticalInvoices: 0, 
    riskyShipments: 0, 
    integrationsDown: 0 
  };

  const totalRiskScore = risk.suspiciousSessions * 20 + risk.criticalInvoices * 15 + risk.riskyShipments * 10 + risk.integrationsDown * 25;
  const overallRiskLevel = totalRiskScore >= 70 ? 'critical' : totalRiskScore >= 50 ? 'high' : totalRiskScore >= 30 ? 'medium' : 'low';
  const riskStyle = RISK_COLORS[overallRiskLevel];
  const RiskIcon = riskStyle.icon;

  return (
    <div className="p-6" data-testid="risk-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="w-7 h-7 text-red-600" />
            {t('riskDashboardTitle') || 'Дашборд ризиків'}
          </h1>
          <p className="text-gray-500 mt-1">
            {t('riskDashboardSubtitle') || 'Моніторинг та управління ризиками'}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${autoRefresh ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            <Wifi className="w-4 h-4" />
            <span className="text-sm">{autoRefresh ? 'Live' : t('paused') || 'Paused'}</span>
          </div>
          
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-4 py-2 rounded-lg transition-colors ${autoRefresh ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            {autoRefresh ? (t('pause') || 'Pause') : (t('resume') || 'Resume')}
          </button>
          
          <button
            onClick={runDailyCheck}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg transition-colors"
            data-testid="daily-check-btn"
          >
            <Activity className="w-4 h-4" />
            {lang === 'uk' ? 'Запустити перевірку' : 'Run Daily Check'}
          </button>
          
          <button
            onClick={fetchData}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            disabled={loading}
            data-testid="refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {lang === 'uk' ? 'Оновити' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Overall Risk Indicator */}
      <div className={`${riskStyle.bg} border ${riskStyle.border} rounded-2xl p-6 mb-8`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 ${riskStyle.bg} border-2 ${riskStyle.border} rounded-full flex items-center justify-center`}>
              <RiskIcon className={`w-8 h-8 ${riskStyle.text}`} />
            </div>
            <div>
              <h2 className={`text-2xl font-bold ${riskStyle.text} uppercase`}>
                {lang === 'uk' ? 'Рівень ризику' : 'Risk Level'}: {overallRiskLevel.toUpperCase()}
              </h2>
              <p className="text-gray-500 mt-1">
                {lang === 'uk' ? 'Загальна оцінка системи' : 'Overall system assessment'}
              </p>
            </div>
          </div>
          
          <div className="text-right">
            <p className={`text-5xl font-bold ${riskStyle.text}`}>{totalRiskScore}</p>
            <p className="text-gray-500 text-sm">{lang === 'uk' ? 'Загальний бал' : 'Total Score'}</p>
          </div>
        </div>
        
        <p className="text-gray-400 text-xs mt-4">
          {lang === 'uk' ? 'Останнє оновлення' : 'Last updated'}: {lastUpdate.toLocaleTimeString()}
        </p>
      </div>

      {/* Risk Categories */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <RiskCard
          icon={Monitor}
          label={lang === 'uk' ? 'Підозрілі сесії' : 'Suspicious Sessions'}
          value={risk.suspiciousSessions}
          color="orange"
          description={lang === 'uk' ? 'Аномальна активність' : 'Anomalous activity'}
        />
        <RiskCard
          icon={AlertCircle}
          label={lang === 'uk' ? 'Критичні рахунки' : 'Critical Invoices'}
          value={risk.criticalInvoices}
          color="red"
          description={lang === 'uk' ? 'Прострочені платежі' : 'Overdue payments'}
        />
        <RiskCard
          icon={AlertTriangle}
          label={lang === 'uk' ? 'Ризикові доставки' : 'Risky Shipments'}
          value={risk.riskyShipments}
          color="amber"
          description={lang === 'uk' ? 'Потребують уваги' : 'Need attention'}
        />
        <RiskCard
          icon={XCircle}
          label={lang === 'uk' ? 'Інтеграції down' : 'Integrations Down'}
          value={risk.integrationsDown}
          color="purple"
          description={lang === 'uk' ? 'Не працюють' : 'Not working'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical Alerts Feed */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            {lang === 'uk' ? 'Критичні алерти' : 'Critical Alerts'}
            {criticalAlerts.length > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full ml-2">
                {criticalAlerts.length}
              </span>
            )}
          </h3>
          
          <div className="space-y-3 max-h-96 overflow-y-auto" data-testid="alerts-feed">
            {criticalAlerts.length > 0 ? (
              criticalAlerts.map((alert, idx) => (
                <AlertItem key={idx} alert={alert} lang={lang} />
              ))
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="text-gray-500">
                  {lang === 'uk' ? 'Критичних алертів немає' : 'No critical alerts'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Manager Risk Assessment */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            {lang === 'uk' ? 'Аналіз ризиків персоналу' : 'Staff Risk Analysis'}
          </h3>
          
          {dashboardStats?.people?.underperformers?.length > 0 ? (
            <div className="space-y-3" data-testid="manager-risks">
              {dashboardStats.people.underperformers.map((manager, idx) => (
                <div
                  key={idx}
                  className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:border-blue-400 transition-colors cursor-pointer"
                  onClick={() => assessManager(manager.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <UserX className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <p className="text-gray-900 font-medium">{manager.name || 'Manager'}</p>
                        <p className="text-gray-500 text-sm">{manager.email}</p>
                      </div>
                    </div>
                    <button className="text-blue-500 hover:text-blue-700">
                      <Eye className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {manager.issues && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {manager.issues.map((issue, i) => (
                        <span key={i} className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded">
                          {issue}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-gray-500">
                {lang === 'uk' ? 'Проблем з персоналом не виявлено' : 'No staff issues detected'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Risk Assessment Modal */}
      {selectedRisk && (
        <RiskModal risk={selectedRisk} onClose={() => setSelectedRisk(null)} lang={lang} />
      )}
    </div>
  );
};

// Risk Card Component
const RiskCard = ({ icon: Icon, label, value, color, description }) => {
  const colors = {
    red: 'bg-red-50 border-red-200 text-red-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
    green: 'bg-green-50 border-green-200 text-green-600',
  };
  
  const iconColors = {
    red: 'bg-red-100 text-red-600',
    orange: 'bg-orange-100 text-orange-600',
    amber: 'bg-amber-100 text-amber-600',
    purple: 'bg-purple-100 text-purple-600',
    green: 'bg-green-100 text-green-600',
  };
  
  return (
    <div className={`bg-white rounded-2xl p-6 border border-gray-200 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          <p className="text-gray-400 text-xs mt-1">{description}</p>
        </div>
        <div className={`w-12 h-12 ${iconColors[color]} rounded-xl flex items-center justify-center`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
};

// Alert Item Component
const AlertItem = ({ alert, lang }) => {
  const priorityColors = {
    critical: 'border-l-red-500 bg-red-50',
    high: 'border-l-orange-500 bg-orange-50',
  };
  
  return (
    <div className={`border-l-4 ${priorityColors[alert.priority] || priorityColors.high} rounded-r-lg p-3`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-900 font-medium">{alert.title}</p>
          <p className="text-gray-600 text-sm mt-1">{alert.message}</p>
          {alert.manager && (
            <p className="text-gray-400 text-xs mt-2">
              {lang === 'uk' ? 'Менеджер' : 'Manager'}: {alert.manager.name}
            </p>
          )}
        </div>
        <span className="text-gray-400 text-xs whitespace-nowrap">
          {new Date(alert.time).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};

// Risk Modal Component
const RiskModal = ({ risk, onClose, lang }) => {
  const riskStyle = RISK_COLORS[risk.riskLevel] || RISK_COLORS.low;
  const RiskIcon = riskStyle.icon;
  
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 border border-gray-200 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900">
            {lang === 'uk' ? 'Оцінка ризику' : 'Risk Assessment'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XCircle className="w-6 h-6" />
          </button>
        </div>
        
        {/* Risk Score */}
        <div className={`${riskStyle.bg} border ${riskStyle.border} rounded-xl p-4 mb-6`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RiskIcon className={`w-8 h-8 ${riskStyle.text}`} />
              <div>
                <p className={`font-bold ${riskStyle.text} uppercase`}>{risk.riskLevel}</p>
                <p className="text-gray-500 text-sm">{risk.entityType}</p>
              </div>
            </div>
            <p className={`text-3xl font-bold ${riskStyle.text}`}>{risk.riskScore}</p>
          </div>
        </div>
        
        {/* Factors */}
        <div className="mb-6">
          <h4 className="text-gray-900 font-medium mb-3">
            {lang === 'uk' ? 'Фактори ризику' : 'Risk Factors'}
          </h4>
          <div className="space-y-2">
            {risk.factors && risk.factors.length > 0 ? risk.factors.map((factor, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">{factor.description}</span>
                  <span className="text-amber-600 font-medium">+{factor.weight}</span>
                </div>
              </div>
            )) : (
              <p className="text-gray-500 text-sm">Факторів не виявлено</p>
            )}
          </div>
        </div>
        
        {/* Recommendations */}
        {risk.recommendations?.length > 0 && (
          <div>
            <h4 className="text-gray-900 font-medium mb-3">
              {lang === 'uk' ? 'Рекомендації' : 'Recommendations'}
            </h4>
            <ul className="space-y-2">
              {risk.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-gray-600">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default RiskDashboardPage;
