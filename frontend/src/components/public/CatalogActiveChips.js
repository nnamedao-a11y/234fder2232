import React from 'react';
import { X } from 'lucide-react';

/**
 * CatalogActiveChips
 * Reflects ALL active filters as chips with individual remove buttons.
 * Props: { chips: [{ id, label, onRemove }], total, onReset }
 */
export const CatalogActiveChips = ({ chips = [], onReset, total = 0 }) => {
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="catalog-active-chips">
      <span className="text-[12px] uppercase tracking-wider text-[#9A9A9A]">
        Found <span className="text-white font-medium">{Number(total).toLocaleString()}</span> results
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-2 pl-3 pr-2 h-8 border border-[#FEAE00]/40 rounded text-[12px] uppercase text-white"
            data-testid={`active-chip-${c.id}`}
          >
            {c.label}
            <button
              type="button"
              onClick={c.onRemove}
              className="w-4 h-4 rounded-full bg-[#1D1D1B] hover:bg-[#FEAE00] hover:text-black flex items-center justify-center text-[#FEAE00] transition-colors"
              aria-label={`Remove ${c.label}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {chips.length > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="text-[12px] uppercase underline text-[#FEAE00] hover:brightness-110 ml-2"
            data-testid="catalog-reset"
          >
            Reset all
          </button>
        )}
      </div>
    </div>
  );
};

export default CatalogActiveChips;
