/**
 * Contracts Accounting Page (Admin)
 * 
 * /admin/contracts/accounting
 * 
 * For Owner/Team Lead - signature control and accounting overview
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../i18n';
import {
  FileSignature,
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Download,
  Filter,
  RefreshCw,
  Eye,
  ChevronRight,
  Calendar,
  DollarSign,
  Users,
  FileText,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// Status config
const STATUS_CONFIG = {
  draft: { color: 'zinc', icon: FileText, label: { uk: 'Чернетка', en: 'Draft', bg: 'Чернова' } },
  sent: { color: 'blue', icon: Clock, label: { uk: 'Надіслано', en: 'Sent', bg: 'Изпратено' } },
  viewed: { color: 'amber', icon: Eye, label: { uk: 'Переглянуто', en: 'Viewed', bg: 'Прегледано' } },
  signed: { color: 'emerald', icon: CheckCircle, label: { uk: 'Підписано', en: 'Signed', bg: 'Подписано' } },
  rejected: { color: 'red', icon: XCircle, label: { uk: 'Відхилено', en: 'Rejected', bg: 'Отхвърлено' } },
  expired: { color: 'zinc', icon: AlertTriangle, label: { uk: 'Прострочено', en: 'Expired', bg: 'Изтекъл' } },
};

export default function ContractsAccountingPage() {
  const { lang } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedContract, setSelectedContract] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ period });
      if (statusFilter) params.append('status', statusFilter);
      
      const res = await fetch(`${API_URL}/api/admin/contracts/accounting?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch accounting data:', error);
    } finally {
      setLoading(false);
    }
  }, [period, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      
      const res = await fetch(`${API_URL}/api/admin/contracts/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const exportData = await res.json();
      
      // Convert to CSV
      const headers = ['ID', 'Номер', 'Клієнт', 'Email', 'Тип', 'Статус', 'Сума', 'VIN', 'Авто', 'Створено', 'Підписано'];
      const rows = exportData.contracts.map(c => [
        c.id,
        c.contractNumber || '',
        c.customerName || '',
        c.customerEmail || '',
        c.type || '',
        c.status || '',
        c.price || '',
        c.vin || '',
        c.vehicleTitle || '',
        c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
        c.signedAt ? new Date(c.signedAt).toLocaleDateString() : '',
      ]);
      
      const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
      
      // Download
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contracts_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const summary = data?.summary || {};
  const priceStats = data?.priceStats || {};

  return (
    <div className="p-6 space-y-6" data-testid="contracts-accounting-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <FileSignature className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {lang === 'uk' ? 'Бухгалтерія контрактів' : lang === 'bg' ? 'Счетоводство на договори' : 'Contracts Accounting'}
            </h1>
            <p className="text-sm text-gray-500">
              {lang === 'uk' ? 'Контроль підписів та статистика' : 'Signature control & statistics'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Period Filter */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
          >
            <option value="7">7 {lang === 'uk' ? 'днів' : 'days'}</option>
            <option value="30">30 {lang === 'uk' ? 'днів' : 'days'}</option>
            <option value="90">90 {lang === 'uk' ? 'днів' : 'days'}</option>
          </select>
          
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{lang === 'uk' ? 'Всі статуси' : 'All statuses'}</option>
            <option value="signed">{lang === 'uk' ? 'Підписані' : 'Signed'}</option>
            <option value="sent">{lang === 'uk' ? 'Очікують' : 'Pending'}</option>
            <option value="rejected">{lang === 'uk' ? 'Відхилені' : 'Rejected'}</option>
          </select>
          
          {/* Export Button */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition text-sm"
          >
            <Download className="w-4 h-4" />
            {lang === 'uk' ? 'Експорт' : 'Export'}
          </button>
          
          {/* Refresh */}
          <button
            onClick={fetchData}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          title={lang === 'uk' ? 'Всього' : 'Total'}
          value={summary.total || 0}
          icon={FileText}
          color="gray"
        />
        <StatCard
          title={lang === 'uk' ? 'Підписано' : 'Signed'}
          value={summary.signed || 0}
          icon={CheckCircle}
          color="emerald"
          trend={summary.conversionRate}
        />
        <StatCard
          title={lang === 'uk' ? 'Очікують' : 'Pending'}
          value={summary.pending || 0}
          icon={Clock}
          color="blue"
        />
        <StatCard
          title={lang === 'uk' ? 'Прострочені' : 'Overdue'}
          value={summary.overdue || 0}
          icon={AlertTriangle}
          color="red"
          alert={summary.overdue > 0}
        />
        <StatCard
          title={lang === 'uk' ? 'Загальна сума' : 'Total Value'}
          value={`$${Math.round(priceStats.totalValue || 0).toLocaleString()}`}
          icon={DollarSign}
          color="indigo"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Contracts - Need Action */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-500" />
              {lang === 'uk' ? 'Очікують підпису' : 'Awaiting Signature'}
              {data?.pendingContracts?.length > 0 && (
                <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-600 rounded-full">
                  {data.pendingContracts.length}
                </span>
              )}
            </h2>
          </div>
          
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {data?.pendingContracts?.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {lang === 'uk' ? 'Немає контрактів на підпис' : 'No pending contracts'}
              </div>
            ) : (
              data?.pendingContracts?.map((contract) => (
                <ContractRow
                  key={contract.id}
                  contract={contract}
                  lang={lang}
                  onClick={() => setSelectedContract(contract)}
                />
              ))
            )}
          </div>
        </div>

        {/* Recently Signed */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              {lang === 'uk' ? 'Нещодавно підписані' : 'Recently Signed'}
            </h2>
          </div>
          
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {data?.recentlySigned?.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {lang === 'uk' ? 'Немає підписаних контрактів' : 'No signed contracts'}
              </div>
            ) : (
              data?.recentlySigned?.map((contract) => (
                <ContractRow
                  key={contract.id}
                  contract={contract}
                  lang={lang}
                  onClick={() => setSelectedContract(contract)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Overdue Contracts Alert */}
      {data?.overdueContracts?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-red-900">
              {lang === 'uk' ? 'Прострочені контракти' : 'Overdue Contracts'} ({data.overdueContracts.length})
            </h3>
          </div>
          <div className="space-y-2">
            {data.overdueContracts.map((contract) => (
              <div 
                key={contract.id}
                className="flex items-center justify-between bg-white rounded-lg p-3 border border-red-200"
              >
                <div>
                  <div className="font-medium text-gray-900">{contract.customerName}</div>
                  <div className="text-sm text-gray-500">{contract.title}</div>
                </div>
                <button
                  onClick={() => setSelectedContract(contract)}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                >
                  {lang === 'uk' ? 'Переглянути' : 'View'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contract Detail Modal */}
      {selectedContract && (
        <ContractDetailModal
          contract={selectedContract}
          lang={lang}
          onClose={() => setSelectedContract(null)}
        />
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, trend, alert }) {
  const colorClasses = {
    gray: 'bg-gray-50 border-gray-200 text-gray-600',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    red: 'bg-red-50 border-red-200 text-red-600',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-600',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]} ${alert ? 'animate-pulse' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm opacity-80">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {trend && (
            <p className="text-xs flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3" />
              {trend}
            </p>
          )}
        </div>
        <Icon className="w-8 h-8 opacity-50" />
      </div>
    </div>
  );
}

function ContractRow({ contract, lang, onClick }) {
  const status = STATUS_CONFIG[contract.status] || STATUS_CONFIG.draft;
  const StatusIcon = status.icon;

  return (
    <div
      className="p-4 hover:bg-gray-50 cursor-pointer transition flex items-center justify-between"
      onClick={onClick}
      data-testid={`contract-row-${contract.id}`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-${status.color}-100`}>
          <StatusIcon className={`w-4 h-4 text-${status.color}-600`} />
        </div>
        <div>
          <div className="font-medium text-gray-900">{contract.customerName || 'Без імені'}</div>
          <div className="text-sm text-gray-500">{contract.title}</div>
          {contract.price && (
            <div className="text-sm font-semibold text-gray-700">${contract.price.toLocaleString()}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <span className={`px-2 py-1 text-xs rounded-full bg-${status.color}-100 text-${status.color}-700`}>
            {status.label[lang] || status.label.en}
          </span>
          <div className="text-xs text-gray-400 mt-1">
            {contract.createdAt && new Date(contract.createdAt).toLocaleDateString()}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>
    </div>
  );
}

function ContractDetailModal({ contract, lang, onClose }) {
  const status = STATUS_CONFIG[contract.status] || STATUS_CONFIG.draft;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl max-w-lg w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-4 bg-${status.color}-50 border-b`}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{contract.title}</h3>
            <span className={`px-2 py-1 text-xs rounded-full bg-${status.color}-200 text-${status.color}-700`}>
              {status.label[lang] || status.label.en}
            </span>
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">{lang === 'uk' ? 'Клієнт' : 'Customer'}</p>
              <p className="font-medium">{contract.customerName || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Email</p>
              <p className="font-medium">{contract.customerEmail || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{lang === 'uk' ? 'Тип' : 'Type'}</p>
              <p className="font-medium">{contract.type?.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{lang === 'uk' ? 'Сума' : 'Amount'}</p>
              <p className="font-medium text-lg">${contract.price?.toLocaleString() || '0'}</p>
            </div>
          </div>
          
          {contract.vehicleTitle && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">{lang === 'uk' ? 'Авто' : 'Vehicle'}</p>
              <p className="font-medium">{contract.vehicleTitle}</p>
              {contract.vin && <p className="text-sm text-gray-500 font-mono">VIN: {contract.vin}</p>}
            </div>
          )}
          
          <div className="border-t pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{lang === 'uk' ? 'Створено' : 'Created'}</span>
              <span>{contract.createdAt && new Date(contract.createdAt).toLocaleString()}</span>
            </div>
            {contract.sentAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">{lang === 'uk' ? 'Надіслано' : 'Sent'}</span>
                <span>{new Date(contract.sentAt).toLocaleString()}</span>
              </div>
            )}
            {contract.signedAt && (
              <div className="flex justify-between text-emerald-600">
                <span>{lang === 'uk' ? 'Підписано' : 'Signed'}</span>
                <span>{new Date(contract.signedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
        
        <div className="p-4 bg-gray-50 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            {lang === 'uk' ? 'Закрити' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
