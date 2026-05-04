import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const Pagination = ({ page = 1, pages = 1, onChange }) => {
  const prev = () => onChange?.(Math.max(1, page - 1));
  const next = () => onChange?.(Math.min(pages, page + 1));
  const nums = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  return (
    <div className="flex items-center gap-6 justify-center" data-testid="catalog-pagination">
      <button onClick={prev} className="w-8 h-8 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors disabled:opacity-40" aria-label="Previous" disabled={page === 1}><ChevronLeft size={16} /></button>
      <div className="flex items-center gap-4">
        {nums.map((n) => (
          <button key={n} onClick={() => onChange?.(n)} className={`text-[14px] transition-colors ${n === page ? 'text-[#FEAE00]' : 'text-white hover:text-[#FEAE00]'}`} data-testid={`page-${n}`}>{n}</button>
        ))}
      </div>
      <button onClick={next} className="w-8 h-8 rounded-full bg-[#FEAE00] flex items-center justify-center text-black hover:brightness-110 transition-all disabled:opacity-40" aria-label="Next" disabled={page === pages}><ChevronRight size={16} /></button>
    </div>
  );
};

export default Pagination;
