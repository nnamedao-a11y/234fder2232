/**
 * VIN Search Component
 * 
 * Пошук по VIN з результатами:
 * - Дані про авто
 * - Ціни та рекомендації
 * - Deal status
 * - CTA для покупки
 * - A/B Testing support
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Search, Loader2, AlertCircle, Car, CheckCircle } from 'lucide-react';
import VinPriceResult from './VinPriceResult';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// A/B Test variant (persistent per session)
const getVariant = () => {
  let variant = sessionStorage.getItem('ab_variant');
  if (!variant) {
    variant = Math.random() > 0.5 ? 'A' : 'B';
    sessionStorage.setItem('ab_variant', variant);
  }
  return variant;
};

export default function VinSearch({ onLeadCreate }) {
  const [vin, setVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [leadCreated, setLeadCreated] = useState(false);
  
  const variant = useMemo(() => getVariant(), []);

  const searchVin = useCallback(async () => {
    if (!vin || vin.length !== 17) {
      setError('VIN має бути 17 символів');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setLeadCreated(false);

    try {
      const response = await fetch(`${API_URL}/api/vin-price/${vin.toUpperCase()}`);
      
      if (!response.ok) {
        throw new Error('Не вдалося знайти дані по VIN');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message || 'Помилка пошуку');
    } finally {
      setLoading(false);
    }
  }, [vin]);

  const handleBuy = async () => {
    if (!result) return;

    try {
      const response = await fetch(`${API_URL}/api/leads/from-vin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin: result.vin,
          maxBid: result.bid.maxBid,
          finalPrice: result.bid.finalPrice,
          marketPrice: result.market.estimatedPrice,
          dealStatus: result.dealStatus.status,
          vehicle: result.vehicle,
          variant: variant,
        }),
      });

      if (response.ok) {
        const lead = await response.json();
        setLeadCreated(true);
        if (onLeadCreate) {
          onLeadCreate(lead);
        }
      }
    } catch (err) {
      alert('Помилка створення заявки');
    }
  };

  const handleContact = () => {
    window.open('https://t.me/bibi_cars_support', '_blank');
  };

  const handleSave = () => {
    const saved = JSON.parse(localStorage.getItem('savedVins') || '[]');
    saved.push({
      vin: result.vin,
      vehicle: result.vehicle,
      market: result.market,
      savedAt: new Date().toISOString(),
    });
    localStorage.setItem('savedVins', JSON.stringify(saved));
    alert('Збережено!');
  };

  // A/B Variant specific copy
  const ctaCopy = variant === 'B' 
    ? { button: '🔥 Забрати цей варіант', subtext: 'Можемо зайти по ціні прямо зараз' }
    : { button: '🔵 Отримати консультацію', subtext: 'Менеджер перевірить авто і підтвердить вигідність' };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Lead Created Success */}
      {leadCreated && (
        <div className="mb-6 p-6 bg-green-500/10 border border-green-500/50 rounded-2xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-green-400">Заявку створено!</h3>
              <p className="text-green-300">
                Менеджер зв'яжеться з вами протягом 15 хвилин
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search Box */}
      <div className="mb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-xl opacity-30"></div>
          <div className="relative bg-gray-900/90 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Car className="w-7 h-7 text-blue-400" />
              VIN Пошук з розрахунком ціни
            </h2>
            
            <div className="flex gap-3">
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="Введіть 17-значний VIN код..."
                maxLength={17}
                className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-lg tracking-wider"
              />
              
              <button
                onClick={searchVin}
                disabled={loading || vin.length !== 17}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Search className="w-5 h-5" />
                )}
                Шукати
              </button>
            </div>

            <div className="mt-2 flex justify-between items-center">
              <p className="text-gray-500 text-sm">
                {vin.length}/17 символів
              </p>
              {vin.length === 17 && (
                <p className="text-green-400 text-sm flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                  VIN валідний
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-gray-400">Шукаємо дані та розраховуємо ціну...</p>
          <p className="text-gray-500 text-sm mt-1">Це може зайняти до 15 секунд</p>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <VinPriceResult
          data={result}
          onBuy={handleBuy}
          onContact={handleContact}
          onSave={handleSave}
          variant={variant}
          ctaCopy={ctaCopy}
          leadCreated={leadCreated}
        />
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-12 text-gray-500">
          <Car className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p>Введіть VIN код щоб отримати розрахунок ціни</p>
          <p className="text-sm mt-2">
            Приклад: 5YJSA1DN2CFP09123 (Tesla Model S)
          </p>
        </div>
      )}
    </div>
  );
}
