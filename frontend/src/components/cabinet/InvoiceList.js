/**
 * InvoiceList Component
 * 
 * Displays invoices with status, pay button, and payment history
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  CreditCard, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  DollarSign,
  Calendar,
  ExternalLink,
  Loader2
} from 'lucide-react';

// Status configuration
const STATUS_CONFIG = {
  draft: { label: 'Чернетка', color: 'gray', icon: FileText },
  sent: { label: 'Очікує оплати', color: 'yellow', icon: Clock },
  pending: { label: 'В обробці', color: 'blue', icon: Loader2 },
  paid: { label: 'Сплачено', color: 'green', icon: CheckCircle },
  overdue: { label: 'Прострочено', color: 'red', icon: AlertCircle },
  cancelled: { label: 'Скасовано', color: 'gray', icon: AlertCircle },
  expired: { label: 'Термін вийшов', color: 'gray', icon: AlertCircle },
};

// Invoice type labels
const TYPE_LABELS = {
  deposit: 'Депозит',
  lot_payment: 'Оплата лоту',
  auction_fee: 'Аукціонний збір',
  logistics: 'Логістика',
  customs: 'Митне оформлення',
  delivery: 'Доставка',
  service_fee: 'Сервісний збір',
  other: 'Інше',
};

const getStatusClasses = (status) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
  };
  return colors[config.color] || colors.gray;
};

function InvoiceCard({ invoice, onPay, isLoading }) {
  const config = STATUS_CONFIG[invoice.status] || STATUS_CONFIG.draft;
  const Icon = config.icon;
  const canPay = ['sent', 'pending', 'overdue'].includes(invoice.status);
  const isOverdue = invoice.status === 'overdue';
  
  return (
    <motion.div
      className={`bg-white rounded-xl shadow-sm p-5 border-l-4 ${
        isOverdue ? 'border-red-500' : invoice.status === 'paid' ? 'border-green-500' : 'border-blue-500'
      }`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className="font-semibold text-gray-900">{invoice.title}</h4>
          <span className="text-xs text-gray-500 uppercase">
            {TYPE_LABELS[invoice.type] || invoice.type}
          </span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${getStatusClasses(invoice.status)}`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </span>
      </div>

      {invoice.description && (
        <p className="text-sm text-gray-600 mb-4">{invoice.description}</p>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold text-gray-900">
            ${invoice.amount?.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">
            {invoice.currency?.toUpperCase() || 'USD'}
          </p>
        </div>

        <div className="text-right">
          {invoice.dueDate && (
            <p className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              <Calendar className="h-3 w-3 inline mr-1" />
              До: {new Date(invoice.dueDate).toLocaleDateString('uk-UA')}
            </p>
          )}
          {invoice.paidAt && (
            <p className="text-xs text-green-600">
              <CheckCircle className="h-3 w-3 inline mr-1" />
              Сплачено: {new Date(invoice.paidAt).toLocaleDateString('uk-UA')}
            </p>
          )}
        </div>
      </div>

      {canPay && (
        <button
          onClick={() => onPay(invoice)}
          disabled={isLoading}
          className={`w-full mt-4 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${
            isOverdue
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <CreditCard className="h-5 w-5" />
              Сплатити зараз
            </>
          )}
        </button>
      )}

      {invoice.stripeCheckoutUrl && invoice.status === 'pending' && (
        <a
          href={invoice.stripeCheckoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full mt-4 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all"
        >
          <ExternalLink className="h-5 w-5" />
          Продовжити оплату
        </a>
      )}
    </motion.div>
  );
}

export function InvoiceList({ invoices, onPay, isLoading }) {
  const [filter, setFilter] = useState('all');

  if (!invoices || invoices.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-8 text-center">
        <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Немає рахунків</h3>
        <p className="text-gray-500">Тут будуть відображатися ваші рахунки</p>
      </div>
    );
  }

  const filteredInvoices = filter === 'all' 
    ? invoices 
    : invoices.filter(i => i.status === filter);

  // Calculate totals
  const totalPaid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + (i.amount || 0), 0);
  const totalPending = invoices
    .filter(i => ['sent', 'pending', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (i.amount || 0), 0);
  const totalOverdue = invoices
    .filter(i => i.status === 'overdue')
    .reduce((sum, i) => sum + (i.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-green-600 uppercase font-medium">Сплачено</p>
              <p className="text-xl font-bold text-green-700">${totalPaid.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-yellow-600 uppercase font-medium">До сплати</p>
              <p className="text-xl font-bold text-yellow-700">${totalPending.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {totalOverdue > 0 && (
          <div className="bg-red-50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-red-600 uppercase font-medium">Прострочено</p>
                <p className="text-xl font-bold text-red-700">${totalOverdue.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: 'all', label: 'Всі' },
          { value: 'sent', label: 'Очікують' },
          { value: 'paid', label: 'Сплачені' },
          { value: 'overdue', label: 'Прострочені' },
        ].map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      <div className="grid gap-4">
        {filteredInvoices.map((invoice) => (
          <InvoiceCard
            key={invoice.id}
            invoice={invoice}
            onPay={onPay}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}

export default InvoiceList;
