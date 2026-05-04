/**
 * Invoices Page (Cabinet)
 * 
 * /cabinet/invoices
 * 
 * Shows user's invoices and payment buttons
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  CreditCard, 
  Receipt, 
  CheckCircle, 
  Clock, 
  Warning,
  ArrowRight,
  Download
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import PaymentMethodPicker from '../../components/payments/PaymentMethodPicker';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Status Badge
const StatusBadge = ({ status }) => {
  const config = {
    pending: { color: 'amber', icon: Clock, label: 'Очікує оплати' },
    paid: { color: 'emerald', icon: CheckCircle, label: 'Оплачено' },
    cancelled: { color: 'zinc', icon: Warning, label: 'Скасовано' },
    expired: { color: 'red', icon: Warning, label: 'Прострочено' },
    refunded: { color: 'blue', icon: Receipt, label: 'Повернуто' },
  };
  const { color, icon: Icon, label } = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-${color}-100 text-${color}-700`}>
      <Icon size={12} />
      {label}
    </span>
  );
};

// Invoice Card
const InvoiceCard = ({ invoice, onPay }) => {
  const isPending = invoice.status === 'pending';
  
  return (
    <div 
      className="bg-white rounded-xl border border-zinc-200 p-4 hover:shadow-md transition-all"
      data-testid={`invoice-card-${invoice.id}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-zinc-900">{invoice.description || `Рахунок #${invoice.id.slice(0, 8)}`}</h3>
          <p className="text-sm text-zinc-500 mt-0.5">{invoice.type}</p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>
      
      <div className="flex items-center justify-between mt-4">
        <div className="text-2xl font-bold text-zinc-900">
          ${invoice.amount?.toLocaleString()}
          <span className="text-sm font-normal text-zinc-500 ml-1">USD</span>
        </div>
        
        {isPending && (
          <button
            onClick={() => onPay(invoice)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            data-testid={`pay-invoice-${invoice.id}`}
          >
            <CreditCard size={18} />
            Оплатити
            <ArrowRight size={16} />
          </button>
        )}
        
        {invoice.status === 'paid' && (
          <span className="text-emerald-600 font-medium flex items-center gap-1">
            <CheckCircle size={18} />
            Оплачено
          </span>
        )}
      </div>
      
      <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
        <span>Створено: {new Date(invoice.createdAt).toLocaleDateString('uk-UA')}</span>
        {invoice.paidAt && (
          <span>Оплачено: {new Date(invoice.paidAt).toLocaleDateString('uk-UA')}</span>
        )}
      </div>
    </div>
  );
};

// Packages Section
const PackagesSection = ({ packages, onSelectPackage }) => {
  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 mb-8">
      <h2 className="text-lg font-semibold text-zinc-900 mb-4">Швидка оплата</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {packages.map(pkg => (
          <button
            key={pkg.id}
            onClick={() => onSelectPackage(pkg)}
            className="bg-white rounded-xl p-4 border border-blue-200 hover:border-blue-400 hover:shadow-md transition-all text-left"
            data-testid={`package-${pkg.id}`}
          >
            <div className="font-medium text-zinc-900">{pkg.description}</div>
            <div className="text-2xl font-bold text-blue-600 mt-2">${pkg.amount}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

const InvoicesPage = () => {
  const [invoices, setInvoices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pickerInvoice, setPickerInvoice] = useState(null); // { invoice } or { package }

  // Get customerId from URL or localStorage
  const getCustomerId = () => {
    const path = window.location.pathname;
    const match = path.match(/\/cabinet\/([^/]+)/);
    return match?.[1] || localStorage.getItem('customerId');
  };

  const fetchData = useCallback(async () => {
    try {
      const customerId = getCustomerId();
      const [invoicesRes, packagesRes] = await Promise.all([
        axios.get(`${API_URL}/api/invoices/me`, { params: { customerId } }),
        axios.get(`${API_URL}/api/payments/packages`),
      ]);
      setInvoices(invoicesRes.data || []);
      setPackages(packagesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Show picker first; actual checkout creation happens in onProceed
  const handlePay = (invoice) => {
    setPickerInvoice({ kind: 'invoice', invoice });
  };

  const proceedFromPicker = async (selectedMethod) => {
    if (!pickerInvoice) return;
    setProcessing(true);
    try {
      const token = localStorage.getItem('customerToken') || localStorage.getItem('token');
      let invoiceId, amount;
      if (pickerInvoice.kind === 'invoice') {
        invoiceId = pickerInvoice.invoice.id;
        amount = pickerInvoice.invoice.amount;
      } else if (pickerInvoice.kind === 'package') {
        // Create invoice from package first
        const customerId = getCustomerId();
        const invoiceRes = await axios.post(`${API_URL}/api/invoices/create-from-package`, {
          packageId: pickerInvoice.pkg.id,
          customerId,
        });
        invoiceId = invoiceRes.data.id;
        amount = pickerInvoice.pkg.amount;
      }
      const response = await axios.post(`${API_URL}/api/invoices/checkout`, {
        invoiceId,
        originUrl: window.location.origin,
        preferredMethod: selectedMethod,
      }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.data?.url) {
        window.location.href = response.data.url;
      } else {
        throw new Error('No checkout URL');
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      toast.error(error.response?.data?.detail || error.response?.data?.message || 'Помилка створення платежу');
    } finally {
      setProcessing(false);
      setPickerInvoice(null);
    }
  };

  const handleSelectPackage = (pkg) => {
    setPickerInvoice({ kind: 'package', pkg });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const pendingInvoices = invoices.filter(i => i.status === 'pending');
  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const totalPaid = paidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
  const totalPending = pendingInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="invoices-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Мої рахунки</h1>
        <p className="text-zinc-600">Керуйте оплатами та переглядайте історію</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Clock size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="text-sm text-zinc-500">До оплати</div>
              <div className="text-xl font-bold text-amber-600">${totalPending.toLocaleString()}</div>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle size={20} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-sm text-zinc-500">Оплачено</div>
              <div className="text-xl font-bold text-emerald-600">${totalPaid.toLocaleString()}</div>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Receipt size={20} className="text-blue-600" />
            </div>
            <div>
              <div className="text-sm text-zinc-500">Всього рахунків</div>
              <div className="text-xl font-bold text-zinc-900">{invoices.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Packages */}
      {packages.length > 0 && (
        <PackagesSection packages={packages} onSelectPackage={handleSelectPackage} />
      )}

      {/* Pending Invoices */}
      {pendingInvoices.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 mb-4 flex items-center gap-2">
            <Clock size={20} className="text-amber-500" />
            Очікують оплати ({pendingInvoices.length})
          </h2>
          <div className="grid gap-4">
            {pendingInvoices.map(invoice => (
              <InvoiceCard key={invoice.id} invoice={invoice} onPay={handlePay} />
            ))}
          </div>
        </div>
      )}

      {/* Paid Invoices */}
      {paidInvoices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-4 flex items-center gap-2">
            <CheckCircle size={20} className="text-emerald-500" />
            Оплачені ({paidInvoices.length})
          </h2>
          <div className="grid gap-4">
            {paidInvoices.map(invoice => (
              <InvoiceCard key={invoice.id} invoice={invoice} onPay={handlePay} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {invoices.length === 0 && (
        <div className="text-center py-12 bg-zinc-50 rounded-xl">
          <Receipt size={48} className="text-zinc-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 mb-2">Немає рахунків</h3>
          <p className="text-zinc-600">Ваші рахунки з'являться тут</p>
        </div>
      )}

      {/* Processing Overlay */}
      {processing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 flex items-center gap-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span>Переходимо до оплати...</span>
          </div>
        </div>
      )}

      {/* Payment method picker */}
      <PaymentMethodPicker
        open={!!pickerInvoice}
        onClose={() => setPickerInvoice(null)}
        amount={pickerInvoice?.kind === 'invoice' ? pickerInvoice.invoice.amount : pickerInvoice?.pkg?.amount}
        currency={pickerInvoice?.kind === 'invoice' ? pickerInvoice.invoice.currency : 'usd'}
        description={pickerInvoice?.kind === 'invoice' ? (pickerInvoice.invoice.description || `Рахунок #${pickerInvoice.invoice.id}`) : pickerInvoice?.pkg?.description}
        onProceed={proceedFromPicker}
      />
    </div>
  );
};

export default InvoicesPage;
