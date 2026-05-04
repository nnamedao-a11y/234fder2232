import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Circle, Loader2, ChevronRight } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_META = {
  pending:     { icon: Circle,        color: 'text-gray-400',     ring: 'bg-gray-50  border-gray-200',    label: 'Очікує' },
  in_progress: { icon: Loader2,       color: 'text-blue-600 animate-spin', ring: 'bg-blue-50 border-blue-200',  label: 'В роботі' },
  done:        { icon: CheckCircle2,  color: 'text-emerald-500',   ring: 'bg-emerald-50 border-emerald-200', label: 'Готово' },
  skipped:     { icon: Clock,         color: 'text-amber-500',     ring: 'bg-amber-50 border-amber-200',  label: 'Пропущено' },
};

export default function OrderStepRow({ step, orderId, readOnly = false, onUpdated }) {
  const meta = STATUS_META[step.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const [busy, setBusy] = useState(false);

  const setStatus = async (next) => {
    setBusy(true);
    try {
      const r = await axios.patch(`${API_URL}/api/orders/${orderId}/steps/${step.id}`, { status: next });
      onUpdated?.(r.data?.order);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка оновлення');
    } finally { setBusy(false); }
  };

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${meta.ring} transition-colors`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-white border-2 ${step.status === 'done' ? 'border-emerald-300' : step.status === 'in_progress' ? 'border-blue-300' : 'border-gray-200'}`}>
        <Icon className={`w-4 h-4 ${meta.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {step.service_name && <span className="text-[10px] uppercase tracking-wider text-gray-400 truncate">{step.service_name}</span>}
        </div>
        <p className="font-medium text-sm text-gray-900 truncate">{step.label}</p>
        {step.note && <p className="text-xs text-gray-500 mt-0.5 italic">«{step.note}»</p>}
      </div>
      {!readOnly ? (
        <div className="flex items-center gap-1">
          {step.status !== 'in_progress' && step.status !== 'done' && (
            <button disabled={busy} onClick={() => setStatus('in_progress')} className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium disabled:opacity-50">
              Старт
            </button>
          )}
          {step.status !== 'done' && (
            <button disabled={busy} onClick={() => setStatus('done')} className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium disabled:opacity-50">
              Готово
            </button>
          )}
          {step.status === 'done' && (
            <button disabled={busy} onClick={() => setStatus('pending')} className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs disabled:opacity-50">
              Скасувати
            </button>
          )}
        </div>
      ) : (
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
      )}
    </div>
  );
}
