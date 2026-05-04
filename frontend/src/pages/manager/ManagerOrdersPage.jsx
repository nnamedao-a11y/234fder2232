/**
 * Manager Orders Page  -  /manager/orders
 * --------------------------------------------------
 * Once a customer pays an invoice, an order is auto-created with one
 * workflow step per service. Manager works through these steps here.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, RefreshCw, Search, ArrowLeft, Send, Package, MessageCircle } from 'lucide-react';
import OrderStepRow from '../../components/orders/OrderStepRow';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_BADGE = {
  pending:      'bg-gray-100 text-gray-600',
  in_progress:  'bg-blue-100 text-blue-700',
  waiting_docs: 'bg-amber-100 text-amber-700',
  in_delivery:  'bg-violet-100 text-violet-700',
  completed:    'bg-emerald-100 text-emerald-700',
  cancelled:    'bg-rose-100 text-rose-700',
  on_hold:      'bg-zinc-100 text-zinc-700',
};

const fmt = (n, ccy = 'usd') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (ccy || 'USD').toUpperCase() }).format(n || 0); }
  catch { return `${(n || 0).toFixed(2)} ${(ccy || 'USD').toUpperCase()}`; }
};

export default function ManagerOrdersPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/manager/orders?limit=200`);
      setItems(r.data?.items || []);
    } catch {
      toast.error('Помилка завантаження');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-focus order from ?focus=<id> (from notification click)
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (focusId && items.length > 0) {
      const o = items.find((x) => x.id === focusId);
      if (o) {
        setActive(o);
        const next = new URLSearchParams(searchParams);
        next.delete('focus');
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, items, setSearchParams]);

  const openOrder = async (id) => {
    try {
      const r = await axios.get(`${API_URL}/api/orders/${id}`);
      setActive(r.data?.order);
    } catch (e) { toast.error('Помилка'); }
  };

  const onStepUpdated = (newOrder) => {
    if (!newOrder) return;
    setActive(newOrder);
    setItems((prev) => prev.map((o) => (o.id === newOrder.id ? newOrder : o)));
  };

  const sendNote = async () => {
    if (!noteText.trim() || !active) return;
    try {
      await axios.post(`${API_URL}/api/orders/${active.id}/notes`, { body: noteText });
      const r = await axios.get(`${API_URL}/api/orders/${active.id}`);
      setActive(r.data?.order);
      setNoteText('');
    } catch { toast.error('Помилка'); }
  };

  const filtered = items.filter((o) => !q || (o.id + (o.customerId || '') + (o.invoiceId || '')).toLowerCase().includes(q.toLowerCase()));

  if (active) {
    const totalSteps = (active.steps || []).length;
    const doneSteps = (active.steps || []).filter((s) => s.status === 'done').length;
    const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setActive(null)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> До списку замовлень
        </button>
        <div className="bg-gradient-to-br from-[#635BFF] to-[#7C6FFF] rounded-2xl p-6 text-white mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs opacity-80 uppercase tracking-wider">Замовлення</p>
              <p className="font-mono text-sm mt-0.5">{active.id}</p>
              <p className="text-3xl font-bold mt-2">{fmt(active.amount, active.currency)}</p>
            </div>
            <div className="text-right">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium bg-white/20 ${STATUS_BADGE[active.status] ? '' : ''}`}>{active.status}</span>
              <p className="text-xs opacity-80 mt-2">Клієнт: {active.customerId || '—'}</p>
              <p className="text-xs opacity-80">Інвойс: {active.invoiceId || '—'}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs opacity-80 mb-1"><span>Прогрес</span><span>{doneSteps}/{totalSteps} • {pct}%</span></div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><Package className="w-4 h-4" /> Послуги ({(active.items || []).length})</h3>
          <div className="space-y-2">
            {(active.items || []).map((it) => (
              <div key={it.service_item_id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                <span className="text-sm font-medium text-gray-800">{it.name}</span>
                <span className="text-sm text-gray-500">{fmt(it.line_total || it.price, active.currency)} × {it.qty}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
          <h3 className="font-semibold text-gray-900 mb-4">Workflow — {totalSteps} етапів</h3>
          <div className="space-y-2">
            {(active.steps || []).map((s) => (
              <OrderStepRow key={s.id} step={s} orderId={active.id} onUpdated={onStepUpdated} />
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><MessageCircle className="w-4 h-4" /> Нотатки</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
            {(active.notes || []).map((n) => (
              <div key={n.id} className="text-sm bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span className="font-medium">{n.author}</span>
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                </div>
                <p className="text-gray-800">{n.body}</p>
              </div>
            ))}
            {(!active.notes || active.notes.length === 0) && <p className="text-xs text-gray-400 italic">Поки що нотаток немає</p>}
          </div>
          <div className="flex items-end gap-2">
            <textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Залишити нотатку…" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            <button onClick={sendNote} disabled={!noteText.trim()} className="px-3 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] disabled:opacity-50"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1280px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Briefcase className="w-7 h-7 text-[#635BFF]" /> Замовлення</h1>
          <p className="text-sm text-gray-500 mt-1">Замовлення створюються автоматично після оплати клієнтом інвойсу.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук за ID / клієнтом / інвойсом…" className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {filtered.length === 0 && !loading ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Немає активних замовлень.</p>
            <p className="text-xs text-gray-400 mt-1">Як тільки клієнт оплатить інвойс — тут з'явиться нове замовлення.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Замовлення</th>
                <th className="text-left px-5 py-3 font-medium">Клієнт</th>
                <th className="text-left px-5 py-3 font-medium">Послуги</th>
                <th className="text-left px-5 py-3 font-medium">Прогрес</th>
                <th className="text-right px-5 py-3 font-medium">Сума</th>
                <th className="text-left px-5 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const total = (o.steps || []).length;
                const done  = (o.steps || []).filter((s) => s.status === 'done').length;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <tr key={o.id} onClick={() => openOrder(o.id)} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900 font-mono text-xs">{o.id}</p>
                      <p className="text-xs text-gray-400 font-mono">{o.invoiceId}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{o.customerId || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(o.items || []).slice(0, 3).map((it, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 bg-gray-100 rounded">{it.name}</span>)}
                        {(o.items || []).length > 3 && <span className="text-[11px] text-gray-400">+{o.items.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#635BFF] rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 tabular-nums">{done}/{total}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmt(o.amount, o.currency)}</td>
                    <td className="px-5 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
