/**
 * Master-Admin Payments Dashboard
 * --------------------------------
 * Full visibility & control over every Stripe charge:
 *  - KPI cards (total, succeeded, failed, refunded, pending)
 *  - By-method breakdown (Card / Apple Pay / Google Pay / Link / Klarna / Crypto / Bank…)
 *  - Daily revenue trend
 *  - Searchable & filterable payments table
 *  - Detail drawer with Stripe info + receipt + refund action
 *  - Sync button to pull latest PaymentIntents from Stripe API
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  CreditCard,
  RefreshCw,
  Search,
  Download,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  ExternalLink,
  TrendingUp,
  DollarSign,
  Activity,
  Filter,
  Wallet,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_BADGE = {
  succeeded:                'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  complete:                 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  paid:                     'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  processing:               'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  requires_payment_method:  'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  requires_action:          'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  open:                     'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  failed:                   'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
  canceled:                 'bg-gray-200 text-gray-600 ring-1 ring-gray-300',
  expired:                  'bg-gray-200 text-gray-600 ring-1 ring-gray-300',
};

const METHOD_META = {
  card:              { label: 'Card',           color: '#635BFF', icon: '💳' },
  apple_pay:         { label: 'Apple Pay',      color: '#000000', icon: '' },
  google_pay:        { label: 'Google Pay',     color: '#4285F4', icon: '🅖' },
  link:              { label: 'Link',           color: '#00D924', icon: '🔗' },
  klarna:            { label: 'Klarna',         color: '#FFB3C7', icon: 'K' },
  afterpay_clearpay: { label: 'Afterpay',       color: '#B2FCE4', icon: 'A' },
  cashapp:           { label: 'Cash App',       color: '#00D632', icon: '$' },
  crypto:            { label: 'Crypto',         color: '#F7931A', icon: '₿' },
  us_bank_account:   { label: 'ACH',            color: '#0F62FE', icon: '🏦' },
  sepa_debit:        { label: 'SEPA',           color: '#3B82F6', icon: '€' },
  ideal:             { label: 'iDEAL',          color: '#CC0066', icon: 'I' },
  bancontact:        { label: 'Bancontact',     color: '#005498', icon: 'B' },
  p24:               { label: 'Przelewy24',     color: '#D40028', icon: 'P' },
  blik:              { label: 'BLIK',           color: '#000',    icon: 'B' },
  alipay:            { label: 'Alipay',         color: '#1677FF', icon: 'A' },
  wechat_pay:        { label: 'WeChat',         color: '#07C160', icon: 'W' },
};

const fmtAmount = (n, ccy = 'usd') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (ccy || 'USD').toUpperCase() }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} ${(ccy || 'USD').toUpperCase()}`;
  }
};

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso || '—'; }
};

const StatCard = ({ label, value, sub, icon: Icon, accent = '#635BFF' }) => (
  <div className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}15` }}>
        <Icon className="w-5 h-5" style={{ color: accent }} />
      </div>
    </div>
  </div>
);

const MethodPill = ({ method, wallet }) => {
  const m = METHOD_META[method] || { label: method || '—', color: '#6B7280', icon: '?' };
  // If card with wallet (apple_pay/google_pay), show the wallet variant
  let displayMethod = m;
  if (method === 'card' && wallet) {
    displayMethod = METHOD_META[wallet] || m;
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium" style={{ backgroundColor: `${displayMethod.color}15`, color: displayMethod.color }}>
      <span className="text-[10px]">{displayMethod.icon}</span>
      {displayMethod.label}
    </span>
  );
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-600'}`}>
    {status === 'succeeded' || status === 'complete' || status === 'paid' ? <CheckCircle2 className="w-3 h-3" /> :
     status === 'failed' || status === 'canceled' || status === 'expired' ? <XCircle className="w-3 h-3" /> :
     <Clock className="w-3 h-3" />}
    {status || 'unknown'}
  </span>
);

export default function AdminPaymentsPage() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filters, setFilters] = useState({ status: '', method: '', q: '', days: 30 });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.method) params.set('method', filters.method);
      if (filters.q)      params.set('q', filters.q);
      params.set('days', String(filters.days || 30));
      params.set('limit', '200');
      const [statsRes, listRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/payments/stats?days=${filters.days || 30}`),
        axios.get(`${API_URL}/api/admin/payments?${params.toString()}`),
      ]);
      setStats(statsRes.data);
      setItems(listRes.data.items || []);
      setTotal(listRes.data.total || 0);
    } catch (e) {
      toast.error('Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await axios.post(`${API_URL}/api/admin/payments/sync?limit=100`);
      toast.success(`Synced ${r.data.synced || 0} payments from Stripe`);
      await load();
    } catch (e) {
      toast.error(`Sync failed: ${e.response?.data?.detail || e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const openDetail = async (payment) => {
    setSelected(payment);
    setDetail(null);
    try {
      const id = payment.paymentIntentId || payment.sessionId || payment.id;
      const r = await axios.get(`${API_URL}/api/admin/payments/${id}`);
      setDetail(r.data);
    } catch (e) {
      toast.error('Failed to load payment detail');
    }
  };

  const handleRefund = async (full = true) => {
    if (!selected) return;
    if (!window.confirm(`Refund ${full ? 'FULL' : 'partial'} amount ${fmtAmount(selected.amount, selected.currency)}? This action cannot be undone.`)) return;
    setRefunding(true);
    try {
      const id = selected.paymentIntentId || selected.id;
      const body = full ? { reason: 'requested_by_customer' } : { reason: 'requested_by_customer', amount: selected.amount / 2 };
      const r = await axios.post(`${API_URL}/api/admin/payments/${id}/refund`, body);
      toast.success(`Refund ${r.data.status}: ${fmtAmount(r.data.amount, selected.currency)}`);
      await load();
      await openDetail(selected);
    } catch (e) {
      toast.error(`Refund failed: ${e.response?.data?.detail || e.message}`);
    } finally {
      setRefunding(false);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'PaymentIntent', 'Status', 'Amount', 'Currency', 'Method', 'Card', 'Customer', 'Email', 'Invoice'],
      ...items.map(p => [
        p.created_at, p.paymentIntentId || p.sessionId || p.id, p.status, p.amount, p.currency,
        p.wallet || p.method || '', p.cardBrand && p.cardLast4 ? `${p.cardBrand} ****${p.cardLast4}` : '',
        p.customerId || '', p.customerEmail || '', p.invoiceId || '',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bibi-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dailyMax = useMemo(() => Math.max(1, ...(stats?.daily || []).map(d => d.amount || 0)), [stats]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-[#635BFF]" />
            Payments
          </h1>
          <p className="text-sm text-gray-500 mt-1">All Stripe transactions • {filters.days}-day window • Master-admin view</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filters.days}
            onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
            <option value="3650">All time</option>
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-[#635BFF] text-white rounded-lg hover:bg-[#5147d4] disabled:opacity-50 text-sm font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Sync from Stripe
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard label="Total volume" value={fmtAmount(stats.totalAmount, items[0]?.currency || 'USD')} sub={`${stats.totalCount} successful`} icon={DollarSign} accent="#635BFF" />
          <StatCard label="Succeeded" value={stats.succeeded} icon={CheckCircle2} accent="#10B981" />
          <StatCard label="Pending" value={stats.pending} icon={Clock} accent="#F59E0B" />
          <StatCard label="Failed" value={stats.failed} icon={XCircle} accent="#EF4444" />
          <StatCard label="Refunded" value={stats.refunded} icon={RotateCcw} accent="#6B7280" />
        </div>
      )}

      {/* By-method + daily chart row */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">By payment method</h3>
            </div>
            {stats.byMethod.length === 0 && <p className="text-xs text-gray-400">No data yet</p>}
            <div className="space-y-2">
              {stats.byMethod.map((m) => {
                const meta = METHOD_META[m.method] || { label: m.method || 'unknown', color: '#6B7280', icon: '?' };
                const pct = stats.totalAmount ? Math.round((m.amount / stats.totalAmount) * 100) : 0;
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>{meta.icon}</span>
                        <span className="font-medium">{meta.label}</span>
                        <span className="text-xs text-gray-400">×{m.count}</span>
                      </div>
                      <span className="font-semibold tabular-nums">{fmtAmount(m.amount)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Daily revenue</h3>
            </div>
            {stats.daily.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs text-gray-400">
                No payments yet — once payments come in, the chart fills up automatically.
              </div>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {stats.daily.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full flex items-end" style={{ height: '100%' }}>
                      <div
                        className="w-full bg-gradient-to-t from-[#635BFF] to-[#9D8EFF] rounded-t hover:opacity-80 transition-opacity"
                        style={{ height: `${(d.amount / dailyMax) * 100}%` }}
                        title={`${d.date}: ${fmtAmount(d.amount)} (${d.count})`}
                      />
                    </div>
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by email, invoice, paymentIntent…"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20 focus:border-[#635BFF]"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="paid">Paid</option>
            <option value="processing">Processing</option>
            <option value="requires_action">Requires action</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
          <select
            value={filters.method}
            onChange={(e) => setFilters({ ...filters, method: e.target.value })}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="">All methods</option>
            {Object.entries(METHOD_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
          >
            <Filter className="w-3.5 h-3.5" />
            Apply
          </button>
        </div>
      </div>

      {/* Payments table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Recent payments <span className="font-normal text-gray-400">({total})</span></h3>
          {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        </div>
        {items.length === 0 && !loading ? (
          <div className="p-12 text-center">
            <Activity className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No payments yet.</p>
            <p className="text-xs text-gray-400 mt-1">Click "Sync from Stripe" to pull existing transactions, or wait for the first invoice payment.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Date</th>
                  <th className="text-left px-5 py-3 font-medium">Customer</th>
                  <th className="text-left px-5 py-3 font-medium">Method</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium">Amount</th>
                  <th className="text-left px-5 py-3 font-medium">Invoice</th>
                  <th className="text-left px-5 py-3 font-medium">PaymentIntent</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id || p.paymentIntentId || p.sessionId}
                    onClick={() => openDetail(p)}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{fmtDate(p.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-[200px]">{p.customerEmail || '—'}</div>
                      {p.customerId && <div className="text-xs text-gray-400 truncate max-w-[200px]">{p.customerId}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <MethodPill method={p.method} wallet={p.wallet} />
                      {p.cardBrand && p.cardLast4 && (
                        <div className="text-xs text-gray-500 mt-0.5">{p.cardBrand} ••{p.cardLast4}</div>
                      )}
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtAmount(p.amount, p.currency)}</td>
                    <td className="px-5 py-3 text-xs text-gray-500 font-mono">{p.invoiceId || '—'}</td>
                    <td className="px-5 py-3 text-xs text-gray-400 font-mono truncate max-w-[160px]">{p.paymentIntentId || p.sessionId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => { setSelected(null); setDetail(null); }} />
          <div className="w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Payment detail</h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{selected.paymentIntentId || selected.sessionId}</p>
              </div>
              <button onClick={() => { setSelected(null); setDetail(null); }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-gradient-to-br from-[#635BFF] to-[#7C6FFF] rounded-2xl p-5 text-white">
                <p className="text-xs uppercase tracking-wider opacity-80">Amount</p>
                <p className="text-4xl font-bold mt-1">{fmtAmount(selected.amount, selected.currency)}</p>
                <div className="flex items-center justify-between mt-4">
                  <StatusBadge status={selected.status} />
                  <MethodPill method={selected.method} wallet={selected.wallet} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Customer email" value={selected.customerEmail} />
                <Field label="Customer ID" value={selected.customerId} mono />
                <Field label="Invoice" value={selected.invoiceId} mono />
                <Field label="Currency" value={(selected.currency || '').toUpperCase()} />
                <Field label="Card" value={selected.cardBrand && selected.cardLast4 ? `${selected.cardBrand} ••${selected.cardLast4}` : '—'} />
                <Field label="Wallet" value={selected.wallet || '—'} />
                <Field label="Created" value={fmtDate(selected.created_at)} />
                <Field label="Updated" value={fmtDate(selected.updated_at)} />
              </div>

              {selected.metadata && Object.keys(selected.metadata || {}).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Metadata</p>
                  <div className="bg-gray-50 rounded-lg p-3 text-xs font-mono space-y-1">
                    {Object.entries(selected.metadata).map(([k, v]) => (
                      <div key={k}><span className="text-gray-500">{k}:</span> <span className="text-gray-900">{String(v)}</span></div>
                    ))}
                  </div>
                </div>
              )}

              {selected.receiptUrl && (
                <a
                  href={selected.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Stripe receipt
                </a>
              )}

              {(selected.status === 'succeeded' || selected.status === 'complete' || selected.status === 'paid') && selected.paymentIntentId && (
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Refund</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={refunding}
                      onClick={() => handleRefund(true)}
                      className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Full refund
                    </button>
                    <button
                      disabled={refunding}
                      onClick={() => handleRefund(false)}
                      className="px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      Half refund
                    </button>
                  </div>
                </div>
              )}

              {detail?.stripe && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Raw Stripe payload</summary>
                  <pre className="mt-2 bg-gray-50 p-3 rounded-lg overflow-auto max-h-80 font-mono text-[10px]">{JSON.stringify(detail.stripe, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, value, mono }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''} truncate`}>{value || '—'}</p>
  </div>
);
