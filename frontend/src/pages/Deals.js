import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { 
  Plus, Pencil, Trash, CaretRight, CurrencyCircleDollar, TrendUp, TrendDown,
  Coins, CheckCircle, XCircle, Package, Truck, CreditCard, ChatCircle
} from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { motion } from 'framer-motion';

const DEAL_STATUSES = ['new','negotiation','waiting_deposit','deposit_paid','purchased','in_delivery','completed','cancelled'];

const statusColors = {
  new: 'bg-[#E0E7FF] text-[#4F46E5]', negotiation: 'bg-[#FEF3C7] text-[#D97706]',
  waiting_deposit: 'bg-[#FEE2E2] text-[#DC2626]', deposit_paid: 'bg-[#D1FAE5] text-[#059669]',
  purchased: 'bg-[#DBEAFE] text-[#2563EB]', in_delivery: 'bg-[#E0E7FF] text-[#7C3AED]',
  completed: 'bg-[#D1FAE5] text-[#059669]', cancelled: 'bg-[#F4F4F5] text-[#71717A]'
};

const Deals = () => {
  const { t } = useLang();
  const [deals, setDeals] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [formData, setFormData] = useState({
    title: '', customerId: '', clientPrice: 0, internalCost: 0, purchasePrice: 0,
    description: '', vehiclePlaceholder: '', vin: ''
  });

  const statusLabels = {
    new: t('dealNew'), negotiation: t('dealNegotiation'), waiting_deposit: t('dealWaitingDeposit'),
    deposit_paid: t('dealDepositPaid'), purchased: t('dealPurchased'), in_delivery: t('dealInDelivery'),
    completed: t('dealCompleted'), cancelled: t('dealCancelled')
  };

  useEffect(() => { fetchDeals(); fetchCustomers(); fetchStats(); }, [search, statusFilter]);

  const fetchDeals = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      const res = await axios.get(`${API_URL}/api/deals?${params}`);
      setDeals(res.data.data || []);
    } catch (err) { toast.error(t('error')); } finally { setLoading(false); }
  };

  const fetchCustomers = async () => {
    try { const res = await axios.get(`${API_URL}/api/customers?limit=100`); setCustomers(res.data.data || []); } catch (err) {}
  };

  const fetchStats = async () => {
    try { const res = await axios.get(`${API_URL}/api/deals/stats`); setStats(res.data); } catch (err) {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, value: formData.clientPrice, estimatedMargin: formData.internalCost - formData.clientPrice };
      if (editingDeal) {
        await axios.put(`${API_URL}/api/deals/${editingDeal.id}`, payload);
        toast.success(t('dealUpdated'));
      } else {
        await axios.post(`${API_URL}/api/deals`, payload);
        toast.success(t('dealCreated'));
      }
      setShowModal(false); resetForm(); fetchDeals(); fetchStats();
    } catch (err) { toast.error(err.response?.data?.message || t('error')); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('deleteDealConfirm'))) return;
    try { await axios.delete(`${API_URL}/api/deals/${id}`); toast.success(t('dealDeleted')); fetchDeals(); fetchStats(); }
    catch (err) { toast.error(t('error')); }
  };

  const handleStatusChange = async (id, newStatus) => {
    try { await axios.patch(`${API_URL}/api/deals/${id}/status`, { status: newStatus }); toast.success(t('statusUpdated')); fetchDeals(); fetchStats(); }
    catch (err) { toast.error(err.response?.data?.message || t('cannotChangeStatus')); }
  };

  const handleFinanceUpdate = async (id, field, value) => {
    try {
      await axios.patch(`${API_URL}/api/deals/${id}/finance`, { [field]: value });
      toast.success(t('financeUpdated'));
      fetchDeals();
      if (selectedDeal) { const res = await axios.get(`${API_URL}/api/deals/${id}`); setSelectedDeal(res.data); }
    } catch (err) { toast.error(t('error')); }
  };

  const openEditModal = (deal) => {
    setEditingDeal(deal);
    setFormData({ title: deal.title, customerId: deal.customerId || '', clientPrice: deal.clientPrice || 0,
      internalCost: deal.internalCost || 0, purchasePrice: deal.purchasePrice || 0, description: deal.description || '',
      vehiclePlaceholder: deal.vehiclePlaceholder || '', vin: deal.vin || '' });
    setShowModal(true);
  };

  const openDetailModal = (deal) => { setSelectedDeal(deal); setShowDetailModal(true); };
  const resetForm = () => { setEditingDeal(null); setFormData({ title: '', customerId: '', clientPrice: 0, internalCost: 0, purchasePrice: 0, description: '', vehiclePlaceholder: '', vin: '' }); };
  const getCustomerName = (id) => { const c = customers.find(c => c.id === id); return c ? `${c.firstName} ${c.lastName}` : '—'; };

  return (
    <motion.div data-testid="deals-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('dealsTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1">{t('salesPipeline')}</p>
        </div>
        <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-primary w-full sm:w-auto" data-testid="create-deal-btn">
          <Plus size={18} weight="bold" />{t('newDeal')}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-5 sm:mb-6">
          <StatCard icon={Package} label={t('totalDeals')} value={stats.total} color="#4F46E5" />
          <StatCard icon={CheckCircle} label={t('completedDeals')} value={stats.completedDeals || 0} color="#059669" />
          <StatCard icon={XCircle} label={t('cancelledDeals')} value={stats.cancelledDeals || 0} color="#DC2626" />
          <StatCard icon={CurrencyCircleDollar} label={t('totalValue')} value={`$${(stats.totalValue || 0).toLocaleString()}`} color="#7C3AED" />
          <StatCard icon={Coins} label={t('estMargin')} value={`$${Math.abs(stats.totalEstimatedMargin || 0).toLocaleString()}`} color="#D97706" />
          <StatCard icon={TrendUp} label={t('realProfit')} value={`$${(stats.totalRealProfit || 0).toLocaleString()}`} color="#059669" />
        </div>
      )}

      <div className="card p-4 sm:p-5 mb-4 sm:mb-5">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchDeals')} className="input w-full sm:flex-1 sm:min-w-[200px]" data-testid="deals-search-input" />
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-[180px] input" data-testid="deals-status-filter"><SelectValue placeholder={t('allStatuses')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              {DEAL_STATUSES.map(s => (<SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-premium min-w-[900px] w-full" data-testid="deals-table">
          <thead>
            <tr>
              <th>{t('dealsTitle')}</th><th>VIN / {t('vehicle')}</th><th>{t('customer')}</th><th>{t('status')}</th>
              <th>{t('clientPrice')}</th><th>{t('estMargin')}</th><th>{t('realProfit')}</th><th className="text-right">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-[#71717A]">{t('loading')}</td></tr>
            ) : deals.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-[#71717A]">{t('noDeals')}</td></tr>
            ) : deals.map(deal => (
              <tr key={deal.id} data-testid={`deal-row-${deal.id}`} className="cursor-pointer hover:bg-[#F9FAFB]" onClick={() => openDetailModal(deal)}>
                <td className="font-medium text-[#18181B]">
                  <div>{deal.title}</div>
                  {deal.sourceScenario && <span className="text-xs text-[#71717A] capitalize">{deal.sourceScenario}</span>}
                </td>
                <td>
                  <div className="text-sm font-mono text-[#71717A]">{deal.vin || '—'}</div>
                  <div className="text-xs text-[#A1A1AA]">{deal.vehicleTitle || deal.vehiclePlaceholder}</div>
                </td>
                <td>{getCustomerName(deal.customerId)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Select value={deal.status} onValueChange={(v) => handleStatusChange(deal.id, v)}>
                    <SelectTrigger className="w-[150px] h-8 bg-transparent border-0 p-0" data-testid={`deal-status-${deal.id}`}>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[deal.status]}`}>{statusLabels[deal.status]}</span>
                    </SelectTrigger>
                    <SelectContent>{DEAL_STATUSES.map(s => (<SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>))}</SelectContent>
                  </Select>
                </td>
                <td className="font-semibold text-[#18181B]">${(deal.clientPrice || deal.value || 0).toLocaleString()}</td>
                <td className={`font-medium ${(deal.estimatedMargin || 0) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>${Math.abs(deal.estimatedMargin || 0).toLocaleString()}</td>
                <td className={`font-semibold ${(deal.realProfit || 0) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>{deal.status === 'completed' ? `$${(deal.realProfit || 0).toLocaleString()}` : '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEditModal(deal)} className="p-2.5 hover:bg-[#F4F4F5] rounded-lg" data-testid={`edit-deal-${deal.id}`}><Pencil size={16} className="text-[#71717A]" /></button>
                    <button onClick={() => handleDelete(deal.id)} className="p-2.5 hover:bg-[#FEE2E2] rounded-lg" data-testid={`delete-deal-${deal.id}`}><Trash size={16} className="text-[#DC2626]" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg bg-white rounded-2xl border border-[#E4E4E7] max-h-[90vh] overflow-y-auto" data-testid="deal-modal">
          <DialogHeader><DialogTitle className="text-lg sm:text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{editingDeal ? t('editDeal') : t('newDeal')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('dealTitle')}</label>
              <input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} required className="input w-full" data-testid="deal-title-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">VIN</label>
                <input type="text" value={formData.vin} onChange={(e) => setFormData({...formData, vin: e.target.value.toUpperCase()})} className="input w-full font-mono" data-testid="deal-vin-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('customer')}</label>
                <Select value={formData.customerId || "none"} onValueChange={(v) => setFormData({...formData, customerId: v === "none" ? "" : v})}>
                  <SelectTrigger className="input" data-testid="deal-customer-select"><SelectValue placeholder={t('selectCustomer')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('notSelected')}</SelectItem>
                    {customers.map(c => (<SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('clientPrice')} ($)</label>
                <input type="number" value={formData.clientPrice} onChange={(e) => setFormData({...formData, clientPrice: parseInt(e.target.value) || 0})} className="input w-full" data-testid="deal-client-price-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('internalCost')} ($)</label>
                <input type="number" value={formData.internalCost} onChange={(e) => setFormData({...formData, internalCost: parseInt(e.target.value) || 0})} className="input w-full" data-testid="deal-internal-cost-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('purchasePrice')} ($)</label>
                <input type="number" value={formData.purchasePrice} onChange={(e) => setFormData({...formData, purchasePrice: parseInt(e.target.value) || 0})} className="input w-full" data-testid="deal-purchase-price-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('vehicleDesc')}</label>
              <input type="text" value={formData.vehiclePlaceholder} onChange={(e) => setFormData({...formData, vehiclePlaceholder: e.target.value})} placeholder="BMW X5 2022" className="input w-full" data-testid="deal-vehicle-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('description')}</label>
              <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} className="input w-full resize-none" data-testid="deal-description-input" />
            </div>
            <div className="bg-[#F4F4F5] rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('estimatedMargin')}</div>
              <div className={`text-2xl font-bold ${(formData.internalCost - formData.clientPrice) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                ${Math.abs(formData.internalCost - formData.clientPrice).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1" data-testid="deal-cancel-btn">{t('cancel')}</button>
              <button type="submit" className="btn-primary flex-1" data-testid="deal-submit-btn">{editingDeal ? t('save') : t('create')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deal Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl bg-white rounded-2xl border border-[#E4E4E7]" data-testid="deal-detail-modal">
          {selectedDeal && (
            <>
              <DialogHeader><DialogTitle className="text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{selectedDeal.title}</DialogTitle></DialogHeader>
              <div className="space-y-6 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[selectedDeal.status]}`}>{statusLabels[selectedDeal.status]}</span>
                    {selectedDeal.sourceScenario && <span className="ml-2 px-2 py-1 bg-[#F4F4F5] rounded text-xs capitalize">{selectedDeal.sourceScenario}</span>}
                  </div>
                  {selectedDeal.vin && <span className="font-mono text-sm text-[#71717A]">{selectedDeal.vin}</span>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <FinanceCard label={t('clientPrice')} value={selectedDeal.clientPrice || 0} editable onSave={(v) => handleFinanceUpdate(selectedDeal.id, 'clientPrice', v)} t={t} />
                  <FinanceCard label={t('internalCost')} value={selectedDeal.internalCost || 0} editable onSave={(v) => handleFinanceUpdate(selectedDeal.id, 'internalCost', v)} t={t} />
                  <FinanceCard label={t('purchasePrice')} value={selectedDeal.purchasePrice || 0} editable onSave={(v) => handleFinanceUpdate(selectedDeal.id, 'purchasePrice', v)} t={t} />
                  <FinanceCard label={t('realCost')} value={selectedDeal.realCost || 0} editable onSave={(v) => handleFinanceUpdate(selectedDeal.id, 'realCost', v)} t={t} />
                  <FinanceCard label={t('realRevenue')} value={selectedDeal.realRevenue || 0} editable onSave={(v) => handleFinanceUpdate(selectedDeal.id, 'realRevenue', v)} t={t} />
                </div>
                <div className="grid grid-cols-3 gap-4 bg-[#F9FAFB] rounded-xl p-4">
                  <div>
                    <div className="text-xs text-[#71717A] uppercase tracking-wider">{t('estMargin')}</div>
                    <div className={`text-xl font-bold ${(selectedDeal.estimatedMargin || 0) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>${Math.abs(selectedDeal.estimatedMargin || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#71717A] uppercase tracking-wider">{t('realProfit')}</div>
                    <div className={`text-xl font-bold ${(selectedDeal.realProfit || 0) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>${(selectedDeal.realProfit || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#71717A] uppercase tracking-wider">{t('overrideLoss')}</div>
                    <div className={`text-xl font-bold ${(selectedDeal.overrideDelta || 0) > 0 ? 'text-[#DC2626]' : 'text-[#71717A]'}`}>${(selectedDeal.overrideDelta || 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex gap-2 text-sm">
                  {selectedDeal.leadId && <span className="px-2 py-1 bg-[#E0E7FF] text-[#4F46E5] rounded">Lead: {selectedDeal.leadId}</span>}
                  {selectedDeal.quoteId && <span className="px-2 py-1 bg-[#FEF3C7] text-[#D97706] rounded">Quote: {selectedDeal.quoteId}</span>}
                  {selectedDeal.depositId && <span className="px-2 py-1 bg-[#D1FAE5] text-[#059669] rounded">Deposit: {selectedDeal.depositId}</span>}
                </div>

                {/* ───────── Pipeline v2 advance (P0.2) ───────── */}
                <DealPipelineAdvance
                  deal={selectedDeal}
                  onAdvanced={async () => {
                    const res = await axios.get(`${API_URL}/api/deals/${selectedDeal.id}`);
                    setSelectedDeal(res.data);
                    fetchDeals();
                  }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

const StatCard = ({ icon: Icon, label, value, color }) => (
  <div className="kpi-card">
    <div className="mb-3"><Icon size={24} weight="duotone" style={{ color }} /></div>
    <div className="kpi-value">{value}</div>
    <div className="kpi-label">{label}</div>
  </div>
);

const FinanceCard = ({ label, value, editable, onSave, t }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);
  const handleSave = () => { onSave(localValue); setIsEditing(false); };
  return (
    <div className="border rounded-xl p-3">
      <div className="text-xs text-[#71717A] uppercase tracking-wider mb-2">{label}</div>
      {isEditing ? (
        <div className="flex gap-2">
          <input type="number" value={localValue} onChange={(e) => setLocalValue(parseInt(e.target.value) || 0)} className="input w-full text-lg" autoFocus />
          <button onClick={handleSave} className="btn-primary px-3 py-1 text-sm">{t('save')}</button>
        </div>
      ) : (
        <div className={`text-lg font-semibold ${editable ? 'cursor-pointer hover:text-[#4F46E5]' : ''}`} onClick={() => editable && setIsEditing(true)}>${value.toLocaleString()}</div>
      )}
    </div>
  );
};

export default Deals;

// ───────────────────── Pipeline v2 Advance (P0.2) ─────────────────────
const DealPipelineAdvance = ({ deal, onAdvanced }) => {
  const [catalog, setCatalog] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API_URL}/api/legal/catalog`).then(r => setCatalog(r.data)).catch(() => {});
  }, []);
  if (!catalog) return null;
  const current = deal.stage || deal.status || 'lead';
  const allowed = (catalog.deal_stage_forward || {})[current] || [];
  const groups = catalog.deal_stage_groups || [];
  const currentGroup = groups.find(g => (g.stages || []).includes(current));
  const pretty = (s) => (s || '').replace(/_/g, ' ');

  const doAdvance = async (to) => {
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/deals/${deal.id}/advance`, { to });
      toast.success(`Pipeline → ${pretty(to)}`);
      await onAdvanced();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Переход запрещён');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[#E4E4E7] pt-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
        Pipeline v2 — этап «{currentGroup?.label || '—'}»
      </div>
      {/* 8 macro groups breadcrumb */}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {groups.map((g, idx) => {
            const isCur = g.id === currentGroup?.id;
            const curIdx = groups.findIndex(x => x.id === currentGroup?.id);
            const isPast = curIdx >= 0 && idx < curIdx;
            return (
              <span key={g.id}
                    className={`px-2 py-1 rounded text-[10px] font-semibold ${
                      isCur ? 'bg-[#4F46E5] text-white' :
                      isPast ? 'bg-[#D1FAE5] text-[#059669]' :
                      'bg-[#F4F4F5] text-[#71717A]'
                    }`}>
                {idx + 1}. {g.label}
              </span>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-[#71717A]">Текущая стадия:</span>
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#4F46E5] text-white" data-testid="pipeline-current-stage">
          {pretty(current)}
        </span>
      </div>
      {allowed.length === 0 ? (
        <p className="text-xs text-[#71717A]">Финальная стадия — переходов нет.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowed.map(t => (
            <button
              key={t}
              disabled={busy}
              onClick={() => doAdvance(t)}
              data-testid={`pipeline-advance-${t}`}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                t === 'cancelled'
                  ? 'bg-[#FEE2E2] hover:bg-[#FCA5A5] text-[#DC2626]'
                  : 'bg-[#E0E7FF] hover:bg-[#4F46E5] hover:text-white text-[#4F46E5]'
              }`}
            >
              → {pretty(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
