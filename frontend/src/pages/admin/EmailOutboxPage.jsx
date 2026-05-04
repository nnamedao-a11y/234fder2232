/**
 * Master-Admin  →  Email Outbox
 * Shows what the notification system actually sent (or logged in dry-run).
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Mail, RefreshCw, CheckCircle2, XCircle, Eye, Filter } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const authHeaders = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const STATUS_STYLE = {
  sent:    { label: 'sent',    color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  dry_run: { label: 'dry-run', color: 'bg-amber-100 text-amber-700',     icon: Eye },
  failed:  { label: 'failed',  color: 'bg-rose-100 text-rose-700',       icon: XCircle },
  queued:  { label: 'queued',  color: 'bg-zinc-100 text-zinc-700',       icon: Mail },
};

export default function EmailOutboxPage() {
  const [items, setItems] = useState([]);
  const [provider, setProvider] = useState('dry_run');
  const [loading, setLoading] = useState(true);
  const [filterEvent, setFilterEvent] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/admin/email-outbox?limit=200`, { headers: authHeaders() });
      setItems(r.data?.items || []);
      setProvider(r.data?.provider || 'dry_run');
    } catch { toast.error('Помилка завантаження'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const filtered = useMemo(
    () => items.filter((x) => !filterEvent || x.event === filterEvent),
    [items, filterEvent],
  );

  const events = Array.from(new Set(items.map((x) => x.event))).filter(Boolean);

  return (
    <div className="p-6 max-w-[1280px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Mail className="w-7 h-7 text-[#635BFF]" /> Email outbox
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Провайдер: <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${provider === 'resend' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{provider}</span>
            {provider === 'dry_run' && ' — реальні листи не надсилаються. Додайте RESEND_API_KEY у backend/.env для production.'}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-zinc-400" />
        <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white">
          <option value="">Всі події</option>
          {events.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Статус</th>
              <th className="text-left px-5 py-3 font-medium">Подія</th>
              <th className="text-left px-5 py-3 font-medium">Отримувач</th>
              <th className="text-left px-5 py-3 font-medium">Subject</th>
              <th className="text-left px-5 py-3 font-medium">Час</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-zinc-400 text-sm">Outbox порожній — події ще не тригерились.</td></tr>
            ) : filtered.map((e) => {
              const s = STATUS_STYLE[e.status] || STATUS_STYLE.queued;
              const Icon = s.icon;
              return (
                <tr key={e.id} onClick={() => setSelected(e)} className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.color}`}>
                      <Icon className="w-3 h-3" /> {s.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-zinc-700">{e.event}</td>
                  <td className="px-5 py-3 text-zinc-700">{e.to}</td>
                  <td className="px-5 py-3 text-zinc-800 truncate max-w-[420px]">{e.subject}</td>
                  <td className="px-5 py-3 text-xs text-zinc-500">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                  <td className="px-5 py-3 text-right"><Eye className="w-4 h-4 text-zinc-400 inline" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setSelected(null)}>
          <div className="flex-1 bg-zinc-900/40" />
          <aside className="w-full max-w-2xl bg-white shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-4">
              <p className="text-xs text-zinc-500 font-mono">{selected.id}</p>
              <h2 className="font-semibold text-zinc-900 mt-1">{selected.subject}</h2>
              <p className="text-xs text-zinc-500 mt-0.5">→ {selected.to}</p>
            </div>
            <div className="p-5">
              <div className="border border-zinc-200 rounded-lg p-4 bg-white" dangerouslySetInnerHTML={{ __html: selected.html || '' }} />
              {selected.provider_error && (
                <pre className="mt-3 bg-rose-50 border border-rose-100 rounded-lg p-3 text-xs text-rose-700 overflow-x-auto">{selected.provider_error}</pre>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
