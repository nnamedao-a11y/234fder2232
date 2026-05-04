import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Breadcrumbs — follows Figma:
 *  - link items: muted #5E5E5E, hover amber
 *  - active/current (last): amber #FEAE00
 */
export const Breadcrumbs = ({ items = [] }) => {
  return (
    <nav
      className="text-[14px] md:text-[20px] font-semibold uppercase tracking-wide"
      data-testid="breadcrumbs"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className="mx-2 text-[#5E5E5E]">/</span>}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="text-[#5E5E5E] hover:text-[#FEAE00] transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-[#5E5E5E]' : 'text-[#5E5E5E]'}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default Breadcrumbs;
