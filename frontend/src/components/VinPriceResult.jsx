/**
 * VIN Price Result Component
 * 
 * Показує результат VIN пошуку з:
 * - Vehicle info
 * - Market price
 * - Bid recommendations
 * - Deal status
 * - Cost breakdown
 * - CTA buttons
 */

import React, { useState, useEffect } from 'react';
import { 
  Car, DollarSign, TrendingUp, AlertCircle, 
  CheckCircle, XCircle, Clock, MapPin, 
  Gauge, Wrench, Phone, ShoppingCart, Star
} from 'lucide-react';

// Deal status styles
const DEAL_STATUS_STYLES = {
  GOOD_DEAL: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/50',
    text: 'text-green-400',
    icon: CheckCircle,
  },
  OK_DEAL: {
    bg: 'bg-lime-500/10',
    border: 'border-lime-500/50',
    text: 'text-lime-400',
    icon: CheckCircle,
  },
  RISKY: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/50',
    text: 'text-yellow-400',
    icon: AlertCircle,
  },
  OVERPRICED: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/50',
    text: 'text-orange-400',
    icon: AlertCircle,
  },
  BAD_DEAL: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/50',
    text: 'text-red-400',
    icon: XCircle,
  },
};

export default function VinPriceResult({ data, onBuy, onContact, onSave, variant, ctaCopy, leadCreated }) {
  if (!data || !data.success) {
    return (
      <div className="p-8 text-center text-gray-400">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-500" />
        <p>Дані не знайдено</p>
      </div>
    );
  }

  const { vehicle, market, bid, costs, dealStatus, managerAdvice } = data;
  const statusStyle = DEAL_STATUS_STYLES[dealStatus.status] || DEAL_STATUS_STYLES.RISKY;
  const StatusIcon = statusStyle.icon;

  const formatPrice = (price) => {
    if (!price && price !== 0) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800 overflow-hidden">
      {/* Hero Section */}
      <div className="p-6 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
        {/* Vehicle Title & Status */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h2>
            <p className="text-gray-400 text-sm font-mono">
              VIN: {data.vin}
            </p>
          </div>
          
          {/* Deal Status Badge */}
          <div className={`px-4 py-2 rounded-lg border ${statusStyle.bg} ${statusStyle.border}`}>
            <div className="flex items-center gap-2">
              <StatusIcon className={`w-5 h-5 ${statusStyle.text}`} />
              <span className={`font-semibold ${statusStyle.text}`}>
                {dealStatus.label.replace(/[🟢🟡🟠🔴]/g, '').trim()}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex flex-wrap gap-4 text-sm text-gray-400">
          {vehicle.location && (
            <div className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              {vehicle.location}
            </div>
          )}
          {vehicle.damage && (
            <div className="flex items-center gap-1">
              <Wrench className="w-4 h-4" />
              {vehicle.damage}
            </div>
          )}
          {vehicle.mileage && (
            <div className="flex items-center gap-1">
              <Gauge className="w-4 h-4" />
              {vehicle.mileage.toLocaleString()} mi
            </div>
          )}
          <div className="flex items-center gap-1">
            <TrendingUp className="w-4 h-4" />
            {Math.round(market.confidence * 100)}% впевненість
          </div>
        </div>
      </div>

      {/* Price Section */}
      <div className="p-6 border-t border-gray-800">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Market Price */}
          <div className="text-center p-4 bg-gray-800/30 rounded-xl">
            <p className="text-gray-400 text-sm mb-1">Ринкова ціна</p>
            <p className="text-3xl font-bold text-white">
              {formatPrice(market.estimatedPrice)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {formatPrice(market.priceRange.min)} — {formatPrice(market.priceRange.max)}
            </p>
          </div>

          {/* Recommended Bid */}
          <div className="text-center p-4 bg-green-500/10 rounded-xl border border-green-500/30">
            <p className="text-green-400 text-sm mb-1">Рекомендована ставка</p>
            <p className="text-3xl font-bold text-green-400">
              {formatPrice(bid.safeBid)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Макс: {formatPrice(bid.maxBid)}
            </p>
          </div>

          {/* Final Price */}
          <div className="text-center p-4 bg-blue-500/10 rounded-xl border border-blue-500/30">
            <p className="text-blue-400 text-sm mb-1">Фінальна ціна (під ключ)</p>
            <p className="text-3xl font-bold text-blue-400">
              {formatPrice(bid.finalPrice)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Маржа: {formatPrice(bid.platformMargin)}
            </p>
          </div>
        </div>

        {/* Break-even warning */}
        <div className="mt-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Break-even:</span> {formatPrice(bid.breakEvenBid)} — 
            вище цієї ціни угода невигідна
          </p>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="p-6 border-t border-gray-800">
        <h3 className="text-lg font-semibold text-white mb-4">Розбивка витрат</h3>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-gray-400 mb-1">Auction Fee</p>
            <p className="text-white font-semibold">{formatPrice(costs.auctionFee)}</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-gray-400 mb-1">Доставка</p>
            <p className="text-white font-semibold">{formatPrice(costs.delivery.total)}</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-gray-400 mb-1">Митниця</p>
            <p className="text-white font-semibold">{formatPrice(costs.customs.total)}</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-gray-400 mb-1">Ремонт (орієнт.)</p>
            <p className="text-white font-semibold">{formatPrice(costs.repair.estimated)}</p>
          </div>
        </div>

        <div className="mt-4 p-4 bg-gray-800/50 rounded-lg flex justify-between items-center">
          <span className="text-gray-300">Всього витрат (без ставки)</span>
          <span className="text-xl font-bold text-white">{formatPrice(bid.costsWithoutBid)}</span>
        </div>
      </div>

      {/* Manager Advice (if available) */}
      {managerAdvice && (
        <div className="p-6 border-t border-gray-800 bg-gradient-to-r from-purple-900/20 to-blue-900/20">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${
              managerAdvice.urgency === 'high' ? 'bg-green-500/20' :
              managerAdvice.urgency === 'medium' ? 'bg-yellow-500/20' : 'bg-gray-500/20'
            }`}>
              <TrendingUp className={`w-6 h-6 ${
                managerAdvice.urgency === 'high' ? 'text-green-400' :
                managerAdvice.urgency === 'medium' ? 'text-yellow-400' : 'text-gray-400'
              }`} />
            </div>
            <div>
              <p className="text-white font-semibold mb-1">
                Рекомендація: {managerAdvice.action}
              </p>
              <p className="text-gray-300 text-sm">
                {managerAdvice.script}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CTA Buttons */}
      <div className="p-6 border-t border-gray-800 bg-gray-900/50">
        {leadCreated ? (
          <div className="text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
            <p className="text-green-400 font-semibold">Заявку створено!</p>
            <p className="text-gray-400 text-sm">Очікуйте дзвінок менеджера</p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={onBuy}
              data-testid="buy-vehicle-btn"
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 ${
                variant === 'B' 
                  ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500' 
                  : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500'
              } text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02]`}
            >
              <ShoppingCart className="w-5 h-5" />
              {ctaCopy?.button || 'Купити це авто'}
            </button>
            
            <button
              onClick={onContact}
              data-testid="contact-manager-btn"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-all"
            >
              <Phone className="w-5 h-5" />
              Зв'язатися з менеджером
            </button>
            
            <button
              onClick={onSave}
              data-testid="save-vehicle-btn"
              className="flex items-center justify-center gap-2 px-6 py-4 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl transition-all border border-gray-700"
            >
              <Star className="w-5 h-5" />
            </button>
          </div>
        )}
        
        {ctaCopy?.subtext && !leadCreated && (
          <p className="text-center text-gray-400 text-sm mt-3">
            {ctaCopy.subtext}
          </p>
        )}
      </div>

      {/* Confidence & Sources */}
      <div className="px-6 py-3 border-t border-gray-800 bg-gray-900/30 flex justify-between items-center text-sm text-gray-500">
        <span>
          Джерела: {vehicle.sources.length} • Впевненість: {Math.round(vehicle.confidence * 100)}%
        </span>
        <span>
          Розраховано за {data.duration}ms
        </span>
      </div>
    </div>
  );
}
