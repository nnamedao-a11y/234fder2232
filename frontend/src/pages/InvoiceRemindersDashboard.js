/**
 * Invoice Reminders Dashboard
 * 
 * /admin/invoice-reminders
 * 
 * Monitor and manage invoice reminders & escalations
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Clock,
  Warning,
  ShieldWarning,
  Bell,
  ArrowsClockwise,
  Check,
  User,
  Envelope,
  CaretRight,
  ChartLineUp,
  Play
} from '@phosphor-icons/react';

// Escalation Level Badge
const EscalationBadge = ({ level, t }) => {
  const config = {
    0: { bg: 'bg-zinc-100', text: 'text-zinc-600', label: t('pending') },
    1: { bg: 'bg-amber-100', text: 'text-amber-700', label: t('level1Manager') },
    2: { bg: 'bg-orange-100', text: 'text-orange-700', label: t('level2TeamLead') },
    3: { bg: 'bg-red-100', text: 'text-red-700', label: t('level3Owner') },
  };
  const c = config[level] || config[0];
  return (
    <span className={`${c.bg} ${c.text} px-2 py-1 rounded-full text-xs font-medium`}>
      {c.label}
    </span>
  );
};

// Summary Card
const SummaryCard = ({ title, value, icon: Icon, color, subtitle }) => (
  <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
    <div className="flex items-start justify-between">
      <div className={`p-3 rounded-xl bg-${color}-50`}>
        <Icon size={24} weight="duotone" className={`text-${color}-600`} />
      </div>
    </div>
    <div className="mt-4">
      <p className="text-3xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
        {value}
      </p>
      <p className="text-sm text-[#71717A] mt-1">{title}</p>
      {subtitle && <p className="text-xs text-[#A1A1AA] mt-1">{subtitle}</p>}
    </div>
  </div>
);

// Invoice Row
const InvoiceRow = ({ invoice }) => (
  <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:shadow-md transition-all">
    <div className="p-2 rounded-lg bg-red-50">
      <Warning size={20} className="text-red-600" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="font-medium text-[#18181B] truncate">
          #{invoice.id?.slice(0, 8)}
        </p>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          OVERDUE
        </span>
      </div>
      <p className="text-sm text-[#71717A]">{invoice.title || invoice.description}</p>
    </div>
    <div className="text-right">
      <p className="font-bold text-[#18181B]">${(invoice.amount || 0).toLocaleString()}</p>
      <p className="text-xs text-[#71717A]">
        Due: {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('uk-UA') : '—'}
      </p>
    </div>
    <CaretRight size={16} className="text-[#A1A1AA]" />
  </div>
);

const InvoiceRemindersDashboard = () => {
  const { t } = useLang();
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [criticalInvoices, setCriticalInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, criticalRes] = await Promise.all([
        axios.get(`${API_URL}/api/invoice-reminders/escalation-summary`),
        axios.get(`${API_URL}/api/invoice-reminders/critical`),
      ]);
      setSummary(summaryRes.data);
      setCriticalInvoices(criticalRes.data || []);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleForceProcess = async () => {
    try {
      setProcessing(true);
      const res = await axios.post(`${API_URL}/api/invoice-reminders/process`);
      toast.success(`Оброблено ${res.data.processed} інвойсів, надіслано ${res.data.reminders} нагадувань`);
      fetchData();
    } catch (error) {
      toast.error('Помилка обробки');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="space-y-8"
      data-testid="invoice-reminders-dashboard"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Invoice Reminders
          </h1>
          <p className="text-sm text-[#71717A] mt-1">Моніторинг нагадувань та ескалацій</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="p-2 hover:bg-[#F4F4F5] rounded-xl transition-colors"
            data-testid="refresh-btn"
          >
            <ArrowsClockwise size={20} className="text-[#71717A]" />
          </button>
          <button
            onClick={handleForceProcess}
            disabled={processing}
            className="flex items-center gap-2 px-4 py-2 bg-[#18181B] text-white rounded-xl hover:bg-[#3F3F46] transition-colors disabled:opacity-50"
            data-testid="process-btn"
          >
            {processing ? (
              <ArrowsClockwise size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Запустити обробку
          </button>
        </div>
      </div>

      {/* Escalation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard
          title={t('level1Manager')}
          value={summary?.level1Count || 0}
          icon={Clock}
          color="amber"
          subtitle={t('oneDayOverdue')}
        />
        <SummaryCard
          title={t('level2TeamLead')}
          value={summary?.level2Count || 0}
          icon={Warning}
          color="orange"
          subtitle={t('threeDaysOverdue')}
        />
        <SummaryCard
          title={t('level3Owner')}
          value={summary?.level3Count || 0}
          icon={ShieldWarning}
          color="red"
          subtitle={t('fiveDaysOverdue')}
        />
        <SummaryCard
          title={t('criticalLevel')}
          value={summary?.criticalCount || 0}
          icon={Bell}
          color="red"
          subtitle={t('requiresImmediateAction')}
        />
      </div>

      {/* Reminder Rules Info */}
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-200 p-6">
        <h2 className="text-lg font-semibold text-[#18181B] mb-4" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          Правила нагадувань
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white/80 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-blue-100">
                <Clock size={16} className="text-blue-600" />
              </div>
              <span className="font-medium text-[#18181B]">T-24h</span>
            </div>
            <p className="text-sm text-[#71717A]">Нагадування клієнту та менеджеру за 24 години до дедлайну</p>
          </div>
          <div className="bg-white/80 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-amber-100">
                <Bell size={16} className="text-amber-600" />
              </div>
              <span className="font-medium text-[#18181B]">T-0 (Due Today)</span>
            </div>
            <p className="text-sm text-[#71717A]">Термінове нагадування в день дедлайну</p>
          </div>
          <div className="bg-white/80 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-orange-100">
                <Warning size={16} className="text-orange-600" />
              </div>
              <span className="font-medium text-[#18181B]">T+1-3 дні</span>
            </div>
            <p className="text-sm text-[#71717A]">Ескалація до менеджера (L1) та Team Lead (L2)</p>
          </div>
          <div className="bg-white/80 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-red-100">
                <ShieldWarning size={16} className="text-red-600" />
              </div>
              <span className="font-medium text-[#18181B]">T+5 днів</span>
            </div>
            <p className="text-sm text-[#71717A]">CRITICAL: ескалація до Owner (L3)</p>
          </div>
          <div className="bg-white/80 rounded-xl p-4 md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-emerald-100">
                <Check size={16} className="text-emerald-600" />
              </div>
              <span className="font-medium text-[#18181B]">Канали сповіщень</span>
            </div>
            <p className="text-sm text-[#71717A]">
              Cabinet (завжди) • Email (якщо налаштовано) • Telegram (для менеджерів, team leads, owners)
            </p>
          </div>
        </div>
      </div>

      {/* Critical Invoices */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Критичні прострочені інвойси
          </h2>
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
            {criticalInvoices.length} total
          </span>
        </div>
        
        {criticalInvoices.length > 0 ? (
          <div className="space-y-3">
            {criticalInvoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Check size={48} className="mx-auto mb-4 text-emerald-500" />
            <p className="font-medium text-[#18181B]">Немає критичних інвойсів</p>
            <p className="text-sm text-[#71717A] mt-1">Всі інвойси в порядку</p>
          </div>
        )}
      </div>

      {/* Cron Info */}
      <div className="bg-[#F4F4F5] rounded-xl p-4 flex items-center gap-4">
        <ChartLineUp size={24} className="text-[#71717A]" />
        <div>
          <p className="text-sm font-medium text-[#18181B]">Автоматична обробка</p>
          <p className="text-xs text-[#71717A]">Cron job запускається кожну годину для перевірки та відправки нагадувань</p>
        </div>
      </div>
    </motion.div>
  );
};

export default InvoiceRemindersDashboard;
