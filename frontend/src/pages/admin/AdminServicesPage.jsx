/**
 * Master-Admin Services Catalog
 * Master admin manages WHICH services managers can attach to invoices.
 * Each service has a default price + a workflow definition (steps that
 * appear on the order once payment succeeds).
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Package, Plus, Pencil, Trash2, Save, X, RefreshCw, ListChecks, DollarSign, Power, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const CATEGORIES = ['import', 'logistics', 'docs', 'custom'];

const CATEGORY_COLORS = {
  import:    { bg: 'bg-violet-100',  text: 'text-violet-700',  hex: '#7C3AED' },
  logistics: { bg: 'bg-blue-100',    text: 'text-blue-700',    hex: '#2563EB' },
  docs:      { bg: 'bg-amber-100',   text: 'text-amber-700',   hex: '#D97706' },
  custom:    { bg: 'bg-emerald-100', text: 'text-emerald-700', hex: '#059669' },
};

const emptyService = () => ({
  id: null,
  code: '',
  name: '',
  name_en: '',
  description: '',
  category: 'custom',
  default_price: 0,
  currency: 'USD',
  default_qty: 1,
  workflow: [
    { key: 'pending',     label: 'Очікує' },
    { key: 'in_progress', label: 'В роботі' },
    { key: 'completed',   label: 'Готово' },
  ],
  is_active: true,
});

export default function AdminServicesPage() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); // service object being edited or null
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [svcR, tplR] = await Promise.all([
        axios.get(`${API_URL}/api/admin/services`),
        axios.get(`${API_URL}/api/admin/workflow-templates`),
      ]);
      setItems(svcR.data?.items || []);
      setTemplates(tplR.data?.items || []);
    } catch {
      toast.error('Не вдалось завантажити каталог послуг');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moveStep = (idx, dir) => {
    const wf = [...(editor?.workflow || [])];
    const j = idx + dir;
    if (j < 0 || j >= wf.length) return;
    [wf[idx], wf[j]] = [wf[j], wf[idx]];
    setEditor({ ...editor, workflow: wf });
  };

  const applyTemplate = (tpl) => {
    setEditor({ ...editor, workflow: (tpl.steps || []).map((s) => ({ ...s })) });
    setShowTemplatePicker(false);
    toast.success(`Застосовано: ${tpl.name}`);
  };

  const saveService = async () => {
    if (!editor?.name) { toast.error('Назва обов\'язкова'); return; }
    try {
      if (editor.id) {
        await axios.patch(`${API_URL}/api/admin/services/${editor.id}`, editor);
        toast.success('Послугу оновлено');
      } else {
        await axios.post(`${API_URL}/api/admin/services`, editor);
        toast.success('Послугу створено');
      }
      setEditor(null);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка збереження');
    }
  };

  const toggleActive = async (svc) => {
    try {
      await axios.patch(`${API_URL}/api/admin/services/${svc.id}`, { is_active: !svc.is_active });
      await load();
    } catch { toast.error('Помилка'); }
  };

  const deleteService = async (svc) => {
    if (!window.confirm(`Деактивувати послугу "${svc.name}"?`)) return;
    try {
      await axios.delete(`${API_URL}/api/admin/services/${svc.id}`);
      toast.success('Деактивовано');
      await load();
    } catch { toast.error('Помилка'); }
  };

  return (
    <div className="p-6 max-w-[1280px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-7 h-7 text-[#635BFF]" />
            Каталог послуг
          </h1>
          <p className="text-sm text-gray-500 mt-1">Послуги, які менеджери можуть додавати у рахунки. Workflow визначає етапи замовлення після оплати.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
          </button>
          <button onClick={() => setEditor(emptyService())} className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] text-sm font-medium">
            <Plus className="w-4 h-4" /> Нова послуга
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((s) => {
          const c = CATEGORY_COLORS[s.category] || CATEGORY_COLORS.custom;
          return (
            <div key={s.id} className={`bg-white border rounded-2xl p-5 hover:shadow-sm transition-shadow ${s.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${c.hex}15` }}>
                    <Package className="w-5 h-5" style={{ color: c.hex }} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{s.code}</p>
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.bg} ${c.text} font-medium`}>{s.category}</span>
              </div>
              {s.description && <p className="text-sm text-gray-600 mb-3 line-clamp-2">{s.description}</p>}
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="flex items-center gap-1 text-gray-700 font-semibold">
                  <DollarSign className="w-3.5 h-3.5 text-gray-400" />{s.default_price} {s.currency}
                </span>
                <span className="flex items-center gap-1 text-gray-500 text-xs">
                  <ListChecks className="w-3.5 h-3.5" /> {s.workflow?.length || 0} етапів
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {(s.workflow || []).map((w, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{w.label}</span>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                <button onClick={() => setEditor(s)} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs font-medium text-gray-700">
                  <Pencil className="w-3.5 h-3.5" /> Редагувати
                </button>
                <button onClick={() => toggleActive(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${s.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} title={s.is_active ? 'Деактивувати' : 'Активувати'}>
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => deleteService(s)} className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs" title="Видалити">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !loading && (
          <div className="col-span-full text-center py-12 bg-white border border-dashed border-gray-300 rounded-2xl">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Каталог порожній.</p>
            <button onClick={() => setEditor(emptyService())} className="mt-3 px-4 py-2 bg-[#635BFF] text-white rounded-lg text-sm">Створити першу послугу</button>
          </div>
        )}
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setEditor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editor.id ? 'Редагування послуги' : 'Нова послуга'}</h2>
              <button onClick={() => setEditor(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Назва (UA)" value={editor.name} onChange={(v) => setEditor({ ...editor, name: v })} required />
                <Input label="Назва (EN)" value={editor.name_en} onChange={(v) => setEditor({ ...editor, name_en: v })} />
              </div>
              <Input label="Код (короткий ID)" value={editor.code} onChange={(v) => setEditor({ ...editor, code: v.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="напр. transit_insurance" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Опис</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Категорія</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <Input label="Базова ціна" type="number" value={editor.default_price} onChange={(v) => setEditor({ ...editor, default_price: Number(v) })} />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" value={editor.currency} onChange={(e) => setEditor({ ...editor, currency: e.target.value })}>
                    {['USD','EUR','UAH','BGN','GBP'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-600">Workflow (етапи замовлення)</label>
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker(true)}
                    className="flex items-center gap-1 px-2 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-medium"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Застосувати шаблон
                  </button>
                </div>
                <div className="space-y-2">
                  {(editor.workflow || []).map((w, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-gray-100 text-gray-500 text-xs flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                      <input className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm" placeholder="key (latin)" value={w.key} onChange={(e) => { const wf = [...editor.workflow]; wf[idx] = { ...wf[idx], key: e.target.value }; setEditor({ ...editor, workflow: wf }); }} />
                      <input className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm" placeholder="Назва етапу" value={w.label} onChange={(e) => { const wf = [...editor.workflow]; wf[idx] = { ...wf[idx], label: e.target.value }; setEditor({ ...editor, workflow: wf }); }} />
                      <div className="flex items-center">
                        <button type="button" disabled={idx === 0} onClick={() => moveStep(idx, -1)} className="p-1.5 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30" title="Вгору"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button type="button" disabled={idx === (editor.workflow || []).length - 1} onClick={() => moveStep(idx, +1)} className="p-1.5 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30" title="Вниз"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <button type="button" onClick={() => setEditor({ ...editor, workflow: editor.workflow.filter((_, i) => i !== idx) })} className="p-1.5 hover:bg-rose-50 text-rose-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setEditor({ ...editor, workflow: [...(editor.workflow || []), { key: 'new_step', label: 'Новий етап' }] })} className="mt-2 text-xs text-[#635BFF] hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Додати етап
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={!!editor.is_active} onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })} className="rounded border-gray-300" />
                Активна
              </label>
            </div>
            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button onClick={() => setEditor(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Скасувати</button>
              <button onClick={saveService} className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] text-sm font-medium">
                <Save className="w-4 h-4" /> Зберегти
              </button>
            </div>

            {/* Template picker overlay */}
            {showTemplatePicker && (
              <div className="absolute inset-0 bg-zinc-900/50 flex items-center justify-center p-6" onClick={() => setShowTemplatePicker(false)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                  <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
                    <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-600" /> Шаблон workflow
                    </h3>
                    <button onClick={() => setShowTemplatePicker(false)} className="p-1.5 hover:bg-zinc-100 rounded-lg"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    {templates.length === 0 ? (
                      <p className="text-sm text-zinc-500 text-center py-6">Шаблонів ще немає</p>
                    ) : templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className="w-full text-left p-3 rounded-xl hover:bg-zinc-50 border border-zinc-100 mb-2"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-zinc-900">{t.name}</p>
                            {t.description && <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>}
                          </div>
                          <span className="text-xs px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full">{(t.steps || []).length} кроків</span>
                        </div>
                        <div className="mt-2 flex items-center gap-1 flex-wrap">
                          {(t.steps || []).map((s, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded">{s.label}</span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && <span className="text-rose-500">*</span>}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20" />
    </div>
  );
}
