/**
 * History Reports Cabinet Page
 * 
 * /cabinet/history-reports
 * 
 * Показує користувачу всі його звіти:
 * - VIN
 * - Provider
 * - Дата відкриття
 * - Статус: unlocked / expired / archived
 * - Хто відкрив: manager-approved
 * - Деталі звіту
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  FileText, 
  Clock, 
  CheckCircle, 
  Warning,
  LockOpen,
  Archive,
  Timer,
  User,
  Car,
  Speedometer,
  Certificate,
  CaretRight,
  ArrowClockwise,
  MagnifyingGlass
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Status Badge Component
const StatusBadge = ({ status }) => {
  const config = {
    unlocked: { color: 'emerald', icon: LockOpen, label: 'Активний' },
    purchased: { color: 'emerald', icon: CheckCircle, label: 'Куплений' },
    pending_approval: { color: 'amber', icon: Clock, label: 'Очікує' },
    expired: { color: 'zinc', icon: Timer, label: 'Прострочений' },
    archived: { color: 'blue', icon: Archive, label: 'Архів' },
    denied: { color: 'red', icon: Warning, label: 'Відхилено' },
    requested: { color: 'blue', icon: Clock, label: 'Запитано' },
  };

  const { color, icon: Icon, label } = config[status] || config.requested;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
      bg-${color}-100 text-${color}-700`}
      data-testid={`status-badge-${status}`}
    >
      <Icon size={14} weight="fill" />
      {label}
    </span>
  );
};

// Report Card Component
const ReportCard = ({ report, onView, isExpired }) => {
  const reportData = report.reportData || {};
  const hasIssues = (reportData.accidents > 0) || 
                    (reportData.titleStatus === 'salvage') ||
                    (reportData.damageRecords?.length > 0);

  const timeLeft = report.expiresAt ? 
    Math.max(0, Math.floor((new Date(report.expiresAt) - new Date()) / (1000 * 60 * 60))) : 
    null;

  return (
    <div 
      className={`bg-white rounded-2xl border transition-all hover:shadow-md cursor-pointer
        ${isExpired ? 'border-zinc-200 opacity-75' : hasIssues ? 'border-amber-200' : 'border-zinc-200'}`}
      onClick={() => onView(report)}
      data-testid={`report-card-${report.vin}`}
    >
      {/* Header */}
      <div className={`px-6 py-4 border-b ${isExpired ? 'bg-zinc-50' : hasIssues ? 'bg-amber-50' : 'bg-emerald-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isExpired ? 'bg-zinc-200' : hasIssues ? 'bg-amber-200' : 'bg-emerald-200'}`}>
              <Car size={20} className={isExpired ? 'text-zinc-600' : hasIssues ? 'text-amber-700' : 'text-emerald-700'} weight="fill" />
            </div>
            <div>
              <p className="font-mono font-semibold text-zinc-900">{report.vin}</p>
              <p className="text-xs text-zinc-500">
                {report.provider?.toUpperCase() || 'CarVertical'}
              </p>
            </div>
          </div>
          <StatusBadge status={report.status} />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Quick Stats */}
        {reportData && !isExpired && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-zinc-900">{reportData.ownerCount || '—'}</p>
              <p className="text-xs text-zinc-500">Власників</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${reportData.accidents > 0 ? 'text-amber-600' : 'text-zinc-900'}`}>
                {reportData.accidents ?? '—'}
              </p>
              <p className="text-xs text-zinc-500">ДТП</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${reportData.titleStatus === 'salvage' ? 'text-red-600' : 'text-emerald-600'}`}>
                {reportData.titleStatus === 'salvage' ? '!' : '✓'}
              </p>
              <p className="text-xs text-zinc-500">Title</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-zinc-900">{report.viewCount || 0}</p>
              <p className="text-xs text-zinc-500">Переглядів</p>
            </div>
          </div>
        )}

        {/* Meta Info */}
        <div className="flex items-center justify-between text-sm text-zinc-500 pt-4 border-t">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {new Date(report.deliveredAt || report.createdAt).toLocaleDateString('uk-UA')}
            </span>
            {report.approvedBy && (
              <span className="flex items-center gap-1">
                <User size={14} />
                Менеджер
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {timeLeft !== null && timeLeft > 0 && !isExpired && (
              <span className={`flex items-center gap-1 ${timeLeft < 12 ? 'text-amber-600' : ''}`}>
                <Timer size={14} />
                {timeLeft}г залишилось
              </span>
            )}
            <CaretRight size={16} className="text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  );
};

// Full Report View Modal
const ReportModal = ({ report, onClose }) => {
  if (!report) return null;

  const data = report.reportData || {};
  const hasIssues = (data.accidents > 0) || 
                    (data.titleStatus === 'salvage') ||
                    (data.damageRecords?.length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-5 border-b sticky top-0 z-10 ${hasIssues ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Звіт по VIN</h2>
              <p className="font-mono text-zinc-600">{report.vin}</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-white/50 transition-colors"
              data-testid="close-report-modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Summary */}
          <div className={`p-4 rounded-xl ${hasIssues ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
            <div className="flex items-center gap-3">
              {hasIssues ? (
                <Warning size={32} weight="fill" className="text-amber-500" />
              ) : (
                <CheckCircle size={32} weight="fill" className="text-emerald-500" />
              )}
              <div>
                <h3 className="font-semibold text-lg">
                  {hasIssues ? 'Знайдено проблеми' : 'Чиста історія'}
                </h3>
                <p className="text-sm text-zinc-600">
                  {hasIssues ? 'Рекомендуємо детальний огляд' : 'Авто без серйозних проблем в історії'}
                </p>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard 
              icon={User}
              label="Власників"
              value={data.ownerCount ?? '—'}
            />
            <StatCard 
              icon={Warning}
              label="ДТП"
              value={data.accidents ?? 0}
              warning={data.accidents > 0}
            />
            <StatCard 
              icon={Certificate}
              label="Title"
              value={data.titleStatus === 'salvage' ? 'Salvage' : 'Clean'}
              warning={data.titleStatus === 'salvage'}
            />
            <StatCard 
              icon={Speedometer}
              label="Одометр"
              value={data.mileageHistory?.[data.mileageHistory.length - 1]?.mileage?.toLocaleString() || '—'}
            />
          </div>

          {/* Mileage History */}
          {data.mileageHistory?.length > 0 && (
            <div className="bg-zinc-50 rounded-xl p-4">
              <h4 className="font-medium text-zinc-700 mb-3 flex items-center gap-2">
                <Speedometer size={18} />
                Історія пробігу
              </h4>
              <div className="space-y-2">
                {data.mileageHistory.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">{new Date(entry.date).toLocaleDateString('uk-UA')}</span>
                    <span className="font-mono font-medium">{entry.mileage?.toLocaleString()} км</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Damage Records */}
          {data.damageRecords?.length > 0 && (
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
              <h4 className="font-medium text-amber-800 mb-3 flex items-center gap-2">
                <Warning size={18} />
                Записи про пошкодження
              </h4>
              <div className="space-y-2">
                {data.damageRecords.map((record, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-600 mt-0.5">•</span>
                    <div>
                      <span className="text-amber-800">{new Date(record.date).toLocaleDateString('uk-UA')}</span>
                      <span className="text-amber-700"> — {record.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Service History */}
          {data.serviceHistory?.length > 0 && (
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <h4 className="font-medium text-blue-800 mb-3">Сервісна історія</h4>
              <div className="space-y-2">
                {data.serviceHistory.map((service, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-blue-700">{service.type?.replace('_', ' ')}</span>
                    <span className="text-blue-600">{new Date(service.date).toLocaleDateString('uk-UA')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center justify-between text-sm text-zinc-500 pt-4 border-t">
            <span>Провайдер: {report.provider || 'CarVertical'}</span>
            <span>Оновлено: {new Date(data.lastUpdate || report.createdAt).toLocaleDateString('uk-UA')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Stat Card for Modal
const StatCard = ({ icon: Icon, label, value, warning }) => (
  <div className={`rounded-xl p-4 ${warning ? 'bg-amber-50 border border-amber-200' : 'bg-zinc-50'}`}>
    <div className={`mb-2 ${warning ? 'text-amber-500' : 'text-zinc-400'}`}>
      <Icon size={20} />
    </div>
    <div className="text-2xl font-semibold">{value}</div>
    <div className="text-sm text-zinc-500">{label}</div>
  </div>
);

// Main Component
export default function HistoryReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, expired
  const [searchVin, setSearchVin] = useState('');

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/cabinet/history-reports`);
      setReports(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load reports:', err);
      toast.error('Помилка завантаження звітів');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const now = new Date();
  
  const filteredReports = reports.filter(report => {
    // Search filter
    if (searchVin && !report.vin.includes(searchVin.toUpperCase())) {
      return false;
    }

    // Status filter
    const isExpired = report.expiresAt && new Date(report.expiresAt) < now;
    
    if (filter === 'active') {
      return !isExpired && ['unlocked', 'purchased'].includes(report.status);
    }
    if (filter === 'expired') {
      return isExpired || report.status === 'expired' || report.status === 'archived';
    }
    
    return true;
  });

  const activeCount = reports.filter(r => 
    !r.expiresAt || new Date(r.expiresAt) >= now
  ).filter(r => ['unlocked', 'purchased'].includes(r.status)).length;

  const expiredCount = reports.filter(r => 
    (r.expiresAt && new Date(r.expiresAt) < now) || 
    r.status === 'expired' || 
    r.status === 'archived'
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="history-reports-cabinet">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-zinc-100">
            <FileText size={24} weight="fill" className="text-zinc-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Мої звіти</h1>
            <p className="text-zinc-500">Історія перевірених VIN</p>
          </div>
        </div>
        <button
          onClick={loadReports}
          className="p-2 rounded-xl hover:bg-zinc-100 transition-colors"
          data-testid="refresh-reports"
        >
          <ArrowClockwise size={20} className="text-zinc-600" />
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <MagnifyingGlass size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchVin}
            onChange={(e) => setSearchVin(e.target.value.toUpperCase())}
            placeholder="Пошук за VIN..."
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-zinc-200 focus:border-zinc-400 outline-none"
            data-testid="search-vin-input"
          />
        </div>
        
        <div className="flex gap-2">
          <FilterButton 
            active={filter === 'all'} 
            onClick={() => setFilter('all')}
            label={`Всі (${reports.length})`}
          />
          <FilterButton 
            active={filter === 'active'} 
            onClick={() => setFilter('active')}
            label={`Активні (${activeCount})`}
            color="emerald"
          />
          <FilterButton 
            active={filter === 'expired'} 
            onClick={() => setFilter('expired')}
            label={`Архів (${expiredCount})`}
            color="zinc"
          />
        </div>
      </div>

      {/* Reports Grid */}
      {filteredReports.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-zinc-200">
          <FileText size={48} className="mx-auto mb-4 text-zinc-300" />
          <h3 className="text-lg font-medium text-zinc-700 mb-2">
            {searchVin ? 'Звітів не знайдено' : 'У вас ще немає звітів'}
          </h3>
          <p className="text-zinc-500">
            {searchVin ? 'Спробуйте інший VIN' : 'Зверніться до менеджера для отримання звіту'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredReports.map(report => {
            const isExpired = report.expiresAt && new Date(report.expiresAt) < now;
            return (
              <ReportCard
                key={report.id}
                report={report}
                isExpired={isExpired}
                onView={setSelectedReport}
              />
            );
          })}
        </div>
      )}

      {/* Report Modal */}
      {selectedReport && (
        <ReportModal 
          report={selectedReport} 
          onClose={() => setSelectedReport(null)} 
        />
      )}
    </div>
  );
}

// Filter Button
const FilterButton = ({ active, onClick, label, color = 'zinc' }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
      ${active 
        ? `bg-${color}-900 text-white` 
        : `bg-${color}-100 text-${color}-700 hover:bg-${color}-200`
      }`}
    data-testid={`filter-${label.toLowerCase().split(' ')[0]}`}
  >
    {label}
  </button>
);
