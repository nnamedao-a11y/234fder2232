/**
 * HistoryButton Component
 * 
 * Отримати історію авто (з quota management)
 */

import React, { useState } from 'react';
import { FileText, Lock, Warning, CheckCircle } from '@phosphor-icons/react';
import { userEngagementApi } from '../../lib/api';

export default function HistoryButton({ 
  vin, 
  quota,
  onLoaded,
  onQuotaChange,
  size = 'md',
}) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error' | null
  const [message, setMessage] = useState('');

  const freeRemaining = quota?.freeRemaining ?? 0;
  const isRestricted = quota?.isRestricted ?? false;
  const canRequest = freeRemaining > 0 && !isRestricted;

  async function handleClick() {
    if (!canRequest || loading) return;
    
    setLoading(true);
    setStatus(null);
    setMessage('');

    try {
      const res = await userEngagementApi.history.request(vin);
      onLoaded?.(res?.report);
      onQuotaChange?.();
      
      setStatus('success');
      setMessage(res?.cached ? 'Звіт з кешу' : 'Звіт завантажено');
    } catch (err) {
      setStatus('error');
      setMessage(err.message?.includes('403') 
        ? 'Верифікація необхідна' 
        : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }

  const sizeClasses = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-3 text-base',
    lg: 'px-5 py-4 text-lg',
  };

  // Restricted state
  if (isRestricted) {
    return (
      <div className="space-y-2">
        <button
          disabled
          className={`
            inline-flex items-center gap-3 rounded-xl 
            bg-red-50 border border-red-200 text-red-600 
            cursor-not-allowed ${sizeClasses[size]}
          `}
        >
          <Lock size={20} weight="fill" />
          <span>Доступ обмежено</span>
        </button>
        <p className="text-sm text-red-500">
          Зв'яжіться з менеджером для отримання звіту
        </p>
      </div>
    );
  }

  // No quota remaining
  if (freeRemaining <= 0) {
    return (
      <div className="space-y-2">
        <button
          disabled
          className={`
            inline-flex items-center gap-3 rounded-xl 
            bg-zinc-100 border border-zinc-200 text-zinc-500 
            cursor-not-allowed ${sizeClasses[size]}
          `}
        >
          <FileText size={20} />
          <span>Ліміт вичерпано</span>
        </button>
        <p className="text-sm text-zinc-500">
          Безкоштовні звіти використано. Зв'яжіться з менеджером.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={loading}
        data-testid="history-button"
        className={`
          inline-flex items-center gap-3 rounded-xl font-medium
          transition-all ${sizeClasses[size]}
          ${loading 
            ? 'bg-zinc-100 text-zinc-500 cursor-wait'
            : 'bg-zinc-900 text-white hover:bg-zinc-800'
          }
        `}
      >
        {loading ? (
          <>
            <div className="w-5 h-5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            <span>Завантаження...</span>
          </>
        ) : (
          <>
            <FileText size={20} weight="fill" />
            <span>Отримати історію</span>
            <span className="ml-2 px-2 py-0.5 rounded-lg bg-white/20 text-sm">
              {freeRemaining} безкоштовно
            </span>
          </>
        )}
      </button>

      {/* Status message */}
      {status && (
        <div className={`
          flex items-center gap-2 text-sm
          ${status === 'success' ? 'text-emerald-600' : 'text-red-500'}
        `}>
          {status === 'success' ? (
            <CheckCircle size={16} weight="fill" />
          ) : (
            <Warning size={16} weight="fill" />
          )}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
