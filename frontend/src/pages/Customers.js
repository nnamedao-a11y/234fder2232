import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { Plus, Pencil, Trash, Eye } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { motion } from 'framer-motion';

const CUSTOMER_TYPES = ['individual', 'company'];

const Customers = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '', company: '', type: 'individual', address: '', city: '', country: ''
  });

  useEffect(() => { fetchCustomers(); }, [search]);

  const fetchCustomers = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      const res = await axios.get(`${API_URL}/api/customers?${params}`);
      setCustomers(res.data.data || []);
    } catch (err) { toast.error(t('error')); } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await axios.put(`${API_URL}/api/customers/${editingCustomer.id}`, formData);
        toast.success(t('customerUpdated'));
      } else {
        await axios.post(`${API_URL}/api/customers`, formData);
        toast.success(t('customerCreated'));
      }
      setShowModal(false);
      resetForm();
      fetchCustomers();
    } catch (err) { toast.error(err.response?.data?.message || t('error')); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('deleteCustomerConfirm'))) return;
    try {
      await axios.delete(`${API_URL}/api/customers/${id}`);
      toast.success(t('customerDeleted'));
      fetchCustomers();
    } catch (err) { toast.error(t('error')); }
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      firstName: customer.firstName, lastName: customer.lastName, email: customer.email,
      phone: customer.phone || '', company: customer.company || '', type: customer.type,
      address: customer.address || '', city: customer.city || '', country: customer.country || ''
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingCustomer(null);
    setFormData({ firstName: '', lastName: '', email: '', phone: '', company: '', type: 'individual', address: '', city: '', country: '' });
  };

  const typeLabels = { individual: t('typeIndividual'), company: t('typeCompany') };

  return (
    <motion.div data-testid="customers-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('customersTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1">{t('customerDatabase')}</p>
        </div>
        <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-primary w-full sm:w-auto" data-testid="create-customer-btn">
          <Plus size={18} weight="bold" />{t('newCustomer')}
        </button>
      </div>

      <div className="card p-4 sm:p-5 mb-4 sm:mb-5">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchCustomers')} className="input w-full sm:max-w-md" data-testid="customers-search-input" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-premium min-w-[700px] w-full" data-testid="customers-table">
          <thead>
            <tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('phone')}</th><th>{t('type')}</th><th>{t('company')}</th><th>{t('dealsCount')}</th><th className="text-right">{t('actions')}</th></tr>
          </thead>
          <tbody>
            {loading ? (<tr><td colSpan={7} className="text-center py-12 text-[#71717A]">{t('loading')}</td></tr>
            ) : customers.length === 0 ? (<tr><td colSpan={7} className="text-center py-12 text-[#71717A]">{t('noCustomers')}</td></tr>
            ) : customers.map(customer => (
              <tr key={customer.id} data-testid={`customer-row-${customer.id}`}>
                <td className="font-medium text-[#18181B]">
                  <button 
                    onClick={() => navigate(`/admin/customers/${customer.id}/360`)}
                    className="hover:text-[#4F46E5] transition-colors"
                  >
                    {customer.firstName} {customer.lastName}
                  </button>
                </td>
                <td>{customer.email}</td>
                <td>{customer.phone || '—'}</td>
                <td><span className="text-xs text-[#71717A]">{typeLabels[customer.type]}</span></td>
                <td>{customer.company || '—'}</td>
                <td>
                  <span className="font-semibold text-[#18181B]">{customer.totalDeals || 0}</span>
                  <span className="text-xs text-[#71717A] ml-1">(${(customer.totalRevenue || customer.totalValue || 0).toLocaleString()})</span>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => navigate(`/admin/customers/${customer.id}/360`)} className="p-2.5 hover:bg-[#E0E7FF] rounded-lg" data-testid={`view-customer-${customer.id}`}><Eye size={16} className="text-[#4F46E5]" /></button>
                    <button onClick={() => openEditModal(customer)} className="p-2.5 hover:bg-[#F4F4F5] rounded-lg" data-testid={`edit-customer-${customer.id}`}><Pencil size={16} className="text-[#71717A]" /></button>
                    <button onClick={() => handleDelete(customer.id)} className="p-2.5 hover:bg-[#FEE2E2] rounded-lg" data-testid={`delete-customer-${customer.id}`}><Trash size={16} className="text-[#DC2626]" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md bg-white rounded-2xl border border-[#E4E4E7] max-h-[90vh] overflow-y-auto" data-testid="customer-modal">
          <DialogHeader><DialogTitle className="text-lg sm:text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{editingCustomer ? t('editCustomer') : t('newCustomer')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('firstName')}</label>
                <input type="text" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} required className="input w-full" data-testid="customer-firstname-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('lastName')}</label>
                <input type="text" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} required className="input w-full" data-testid="customer-lastname-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('email')}</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} required className="input w-full" data-testid="customer-email-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('phone')}</label>
                <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="input w-full" data-testid="customer-phone-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('type')}</label>
                <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                  <SelectTrigger className="input" data-testid="customer-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{CUSTOMER_TYPES.map(ct => (<SelectItem key={ct} value={ct}>{typeLabels[ct]}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('company')}</label>
              <input type="text" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} className="input w-full" data-testid="customer-company-input" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1" data-testid="customer-cancel-btn">{t('cancel')}</button>
              <button type="submit" className="btn-primary flex-1" data-testid="customer-submit-btn">{editingCustomer ? t('save') : t('create')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default Customers;
