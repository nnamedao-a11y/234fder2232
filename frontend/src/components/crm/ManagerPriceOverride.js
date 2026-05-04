/**
 * Manager Price Override Component
 * 
 * Дозволяє менеджеру змінювати ціну з повним аудитом
 * Показує:
 * - Поточну ціну та сценарій
 * - Форму для override з причиною
 * - Історію змін
 * - Вплив на маржу
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { toast } from 'sonner';
import { 
  PencilSimple,
  Clock,
  CurrencyDollar,
  Warning,
  CheckCircle,
  ArrowsClockwise,
  User,
  Info,
  TrendUp,
  TrendDown,
  ChartLine
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';

const ManagerPriceOverride = ({ quoteId, quote, onUpdate }) => {
  const { user } = useAuth();
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [auditHistory, setAuditHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [overrideForm, setOverrideForm] = useState({
    newPrice: '',
    reason: '',
  });

  useEffect(() => {
    if (quoteId && showHistory) {
      loadAuditHistory();
    }
  }, [quoteId, showHistory]);

  const loadAuditHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/calculator/quote/${quoteId}/audit`);
      setAuditHistory(res.data.history || []);
    } catch (err) {
      console.error('Failed to load audit history:', err);
    }
  };

  const handleOverride = async (e) => {
    e.preventDefault();
    
    if (!overrideForm.newPrice || !overrideForm.reason) {
      toast.error('Вкажіть нову ціну та причину');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.patch(`${API_URL}/api/calculator/quote/${quoteId}/override`, {
        newPrice: parseFloat(overrideForm.newPrice),
        reason: overrideForm.reason,
        managerId: user?.id || 'unknown',
        managerName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Manager',
      });

      toast.success('Ціну змінено успішно');
      setShowOverrideForm(false);
      setOverrideForm({ newPrice: '', reason: '' });
      
      if (onUpdate) {
        onUpdate(res.data.quote);
      }
      
      loadAuditHistory();
    } catch (err) {
      toast.error('Помилка зміни ціни');
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (scenario) => {
    setLoading(true);
    try {
      const res = await axios.patch(`${API_URL}/api/calculator/quote/${quoteId}/revert`, {
        scenario,
        managerId: user?.id || 'unknown',
      });

      toast.success(`Повернено до ${scenarioLabels[scenario]}`);
      
      if (onUpdate) {
        onUpdate(res.data);
      }
      
      loadAuditHistory();
    } catch (err) {
      toast.error('Помилка скасування');
    } finally {
      setLoading(false);
    }
  };

  const scenarioLabels = {
    minimum: 'Мінімум',
    recommended: 'Рекомендовано',
    aggressive: 'Максимум',
    custom: 'Кастом',
  };

  if (!quote) return null;

  const currentPrice = quote.finalPrice || quote.scenarios?.[quote.selectedScenario || 'recommended'] || quote.visibleTotal;
  const recommendedPrice = quote.scenarios?.recommended || quote.visibleTotal;
  const priceDiff = currentPrice - recommendedPrice;
  const percentDiff = ((priceDiff / recommendedPrice) * 100).toFixed(1);
  const margin = currentPrice - quote.internalTotal;
  const isCustom = quote.selectedScenario === 'custom';

  return (
    <div className="space-y-4">
      {/* Current Price Info */}
      <div className="bg-gradient-to-r from-[#18181B] to-[#27272A] rounded-xl p-4 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CurrencyDollar size={20} />
            <span className="font-medium">Поточна ціна</span>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${
            isCustom ? 'bg-[#7C3AED] text-white' : 'bg-white/20'
          }`}>
            {scenarioLabels[quote.selectedScenario || 'recommended']}
          </span>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="text-4xl font-bold">${currentPrice?.toLocaleString()}</div>
            {priceDiff !== 0 && (
              <div className={`text-sm mt-1 flex items-center gap-1 ${
                priceDiff > 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {priceDiff > 0 ? <TrendUp size={14} /> : <TrendDown size={14} />}
                {priceDiff > 0 ? '+' : ''}${priceDiff.toLocaleString()} ({percentDiff}%) від рекомендованої
              </div>
            )}
          </div>
          
          <div className="text-right">
            <div className="text-xs text-white/60">Маржа компанії</div>
            <div className={`font-semibold ${margin > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {margin > 0 ? '+' : ''}{margin.toLocaleString()}$
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowOverrideForm(!showOverrideForm)}
          className="btn btn-primary flex items-center gap-2"
          data-testid="override-price-btn"
        >
          <PencilSimple size={16} />
          {isCustom ? 'Змінити ціну' : 'Встановити свою ціну'}
        </button>

        {isCustom && (
          <button
            onClick={() => handleRevert('recommended')}
            disabled={loading}
            className="btn btn-secondary flex items-center gap-2"
          >
            <ArrowsClockwise size={16} />
            Скинути
          </button>
        )}

        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`btn ${showHistory ? 'btn-secondary' : 'btn-ghost'} flex items-center gap-2`}
        >
          <Clock size={16} />
          Історія
        </button>
      </div>

      {/* Override Form */}
      <AnimatePresence>
        {showOverrideForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleOverride}
            className="card p-4 space-y-4 border-2 border-[#7C3AED]"
          >
            <div className="flex items-center gap-2 text-[#7C3AED]">
              <Warning size={18} />
              <span className="font-medium">Manager Price Override</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#71717A]">Нова ціна ($) *</label>
                <input
                  type="number"
                  value={overrideForm.newPrice}
                  onChange={(e) => setOverrideForm(f => ({ ...f, newPrice: e.target.value }))}
                  placeholder={currentPrice?.toString()}
                  className="input w-full mt-1"
                  min="0"
                  step="0.01"
                  required
                  data-testid="override-price-input"
                />
                
                {/* Quick buttons */}
                <div className="flex gap-1 mt-2">
                  {[
                    { label: '-5%', value: Math.round(recommendedPrice * 0.95) },
                    { label: 'Рек.', value: recommendedPrice },
                    { label: '+5%', value: Math.round(recommendedPrice * 1.05) },
                    { label: '+10%', value: Math.round(recommendedPrice * 1.10) },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setOverrideForm(f => ({ ...f, newPrice: opt.value.toString() }))}
                      className="text-xs px-2 py-1 rounded bg-[#F7F7F8] hover:bg-[#E4E4E7]"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-[#71717A]">Причина зміни *</label>
                <select
                  value={overrideForm.reason}
                  onChange={(e) => setOverrideForm(f => ({ ...f, reason: e.target.value }))}
                  className="input w-full mt-1"
                  required
                  data-testid="override-reason-select"
                >
                  <option value="">Оберіть причину...</option>
                  <option value="client_negotiation">Торг з клієнтом</option>
                  <option value="repeat_customer">Постійний клієнт</option>
                  <option value="competitive_pricing">Конкурентна ціна</option>
                  <option value="bulk_order">Опт / декілька авто</option>
                  <option value="manager_discretion">На розсуд менеджера</option>
                  <option value="promo_campaign">Промо акція</option>
                  <option value="error_correction">Виправлення помилки</option>
                  <option value="other">Інше</option>
                </select>
              </div>
            </div>

            {/* Preview */}
            {overrideForm.newPrice && (
              <div className="p-3 bg-[#F5F3FF] rounded-lg">
                <div className="text-sm text-[#7C3AED]">Попередній перегляд:</div>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-[#71717A] line-through">${currentPrice?.toLocaleString()}</span>
                  <span className="text-lg font-semibold">${parseFloat(overrideForm.newPrice).toLocaleString()}</span>
                  <span className={`text-sm ${
                    parseFloat(overrideForm.newPrice) > currentPrice ? 'text-green-600' : 'text-red-600'
                  }`}>
                    ({parseFloat(overrideForm.newPrice) > currentPrice ? '+' : ''}{(parseFloat(overrideForm.newPrice) - currentPrice).toLocaleString()}$)
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowOverrideForm(false)}
                className="btn btn-ghost"
              >
                Скасувати
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
                data-testid="submit-override-btn"
              >
                {loading ? 'Збереження...' : 'Зберегти ціну'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Audit History */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="card p-4"
          >
            <div className="flex items-center gap-2 mb-4">
              <ChartLine size={18} />
              <h4 className="font-medium">Історія змін ціни</h4>
            </div>

            {auditHistory.length === 0 ? (
              <div className="text-sm text-[#71717A] text-center py-4">
                Немає змін ціни
              </div>
            ) : (
              <div className="space-y-3">
                {auditHistory
                  .filter(h => ['manager_price_override', 'scenario_changed', 'revert_to_scenario'].includes(h.action))
                  .slice(0, 10)
                  .map((entry, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-[#F7F7F8] rounded-lg">
                      <div className={`p-2 rounded-full ${
                        entry.action === 'manager_price_override' 
                          ? 'bg-[#7C3AED]/10 text-[#7C3AED]'
                          : entry.action === 'revert_to_scenario'
                          ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
                          : 'bg-[#2563EB]/10 text-[#2563EB]'
                      }`}>
                        {entry.action === 'manager_price_override' 
                          ? <PencilSimple size={14} />
                          : entry.action === 'revert_to_scenario'
                          ? <ArrowsClockwise size={14} />
                          : <CheckCircle size={14} />}
                      </div>
                      
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {entry.action === 'manager_price_override' && 'Зміна ціни менеджером'}
                          {entry.action === 'scenario_changed' && 'Зміна сценарію'}
                          {entry.action === 'revert_to_scenario' && 'Скидання до сценарію'}
                        </div>
                        
                        {entry.action === 'manager_price_override' && (
                          <>
                            <div className="text-sm">
                              ${entry.oldValue?.price?.toLocaleString()} → ${entry.newValue?.price?.toLocaleString()}
                              <span className={`ml-2 ${entry.newValue?.priceDiff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({entry.newValue?.priceDiff > 0 ? '+' : ''}{entry.newValue?.percentChange}%)
                              </span>
                            </div>
                            <div className="text-xs text-[#71717A]">
                              Причина: {reasonLabels[entry.newValue?.reason] || entry.newValue?.reason}
                            </div>
                          </>
                        )}
                        
                        {entry.action === 'scenario_changed' && (
                          <div className="text-sm">
                            {scenarioLabels[entry.oldValue] || entry.oldValue} → {scenarioLabels[entry.newValue] || entry.newValue}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 mt-1 text-xs text-[#71717A]">
                          <User size={12} />
                          {entry.userName || entry.userId || 'System'}
                          <span>•</span>
                          {new Date(entry.timestamp).toLocaleString('uk-UA')}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const reasonLabels = {
  client_negotiation: 'Торг з клієнтом',
  repeat_customer: 'Постійний клієнт',
  competitive_pricing: 'Конкурентна ціна',
  bulk_order: 'Опт / декілька авто',
  manager_discretion: 'На розсуд менеджера',
  promo_campaign: 'Промо акція',
  error_correction: 'Виправлення помилки',
  other: 'Інше',
};

export default ManagerPriceOverride;
