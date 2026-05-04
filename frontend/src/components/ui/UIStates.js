/**
 * UI State Components
 * 
 * Loading, Error, Empty states для всього сайту
 */

import React from 'react';
import { Warning, SmileySad, SpinnerGap } from '@phosphor-icons/react';

// Loading State
export const Loading = ({ text = 'Завантаження...' }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16" data-testid="loading-state">
      <SpinnerGap size={48} className="text-zinc-400 animate-spin mb-4" />
      <p className="text-zinc-500 text-sm">{text}</p>
    </div>
  );
};

// Error State
export const ErrorState = ({ 
  text = 'Щось пішло не так', 
  onRetry 
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-16" data-testid="error-state">
      <Warning size={48} className="text-red-400 mb-4" />
      <p className="text-red-500 font-medium mb-2">{text}</p>
      <p className="text-zinc-400 text-sm mb-4">Спробуйте ще раз пізніше</p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm hover:bg-zinc-800"
        >
          Спробувати ще
        </button>
      )}
    </div>
  );
};

// Empty State
export const Empty = ({ 
  text = 'Нічого не знайдено',
  subtext,
  icon: Icon = SmileySad,
  action,
  actionText = 'Показати все'
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 bg-zinc-100 rounded-xl" data-testid="empty-state">
      <Icon size={48} className="text-zinc-300 mb-4" />
      <p className="text-zinc-500 font-medium mb-1">{text}</p>
      {subtext && <p className="text-zinc-400 text-sm">{subtext}</p>}
      {action && (
        <button 
          onClick={action}
          className="mt-4 px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm hover:bg-zinc-800"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};

// Page Loading (full page)
export const PageLoading = () => {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loading />
    </div>
  );
};

export default { Loading, ErrorState, Empty, PageLoading };
