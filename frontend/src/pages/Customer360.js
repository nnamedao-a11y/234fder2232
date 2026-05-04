/**
 * Customer 360 Page
 * 
 * Повна картка клієнта:
 * - Контактна інформація
 * - Агреговані метрики (leads, quotes, deals)
 * - Timeline всіх подій
 * - LTV tracking
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../App';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useLang } from '../i18n';
import {
  ArrowLeft,
  User,
  Phone,
  Envelope,
  Buildings,
  MapPin,
  CurrencyCircleDollar,
  TrendUp,
  Receipt,
  Handshake,
  Coins,
  ClockCounterClockwise,
  CaretRight,
  CheckCircle,
  XCircle,
  ArrowSquareOut,
  Wallet
} from '@phosphor-icons/react';

const Customer360 = () => {
  const { t } = useLang();
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [fullRes, timelineRes] = await Promise.all([
        axios.get(`${API_URL}/api/customers/${id}/360`),
        axios.get(`${API_URL}/api/customers/${id}/timeline`),
      ]);
      setData(fullRes.data);
      setTimeline(timelineRes.data || []);
    } catch (err) {
      toast.error('Помилка завантаження даних клієнта');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshStats = async () => {
    try {
      await axios.patch(`${API_URL}/api/customers/${id}/refresh-stats`);
      toast.success('Статистику оновлено');
      fetchData();
    } catch (err) {
      toast.error('Помилка оновлення статистики');
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="customer-360-loading">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const { customer, leads, quotes, deals, deposits = [], summary } = data;

  const statusColors = {
    active: 'bg-[#D1FAE5] text-[#059669]',
    inactive: 'bg-[#F4F4F5] text-[#71717A]',
    vip: 'bg-[#FEF3C7] text-[#D97706]',
    blacklisted: 'bg-[#FEE2E2] text-[#DC2626]',
  };

  const dealStatusColors = {
    new: 'bg-[#E0E7FF] text-[#4F46E5]',
    negotiation: 'bg-[#FEF3C7] text-[#D97706]',
    waiting_deposit: 'bg-[#FEE2E2] text-[#DC2626]',
    deposit_paid: 'bg-[#D1FAE5] text-[#059669]',
    purchased: 'bg-[#DBEAFE] text-[#2563EB]',
    in_delivery: 'bg-[#E0E7FF] text-[#7C3AED]',
    completed: 'bg-[#D1FAE5] text-[#059669]',
    cancelled: 'bg-[#F4F4F5] text-[#71717A]',
  };

  return (
    <motion.div
      data-testid="customer-360-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/admin/customers')}
          className="p-2 hover:bg-[#F4F4F5] rounded-lg transition-colors"
          data-testid="back-btn"
        >
          <ArrowLeft size={20} className="text-[#71717A]" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-sm text-[#71717A] mt-1">Customer 360 View</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[customer.status] || statusColors.active}`}>
          {customer.status || 'active'}
        </span>
        <button
          onClick={handleRefreshStats}
          className="btn-secondary"
          data-testid="refresh-stats-btn"
        >
          Оновити статистику
        </button>
      </div>

      {/* Contact Info + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Card */}
        <div className="section-card lg:col-span-1">
          <div className="section-title-clean">
            <User size={22} weight="duotone" className="text-[#4F46E5]" />
            <span>Контактна інформація</span>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 bg-gradient-to-br from-[#18181B] to-[#3F3F46] rounded-2xl flex items-center justify-center text-xl font-bold text-white">
                {customer.firstName?.[0]}{customer.lastName?.[0]}
              </div>
              <div>
                <p className="font-semibold text-[#18181B]">{customer.firstName} {customer.lastName}</p>
                <p className="text-sm text-[#71717A]">{customer.company || 'Individual'}</p>
              </div>
            </div>
            
            <div className="space-y-3 pt-3 border-t border-[#E4E4E7]">
              <ContactItem icon={Envelope} label="Email" value={customer.email} />
              <ContactItem icon={Phone} label="Телефон" value={customer.phone || '—'} />
              <ContactItem icon={Buildings} label="Компанія" value={customer.company || '—'} />
              <ContactItem icon={MapPin} label="Місто" value={customer.city || '—'} />
            </div>
            
            {customer.source && (
              <div className="pt-3 border-t border-[#E4E4E7]">
                <p className="text-xs text-[#71717A] uppercase tracking-wider">Джерело</p>
                <p className="font-medium text-[#18181B] mt-1">{customer.source}</p>
              </div>
            )}
          </div>
        </div>

        {/* KPIs Grid */}
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard icon={Receipt} label="Leads" value={summary.totalLeads} color="#4F46E5" />
          <KpiCard icon={Receipt} label="Quotes" value={summary.totalQuotes} color="#7C3AED" />
          <KpiCard icon={Handshake} label="Deals" value={summary.totalDeals} color="#D97706" />
          <KpiCard icon={CheckCircle} label="Completed" value={summary.completedDeals} color="#059669" />
          <KpiCard icon={Wallet} label="Deposits" value={summary.depositsCount || deposits.length} color="#2563EB" />
          <KpiCard icon={CurrencyCircleDollar} label="Revenue" value={`$${summary.totalRevenue.toLocaleString()}`} color="#059669" />
          <KpiCard icon={Coins} label="Profit" value={`$${summary.totalProfit.toLocaleString()}`} color="#059669" highlight />
          <KpiCard icon={Wallet} label="Deposits Sum" value={`$${(summary.totalDepositsAmount || 0).toLocaleString()}`} color="#2563EB" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#E4E4E7]">
        {['overview', 'legal', 'leads', 'quotes', 'deals', 'deposits', 'timeline'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-[#4F46E5] border-b-2 border-[#4F46E5]'
                : 'text-[#71717A] hover:text-[#18181B]'
            }`}
            data-testid={`tab-${tab}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'deposits' && deposits.length > 0 && (
              <span className="ml-1 text-xs bg-[#E0E7FF] text-[#4F46E5] px-1.5 py-0.5 rounded-full">{deposits.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Leads */}
            <EntitySection
              title="Recent Leads"
              items={leads.slice(0, 5)}
              emptyMessage="Немає лідів"
              renderItem={(item) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[#18181B]">{item.firstName} {item.lastName}</p>
                    <p className="text-sm text-[#71717A]">VIN: {item.vin || '—'}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${dealStatusColors[item.status] || 'bg-[#F4F4F5] text-[#71717A]'}`}>
                    {item.status}
                  </span>
                </div>
              )}
            />

            {/* Recent Deals */}
            <EntitySection
              title="Recent Deals"
              items={deals.slice(0, 5)}
              emptyMessage="Немає угод"
              renderItem={(item) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[#18181B]">{item.title || item.vin}</p>
                    <p className="text-sm text-[#71717A]">${(item.clientPrice || 0).toLocaleString()}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${dealStatusColors[item.status] || 'bg-[#F4F4F5] text-[#71717A]'}`}>
                    {item.status}
                  </span>
                </div>
              )}
            />

            {/* Recent Deposits */}
            <EntitySection
              title="Recent Deposits"
              items={deposits.slice(0, 5)}
              emptyMessage="Немає депозитів"
              renderItem={(item) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[#18181B]">${(item.amount || 0).toLocaleString()}</p>
                    <p className="text-sm text-[#71717A]">{new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    item.status === 'confirmed' || item.status === 'completed'
                      ? 'bg-[#D1FAE5] text-[#059669]'
                      : 'bg-[#FEF3C7] text-[#D97706]'
                  }`}>
                    {item.status}
                  </span>
                </div>
              )}
            />

            {/* Recent Quotes */}
            <EntitySection
              title="Recent Quotes"
              items={quotes.slice(0, 5)}
              emptyMessage="Немає прорахунків"
              renderItem={(item) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-[#18181B]">{item.quoteNumber || item.vehicleTitle || 'Quote'}</p>
                    <p className="text-sm text-[#71717A]">VIN: {item.vin || '—'}</p>
                  </div>
                  <p className="font-semibold text-[#18181B]">${(item.visibleTotal || 0).toLocaleString()}</p>
                </div>
              )}
            />
          </div>
        )}

        {activeTab === 'legal' && (
          <CustomerLegalSection customerId={id} />
        )}

        {activeTab === 'leads' && (
          <EntitySection
            title={`Leads (${leads.length})`}
            items={leads}
            emptyMessage="Немає лідів"
            renderItem={(item) => (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#18181B]">{item.firstName} {item.lastName}</p>
                  <p className="text-sm text-[#71717A]">VIN: {item.vin || '—'} | {new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${dealStatusColors[item.status] || 'bg-[#F4F4F5] text-[#71717A]'}`}>
                    {item.status}
                  </span>
                  <ArrowSquareOut size={16} className="text-[#71717A]" />
                </div>
              </div>
            )}
          />
        )}

        {activeTab === 'quotes' && (
          <EntitySection
            title={`Quotes (${quotes.length})`}
            items={quotes}
            emptyMessage="Немає прорахунків"
            renderItem={(item) => (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#18181B]">{item.quoteNumber || item.vehicleTitle}</p>
                  <p className="text-sm text-[#71717A]">VIN: {item.vin} | {item.selectedScenario}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-[#18181B]">${(item.visibleTotal || 0).toLocaleString()}</p>
                  <p className="text-xs text-[#059669]">Margin: ${(item.hiddenFee || 0).toLocaleString()}</p>
                </div>
              </div>
            )}
          />
        )}

        {activeTab === 'deals' && (
          <EntitySection
            title={`Deals (${deals.length})`}
            items={deals}
            emptyMessage="Немає угод"
            renderItem={(item) => (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#18181B]">{item.title}</p>
                  <p className="text-sm text-[#71717A]">VIN: {item.vin || '—'} | {new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold text-[#18181B]">${(item.clientPrice || 0).toLocaleString()}</p>
                    <p className={`text-xs ${(item.realProfit || item.estimatedMargin || 0) >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                      Profit: ${(item.realProfit || item.estimatedMargin || 0).toLocaleString()}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${dealStatusColors[item.status] || 'bg-[#F4F4F5] text-[#71717A]'}`}>
                    {item.status}
                  </span>
                </div>
              </div>
            )}
          />
        )}

        {activeTab === 'deposits' && (
          <EntitySection
            title={`Deposits (${deposits.length})`}
            items={deposits}
            emptyMessage="Немає депозитів"
            renderItem={(item) => (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#18181B]">Депозит #{item.id?.slice(-8) || '—'}</p>
                  <p className="text-sm text-[#71717A]">
                    {item.paymentMethod || 'Не вказано'} | {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                  {item.description && (
                    <p className="text-xs text-[#A1A1AA] mt-1">{item.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold text-[#18181B]">${(item.amount || 0).toLocaleString()}</p>
                    {item.confirmedAt && (
                      <p className="text-xs text-[#059669]">
                        Підтверджено: {new Date(item.confirmedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    item.status === 'confirmed' || item.status === 'completed' 
                      ? 'bg-[#D1FAE5] text-[#059669]' 
                      : item.status === 'pending' 
                        ? 'bg-[#FEF3C7] text-[#D97706]'
                        : 'bg-[#F4F4F5] text-[#71717A]'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            )}
          />
        )}

        {activeTab === 'timeline' && (
          <div className="section-card">
            <div className="section-title-clean">
              <ClockCounterClockwise size={22} weight="duotone" className="text-[#7C3AED]" />
              <span>Timeline</span>
            </div>
            
            <div className="space-y-4">
              {timeline.length === 0 ? (
                <p className="text-[#71717A] text-center py-8">Немає подій</p>
              ) : (
                timeline.map((event, idx) => (
                  <div key={event._id || idx} className="flex gap-4 items-start">
                    <div className="w-3 h-3 rounded-full bg-[#4F46E5] mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1 border-b border-[#E4E4E7] pb-4">
                      <p className="font-medium text-[#18181B]">{event.title || event.type}</p>
                      <p className="text-sm text-[#71717A]">{event.description || '—'}</p>
                      <p className="text-xs text-[#A1A1AA] mt-1">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// Helper Components
const ContactItem = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3">
    <Icon size={18} className="text-[#71717A]" />
    <div>
      <p className="text-xs text-[#71717A]">{label}</p>
      <p className="text-sm text-[#18181B]">{value}</p>
    </div>
  </div>
);

const KpiCard = ({ icon: Icon, label, value, color, highlight }) => (
  <div className={`kpi-card ${highlight ? 'border-[#059669] bg-[#F0FDF4]' : ''}`}>
    <div className="mb-3">
      <Icon size={24} weight="duotone" style={{ color }} />
    </div>
    <div className={`kpi-value ${highlight ? 'text-[#059669]' : ''}`}>{value}</div>
    <div className="kpi-label">{label}</div>
  </div>
);

const EntitySection = ({ title, items, emptyMessage, renderItem }) => (
  <div className="section-card">
    <div className="section-title-clean">
      <span>{title}</span>
    </div>
    
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-[#71717A] text-center py-8">{emptyMessage}</p>
      ) : (
        items.map((item, idx) => (
          <div 
            key={item._id || item.id || idx} 
            className="p-4 rounded-xl border border-[#E4E4E7] hover:border-[#4F46E5]/30 transition-colors cursor-pointer"
          >
            {renderItem(item)}
          </div>
        ))
      )}
    </div>
  </div>
);

export default Customer360;

// ───────────────── P0.1 Customer Legal Section ─────────────────
const CustomerLegalSection = ({ customerId }) => {
  const [legal, setLegal] = useState({
    first_name: '', last_name: '', egn: '', national_id_no: '',
    id_card_address: '', id_card_issued_by: '', id_card_issue_date: '',
  });
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        axios.get(`${API_URL}/api/customers/${customerId}/legal`),
        axios.get(`${API_URL}/api/customers/${customerId}/legal/validate`),
      ]);
      if (r1.data?.legal) setLegal(prev => ({ ...prev, ...r1.data.legal }));
      setValidation(r2.data);
    } catch (e) {
      // ignore — new customer
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  const save = async () => {
    if (!/^\d{10}$/.test(legal.egn || '')) return toast.error('EGN должен быть ровно 10 цифр');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(legal.id_card_issue_date || ''))
      return toast.error('Дата выдачи в формате YYYY-MM-DD');
    setSaving(true);
    try {
      await axios.put(`${API_URL}/api/customers/${customerId}/legal`, legal);
      toast.success('Legal-поля сохранены');
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const F = (key, label, opts = {}) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
        {label}<span className="text-[#DC2626]"> *</span>
      </label>
      <input
        type={opts.type || 'text'}
        value={legal[key] || ''}
        onChange={(e) => setLegal({ ...legal, [key]: e.target.value })}
        maxLength={opts.maxLength}
        placeholder={opts.placeholder}
        className="input w-full"
        data-testid={`c360-legal-${key}`}
      />
    </div>
  );

  if (loading) return <p className="text-sm text-[#71717A]">Загрузка…</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 section-card">
        <div className="section-title-clean">
          <User size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Юридические поля (для депозитного договора)</span>
        </div>
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {F('first_name', 'Имя (лат.)', { placeholder: 'Ivan' })}
            {F('last_name',  'Фамилия (лат.)', { placeholder: 'Ivanov' })}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {F('egn', 'ЕГН (10 цифр)', { maxLength: 10, placeholder: '9901011234' })}
            {F('national_id_no', '№ личной карты', { placeholder: 'BG1234567' })}
          </div>
          {F('id_card_address', 'Адрес по карте', { placeholder: 'гр. София, ул. ...' })}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {F('id_card_issued_by', 'Кем выдана', { placeholder: 'МВР София' })}
            {F('id_card_issue_date', 'Дата выдачи', { type: 'date' })}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={save} disabled={saving} className="btn-primary" data-testid="c360-legal-save">
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button onClick={load} className="btn-secondary">Сбросить</button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title-clean">
          <CheckCircle size={22} weight="duotone" className="text-[#059669]" />
          <span>Готовность</span>
        </div>
        {validation?.ready_for_deposit_contract ? (
          <div className="bg-[#D1FAE5] border border-[#059669]/30 rounded-xl p-4">
            <div className="flex items-center gap-2 text-[#059669] font-semibold">
              <CheckCircle size={22} weight="fill" /> Все поля OK
            </div>
            <p className="text-sm text-[#047857] mt-2">
              Можно создавать депозитный договор (P0.4).
            </p>
          </div>
        ) : (
          <div className="bg-[#FEF3C7] border border-[#D97706]/30 rounded-xl p-4">
            <div className="flex items-center gap-2 text-[#D97706] font-semibold">
              <XCircle size={22} weight="fill" /> Не хватает полей
            </div>
            <ul className="text-sm text-[#92400E] mt-2 list-disc pl-5 space-y-1">
              {(validation?.missing_fields || []).map(f => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
