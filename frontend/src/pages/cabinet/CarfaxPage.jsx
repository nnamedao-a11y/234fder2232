/**
 * Cabinet Carfax Page
 * 
 * /cabinet/carfax
 * 
 * User can:
 * - Request Carfax by VIN
 * - View request status
 * - Download PDF when ready
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  FileText, 
  Clock, 
  CheckCircle, 
  Warning,
  Download,
  Plus,
  ArrowClockwise,
  MagnifyingGlass,
  Car,
  Hourglass,
  X
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Status Badge Component
const StatusBadge = ({ status }) => {
  const config = {
    pending: { color: 'amber', icon: Hourglass, label: 'Очікує обробки' },
    processing: { color: 'blue', icon: Clock, label: 'В обробці' },
    uploaded: { color: 'emerald', icon: CheckCircle, label: 'Готово' },
    rejected: { color: 'red', icon: X, label: 'Відхилено' },
    expired: { color: 'zinc', icon: Warning, label: 'Прострочено' },
  };

  const { color, icon: Icon, label } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
      bg-${color}-100 text-${color}-700`}
      data-testid={`carfax-status-${status}`}
    >
      <Icon size={14} weight="fill" />
      {label}
    </span>
  );
};

// Request Card Component
const RequestCard = ({ request, onDownload }) => {
  const isReady = request.status === 'uploaded';
  const isPending = request.status === 'pending' || request.status === 'processing';
  
  return (
    <div 
      className={`bg-white rounded-2xl border transition-all 
        ${isReady ? 'border-emerald-200 hover:shadow-md' : 'border-zinc-200'}`}
      data-testid={`carfax-request-${request.vin}`}
    >
      {/* Header */}
      <div className={`px-6 py-4 border-b ${isReady ? 'bg-emerald-50' : 'bg-zinc-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isReady ? 'bg-emerald-200' : 'bg-zinc-200'}`}>
              <Car size={20} className={isReady ? 'text-emerald-700' : 'text-zinc-600'} weight="fill" />
            </div>
            <div>
              <p className="font-mono font-semibold text-zinc-900">{request.vin}</p>
              <p className="text-xs text-zinc-500">
                {new Date(request.createdAt).toLocaleDateString('uk-UA')}
              </p>
            </div>
          </div>
          <StatusBadge status={request.status} />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Status Messages */}
        {isPending && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl mb-4">
            <Hourglass size={24} className="text-amber-500 animate-pulse" />
            <div>
              <p className="font-medium text-amber-800">Очікуйте 1-2 години</p>
              <p className="text-sm text-amber-600">Менеджер опрацює ваш запит</p>
            </div>
          </div>
        )}

        {request.status === 'rejected' && (
          <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl mb-4">
            <Warning size={24} className="text-red-500 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">Запит відхилено</p>
              <p className="text-sm text-red-600">{request.rejectReason || 'Зверніться до менеджера'}</p>
            </div>
          </div>
        )}

        {isReady && (
          <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl mb-4">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-800">Звіт готовий</p>
                <p className="text-sm text-emerald-600">{request.pdfFilename || 'carfax-report.pdf'}</p>
              </div>
            </div>
            <button
              onClick={() => onDownload(request)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl 
                hover:bg-emerald-700 transition-colors"
              data-testid={`download-carfax-${request.vin}`}
            >
              <Download size={18} />
              Завантажити
            </button>
          </div>
        )}

        {/* Meta Info */}
        <div className="flex items-center justify-between text-sm text-zinc-500 pt-4 border-t">
          <span>
            {request.managerName && `Менеджер: ${request.managerName}`}
          </span>
          {request.expiresAt && (
            <span>
              Діє до: {new Date(request.expiresAt).toLocaleDateString('uk-UA')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// New Request Modal
const NewRequestModal = ({ onClose, onSubmit }) => {
  const [vin, setVin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (vin.length !== 17) {
      toast.error('VIN має містити 17 символів');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(vin);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl max-w-md w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-zinc-900 mb-4">Запит Carfax звіту</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              VIN номер
            </label>
            <input
              type="text"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))}
              placeholder="Введіть 17-значний VIN"
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:border-zinc-400 outline-none
                font-mono text-lg tracking-wide"
              data-testid="carfax-vin-input"
            />
            <p className="text-xs text-zinc-500 mt-1">{vin.length}/17 символів</p>
          </div>

          <div className="bg-amber-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-amber-800">
              <strong>Увага:</strong> Після подання запиту, менеджер опрацює його протягом 1-2 годин.
              Ви отримаєте сповіщення, коли звіт буде готовий.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors"
            >
              Скасувати
            </button>
            <button
              type="submit"
              disabled={vin.length !== 17 || loading}
              className="flex-1 px-4 py-3 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="submit-carfax-request"
            >
              {loading ? 'Надсилання...' : 'Запросити звіт'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Main Component
export default function CarfaxPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewRequest, setShowNewRequest] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/carfax/me`);
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load Carfax requests:', err);
      toast.error('Помилка завантаження');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleCreateRequest = async (vin) => {
    try {
      const res = await axios.post(`${API_URL}/api/carfax/request`, { vin });
      toast.success('Запит успішно створено!');
      loadRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Помилка створення запиту');
      throw err;
    }
  };

  const handleDownload = (request) => {
    if (request.pdfUrl) {
      window.open(request.pdfUrl, '_blank');
    } else {
      toast.error('PDF ще не завантажено');
    }
  };

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'processing').length;
  const readyCount = requests.filter(r => r.status === 'uploaded').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="carfax-cabinet-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-100">
            <FileText size={24} weight="fill" className="text-blue-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Carfax звіти</h1>
            <p className="text-zinc-500">Перевірка історії автомобіля</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={loadRequests}
            className="p-2 rounded-xl hover:bg-zinc-100 transition-colors"
            data-testid="refresh-carfax"
          >
            <ArrowClockwise size={20} className="text-zinc-600" />
          </button>
          <button
            onClick={() => setShowNewRequest(true)}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl 
              hover:bg-zinc-800 transition-colors"
            data-testid="new-carfax-request"
          >
            <Plus size={18} />
            Новий запит
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-zinc-200">
          <p className="text-2xl font-bold text-zinc-900">{requests.length}</p>
          <p className="text-sm text-zinc-500">Всього запитів</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
          <p className="text-2xl font-bold text-amber-700">{pendingCount}</p>
          <p className="text-sm text-amber-600">В обробці</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
          <p className="text-2xl font-bold text-emerald-700">{readyCount}</p>
          <p className="text-sm text-emerald-600">Готових</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
          <p className="text-2xl font-bold text-blue-700">$45</p>
          <p className="text-sm text-blue-600">Ціна звіту</p>
        </div>
      </div>

      {/* Requests List */}
      {requests.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-zinc-200">
          <FileText size={48} className="mx-auto mb-4 text-zinc-300" />
          <h3 className="text-lg font-medium text-zinc-700 mb-2">У вас ще немає запитів</h3>
          <p className="text-zinc-500 mb-6">Створіть перший запит на перевірку VIN</p>
          <button
            onClick={() => setShowNewRequest(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-xl 
              hover:bg-zinc-800 transition-colors"
          >
            <Plus size={18} />
            Створити запит
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map(request => (
            <RequestCard
              key={request.id}
              request={request}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {/* New Request Modal */}
      {showNewRequest && (
        <NewRequestModal
          onClose={() => setShowNewRequest(false)}
          onSubmit={handleCreateRequest}
        />
      )}
    </div>
  );
}
