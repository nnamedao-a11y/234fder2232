/**
 * CompareButton Component
 * 
 * Сравнить / ✓ В сравнении
 */

import React, { useState, useMemo } from 'react';
import { Scales } from '@phosphor-icons/react';
import { userEngagementApi } from '../../lib/api';

export default function CompareButton({ 
  vehicleId, 
  vin,
  snapshot,
  compareSet = new Set(),
  compareCount = 0,
  onToggle,
  size = 'md',
  showText = true,
}) {
  const [saving, setSaving] = useState(false);
  const isInCompare = useMemo(() => compareSet.has(vehicleId), [compareSet, vehicleId]);
  const isFull = compareCount >= 3 && !isInCompare;

  async function handleClick(e) {
    e.stopPropagation();
    e.preventDefault();
    
    if (isFull) return;
    
    setSaving(true);
    try {
      if (isInCompare) {
        await userEngagementApi.compare.remove(vehicleId);
      } else {
        await userEngagementApi.compare.add({ vehicleId, vin, snapshot });
      }
      onToggle?.();
    } catch (err) {
      console.error('Compare toggle error:', err);
    } finally {
      setSaving(false);
    }
  }

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 24 : 20;

  return (
    <button
      onClick={handleClick}
      disabled={saving || isFull}
      data-testid="compare-button"
      className={`
        inline-flex items-center gap-2 rounded-lg border transition-all
        ${sizeClasses[size]}
        ${isInCompare 
          ? 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100' 
          : isFull
            ? 'bg-zinc-100 border-zinc-200 text-zinc-400 cursor-not-allowed'
            : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300'
        }
        ${saving ? 'opacity-50 cursor-wait' : ''}
      `}
    >
      <Scales 
        size={iconSize} 
        weight={isInCompare ? 'fill' : 'regular'}
        className={isInCompare ? 'text-blue-500' : 'text-zinc-400'}
      />
      {showText && (
        <span>
          {saving ? '...' : isInCompare ? 'В сравнении' : isFull ? 'Макс. 3' : 'Сравнить'}
        </span>
      )}
    </button>
  );
}
