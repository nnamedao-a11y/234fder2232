/**
 * Quote History Component
 * 
 * Відображає історію всіх розрахунків для ліда/VIN
 * + Scenario Pricing Selection
 * + Manager Price Override
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../../App';
import { toast } from 'sonner';
import { 
  Receipt, 
  CaretDown, 
  CaretUp,
  Clock,
  CurrencyDollar,
  CheckCircle,
  Warning,
  PencilSimple
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import ManagerPriceOverride from './ManagerPriceOverride';

const QuoteHistory = ({ leadId, vin, onScenarioChange, showManagerOverride = true }) => {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedQuote, setExpandedQuote] = useState(null);
  const [activeOverrideQuote, setActiveOverrideQuote] = useState(null);

  useEffect(() => {
    loadQuotes();
  }, [leadId, vin]);

  const loadQuotes = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (leadId) params.append('leadId', leadId);
      if (vin) params.append('vin', vin);
      params.append('limit', '20');

      const res = await axios.get(`${API_URL}/api/calculator/quotes?${params.toString()}`);
      setQuotes(res.data);
    } catch (err) {
      console.error('Failed to load quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScenarioChange = async (quoteId, selectedScenario) => {
    try {
      const res = await axios.patch(`${API_URL}/api/calculator/quote/${quoteId}/scenario`, {
        selectedScenario
      });
      
      setQuotes(prev => prev.map(q => 
        q._id === quoteId ? { ...q, selectedScenario, finalPrice: res.data.finalPrice } : q
      ));
      
      toast.success(`Сценарій змінено на ${scenarioLabels[selectedScenario]}`);
      
      if (onScenarioChange) {
        onScenarioChange(res.data);
      }
    } catch (err) {
      toast.error('Помилка зміни сценарію');
    }
  };

  const scenarioLabels = {
    minimum: 'Мінімум (-5%)',
    recommended: 'Рекомендовано',
    aggressive: 'Максимум (+10%)'
  };

  const scenarioColors = {
    minimum: 'text-[#059669] bg-[#DCFCE7]',
    recommended: 'text-[#2563EB] bg-[#DBEAFE]',
    aggressive: 'text-[#DC2626] bg-[#FEE2E2]',
    custom: 'text-[#7C3AED] bg-[#F3E8FF]'
  };

  const handleQuoteUpdate = (updatedQuote) => {
    setQuotes(prev => prev.map(q => 
      q._id === updatedQuote._id ? updatedQuote : q
    ));
    if (onScenarioChange) {
      onScenarioChange(updatedQuote);
    }
  };

  if (loading) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-2 text-[#71717A]">
          <div className="w-4 h-4 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin"></div>
          Завантаження історії...
        </div>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-2 text-[#71717A]">
          <Receipt size={18} />
          Немає історії розрахунків
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4" data-testid="quote-history">
      <div className="flex items-center gap-2">
        <Receipt size={20} className="text-[#18181B]" />
        <h3 className="font-semibold text-[#18181B]">Історія розрахунків</h3>
        <span className="text-xs text-[#71717A]">({quotes.length})</span>
      </div>

      <div className="space-y-3">
        {quotes.map((quote, index) => {
          const isExpanded = expandedQuote === quote._id;
          const selectedPrice = quote.scenarios?.[quote.selectedScenario || 'recommended'] || quote.visibleTotal;

          return (
            <motion.div
              key={quote._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="border border-[#E4E4E7] rounded-xl overflow-hidden"
              data-testid={`quote-item-${quote._id}`}
            >
              {/* Header */}
              <div 
                className="p-4 bg-[#F7F7F8] cursor-pointer flex items-center justify-between"
                onClick={() => setExpandedQuote(isExpanded ? null : quote._id)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="font-mono text-sm font-medium text-[#18181B]">
                      {quote.quoteNumber}
                    </div>
                    <div className="text-xs text-[#71717A] flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(quote.createdAt).toLocaleDateString('uk-UA')}
                    </div>
                  </div>
                  
                  {quote.vin && (
                    <div className="text-xs font-mono text-[#71717A]">
                      VIN: {quote.vin}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {/* Scenario Badge */}
                  <span className={`text-xs px-2 py-1 rounded-full ${scenarioColors[quote.selectedScenario || 'recommended']}`}>
                    {scenarioLabels[quote.selectedScenario || 'recommended']}
                  </span>

                  {/* Prices */}
                  <div className="text-right">
                    <div className="font-semibold text-[#059669]">
                      ${selectedPrice?.toLocaleString()}
                    </div>
                    <div className="text-xs text-[#71717A]">
                      internal: ${quote.internalTotal?.toLocaleString()}
                    </div>
                  </div>

                  {isExpanded ? <CaretUp size={18} /> : <CaretDown size={18} />}
                </div>
              </div>

              {/* Expanded Content */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-[#E4E4E7]"
                  >
                    <div className="p-4 space-y-4">
                      {/* Scenario Selection */}
                      <div className="grid grid-cols-3 gap-2">
                        {['minimum', 'recommended', 'aggressive'].map((scenario) => (
                          <button
                            key={scenario}
                            onClick={() => handleScenarioChange(quote._id, scenario)}
                            className={`p-3 rounded-lg border-2 transition-all ${
                              quote.selectedScenario === scenario
                                ? 'border-[#18181B] bg-[#18181B] text-white'
                                : 'border-[#E4E4E7] hover:border-[#71717A]'
                            }`}
                            data-testid={`scenario-${scenario}-${quote._id}`}
                          >
                            <div className="text-xs uppercase tracking-wider opacity-70">
                              {scenario === 'minimum' ? 'Мінімум' : scenario === 'recommended' ? 'Рекомендовано' : 'Максимум'}
                            </div>
                            <div className="font-semibold mt-1">
                              ${quote.scenarios?.[scenario]?.toLocaleString() || 'N/A'}
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Breakdown */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-sm">
                        {Object.entries(quote.breakdown || {}).map(([key, value]) => (
                          <div key={key} className="p-2 bg-[#F7F7F8] rounded-lg">
                            <div className="text-xs text-[#71717A]">{humanize(key)}</div>
                            <div className="font-medium">${Number(value).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>

                      {/* Hidden Fee Info */}
                      <div className="flex items-center gap-4 p-3 bg-[#F5F3FF] rounded-lg border border-[#7C3AED]">
                        <Warning size={20} className="text-[#7C3AED]" />
                        <div>
                          <div className="text-sm font-medium text-[#7C3AED]">Hidden Fee (Маржа)</div>
                          <div className="text-xs text-[#71717A]">
                            Visible: ${quote.visibleTotal?.toLocaleString()} → Internal: ${quote.internalTotal?.toLocaleString()} 
                            <span className="text-[#7C3AED] ml-1">(+${quote.hiddenFee?.toLocaleString()})</span>
                          </div>
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-[#71717A]">Статус:</span>
                          <span className={`badge status-${quote.status}`}>{quote.status}</span>
                        </div>
                        {quote.convertedToLead && (
                          <div className="flex items-center gap-1 text-[#059669]">
                            <CheckCircle size={16} />
                            Конвертовано в лід
                          </div>
                        )}
                      </div>

                      {/* Manager Price Override Section */}
                      {showManagerOverride && (
                        <div className="border-t border-[#E4E4E7] pt-4 mt-4">
                          <button
                            onClick={() => setActiveOverrideQuote(activeOverrideQuote === quote._id ? null : quote._id)}
                            className="flex items-center gap-2 text-sm text-[#7C3AED] hover:underline"
                            data-testid={`manager-override-toggle-${quote._id}`}
                          >
                            <PencilSimple size={16} />
                            {activeOverrideQuote === quote._id ? 'Приховати' : 'Manager Price Override'}
                          </button>
                          
                          {activeOverrideQuote === quote._id && (
                            <div className="mt-4">
                              <ManagerPriceOverride
                                quoteId={quote._id}
                                quote={quote}
                                onUpdate={handleQuoteUpdate}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

// Humanize breakdown keys
function humanize(key) {
  const map = {
    carPrice: 'Ціна авто',
    auctionFee: 'Аукціонний збір',
    insurance: 'Страхування',
    usaInland: 'Доставка USA',
    ocean: 'Морська доставка',
    usaHandlingFee: 'Оформлення USA',
    bankFee: 'Банк/пошта',
    euPortHandlingFee: 'Порт ЄС',
    euDelivery: 'Доставка ЄС',
    companyFee: 'Послуги компанії',
    customs: 'Митні платежі',
    documentationFee: 'Документація',
    titleFee: 'Титул',
  };
  return map[key] || key;
}

export default QuoteHistory;
