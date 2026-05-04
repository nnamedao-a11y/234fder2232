/**
 * Manager Invoices  —  /manager/invoices
 * --------------------------------------------------------------------
 * Multi-line invoice builder backed by the master-admin services
 * catalog. Manager picks one or more services (or types a custom line),
 * sends the invoice to the customer, and after payment automatically
 * gets a linked order with workflow steps.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import {
  Receipt,
  Plus,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  RefreshCw,
  Search,
  Filter,
  Trash2,
  Package,
  ListChecks,
  ArrowRight,
  FileText,
  CreditCard,
  ChevronRight,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// ────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────
const fmt = (n, ccy = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (ccy || 'USD').toUpperCase(),
    }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${(ccy || 'USD').toUpperCase()}`;
  }
};

const STATUS_META = {
  draft:     { label: 'Чернетка',         color: 'bg-zinc-100 text-zinc-700',     icon: FileText },
  sent:      { label: 'Надіслано',        color: 'bg-blue-100 text-blue-700',     icon: Send },
  pending:   { label: 'Очікує оплати',    color: 'bg-amber-100 text-amber-700',   icon: Clock },
  paid:      { label: 'Оплачено',         color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  cancelled: { label: 'Скасовано',        color: 'bg-zinc-100 text-zinc-500',     icon: X },
  overdue:   { label: 'Прострочено',      color: 'bg-rose-100 text-rose-700',     icon: AlertTriangle },
};

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.draft;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${m.color}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
};

const authHeaders = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// ────────────────────────────────────────────────────────────────────
// Create invoice modal — multi-line builder
// ────────────────────────────────────────────────────────────────────
const newCustomLine = () => ({
  id: `line_${Math.random().toString(36).slice(2, 8)}`,
  service_id: null,
  name: '',
  description: '',
  price: 0,
  qty: 1,
  category: 'custom',
  workflow: [],
});

function CreateInvoiceModal({ open, onClose, customers, services, onCreated }) {
  const [customerId, setCustomerId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setCustomerId('');
      setCurrency('USD');
      setNotes('');
      setDueDate('');
      setItems([]);
    }
  }, [open]);

  const total = useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.qty) || 0), 0),
    [items],
  );

  const addService = (svc) => {
    setItems((prev) => [
      ...prev,
      {
        id: `line_${Math.random().toString(36).slice(2, 8)}`,
        service_id: svc.id,
        name: svc.name,
        description: svc.description || '',
        price: Number(svc.default_price) || 0,
        qty: Number(svc.default_qty) || 1,
        category: svc.category,
        workflow: svc.workflow || [],
      },
    ]);
    setPickerOpen(false);
    setPickerQuery('');
  };

  const updateLine = (idx, patch) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeLine = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const filteredServices = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim();
    return services.filter(
      (s) =>
        s.is_active !== false &&
        (!q ||
          (s.name || '').toLowerCase().includes(q) ||
          (s.code || '').toLowerCase().includes(q) ||
          (s.category || '').toLowerCase().includes(q)),
    );
  }, [services, pickerQuery]);

  const submit = async () => {
    if (!customerId) return toast.error('Оберіть клієнта');
    if (items.length === 0) return toast.error('Додайте хоча б одну послугу');
    for (const it of items) {
      if (!it.name?.trim()) return toast.error('Назва позиції обов\'язкова');
      if (Number(it.price) < 0) return toast.error('Ціна не може бути від\'ємною');
    }

    const payload = {
      customerId,
      currency,
      notes,
      dueDate: dueDate || undefined,
      items: items.map((it) => ({
        service_id: it.service_id || undefined,
        name: it.name,
        description: it.description || undefined,
        price: Number(it.price),
        qty: Number(it.qty),
      })),
    };

    setSaving(true);
    try {
      const r = await axios.post(`${API_URL}/api/manager/invoices`, payload, {
        headers: authHeaders(),
      });
      toast.success('Рахунок створено');
      onCreated?.(r.data?.invoice);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка створення рахунку');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-invoice-modal"
      >
        {/* header */}
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#635BFF]/10 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-[#635BFF]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Новий рахунок</h2>
              <p className="text-xs text-zinc-500">Підбірка послуг для клієнта · Multi-line</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="p-6 space-y-6">
          {/* customer + currency */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 mb-1">Клієнт *</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#635BFF]/20 focus:border-[#635BFF]"
                data-testid="invoice-customer-select"
              >
                <option value="">— Оберіть клієнта —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.firstName || c.name || c.email || c.id)}
                    {c.email ? ` · ${c.email}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Валюта</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm bg-white"
              >
                {['USD', 'EUR', 'UAH', 'BGN', 'GBP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* due date + notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Термін оплати</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 mb-1">Нотатки клієнту</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Напр.: Оплата до п'ятниці"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* lines builder */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-[#635BFF]" /> Позиції рахунку
                <span className="text-xs text-zinc-400 font-normal">{items.length}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setItems((p) => [...p, newCustomLine()])}
                  className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-xs font-medium text-zinc-700"
                  data-testid="add-custom-line"
                >
                  <Plus className="w-3.5 h-3.5" /> Своя позиція
                </button>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#635BFF] hover:bg-[#5147d4] text-white rounded-lg text-xs font-medium"
                  data-testid="add-service-line"
                >
                  <Package className="w-3.5 h-3.5" /> Додати послугу
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-10 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                <Package className="w-10 h-10 text-zinc-300 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">Ще немає позицій</p>
                <p className="text-xs text-zinc-400 mt-1">Натисніть «Додати послугу» щоб обрати з каталогу</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div
                    key={it.id}
                    className="bg-white border border-zinc-200 rounded-xl p-3 flex flex-wrap items-start gap-3"
                  >
                    <div className="flex-1 min-w-[220px]">
                      <input
                        value={it.name}
                        onChange={(e) => updateLine(idx, { name: e.target.value })}
                        placeholder="Назва позиції"
                        className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm font-medium"
                        data-testid={`invoice-line-name-${idx}`}
                      />
                      {it.service_id ? (
                        <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                          <Package className="w-3 h-3" /> з каталогу · {it.workflow.length} етапів
                        </p>
                      ) : (
                        <p className="text-[11px] text-zinc-400 mt-1">Custom line</p>
                      )}
                    </div>
                    <div className="w-24">
                      <label className="block text-[10px] text-zinc-400 mb-0.5">Ціна</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.price}
                        onChange={(e) => updateLine(idx, { price: e.target.value })}
                        className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-right tabular-nums"
                        data-testid={`invoice-line-price-${idx}`}
                      />
                    </div>
                    <div className="w-16">
                      <label className="block text-[10px] text-zinc-400 mb-0.5">К-сть</label>
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={it.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                        className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-right tabular-nums"
                      />
                    </div>
                    <div className="w-28 text-right">
                      <label className="block text-[10px] text-zinc-400 mb-0.5">Сума</label>
                      <p className="px-2 py-1.5 font-semibold text-sm tabular-nums text-zinc-900">
                        {fmt((Number(it.price) || 0) * (Number(it.qty) || 0), currency)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeLine(idx)}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg self-center"
                      title="Видалити позицію"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* total */}
            <div className="mt-4 pt-4 border-t border-zinc-200 flex items-center justify-between">
              <span className="text-sm text-zinc-500">Разом</span>
              <span className="text-2xl font-bold text-zinc-900 tabular-nums">{fmt(total, currency)}</span>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="sticky bottom-0 bg-white border-t border-zinc-200 px-6 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
          >
            Скасувати
          </button>
          <button
            onClick={submit}
            disabled={saving || items.length === 0 || !customerId}
            className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="create-invoice-submit"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Створити рахунок
          </button>
        </div>

        {/* Service picker overlay */}
        {pickerOpen && (
          <div
            className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center p-6"
            onClick={() => setPickerOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
                <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#635BFF]" /> Каталог послуг
                </h3>
                <button onClick={() => setPickerOpen(false)} className="p-1.5 hover:bg-zinc-100 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-4 py-2 border-b border-zinc-100">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Пошук за назвою / категорією…"
                    className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {filteredServices.length === 0 ? (
                  <div className="text-center py-8 text-sm text-zinc-500">
                    Послуги не знайдено. Master-admin може додати їх у{' '}
                    <code className="px-1.5 py-0.5 bg-zinc-100 rounded">/admin/services</code>.
                  </div>
                ) : (
                  filteredServices.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addService(s)}
                      className="w-full text-left p-3 rounded-xl hover:bg-zinc-50 flex items-center gap-3 group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-[#635BFF]/10 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-[#635BFF]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{s.name}</p>
                        <p className="text-xs text-zinc-500 truncate">
                          <span className="capitalize">{s.category}</span>
                          {s.code ? ` · ${s.code}` : ''}
                          {' · '}
                          {(s.workflow || []).length} етапів
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-zinc-700 tabular-nums">
                        {fmt(s.default_price, s.currency || currency)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-[#635BFF]" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Detail drawer (incl. linked order)
// ────────────────────────────────────────────────────────────────────
function InvoiceDetailDrawer({ invoice, onClose, onChanged }) {
  const [order, setOrder] = useState(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [acting, setActing] = useState('');

  const fetchOrder = useCallback(async () => {
    if (!invoice?.id || invoice.status !== 'paid') {
      setOrder(null);
      return;
    }
    setLoadingOrder(true);
    try {
      // The manager-orders list includes the invoice mapping
      const r = await axios.get(`${API_URL}/api/manager/orders?limit=200`, { headers: authHeaders() });
      const o = (r.data?.items || []).find((x) => x.invoiceId === invoice.id);
      setOrder(o || null);
    } finally {
      setLoadingOrder(false);
    }
  }, [invoice?.id, invoice?.status]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  const act = async (action) => {
    setActing(action);
    try {
      const r = await axios.patch(
        `${API_URL}/api/invoices/${invoice.id}/${action}`,
        {},
        { headers: authHeaders() },
      );
      toast.success({ send: 'Надіслано клієнту', cancel: 'Скасовано', 'mark-paid': 'Позначено оплаченим' }[action] || 'OK');
      onChanged?.(r.data?.invoice);
      // mark-paid → fetch the new order
      if (action === 'mark-paid') setTimeout(fetchOrder, 400);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Помилка');
    } finally {
      setActing('');
    }
  };

  if (!invoice) return null;

  const items = invoice.items || [];

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-zinc-900/40" onClick={onClose} />
      <aside className="w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-400">Рахунок</p>
            <p className="font-mono text-sm text-zinc-700">{invoice.id}</p>
            <div className="mt-2"><StatusBadge status={invoice.status} /></div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-gradient-to-br from-[#635BFF] to-[#7C6FFF] rounded-2xl p-5 text-white">
            <p className="text-xs opacity-80 uppercase tracking-wider">Сума</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{fmt(invoice.total || invoice.amount, invoice.currency)}</p>
            <p className="text-xs opacity-80 mt-2">Клієнт: {invoice.customerId}</p>
            {invoice.dueDate && <p className="text-xs opacity-80">Термін: {new Date(invoice.dueDate).toLocaleDateString()}</p>}
          </div>

          {/* line items */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Позиції</h3>
            <div className="space-y-1.5">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between p-2 rounded-lg bg-zinc-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800 truncate">{it.name}</p>
                    <p className="text-[11px] text-zinc-500">
                      {it.service_id ? <span className="text-[#635BFF]">з каталогу</span> : 'custom'} · {fmt(it.price, invoice.currency)} × {it.qty}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{fmt(it.line_total, invoice.currency)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* actions */}
          {['draft', 'sent', 'pending'].includes(invoice.status) && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => act('send')}
                disabled={acting === 'send'}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Надіслати клієнту
              </button>
              <button
                onClick={() => act('mark-paid')}
                disabled={acting === 'mark-paid'}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <CreditCard className="w-4 h-4" /> Підтвердити оплату
              </button>
              <button
                onClick={() => {
                  if (!window.confirm('Скасувати цей рахунок?')) return;
                  act('cancel');
                }}
                disabled={acting === 'cancel'}
                className="flex items-center gap-2 px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Скасувати
              </button>
            </div>
          )}

          {/* linked order */}
          {invoice.status === 'paid' && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2 flex items-center gap-2">
                <ListChecks className="w-3.5 h-3.5" /> Замовлення / Workflow
              </h3>
              {loadingOrder ? (
                <div className="text-center py-4 text-sm text-zinc-500"><RefreshCw className="w-4 h-4 inline animate-spin" /> завантаження…</div>
              ) : order ? (
                <a
                  href={`/manager/orders`}
                  className="group block bg-emerald-50 border border-emerald-200 rounded-2xl p-4 hover:bg-emerald-100"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-emerald-700 font-mono">{order.id}</p>
                      <p className="text-sm font-medium text-emerald-900 mt-0.5">
                        {(order.steps || []).filter((s) => s.status === 'done').length}/{(order.steps || []).length} етапів виконано
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="mt-2 h-1.5 bg-white border border-emerald-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{
                        width: `${
                          (order.steps || []).length
                            ? Math.round(
                                ((order.steps || []).filter((s) => s.status === 'done').length /
                                  (order.steps || []).length) *
                                  100,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </a>
              ) : (
                <p className="text-sm text-zinc-500">Замовлення ще створюється…</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────
export default function ManagerInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [services, setServices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invR, svcR, cusR] = await Promise.all([
        axios.get(`${API_URL}/api/manager/invoices/my?limit=200`, { headers: authHeaders() }),
        axios.get(`${API_URL}/api/services`),
        axios.get(`${API_URL}/api/customers?limit=500`, { headers: authHeaders() }),
      ]);
      setInvoices(invR.data?.items || []);
      setServices(svcR.data?.items || []);
      const cusBody = cusR.data;
      const cusList = Array.isArray(cusBody)
        ? cusBody
        : cusBody?.data || cusBody?.items || cusBody?.customers || [];
      setCustomers(cusList);
    } catch (e) {
      toast.error('Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-open invoice from ?focus=<id> (coming from notification click)
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (focusId && invoices.length > 0) {
      const inv = invoices.find((x) => x.id === focusId);
      if (inv) {
        setDrawer(inv);
        // Clean the URL so refresh doesn't re-open
        const next = new URLSearchParams(searchParams);
        next.delete('focus');
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, invoices, setSearchParams]);

  const onInvoiceCreated = (inv) => {
    if (!inv) return;
    setInvoices((prev) => [inv, ...prev]);
  };

  const onInvoiceChanged = (inv) => {
    if (!inv) return;
    setInvoices((prev) => prev.map((x) => (x.id === inv.id ? inv : x)));
    setDrawer((d) => (d && d.id === inv.id ? inv : d));
  };

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (filter !== 'all' && inv.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (inv.id || '').toLowerCase().includes(q) ||
          (inv.customerId || '').toLowerCase().includes(q) ||
          (inv.description || '').toLowerCase().includes(q) ||
          (inv.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, filter, search]);

  // KPI cards
  const stats = useMemo(() => {
    const sumBy = (st) => invoices.filter((i) => i.status === st).reduce((s, i) => s + (i.total || i.amount || 0), 0);
    return {
      total: invoices.length,
      pending: invoices.filter((i) => ['pending', 'sent', 'draft'].includes(i.status)).length,
      paid: sumBy('paid'),
      overdue: sumBy('overdue'),
    };
  }, [invoices]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto" data-testid="manager-invoices-page">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Receipt className="w-7 h-7 text-[#635BFF]" /> Рахунки
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Створюйте multi-line рахунки з каталогу послуг. Після оплати автоматично з'явиться workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Оновити
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] text-sm font-medium"
            data-testid="create-invoice-btn"
          >
            <Plus className="w-4 h-4" /> Новий рахунок
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Всього', value: stats.total, color: '#635BFF', icon: Receipt },
          { label: 'У роботі', value: stats.pending, color: '#F59E0B', icon: Clock },
          { label: 'Оплачено', value: fmt(stats.paid, 'USD'), color: '#10B981', icon: CheckCircle2 },
          { label: 'Прострочено', value: fmt(stats.overdue, 'USD'), color: '#EF4444', icon: AlertTriangle },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${s.color}15` }}>
                <Icon className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">{s.label}</p>
                <p className="text-xl font-bold text-zinc-900">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* filters */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за ID / клієнтом / описом…"
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm"
            data-testid="invoice-search"
          />
        </div>
        <Filter className="w-4 h-4 text-zinc-400" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white"
          data-testid="invoice-filter"
        >
          <option value="all">Всі статуси</option>
          <option value="draft">Чернетки</option>
          <option value="sent">Надіслані</option>
          <option value="pending">Очікують оплати</option>
          <option value="paid">Оплачені</option>
          <option value="overdue">Прострочені</option>
          <option value="cancelled">Скасовані</option>
        </select>
      </div>

      {/* table */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">Рахунок</th>
              <th className="text-left px-5 py-3 font-medium">Клієнт</th>
              <th className="text-left px-5 py-3 font-medium">Послуги</th>
              <th className="text-right px-5 py-3 font-medium">Сума</th>
              <th className="text-left px-5 py-3 font-medium">Статус</th>
              <th className="text-left px-5 py-3 font-medium">Дата</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-zinc-400">
                  <Receipt className="w-10 h-10 mx-auto mb-2 text-zinc-300" />
                  <p className="text-sm">Рахунків не знайдено</p>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="mt-3 text-sm text-[#635BFF] hover:underline"
                  >
                    Створити перший
                  </button>
                </td>
              </tr>
            ) : (
              filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => setDrawer(inv)}
                  className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer"
                  data-testid={`invoice-row-${inv.id}`}
                >
                  <td className="px-5 py-3">
                    <p className="font-mono text-xs text-zinc-700">{inv.id}</p>
                    {inv.description && <p className="text-xs text-zinc-400 truncate max-w-[260px]">{inv.description}</p>}
                  </td>
                  <td className="px-5 py-3 text-zinc-700">{inv.customerId || '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(inv.items || []).slice(0, 3).map((it, i) => (
                        <span key={i} className="text-[11px] px-1.5 py-0.5 bg-zinc-100 rounded">
                          {it.name}
                        </span>
                      ))}
                      {(inv.items || []).length > 3 && (
                        <span className="text-[11px] text-zinc-400">+{inv.items.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {fmt(inv.total || inv.amount, inv.currency)}
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-5 py-3 text-xs text-zinc-500">
                    {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ChevronRight className="w-4 h-4 text-zinc-300 inline" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateInvoiceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        customers={customers}
        services={services}
        onCreated={onInvoiceCreated}
      />

      {drawer && (
        <InvoiceDetailDrawer
          invoice={drawer}
          onClose={() => setDrawer(null)}
          onChanged={onInvoiceChanged}
        />
      )}
    </div>
  );
}
