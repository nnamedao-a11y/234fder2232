/**
 * Parser Test Lab Page
 * 
 * /admin/parser-mesh/test
 * 
 * Позволяет админу:
 * - Тестировать VIN через все источники
 * - Видеть какие источники сработали
 * - Видеть что вернули
 * - Видеть merged result
 * - Видеть confidence
 */

import React, { useState } from 'react';
import { useLang } from '../i18n';
import { 
  MagnifyingGlass, 
  CheckCircle, 
  XCircle, 
  Warning,
  Clock,
  CaretDown,
  CaretUp,
  ArrowsClockwise,
  Database,
  Globe,
  ChartBar,
  Shield,
  CurrencyDollar,
  MapPin,
  Calendar,
  Gauge,
  Car,
  Images as ImagesIcon,
  Check,
  X
} from '@phosphor-icons/react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Status badge component
const StatusBadge = ({ status }) => {
  const colors = {
    ACTIVE_AUCTION: 'bg-green-100 text-green-800 border-green-200',
    AUCTION_FINISHED: 'bg-blue-100 text-blue-800 border-blue-200',
    HISTORICAL_RECORD: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    NOT_FOUND: 'bg-red-100 text-red-800 border-red-200',
  };
  
  const labels = {
    ACTIVE_AUCTION: 'Активний аукціон',
    AUCTION_FINISHED: 'Аукціон завершено',
    HISTORICAL_RECORD: 'Історичний запис',
    NOT_FOUND: 'Не знайдено',
  };
  
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${colors[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  );
};

// Deal status badge
const DealBadge = ({ status }) => {
  const colors = {
    EXCELLENT_DEAL: 'bg-green-500 text-white',
    GOOD_DEAL: 'bg-green-400 text-white',
    FAIR_DEAL: 'bg-yellow-400 text-black',
    RISKY_DEAL: 'bg-orange-400 text-white',
    OVERPRICED: 'bg-red-500 text-white',
    UNKNOWN: 'bg-gray-400 text-white',
  };
  
  const labels = {
    EXCELLENT_DEAL: 'Відмінна угода',
    GOOD_DEAL: 'Хороша угода',
    FAIR_DEAL: 'Нормальна угода',
    RISKY_DEAL: 'Ризикована',
    OVERPRICED: 'Завищена ціна',
    UNKNOWN: 'Невідомо',
  };
  
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-400'}`}>
      {labels[status] || status}
    </span>
  );
};

// Confidence bar
const ConfidenceBar = ({ value }) => {
  const percent = Math.round(value * 100);
  const color = percent >= 70 ? 'bg-green-500' : percent >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm font-medium w-12">{percent}%</span>
    </div>
  );
};

