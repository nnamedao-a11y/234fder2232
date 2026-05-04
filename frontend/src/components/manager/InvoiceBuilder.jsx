/**
 * Reusable invoice builder modal for managers.
 * Opens with a customerId; manager selects services from catalog,
 * adjusts price/qty, can add custom line items, and creates a Stripe-payable
 * invoice in one click.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { X, Plus, Trash2, Send, Package, Sparkles } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const fmt = (n, ccy = 'usd') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (ccy || 'USD').toUpperCase() }).format(n || 0); }
  catch { return `${(n || 0).toFixed(2)}`; }
};

export default function InvoiceBuilder({ open, onClose, customerId, customerEmail, onCreated }) {
  const [services, setServices] = useState([]);
  const [items, setItems] = useState([]);
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const loadServices = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/services`);
      setServices(r.data?.items || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (open) { loadServices(); setItems([]); setNotes(''); } }, [open, loadServices]);

  if (!open) return null;

  const addService = (svc) => {
    setItems((prev) => [...prev, { service_id: svc.id, name: svc.name, description: svc.description, price: svc.default_price, qty: svc.default_qty || 1 }]);
    if (svc.currency && currency !== svc.currency) setCurrency(svc.currency);
  };

  const addCustom = () => setItems((prev) => [...prev, { service_id: null, name: '', description: '', price: 0, qty: 1 }]);
  const updateItem = (idx, patch) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const total = items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 1)), 0);

  const submit = async () => {
    if (!customerId) { toast.error('Не вказано клієнта'); return; }
    const valid = items.filter((it) => it.name && Number(it.price) >= 0 && Number(it.qty) > 0);
    if (valid.length === 0) { toast.error('Додайте хоча б одну послугу'); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/api/manager/invoices`, {
        customerId, currency, notes, items: valid,
      });
      toast.success(`Інвойс створено: ${fmt(r.data?.invoice?.total, currency)}`);
      onCreated?.(r.data?.invoice);
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка створення');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg text-gray-900">Новий рахунок</h2>
            <p className="text-xs text-gray-500">Клієнт: {customerEmail || customerId}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6">
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Швидко з каталогу</h3>
          <div className="flex flex-wrap gap-2 mb-5">
            {services.map((s) => (
              <button key={s.id} onClick={() => addService(s)} className="flex items-center gap-2 px-3 py-1.5 bg-[#635BFF]/5 hover:bg-[#635BFF]/10 text-[#635BFF] rounded-lg text-sm border border-[#635BFF]/20">
                <Plus className="w-3.5 h-3.5" /> {s.name} <span className="text-xs opacity-70">{s.default_price} {s.currency}</span>
              </button>
            ))}
            <button onClick={addCustom} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm border border-gray-200 text-gray-700">
              <Plus className="w-3.5 h-3.5" /> Кастомна послуга
            </button>
          </div>

          <div className="space-y-2">
            {items.length === 0 && (
              <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Немає рядків. Виберіть послугу зверху або додайте кастомну.</p>
              </div>
            )}
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex-1">
                  <input value={it.name} onChange={(e) => updateItem(idx, { name: e.target.value })} placeholder="Назва послуги" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white font-medium" />
                  <input value={it.description || ''} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Опис (необов'язково)" className="w-full mt-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white" />
                </div>
                <input type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(idx, { price: e.target.value })} className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-right" />
                <input type="number" min="1" step="1" value={it.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })} className="w-16 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-center" />
                <button onClick={() => removeItem(idx)} className="p-2 hover:bg-rose-50 text-rose-500 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Внутрішня нотатка (видно лише вам та team-lead)" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Разом</p>
            <p className="text-2xl font-bold text-gray-900">{fmt(total, currency)}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              {['USD','EUR','UAH','BGN','GBP'].map((c) => <option key={c}>{c}</option>)}
            </select>
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Скасувати</button>
            <button onClick={submit} disabled={loading || items.length === 0} className="flex items-center gap-2 px-5 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] disabled:opacity-50 text-sm font-medium">
              <Send className="w-4 h-4" /> Створити та надіслати
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
