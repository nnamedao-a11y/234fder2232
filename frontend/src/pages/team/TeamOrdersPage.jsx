/**
 * Team-Lead Orders View  -  /team/orders
 * Sees orders from ALL managers, can filter by manager.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Briefcase, RefreshCw, Filter, Users } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_BADGE = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-emerald-100 text-emerald-700',
  cancelled:   'bg-rose-100 text-rose-700',
  on_hold:     'bg-zinc-100 text-zinc-700',
};

const fmt = (n, ccy = 'usd') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (ccy || 'USD').toUpperCase() }).format(n || 0); }
  catch { return `${(n || 0).toFixed(2)} ${(ccy || 'USD').toUpperCase()}`; }
};

export default function TeamOrdersPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterManager, setFilterManager] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterManager) params.set('manager_id', filterManager);
      const r = await axios.get(`${API_URL}/api/team/orders?${params.toString()}`);
      setItems(r.data?.items || []);
    } catch (e) { toast.error('Помилка завантаження'); }
    finally { setLoading(false); }
  }, [filterStatus, filterManager]);

  useEffect(() => { load(); }, [load]);

  const managers = Array.from(new Set(items.map((o) => o.managerEmail).filter(Boolean)));

  // Aggregations
  const stats = {
    total: items.length,
    in_progress: items.filter((o) => o.status === 'in_progress').length,
    completed: items.filter((o) => o.status === 'completed').length,
    revenue: items.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + (o.amount || 0), 0),
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-[#635BFF]" /> Замовлення команди
          </h1>
          <p className="text-sm text-gray-500 mt-1">Огляд по всіх менеджерах: статуси, прогрес, навантаження.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Всього', value: stats.total, color: '#635BFF' },
          { label: 'В роботі', value: stats.in_progress, color: '#2563EB' },
          { label: 'Завершено', value: stats.completed, color: '#10B981' },
          { label: 'Сума активних', value: fmt(stats.revenue), color: '#F59E0B' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500">{s.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">Всі статуси</option>
          <option value="pending">Очікують</option>
          <option value="in_progress">В роботі</option>
          <option value="completed">Завершено</option>
          <option value="cancelled">Скасовано</option>
        </select>
        <select value={filterManager} onChange={(e) => setFilterManager(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">Всі менеджери</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Замовлення</th>
              <th className="text-left px-5 py-3 font-medium">Менеджер</th>
              <th className="text-left px-5 py-3 font-medium">Клієнт</th>
              <th className="text-left px-5 py-3 font-medium">Послуги</th>
              <th className="text-left px-5 py-3 font-medium">Прогрес</th>
              <th className="text-right px-5 py-3 font-medium">Сума</th>
              <th className="text-left px-5 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const total = (o.steps || []).length;
              const done  = (o.steps || []).filter((s) => s.status === 'done').length;
              const pct   = total ? Math.round((done / total) * 100) : 0;
              return (
                <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3"><p className="font-mono text-xs text-gray-700">{o.id}</p></td>
                  <td className="px-5 py-3 text-gray-700">{o.managerEmail || o.managerId || '—'}</td>
                  <td className="px-5 py-3 text-gray-700">{o.customerId || '—'}</td>
                  <td className="px-5 py-3"><div className="flex flex-wrap gap-1">{(o.items || []).slice(0, 2).map((it, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 bg-gray-100 rounded">{it.name}</span>)}{(o.items || []).length > 2 && <span className="text-[11px] text-gray-400">+{o.items.length - 2}</span>}</div></td>
                  <td className="px-5 py-3 w-40"><div className="flex items-center gap-2"><div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#635BFF] rounded-full" style={{ width: `${pct}%` }} /></div><span className="text-xs text-gray-500">{done}/{total}</span></div></td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(o.amount, o.currency)}</td>
                  <td className="px-5 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span></td>
                </tr>
              );
            })}
            {items.length === 0 && !loading && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm"><Briefcase className="w-8 h-8 mx-auto mb-2 text-gray-300" />Немає замовлень за фільтрами</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
