/**
 * CompareBar Component
 * 
 * Floating bar внизу екрану коли є items в compare
 */

import React from 'react';
import { Scales, X, ArrowRight } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { userEngagementApi } from '../../lib/api';

export default function CompareBar({ list, onClear, onRemove }) {
  const navigate = useNavigate();
  const items = list?.items || [];

  if (!items.length) return null;

  return (
    <div 
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 
                 rounded-2xl bg-zinc-900 px-5 py-4 text-white shadow-2xl
                 border border-zinc-700"
      data-testid="compare-bar"
    >
      <div className="flex items-center gap-6">
        {/* Icon & Count */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500 p-2">
            <Scales size={20} weight="fill" />
          </div>
          <div>
            <div className="font-semibold">Сравнение</div>
            <div className="text-xs text-zinc-400">{items.length}/3 авто</div>
          </div>
        </div>

        {/* Vehicle Pills */}
        <div className="flex items-center gap-2">
          {items.map((item) => (
            <div 
              key={item.vehicleId}
              className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2"
            >
              <span className="text-sm max-w-[120px] truncate">
                {item.snapshot?.title || item.vin}
              </span>
              <button
                onClick={() => onRemove?.(item.vehicleId)}
                className="rounded-full p-1 hover:bg-zinc-700 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 ml-2">
          <button
            onClick={onClear}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Очистить
          </button>
          <button
            onClick={() => navigate('/cabinet/compare')}
            disabled={items.length < 2}
            className={`
              flex items-center gap-2 rounded-xl px-5 py-2.5 font-medium transition-all
              ${items.length >= 2 
                ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
              }
            `}
          >
            Сравнить
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
