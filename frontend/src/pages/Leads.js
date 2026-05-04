import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { Plus, Pencil, Trash, Receipt, Eye } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { motion } from 'framer-motion';
import QuoteHistory from '../components/crm/QuoteHistory';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'archived'];
const LEAD_SOURCES = ['website', 'referral', 'social_media', 'cold_call', 'advertisement', 'partner', 'other'];

const Leads = () => {
  const { t, lang } = useLang();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showQuoteHistory, setShowQuoteHistory] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '', company: '', source: 'website', description: '', value: 0
  });

  // Status labels with translations
  const statusLabels = {
    new: t('statusNew'),
    contacted: t('statusContacted'),
    qualified: t('statusQualified'),
    proposal: t('statusProposal'),
    negotiation: t('statusNegotiation'),
    won: t('statusWon'),
    lost: t('statusLost'),
    archived: t('statusArchived'),
  };

  // Source labels with translations
  const sourceLabels = {
    website: t('sourceWebsite'),
    referral: t('sourceReferral'),
    social_media: t('sourceSocialMedia'),
    cold_call: t('sourceColdCall'),
    advertisement: t('sourceAdvertisement'),
    partner: t('sourcePartner'),
    other: t('sourceOther'),
  };

  useEffect(() => {
    fetchLeads();
  }, [search, statusFilter, sourceFilter]);

  const fetchLeads = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      if (sourceFilter) params.append('source', sourceFilter);
      
      const res = await axios.get(`${API_URL}/api/leads?${params}`);
      setLeads(res.data.data || []);
    } catch (err) {
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingLead) {
        await axios.put(`${API_URL}/api/leads/${editingLead.id}`, formData);
        toast.success(t('success'));
      } else {
        await axios.post(`${API_URL}/api/leads`, formData);
        toast.success(t('success'));
      }
      setShowModal(false);
      resetForm();
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.message || t('error'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(lang === 'uk' ? 'Видалити цей лід?' : 'Delete this lead?')) return;
    try {
      await axios.delete(`${API_URL}/api/leads/${id}`);
      toast.success(t('success'));
      fetchLeads();
    } catch (err) {
      toast.error(t('error'));
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await axios.put(`${API_URL}/api/leads/${id}`, { status: newStatus });
      toast.success(t('success'));
      fetchLeads();
    } catch (err) {
      toast.error(err.response?.data?.message || t('error'));
    }
  };

  const openEditModal = (lead) => {
    setEditingLead(lead);
    setFormData({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone || '',
      company: lead.company || '',
      source: lead.source,
      description: lead.description || '',
      value: lead.value || 0
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingLead(null);
    setFormData({ firstName: '', lastName: '', email: '', phone: '', company: '', source: 'website', description: '', value: 0 });
  };

  return (
    <motion.div 
      data-testid="leads-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            {t('leadsTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-[#71717A] mt-1">{t('leadManagement')}</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="btn-primary w-full sm:w-auto"
          data-testid="create-lead-btn"
        >
          <Plus size={18} weight="bold" />
          {t('newLead')}
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 sm:p-5 mb-4 sm:mb-5">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 min-w-0 sm:min-w-[200px] sm:max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchByNameEmailPhone')}
              className="input w-full"
              data-testid="leads-search-input"
            />
          </div>
          <div className="flex gap-3">
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[160px] h-[46px] bg-white border border-[#E4E4E7] rounded-xl" data-testid="leads-status-filter">
                <SelectValue placeholder={t('allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {LEAD_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter || "all"} onValueChange={(v) => setSourceFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[160px] h-[46px] bg-white border border-[#E4E4E7] rounded-xl" data-testid="leads-source-filter">
                <SelectValue placeholder={t('allSources')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allSources')}</SelectItem>
                {LEAD_SOURCES.map(s => (
                  <SelectItem key={s} value={s}>{sourceLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Table - with horizontal scroll on mobile */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto -mx-0 sm:mx-0">
          <table className="table-premium min-w-[800px] w-full" data-testid="leads-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('vin')}</th>
              <th>{t('email')}</th>
              <th>{t('source')}</th>
              <th>{t('status')}</th>
              <th>{t('clientPrice')}</th>
              <th>{t('internalPrice')}</th>
              <th className="text-right">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-[#71717A]">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin"></div>
                  {t('loading')}
                </div>
              </td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-[#71717A]">{t('noLeads')}</td></tr>
            ) : leads.map(lead => (
              <tr key={lead.id} data-testid={`lead-row-${lead.id}`}>
                <td className="font-medium text-[#18181B]">{lead.firstName} {lead.lastName}</td>
                <td className="font-mono text-xs text-[#71717A]">{lead.vin || '—'}</td>
                <td>{lead.email || '—'}</td>
                <td><span className="text-xs text-[#71717A]">{sourceLabels[lead.source]}</span></td>
                <td>
                  <Select value={lead.status} onValueChange={(v) => handleStatusChange(lead.id, v)}>
                    <SelectTrigger className="w-[130px] h-8 bg-transparent border-0 p-0" data-testid={`lead-status-${lead.id}`}>
                      <span className={`badge status-${lead.status}`}>{statusLabels[lead.status]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map(s => (
                        <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="text-[#059669] font-medium">${lead.price?.toLocaleString() || 0}</td>
                <td className="text-[#7C3AED] font-semibold">
                  ${lead.metadata?.internalTotal?.toLocaleString() || lead.price?.toLocaleString() || 0}
                  {lead.metadata?.hiddenFee > 0 && (
                    <span className="text-xs text-[#71717A] ml-1">(+${lead.metadata?.hiddenFee})</span>
                  )}
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <button 
                      onClick={() => { setSelectedLead(lead); setShowQuoteHistory(true); }}
                      className="p-2.5 hover:bg-[#DBEAFE] rounded-lg transition-colors" 
                      data-testid={`quotes-lead-${lead.id}`}
                      title="Історія розрахунків"
                    >
                      <Receipt size={16} className="text-[#2563EB]" />
                    </button>
                    <button 
                      onClick={() => openEditModal(lead)} 
                      className="p-2.5 hover:bg-[#F4F4F5] rounded-lg transition-colors" 
                      data-testid={`edit-lead-${lead.id}`}
                    >
                      <Pencil size={16} className="text-[#71717A]" />
                    </button>
                    <button 
                      onClick={() => handleDelete(lead.id)} 
                      className="p-2.5 hover:bg-[#FEE2E2] rounded-lg transition-colors" 
                      data-testid={`delete-lead-${lead.id}`}
                    >
                      <Trash size={16} className="text-[#DC2626]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md bg-white rounded-2xl border border-[#E4E4E7] max-h-[90vh] overflow-y-auto" data-testid="lead-modal">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
              {editingLead ? t('editLead') : t('newLead')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('firstName')}</label>
                <input type="text" value={formData.firstName} onChange={(e) => setFormData({...formData, firstName: e.target.value})} required className="input w-full" data-testid="lead-firstname-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('lastName')}</label>
                <input type="text" value={formData.lastName} onChange={(e) => setFormData({...formData, lastName: e.target.value})} required className="input w-full" data-testid="lead-lastname-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('email')}</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} required className="input w-full" data-testid="lead-email-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('phone')}</label>
                <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="input w-full" data-testid="lead-phone-input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('company')}</label>
                <input type="text" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} className="input w-full" data-testid="lead-company-input" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('source')}</label>
                <Select value={formData.source} onValueChange={(v) => setFormData({...formData, source: v})}>
                  <SelectTrigger className="input w-full" data-testid="lead-source-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCES.map(s => (
                      <SelectItem key={s} value={s}>{sourceLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('value')} ($)</label>
                <input type="number" value={formData.value} onChange={(e) => setFormData({...formData, value: parseInt(e.target.value) || 0})} className="input w-full" data-testid="lead-value-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('description')}</label>
              <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={3} className="input w-full resize-none" data-testid="lead-description-input" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1" data-testid="lead-cancel-btn">{t('cancel')}</button>
              <button type="submit" className="btn-primary flex-1" data-testid="lead-submit-btn">{editingLead ? t('save') : t('create')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quote History Modal */}
      <Dialog open={showQuoteHistory} onOpenChange={setShowQuoteHistory}>
        <DialogContent className="max-w-3xl bg-white rounded-2xl border border-[#E4E4E7]" data-testid="quote-history-modal">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
              {t('quoteHistory')}: {selectedLead?.firstName} {selectedLead?.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {selectedLead && (
              <QuoteHistory 
                leadId={selectedLead.id} 
                vin={selectedLead.vin}
                onScenarioChange={() => fetchLeads()}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default Leads;
