import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { Plus, Check } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { motion } from 'framer-motion';

const DEPOSIT_STATUSES = ['pending', 'confirmed', 'processing', 'completed', 'refunded', 'failed'];

const Deposits = () => {
  const { t } = useLang();
  const [deposits, setDeposits] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ customerId: '', amount: 0, description: '' });

  useEffect(() => { fetchDeposits(); fetchCustomers(); }, [statusFilter]);

  const fetchDeposits = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      const res = await axios.get(`${API_URL}/api/deposits?${params}`);
      setDeposits(res.data.data || []);
    } catch (err) { toast.error(t('error')); } finally { setLoading(false); }
  };

  const fetchCustomers = async () => {
    try { const res = await axios.get(`${API_URL}/api/customers?limit=100`); setCustomers(res.data.data || []); } catch (err) {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/deposits`, formData);
      toast.success(t('depositCreated'));
      setShowModal(false);
      setFormData({ customerId: '', amount: 0, description: '' });
      fetchDeposits();
    } catch (err) { toast.error(t('error')); }
  };

  const handleApprove = async (id) => {
    try {
      await axios.put(`${API_URL}/api/deposits/${id}/approve`);
      toast.success(t('depositApproved'));
      fetchDeposits();
    } catch (err) { toast.error(t('error')); }
  };

  const statusLabels = { pending: t('depositPending'), confirmed: t('depositConfirmed'), processing: t('depositProcessing'), completed: t('depositCompleted'), refunded: t('depositRefunded'), failed: t('depositFailed') };
  const getCustomerName = (id) => { const c = customers.find(c => c.id === id); return c ? `${c.firstName} ${c.lastName}` : '—'; };

  return (
    <motion.div data-testid="deposits-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('depositsTitle')}</h1>
          <p className="text-sm text-[#71717A] mt-1">{t('depositManagement')}</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary" data-testid="create-deposit-btn">
          <Plus size={18} weight="bold" />{t('newDeposit')}
        </button>
      </div>

      <div className="card p-5 mb-5">
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[180px] input" data-testid="deposits-status-filter"><SelectValue placeholder={t('allStatuses')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            {DEPOSIT_STATUSES.map(s => (<SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="card overflow-hidden">
        <table className="table-premium" data-testid="deposits-table">
          <thead><tr><th>{t('customer')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('description')}</th><th>{t('date')}</th><th className="text-right">{t('actions')}</th></tr></thead>
          <tbody>
            {loading ? (<tr><td colSpan={6} className="text-center py-12 text-[#71717A]">{t('loading')}</td></tr>
            ) : deposits.length === 0 ? (<tr><td colSpan={6} className="text-center py-12 text-[#71717A]">{t('noDeposits')}</td></tr>
            ) : deposits.map(d => (
              <tr key={d.id} data-testid={`deposit-row-${d.id}`}>
                <td className="font-medium text-[#18181B]">{getCustomerName(d.customerId)}</td>
                <td className="font-semibold text-[#059669]">${d.amount?.toLocaleString()}</td>
                <td><span className={`badge status-${d.status === 'completed' ? 'won' : d.status === 'pending' ? 'new' : d.status === 'failed' ? 'lost' : 'contacted'}`}>{statusLabels[d.status]}</span></td>
                <td className="text-sm text-[#71717A]">{d.description || '—'}</td>
                <td className="text-sm text-[#71717A]">{d.createdAt ? new Date(d.createdAt).toLocaleDateString('uk-UA') : '—'}</td>
                <td>
                  {d.status === 'pending' && (
                    <button onClick={() => handleApprove(d.id)} className="p-2.5 hover:bg-[#D1FAE5] rounded-lg" data-testid={`approve-deposit-${d.id}`}>
                      <Check size={18} weight="bold" className="text-[#059669]" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-md mx-auto bg-white rounded-2xl border border-[#E4E4E7]" data-testid="deposit-modal">
          <DialogHeader><DialogTitle className="text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('newDeposit')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('customer')}</label>
              <Select value={formData.customerId} onValueChange={(v) => setFormData({...formData, customerId: v})}>
                <SelectTrigger className="input" data-testid="deposit-customer-select"><SelectValue placeholder={t('selectCustomer')} /></SelectTrigger>
                <SelectContent>{customers.map(c => (<SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('amount')} ($)</label>
              <input type="number" value={formData.amount} onChange={(e) => setFormData({...formData, amount: parseInt(e.target.value) || 0})} required className="input w-full" data-testid="deposit-amount-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('description')}</label>
              <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={3} className="input w-full resize-none" data-testid="deposit-description-input" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">{t('cancel')}</button>
              <button type="submit" className="btn-primary flex-1" data-testid="deposit-submit-btn">{t('create')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default Deposits;
