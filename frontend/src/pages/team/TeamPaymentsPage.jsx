/**
 * BIBI Cars - Team Payments Watch
 * Overdue invoices monitoring for team lead
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  CreditCard,
  Clock,
  Warning,
  Phone,
  Eye,
  Funnel,
  MagnifyingGlass
} from '@phosphor-icons/react';

const TeamPaymentsPage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/team/payments/overdue`).catch(() =>
        axios.get(`${API_URL}/api/invoices?status=overdue`)
      );
      const invoicesData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.invoices || []);
      setInvoices(invoicesData);
    } catch (err) {
      console.error('Error:', err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const invoiceTypes = ['all', 'deposit', 'lot_payment', 'logistics', 'customs', 'delivery'];

  const filteredInvoices = filterType === 'all' 
    ? invoices 
    : invoices.filter(i => i.type === filterType);

  const totalOverdue = filteredInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

  return (
    <motion.div 
      data-testid="team-payments-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Team Payments Watch
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            Прострочені оплати по команді
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#DC2626]">${totalOverdue.toLocaleString()}</div>
          <div className="text-xs text-[#71717A]">Total overdue</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {invoiceTypes.map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors capitalize ${
              filterType === type
                ? 'bg-[#18181B] text-white'
                : 'bg-white border border-[#E4E4E7] text-[#71717A] hover:bg-[#F4F4F5]'
            }`}
          >
            {type === 'all' ? 'All Types' : type.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full mx-auto"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F4F4F5]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#71717A] uppercase">Deal</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#71717A] uppercase">Customer</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Manager</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Invoice Type</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Due Date</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Overdue Days</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#71717A] uppercase">Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Stage Blocker</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Next Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-[#71717A]">
                      Немає прострочених інвойсів
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv, idx) => (
                    <motion.tr
                      key={inv._id || idx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="hover:bg-[#FAFAFA] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-medium text-[#18181B]">
                          {inv.dealVin?.slice(-8) || inv.dealId?.slice(-6) || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#18181B]">{inv.customerName || 'Client'}</div>
                        <div className="text-xs text-[#71717A]">{inv.customerPhone || inv.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">
                        {inv.managerName || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${
                          inv.type === 'deposit' ? 'bg-[#EEF2FF] text-[#4F46E5]' :
                          inv.type === 'logistics' ? 'bg-[#FEF3C7] text-[#D97706]' :
                          inv.type === 'customs' ? 'bg-[#FCE7F3] text-[#DB2777]' :
                          'bg-[#F4F4F5] text-[#71717A]'
                        }`}>
                          {inv.type?.replace('_', ' ') || 'invoice'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-[#71717A]">
                        {inv.dueDate ? format(new Date(inv.dueDate), 'dd MMM yyyy', { locale: uk }) : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${
                          (inv.daysOverdue || 0) > 7 ? 'text-[#DC2626]' :
                          (inv.daysOverdue || 0) > 3 ? 'text-[#D97706]' : 'text-[#71717A]'
                        }`}>
                          {inv.daysOverdue || 0} days
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#DC2626]">
                        ${inv.amount?.toLocaleString() || 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.stageBlocker ? (
                          <span className="px-2 py-1 text-xs bg-[#FEF2F2] text-[#DC2626] rounded-full">
                            {inv.stageBlocker}
                          </span>
                        ) : (
                          <span className="text-[#71717A]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          className="p-2 text-[#71717A] hover:text-[#059669] hover:bg-[#ECFDF5] rounded-lg transition-colors"
                          title="Call customer"
                        >
                          <Phone size={16} />
                        </button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default TeamPaymentsPage;