// Source breakdown item
const SourceItem = ({ source, expanded, onToggle }) => {
  const statusIcon = source.status === 'success' 
    ? <CheckCircle size={20} className="text-green-500" weight="fill" />
    : source.status === 'empty'
    ? <Warning size={20} className="text-yellow-500" weight="fill" />
    : <XCircle size={20} className="text-red-500" weight="fill" />;
  
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {statusIcon}
          <span className="font-medium">{source.source}</span>
          {source.fieldsProvided?.length > 0 && (
            <span className="text-xs text-gray-500">
              ({source.fieldsProvided.length} полів)
            </span>
          )}
        </div>
        {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
      </button>
      
      {expanded && source.fieldsProvided?.length > 0 && (
        <div className="px-3 pb-3 pt-0">
          <div className="flex flex-wrap gap-2">
            {source.fieldsProvided.map(field => (
              <span 
                key={field}
                className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded"
              >
                {field}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Field confidence item
const FieldConfidenceItem = ({ field }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-700">{field.field}</span>
      <span className="text-xs text-gray-400">({field.source})</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 max-w-[200px] truncate">
        {typeof field.value === 'object' ? JSON.stringify(field.value) : field.value}
      </span>
      <ConfidenceBar value={field.confidence} />
    </div>
  </div>
);

const ParserTestLab = () => {
  const { t } = useLang();
  const [vin, setVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [expandedSources, setExpandedSources] = useState({});

  const handleSearch = async () => {
    if (!vin || vin.length < 11) {
      setError('VIN має бути не менше 11 символів');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await axios.get(`${API_URL}/api/vin-resolver/${vin.toUpperCase()}/test`);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Помилка пошуку');
    } finally {
      setLoading(false);
    }
  };

  const toggleSource = (source) => {
    setExpandedSources(prev => ({
      ...prev,
      [source]: !prev[source]
    }));
  };

  const r = result?.result;
  const v = r?.vehicle;
  const p = r?.pricing;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Database size={28} />
            Parser Test Lab
          </h1>
          <p className="text-gray-600 mt-1">
            Тестування VIN через всі джерела parsing mesh
          </p>
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <MagnifyingGlass 
                size={20} 
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" 
              />
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Введіть VIN код (17 символів)"
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-lg"
                maxLength={17}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <ArrowsClockwise size={20} className="animate-spin" />
              ) : (
                <MagnifyingGlass size={20} />
              )}
              Тестувати
            </button>
          </div>
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {r && (
          <div className="space-y-6">
            {/* Status Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="text-sm text-gray-500 mb-1">VIN</div>
                  <div className="font-mono text-xl font-bold">{r.vin}</div>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={r.status} />
                  {p?.dealStatus && <DealBadge status={p.dealStatus} />}
                </div>
              </div>
              
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-xs text-gray-500 mb-1">Впевненість</div>
                  <ConfidenceBar value={r.confidence} />
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-xs text-gray-500 mb-1">Джерел</div>
                  <div className="text-xl font-bold">{r.sourcesUsed?.length || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-xs text-gray-500 mb-1">Час пошуку</div>
                  <div className="text-xl font-bold">{r.searchDurationMs}ms</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="text-xs text-gray-500 mb-1">Статус</div>
                  <div className="text-sm font-medium">{r.message}</div>
                </div>
              </div>
            </div>

            {/* Vehicle Data */}
            {v && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Car size={24} />
                  Дані автомобіля
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {v.title && (
                    <div className="col-span-full p-4 bg-blue-50 rounded-xl">
                      <div className="text-xs text-blue-600 mb-1">Назва</div>
                      <div className="text-lg font-semibold">{v.title}</div>
                    </div>
                  )}
                  
                  {v.year && (
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-500 mb-1">Рік</div>
                      <div className="font-semibold">{v.year}</div>
                    </div>
                  )}
                  
                  {v.make && (
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-500 mb-1">Марка</div>
                      <div className="font-semibold">{v.make}</div>
                    </div>
                  )}
                  
                  {v.model && (
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-500 mb-1">Модель</div>
                      <div className="font-semibold">{v.model}</div>
                    </div>
                  )}
                  
                  {v.mileage && (
                    <div className="p-4 bg-gray-50 rounded-xl flex items-center gap-2">
                      <Gauge size={20} className="text-gray-400" />
                      <div>
                        <div className="text-xs text-gray-500">Пробіг</div>
                        <div className="font-semibold">{v.mileage?.toLocaleString()} mi</div>
                      </div>
                    </div>
                  )}
                  
                  {v.location && (
                    <div className="p-4 bg-gray-50 rounded-xl flex items-center gap-2">
                      <MapPin size={20} className="text-gray-400" />
                      <div>
                        <div className="text-xs text-gray-500">Локація</div>
                        <div className="font-semibold">{v.location}</div>
                      </div>
                    </div>
                  )}
                  
                  {v.saleDate && (
                    <div className="p-4 bg-gray-50 rounded-xl flex items-center gap-2">
                      <Calendar size={20} className="text-gray-400" />
                      <div>
                        <div className="text-xs text-gray-500">Дата аукціону</div>
                        <div className="font-semibold">
                          {new Date(v.saleDate).toLocaleDateString('uk-UA')}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {v.damageType && (
                    <div className="p-4 bg-orange-50 rounded-xl">
                      <div className="text-xs text-orange-600 mb-1">Пошкодження</div>
                      <div className="font-semibold text-orange-800">{v.damageType}</div>
                    </div>
                  )}
                  
                  {v.lotNumber && (
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-500 mb-1">Лот #</div>
                      <div className="font-mono font-semibold">{v.lotNumber}</div>
                    </div>
                  )}
                  
                  {v.source && (
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-500 mb-1">Джерело</div>
                      <div className="font-semibold">{v.source}</div>
                    </div>
                  )}
                </div>

                {/* Images */}
                {v.images?.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm text-gray-500 mb-3 flex items-center gap-2">
                      <ImagesIcon size={16} />
                      Фото ({v.images.length})
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {v.images.slice(0, 5).map((img, i) => (
                        <img 
                          key={i}
                          src={img} 
                          alt={`Photo ${i + 1}`}
                          className="h-24 w-32 object-cover rounded-lg flex-shrink-0"
                          onError={(e) => e.target.style.display = 'none'}
                        />
                      ))}
                      {v.images.length > 5 && (
                        <div className="h-24 w-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 flex-shrink-0">
                          +{v.images.length - 5}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pricing */}
            {p && (p.marketPrice || p.auctionPrice) && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <CurrencyDollar size={24} />
                  Ціноутворення
                </h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {p.auctionPrice && (
                    <div className="p-4 bg-blue-50 rounded-xl">
                      <div className="text-xs text-blue-600 mb-1">Поточна ставка</div>
                      <div className="text-xl font-bold text-blue-700">
                        ${p.auctionPrice?.toLocaleString()}
                      </div>
                    </div>
                  )}
                  
                  {p.marketPrice && (
                    <div className="p-4 bg-green-50 rounded-xl">
                      <div className="text-xs text-green-600 mb-1">Ринкова ціна</div>
                      <div className="text-xl font-bold text-green-700">
                        ${p.marketPrice?.toLocaleString()}
                      </div>
                    </div>
                  )}
                  
                  {p.recommendedMaxBid && (
                    <div className="p-4 bg-purple-50 rounded-xl">
                      <div className="text-xs text-purple-600 mb-1">Рекомендована ставка</div>
                      <div className="text-xl font-bold text-purple-700">
                        ${p.recommendedMaxBid?.toLocaleString()}
                      </div>
                    </div>
                  )}
                  
                  {p.finalAllInPrice && (
                    <div className="p-4 bg-gray-900 rounded-xl">
                      <div className="text-xs text-gray-400 mb-1">Фінальна ціна All-In</div>
                      <div className="text-xl font-bold text-white">
                        ${p.finalAllInPrice?.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cost breakdown */}
                <div className="mt-4 p-4 bg-gray-50 rounded-xl">
                  <div className="text-sm text-gray-500 mb-2">Розбивка витрат</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {p.deliveryCost && (
                      <div>
                        <span className="text-gray-500">Доставка:</span>{' '}
                        <span className="font-medium">${p.deliveryCost?.toLocaleString()}</span>
                      </div>
                    )}
                    {p.customsCost && (
                      <div>
                        <span className="text-gray-500">Митниця:</span>{' '}
                        <span className="font-medium">${p.customsCost?.toLocaleString()}</span>
                      </div>
                    )}
                    {p.repairEstimate && (
                      <div>
                        <span className="text-gray-500">Ремонт:</span>{' '}
                        <span className="font-medium">${p.repairEstimate?.toLocaleString()}</span>
                      </div>
                    )}
                    {p.platformMargin && (
                      <div>
                        <span className="text-gray-500">Маржа:</span>{' '}
                        <span className="font-medium">${p.platformMargin?.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="mt-4">
                  <div className="text-xs text-gray-500 mb-1">Впевненість в ціні</div>
                  <ConfidenceBar value={p.priceConfidence || 0} />
                </div>
              </div>
            )}

            {/* Source Breakdown */}
            {r.sourceBreakdown?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Globe size={24} />
                  Джерела ({r.sourceBreakdown.length})
                </h2>
                
                <div className="space-y-2">
                  {r.sourceBreakdown.map((source, i) => (
                    <SourceItem 
                      key={i}
                      source={source}
                      expanded={expandedSources[source.source]}
                      onToggle={() => toggleSource(source.source)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Field Confidence */}
            {r.fieldConfidence?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ChartBar size={24} />
                  Впевненість по полях
                </h2>
                
                <div className="space-y-1">
                  {r.fieldConfidence.map((field, i) => (
                    <FieldConfidenceItem key={i} field={field} />
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON (collapsible) */}
            <details className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <summary className="p-6 cursor-pointer hover:bg-gray-50 font-semibold">
                Raw JSON Response
              </summary>
              <div className="p-6 pt-0">
                <pre className="bg-gray-900 text-green-400 p-4 rounded-xl overflow-x-auto text-xs">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <Database size={64} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              Введіть VIN для тестування
            </h2>
            <p className="text-gray-500">
              Система перевірить всі джерела parsing mesh і покаже детальний результат
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParserTestLab;
