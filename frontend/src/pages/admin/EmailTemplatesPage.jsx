/**
 * Master-Admin  →  Email Templates editor
 * Edit subject/html/text per (event × audience × lang). Create-on-save
 * if the row does not yet exist in the DB (seed was moved to Mongo).
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Mail,
  RefreshCw,
  Save,
  Eye,
  Filter,
  Search,
  Clock,
  CheckCircle2,
  Send,
  PlayCircle,
  FileCheck2,
  AlertTriangle,
  Layers,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const EVENT_META = {
  invoice_sent:      { label: 'Рахунок надіслано',     icon: Send,           color: '#2563EB' },
  payment_confirmed: { label: 'Оплату підтверджено',   icon: CheckCircle2,   color: '#059669' },
  order_started:     { label: 'Замовлення запущено',   icon: PlayCircle,     color: '#7C3AED' },
  order_finished:    { label: 'Замовлення виконано',   icon: FileCheck2,     color: '#047857' },
  payment_reminder:  { label: 'Нагадування про оплату', icon: AlertTriangle, color: '#D97706' },
};

const AUDIENCE_LABEL = {
  customer:     { label: 'Клієнт',      color: 'bg-blue-100 text-blue-700' },
  manager:      { label: 'Менеджер',    color: 'bg-violet-100 text-violet-700' },
  team_lead:    { label: 'Team Lead',   color: 'bg-amber-100 text-amber-700' },
  master_admin: { label: 'Master Admin', color: 'bg-zinc-100 text-zinc-700' },
};

const LANG_LABEL = { ua: '🇺🇦 UA', en: '🇬🇧 EN' };

const authHeaders = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function EmailTemplatesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filterEvent, setFilterEvent] = useState('');
  const [filterAud, setFilterAud] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/admin/email-templates`, { headers: authHeaders() });
      setItems(r.data?.items || []);
    } catch { toast.error('Помилка завантаження'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => items.filter(t => (
    (!filterEvent || t.event === filterEvent) &&
    (!filterAud   || t.audience === filterAud) &&
    (!search || (t.subject || '').toLowerCase().includes(search.toLowerCase()))
  )), [items, filterEvent, filterAud, search]);

  const save = async () => {
    if (!selected) return;
    try {
      // Update if `id` exists; otherwise create.
      if (selected.id && items.some(i => i.id === selected.id && !i._new)) {
        await axios.patch(`${API_URL}/api/admin/email-templates/${selected.id}`, {
          subject: selected.subject,
          html: selected.html,
          text_template: selected.text_template || '',
        }, { headers: authHeaders() });
      } else {
        await axios.post(`${API_URL}/api/admin/email-templates`, selected, { headers: authHeaders() });
      }
      toast.success('Шаблон збережено');
      await load();
      setSelected(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка збереження');
    }
  };

  const testDispatch = async () => {
    if (!selected?.event) return;
    try {
      const r = await axios.post(`${API_URL}/api/admin/notifications/test-dispatch`, {
        event: selected.event,
      }, { headers: authHeaders() });
      toast.success(`Dispatch OK · ${r.data?.dispatch?.total || 0} отримувачів`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка відправки тесту');
    }
  };

  const openNew = () => setSelected({
    _new: true, id: null, event: 'invoice_sent', audience: 'customer', lang: 'ua',
    subject: '', html: '<p></p>', text_template: '',
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Mail className="w-7 h-7 text-[#635BFF]" /> Email templates
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Редагуй subject/html/text для кожної події, аудиторії та мови. Токени виду {'{{ invoice.id }}'} рендеряться на сервері.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
          </button>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] text-sm font-medium">
            <Layers className="w-4 h-4" /> Новий шаблон
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Пошук за subject…" className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm" />
        </div>
        <Filter className="w-4 h-4 text-zinc-400" />
        <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white">
          <option value="">Всі події</option>
          {Object.entries(EVENT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterAud} onChange={(e) => setFilterAud(e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white">
          <option value="">Всі аудиторії</option>
          {Object.entries(AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Подія</th>
              <th className="text-left px-5 py-3 font-medium">Аудиторія</th>
              <th className="text-left px-5 py-3 font-medium">Мова</th>
              <th className="text-left px-5 py-3 font-medium">Subject</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-zinc-400 text-sm">Шаблонів не знайдено</td></tr>
            ) : filtered.map(t => {
              const meta = EVENT_META[t.event] || { label: t.event, color: '#71717A' };
              const Icon = meta.icon || Mail;
              const aud = AUDIENCE_LABEL[t.audience] || { label: t.audience, color: 'bg-zinc-100 text-zinc-700' };
              return (
                <tr key={t.id} onClick={() => setSelected(t)} className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                  <td className="px-5 py-3 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${meta.color}15` }}>
                      <Icon className="w-4 h-4" style={{ color: meta.color }} />
                    </div>
                    <span className="text-zinc-900 font-medium">{meta.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${aud.color}`}>{aud.label}</span>
                  </td>
                  <td className="px-5 py-3 text-zinc-600">{LANG_LABEL[t.lang] || t.lang}</td>
                  <td className="px-5 py-3 text-zinc-700 truncate max-w-[500px]">{t.subject}</td>
                  <td className="px-5 py-3 text-right text-xs text-zinc-400">
                    {t.updated_at ? <><Clock className="inline w-3 h-3" /> edited</> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-zinc-900/40" onClick={() => setSelected(null)} />
          <aside className="w-full max-w-3xl bg-white shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-900">{selected._new ? 'Новий шаблон' : 'Редагування шаблону'}</h2>
                <p className="text-xs text-zinc-500">{selected.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(p => !p)} className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-sm text-zinc-700 flex items-center gap-1">
                  <Eye className="w-4 h-4" /> {preview ? 'HTML' : 'Preview'}
                </button>
                <button onClick={testDispatch} className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm flex items-center gap-1">
                  <Send className="w-4 h-4" /> Тест
                </button>
                <button onClick={save} className="px-3 py-1.5 bg-[#635BFF] hover:bg-[#5147d4] text-white rounded-lg text-sm font-medium flex items-center gap-1">
                  <Save className="w-4 h-4" /> Зберегти
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Подія</label>
                  <select disabled={!selected._new} value={selected.event} onChange={(e) => setSelected({ ...selected, event: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white disabled:opacity-60">
                    {Object.entries(EVENT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Аудиторія</label>
                  <select disabled={!selected._new} value={selected.audience} onChange={(e) => setSelected({ ...selected, audience: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white disabled:opacity-60">
                    {Object.entries(AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Мова</label>
                  <select disabled={!selected._new} value={selected.lang} onChange={(e) => setSelected({ ...selected, lang: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white disabled:opacity-60">
                    <option value="ua">🇺🇦 UA</option>
                    <option value="en">🇬🇧 EN</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Тема (Subject)</label>
                <input value={selected.subject || ''} onChange={(e) => setSelected({ ...selected, subject: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm font-medium" />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">HTML body</label>
                {preview ? (
                  <div className="border border-zinc-200 rounded-lg p-4 max-h-96 overflow-y-auto bg-white" dangerouslySetInnerHTML={{ __html: selected.html || '' }} />
                ) : (
                  <textarea rows={12} value={selected.html || ''} onChange={(e) => setSelected({ ...selected, html: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm font-mono" />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Текстова версія (опційно)</label>
                <textarea rows={3} value={selected.text_template || ''} onChange={(e) => setSelected({ ...selected, text_template: e.target.value })} className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm" />
              </div>

              <div className="bg-zinc-50 border border-zinc-100 rounded-lg p-3 text-xs text-zinc-500">
                <p className="font-medium text-zinc-700 mb-1">Доступні токени:</p>
                <code className="text-[11px] leading-relaxed block">
                  {'{{ customer.name }}  {{ customer.email }}  {{ invoice.id }}  {{ invoice.total_fmt }}  {{ invoice.currency }}'}
                  <br />{'{{ order.id }}  {{ order.steps_total }}  {{ manager.name }}  {{ manager.email }}'}
                </code>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
