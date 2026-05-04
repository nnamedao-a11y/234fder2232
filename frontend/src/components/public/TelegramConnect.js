/**
 * Telegram Connect Button Component
 * 
 * Deep link button to connect customer account with Telegram Bot
 */

import React from 'react';

const TELEGRAM_BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME || 'BIBICarsBot';

export const TelegramConnectButton = ({ 
  customerId, 
  isConnected = false,
  onConnect,
  className = '',
  size = 'default', // 'small' | 'default' | 'large'
}) => {
  const deepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=customer_${customerId}`;

  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm',
    default: 'px-5 py-2.5',
    large: 'px-6 py-3 text-lg',
  };

  if (isConnected) {
    return (
      <div className={`flex items-center gap-2 text-green-600 ${className}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <span className="font-medium">Telegram підключено</span>
      </div>
    );
  }

  return (
    <a
      href={deepLink}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onConnect}
      className={`
        inline-flex items-center gap-2 
        bg-[#0088cc] hover:bg-[#006699] 
        text-white font-medium rounded-xl
        transition-all duration-200
        ${sizeClasses[size]}
        ${className}
      `}
      data-testid="telegram-connect-button"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
      </svg>
      Підключити Telegram
    </a>
  );
};

/**
 * Telegram Connect Banner
 * 
 * Full-width banner for customer cabinet
 */
export const TelegramConnectBanner = ({ 
  customerId, 
  isConnected = false,
  onDismiss,
}) => {
  const deepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=customer_${customerId}`;

  if (isConnected) return null;

  return (
    <div 
      className="bg-gradient-to-r from-[#0088cc] to-[#229ED9] text-white rounded-2xl p-5 mb-6"
      data-testid="telegram-banner"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">Отримуйте сповіщення в Telegram</h3>
          <p className="text-white/80 text-sm mt-1">
            Миттєві сповіщення про аукціони, зниження цін та статус ваших замовлень
          </p>
        </div>
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white text-[#0088cc] px-5 py-2.5 rounded-xl font-medium hover:bg-white/90 transition-colors flex-shrink-0"
          data-testid="telegram-banner-connect"
        >
          Підключити
        </a>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-white/70 hover:text-white p-1"
            aria-label="Закрити"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Generate Telegram deep link
 */
export const getTelegramDeepLink = (customerId) => {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=customer_${customerId}`;
};

export default TelegramConnectButton;
