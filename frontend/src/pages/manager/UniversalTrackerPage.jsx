/**
 * UniversalTrackerPage — Manager VIN / Container / IMO tracker
 *
 * /manager/tracking
 *
 * Workflow:
 *   1. Manager types VIN, container number, IMO or lot
 *   2. Backend searches internal DB + external APIs (ShipsGo, VesselFinder)
 *   3. Live position + map rendered instantly
 *   4. Manager can attach IMO to any shipment to enable live tracking
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../../App';
import { toast } from 'sonner';
import {
  MagnifyingGlass,
  Truck,
  Anchor,
  Package,
  CircleNotch,
  CheckCircle,
  XCircle,
  Link as LinkIcon,
  Broadcast,
  CircleNotch as Spinner,
  ArrowClockwise,
  Globe,
  WarningCircle,
} from '@phosphor-icons/react';
import ShipmentTrackingMap from '../../components/shipping/ShipmentTrackingMap';

const EXAMPLES = [
  { label: 'VIN', value: 'WBAJA7C52KWW12345' },
  { label: 'Container', value: 'MSCU7894512' },
  { label: 'IMO', value: '9629344' },
];

const PROVIDER_META = {
  vesselfinder: {
    title: 'VesselFinder',
    description: 'Координати судна в реальному часі за IMO',
  },
  shipsgo: {
    title: 'ShipsGo',
    description: 'Контейнер → IMO / ETA / порти',
  },
  aftership: {
    title: 'AfterShip',
    description: 'Універсальний fallback-трекер посилок',
  },
};

const UniversalTrackerPage = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [providers, setProviders] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configKeys, setConfigKeys] = useState({
    vesselfinder: '',
    shipsgo: '',
    aftership: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const inputRef = useRef(null);

  const loadProviders = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/manager/tracking/providers`);
      setProviders(res.data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadProviders();
    inputRef.current?.focus();
  }, [loadProviders]);

  const handleSearch = async (e) => {
    e?.preventDefault?.();
    if (!query.trim()) {
      toast.error('Введіть VIN, контейнер або IMO');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.post(`${API_URL}/api/manager/tracking/quick-track`, {
        query: query.trim(),
      });
      setResult(res.data);
      if (!res.data.success) {
        toast.info('Нічого не знайдено — перевірте номер або налаштуйте провайдерів');
      }
    } catch (err) {
      toast.error('Помилка трекінгу');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAttach = async (shipmentId, imo, vesselName) => {
    if (!shipmentId || !imo) return;
    try {
      await axios.post(`${API_URL}/api/manager/tracking/attach`, {
        shipmentId,
        imo,
        vesselName,
      });
      toast.success(`IMO ${imo} прив'язано до відправлення`);
      handleSearch();
    } catch (e) {
      toast.error('Не вдалося прив’язати судно');
    }
  };

  const saveProviders = async () => {
    setSavingConfig(true);
    try {
      await axios.post(`${API_URL}/api/admin/tracking/providers/configure`, configKeys);
      toast.success('Ключі збережено');
      setShowConfig(false);
      await loadProviders();
    } catch (e) {
      toast.error('Помилка збереження');
    } finally {
      setSavingConfig(false);
    }
  };

  const classificationLabel = (cls) =>
    ({
      vin: 'VIN',
      container: 'Номер контейнера',
      imo: 'IMO судна',
      lot: 'Лот аукціону',
      generic: 'Загальний запит',
      number: 'Число',
      empty: '—',
    }[cls] || cls);

  const shipment = result?.internal?.shipments?.[0];
  const vesselPosition = result?.vesselPosition;

  const liveShipment = shipment
    ? {
        ...shipment,
        currentPosition: vesselPosition
          ? {
              lat: vesselPosition.lat,
              lng: vesselPosition.lng,
              source: vesselPosition.source || 'real',
            }
          : shipment.currentPosition,
        liveEta: shipment.liveEta || shipment.eta || shipment.estimatedArrivalDate,
        trackingSource: vesselPosition ? 'real' : shipment.trackingSource,
      }
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="manager-tracker-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#18181B] flex items-center gap-2">
          <MagnifyingGlass size={26} weight="bold" /> Універсальний трекер
        </h1>
        <p className="text-sm text-[#71717A] mt-1">
          Пошук будь-якого VIN, контейнера, IMO — з інтеграцією VesselFinder, ShipsGo, AfterShip
        </p>
      </div>

      {/* Providers status */}
      {providers && (
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#18181B] flex items-center gap-2">
              <Globe size={18} /> Провайдери трекінгу
            </h2>
            <button
              onClick={() => setShowConfig((v) => !v)}
              className="text-sm px-3 py-1.5 rounded-lg bg-[#F4F4F5] hover:bg-[#E4E4E7] text-[#18181B]"
            >
              {showConfig ? 'Сховати' : 'Налаштувати ключі'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(providers.providers || {}).map(([key, p]) => {
              const meta = PROVIDER_META[key] || {};
              const ok = p.configured;
              return (
                <div
                  key={key}
                  className={`rounded-xl p-4 border ${
                    ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-[#18181B]">
                      {meta.title || p.name}
                    </span>
                    {ok ? (
                      <CheckCircle size={18} weight="fill" className="text-emerald-600" />
                    ) : (
                      <WarningCircle size={18} weight="fill" className="text-amber-600" />
                    )}
                  </div>
                  <p className="text-xs text-[#71717A] mt-1">{meta.description || p.purpose}</p>
                  <p className="text-[10px] font-mono text-[#A1A1AA] mt-2">
                    env: {p.envVar}
                  </p>
                  {!ok && (
                    <a
                      href={p.signUpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 hover:underline mt-1 inline-block"
                    >
                      Отримати API ключ →
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {showConfig && (
            <div className="mt-4 pt-4 border-t border-[#E4E4E7] space-y-3">
              {['vesselfinder', 'shipsgo', 'aftership'].map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <label className="w-32 text-sm font-medium text-[#18181B] capitalize">
                    {PROVIDER_META[k]?.title || k}
                  </label>
                  <input
                    type="password"
                    placeholder={`${k} API key`}
                    value={configKeys[k]}
                    onChange={(e) =>
                      setConfigKeys((prev) => ({ ...prev, [k]: e.target.value }))
                    }
                    className="flex-1 px-3 py-2 rounded-lg border border-[#E4E4E7] text-sm font-mono"
                  />
                </div>
              ))}
              <button
                onClick={saveProviders}
                disabled={savingConfig}
                className="w-full mt-2 py-2.5 rounded-lg bg-[#18181B] text-white text-sm font-semibold hover:bg-[#27272A] disabled:opacity-50"
              >
                {savingConfig ? 'Зберігаю…' : 'Зберегти ключі'}
              </button>
              <p className="text-xs text-[#71717A]">
                Ключі зберігаються в БД + оновлюються в пам'яті. Для перманентного збереження — додайте
                у <code>/app/backend/.env</code>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <form
        onSubmit={handleSearch}
        className="bg-white border border-[#E4E4E7] rounded-2xl p-5"
      >
        <label className="block text-sm font-semibold text-[#18181B] mb-2">
          Пошук трекінгу
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <MagnifyingGlass
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="VIN / Container / IMO / Lot..."
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-[#E4E4E7] text-sm font-mono focus:outline-none focus:border-[#18181B]"
              data-testid="tracker-input"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 rounded-xl bg-[#18181B] text-white font-semibold hover:bg-[#27272A] disabled:opacity-50 flex items-center gap-2"
            data-testid="tracker-submit"
          >
            {loading ? <Spinner size={18} className="animate-spin" /> : <MagnifyingGlass size={18} />}
            Шукати
          </button>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="text-xs text-[#71717A]">Швидкі приклади:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.value}
              type="button"
              onClick={() => {
                setQuery(ex.value);
              }}
              className="text-xs px-2 py-1 rounded-lg bg-[#F4F4F5] hover:bg-[#E4E4E7] font-mono"
            >
              {ex.label}: {ex.value}
            </button>
          ))}
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-10 flex justify-center">
          <Spinner size={32} className="animate-spin text-[#71717A]" />
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4">
          {/* Classification */}
          <div className="bg-white border border-[#E4E4E7] rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-[#F4F4F5] rounded-xl flex items-center justify-center">
              <Package size={20} className="text-[#18181B]" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-[#71717A]">Розпізнано як</div>
              <div className="font-semibold text-[#18181B]">
                {classificationLabel(result.classification)}{' '}
                <span className="font-mono text-[#71717A]">“{result.query}”</span>
              </div>
            </div>
            {result.success ? (
              <CheckCircle size={22} weight="fill" className="text-emerald-500" />
            ) : (
              <XCircle size={22} weight="fill" className="text-red-500" />
            )}
          </div>

          {/* Internal matches — Shipments */}
          {result.internal?.shipments?.length > 0 && (
            <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
              <h3 className="font-semibold text-[#18181B] mb-3 flex items-center gap-2">
                <Truck size={18} /> Знайдено у CRM — Відправлення
              </h3>
              <div className="space-y-2">
                {result.internal.shipments.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl bg-[#FAFAFA] border border-[#E4E4E7]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#18181B]">
                          {s.vehicleTitle || `Shipment ${s.id?.slice(-6)}`}
                        </div>
                        <div className="text-xs text-[#71717A] font-mono mt-0.5">
                          VIN: {s.vin || '—'} · Container: {s.containerNumber || '—'}
                        </div>
                        <div className="text-xs text-[#71717A] mt-1">
                          {s.originPort} → {s.destinationPort}
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {s.status || 'pending'}
                      </span>
                    </div>

                    {s.vessel?.imo ? (
                      <div className="text-xs mt-2 flex items-center gap-2 text-emerald-600">
                        <Broadcast size={14} /> IMO {s.vessel.imo} · {s.vessel.name}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          const imo = prompt('Введіть IMO судна для прив\'язки:');
                          if (imo) handleAttach(s.id, imo.trim(), null);
                        }}
                        className="text-xs mt-2 text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <LinkIcon size={12} /> Прив’язати судно
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Internal matches — Vehicles / Deals */}
          {(result.internal?.vehicles?.length > 0 || result.internal?.deals?.length > 0) && (
            <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5 space-y-3">
              {result.internal.vehicles.length > 0 && (
                <>
                  <h3 className="font-semibold text-[#18181B]">Автомобілі</h3>
                  <div className="space-y-1">
                    {result.internal.vehicles.map((v) => (
                      <div key={v.id || v.vin} className="text-sm font-mono text-[#71717A]">
                        {v.vin} — {v.make} {v.model} {v.year}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {result.internal.deals.length > 0 && (
                <>
                  <h3 className="font-semibold text-[#18181B]">Угоди</h3>
                  <div className="space-y-1">
                    {result.internal.deals.map((d) => (
                      <div key={d.id} className="text-sm text-[#71717A]">
                        {d.title || d.vehicleTitle} — ${(d.clientPrice || 0).toLocaleString()} · {d.status}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* External API result */}
          {result.external && (
            <div className="bg-white border border-blue-200 rounded-2xl p-5 bg-blue-50/30">
              <h3 className="font-semibold text-[#18181B] flex items-center gap-2 mb-2">
                <Globe size={18} /> Зовнішній трекер — {result.external.source}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {result.external.vesselName && (
                  <div>
                    <div className="text-xs text-[#71717A]">Судно</div>
                    <div className="font-semibold">{result.external.vesselName}</div>
                  </div>
                )}
                {result.external.imo && (
                  <div>
                    <div className="text-xs text-[#71717A]">IMO</div>
                    <div className="font-mono">{result.external.imo}</div>
                  </div>
                )}
                {result.external.origin && (
                  <div>
                    <div className="text-xs text-[#71717A]">Порт відправлення</div>
                    <div>{result.external.origin}</div>
                  </div>
                )}
                {result.external.destination && (
                  <div>
                    <div className="text-xs text-[#71717A]">Порт призначення</div>
                    <div>{result.external.destination}</div>
                  </div>
                )}
                {result.external.eta && (
                  <div>
                    <div className="text-xs text-[#71717A]">ETA</div>
                    <div className="font-semibold text-blue-600">
                      {new Date(result.external.eta).toLocaleDateString('uk-UA')}
                    </div>
                  </div>
                )}
                {result.external.status && (
                  <div>
                    <div className="text-xs text-[#71717A]">Статус</div>
                    <div>{result.external.status}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vessel live position */}
          {vesselPosition && (
            <div className="bg-white border border-emerald-200 rounded-2xl p-5 bg-emerald-50/30">
              <h3 className="font-semibold text-[#18181B] flex items-center gap-2 mb-3">
                <Anchor size={18} /> Поточна позиція судна
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs text-[#71717A]">Координати</div>
                  <div className="font-mono text-xs">
                    {vesselPosition.lat.toFixed(4)}, {vesselPosition.lng.toFixed(4)}
                  </div>
                </div>
                {vesselPosition.speed !== null && vesselPosition.speed !== undefined && (
                  <div>
                    <div className="text-xs text-[#71717A]">Швидкість</div>
                    <div className="font-semibold">{Number(vesselPosition.speed).toFixed(1)} kn</div>
                  </div>
                )}
                {vesselPosition.course !== null && vesselPosition.course !== undefined && (
                  <div>
                    <div className="text-xs text-[#71717A]">Курс</div>
                    <div>{Math.round(Number(vesselPosition.course))}°</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-[#71717A]">Джерело</div>
                  <div className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 inline-block">
                    {vesselPosition.source || 'vesselfinder'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Map if we have a shipment */}
          {liveShipment && liveShipment.route && liveShipment.origin && liveShipment.destination && (
            <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
              <h3 className="font-semibold text-[#18181B] mb-3">Карта маршруту</h3>
              <ShipmentTrackingMap shipment={liveShipment} />
            </div>
          )}

          {/* Nothing found */}
          {!result.success && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <WarningCircle size={28} className="mx-auto text-amber-600 mb-2" />
              <p className="text-sm text-[#18181B] font-semibold">
                Дані не знайдено
              </p>
              <p className="text-xs text-[#71717A] mt-1">
                Перевірте номер VIN/контейнера або налаштуйте API ключі провайдерів вище
              </p>
            </div>
          )}

          <button
            onClick={() => handleSearch()}
            className="w-full py-2 rounded-lg border border-[#E4E4E7] text-sm text-[#71717A] hover:bg-[#FAFAFA] flex items-center justify-center gap-2"
          >
            <ArrowClockwise size={14} /> Оновити
          </button>
        </div>
      )}
    </div>
  );
};

export default UniversalTrackerPage;
