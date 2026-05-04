/**
 * Deal Engine Card Component
 * 
 * Displays deal evaluation with profit, risk, and recommendations
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../../App';
import { 
  TrendUp, 
  TrendDown, 
  Warning, 
  CheckCircle,
  XCircle,
  Eye,
  CurrencyDollar,
  Percent,
  ShieldWarning,
  ArrowRight
} from '@phosphor-icons/react';

const badgeColors = {
  'STRONG BUY': 'bg-green-500 text-white',
  'BUY': 'bg-blue-500 text-white',
  'WATCH': 'bg-yellow-500 text-gray-900',
  'AVOID': 'bg-red-500 text-white',
};

const riskColors = {
  low: 'text-green-600 bg-green-50',
  medium: 'text-yellow-600 bg-yellow-50',
  high: 'text-red-600 bg-red-50',
};

const DealEngineCard = ({ payload, onEvaluate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (payload) {
      evaluateDeal(payload);
    }
  }, [payload]);

  const evaluateDeal = async (dealPayload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/api/deal-engine/evaluate`, dealPayload);
      setData(res.data);
      if (onEvaluate) onEvaluate(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 animate-pulse" data-testid="deal-engine-loading">
        <div className="flex items-center gap-2 mb-4">
          <TrendUp className="w-5 h-5 text-blue-500" />
          <span className="font-medium text-gray-700">Deal Engine</span>
        </div>
        <div className="space-y-3">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 bg-gray-100 rounded"></div>
            <div className="h-16 bg-gray-100 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5" data-testid="deal-engine-error">
        <div className="flex items-center gap-2 text-red-600">
          <XCircle className="w-5 h-5" weight="bold" />
          <span className="font-medium">Помилка Deal Engine</span>
        </div>
        <p className="mt-2 text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center" data-testid="deal-engine-empty">
        <Eye className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">Надайте дані для оцінки угоди</p>
      </div>
    );
  }

  const { profit, risk, score, recommendation } = data;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" data-testid="deal-engine-card">
      {/* Header with Badge */}
      <div className={`px-5 py-3 ${badgeColors[recommendation.badge]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {score.decision === 'strong_buy' && <CheckCircle className="w-6 h-6" weight="fill" />}
            {score.decision === 'buy' && <TrendUp className="w-6 h-6" weight="bold" />}
            {score.decision === 'watch' && <Eye className="w-6 h-6" weight="bold" />}
            {score.decision === 'avoid' && <XCircle className="w-6 h-6" weight="fill" />}
            <span className="text-xl font-bold">{recommendation.badge}</span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{score.dealScore}</div>
            <div className="text-xs opacity-80">Deal Score</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* Message */}
        <div className="text-sm text-gray-700">
          {recommendation.messageUk || recommendation.message}
        </div>

        {/* Price Frame */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <PriceCell 
            label="Ринок" 
            value={`$${recommendation.priceFrame.marketPrice.toLocaleString()}`}
            icon={CurrencyDollar}
          />
          <PriceCell 
            label="Max Bid" 
            value={`$${recommendation.priceFrame.maxBid.toLocaleString()}`}
            icon={TrendUp}
          />
          <PriceCell 
            label="All-in" 
            value={`$${recommendation.priceFrame.finalAllInPrice.toLocaleString()}`}
            icon={CurrencyDollar}
          />
          <PriceCell 
            label="Чистий прибуток" 
            value={`$${recommendation.priceFrame.netProfit.toLocaleString()}`}
            icon={profit.netProfit >= 0 ? TrendUp : TrendDown}
            highlight={profit.netProfit >= 2000 ? 'green' : profit.netProfit >= 0 ? 'blue' : 'red'}
          />
          <PriceCell 
            label="ROI" 
            value={`${profit.roi}%`}
            icon={Percent}
            highlight={profit.roi >= 15 ? 'green' : profit.roi >= 5 ? 'blue' : 'gray'}
          />
          <div className={`p-3 rounded-lg ${riskColors[risk.riskLevel]}`}>
            <div className="flex items-center gap-1 text-xs font-medium mb-1">
              <ShieldWarning className="w-3 h-3" />
              Ризик
            </div>
            <div className="text-lg font-bold capitalize">{risk.riskLevel}</div>
          </div>
        </div>

        {/* Risk Factors */}
        {risk.factors && risk.factors.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Фактори ризику:</div>
            <div className="flex flex-wrap gap-1">
              {risk.factors.map((factor, idx) => (
                <span key={idx} className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded-full">
                  {factor}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Score Breakdown */}
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-xs font-medium text-gray-500 mb-2">Розрахунок Score:</div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <div className="font-medium text-green-600">+{score.breakdown.profitScore}</div>
              <div className="text-gray-500">Прибуток</div>
            </div>
            <div>
              <div className="font-medium text-red-600">{score.breakdown.riskPenalty}</div>
              <div className="text-gray-500">Ризик</div>
            </div>
            <div>
              <div className="font-medium text-purple-600">+{score.breakdown.intentBonus}</div>
              <div className="text-gray-500">Intent</div>
            </div>
            <div>
              <div className="font-medium text-blue-600">+{score.breakdown.demandBonus}</div>
              <div className="text-gray-500">Попит</div>
            </div>
          </div>
        </div>

        {/* Action Items */}
        {recommendation.actionItemsUk && recommendation.actionItemsUk.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">Дії:</div>
            <ul className="space-y-1">
              {recommendation.actionItemsUk.map((item, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                  <ArrowRight className="w-3 h-3 text-blue-500" weight="bold" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

const PriceCell = ({ label, value, icon: Icon, highlight }) => {
  const colors = {
    green: 'text-green-600',
    blue: 'text-blue-600',
    red: 'text-red-600',
    gray: 'text-gray-600',
  };

  return (
    <div className="p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`text-lg font-bold ${highlight ? colors[highlight] : 'text-gray-800'}`}>
        {value}
      </div>
    </div>
  );
};

export default DealEngineCard;
