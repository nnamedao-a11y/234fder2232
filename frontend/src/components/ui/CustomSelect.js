/**
 * Custom Select Component
 * 
 * Кастомний dropdown замість native select
 * З білим фоном та стилізованим списком
 * Підтримує відкриття вгору (dropUp) для таблиць
 */

import React, { useState, useRef, useEffect } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';

const CustomSelect = ({ 
  value, 
  onChange, 
  options = [], 
  placeholder = 'Виберіть...',
  label,
  className = '',
  testId,
  dropUp = false // Відкривати вгору
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find selected option label
  const selectedOption = options.find(opt => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  // Calculate dropdown position styles
  const dropdownStyles = dropUp 
    ? { 
        position: 'absolute',
        bottom: '100%', 
        left: 0,
        right: 0,
        marginBottom: '4px',
        zIndex: 100
      } 
    : { 
        position: 'absolute',
        top: '100%', 
        left: 0,
        right: 0,
        marginTop: '4px',
        zIndex: 100
      };

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-[#71717A] uppercase tracking-wider mb-2">{label}</label>
      )}
      <div className="relative" ref={ref} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3 py-2 bg-white border border-[#E4E4E7] rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-[#18181B] flex items-center justify-between transition-colors hover:border-[#A1A1AA]"
          data-testid={testId}
        >
          <span className={value ? 'text-[#18181B]' : 'text-[#71717A]'}>{displayText}</span>
          <CaretDown 
            size={16} 
            className={`text-[#71717A] transition-transform ${isOpen ? 'rotate-180' : ''}`} 
          />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              style={dropdownStyles}
              className="bg-white border border-[#E4E4E7] rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto"
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-2 transition-colors ${
                    value === option.value 
                      ? 'bg-[#F4F4F5] text-[#18181B] font-medium' 
                      : 'text-[#52525B] hover:bg-[#FAFAFA]'
                  }`}
                >
                  {value === option.value && (
                    <Check size={14} weight="bold" className="text-[#18181B]" />
                  )}
                  {value !== option.value && <span className="w-[14px]" />}
                  {option.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CustomSelect;
