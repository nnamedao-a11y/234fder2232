/**
 * Manager view for Shipment Journey controls:
 *   • bind vessel (mmsi/imo/name) to active stage
 *   • advance to next stage / activate specific stage
 *   • force tick
 *   • replace stages wholesale
 *   • see current journey + recent events
 */

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  MagnifyingGlass,
  ArrowsClockwise,
  SkipForward,
  Plus,
  CheckCircle,
  Anchor,
  Truck,
  Package,
  Lightning,
} from '@phosphor-icons/react';
import JourneyPanel from '../../components/shipping/JourneyPanel';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const STAGE_TYPE_LABEL = { land: 'Наземний', vessel: 'Морський', port: 'Порт' };

function EmptyState({ text }) {
  return (
    <div className="text-center py-10 text-sm text-zinc-500">{text}</div>
  );
}

export default function ShipmentJourneyManager() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [journey, setJourney] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadShipments = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/shipments`);
      // the backend returns {success, data:[...]} in some routes and [...] in others
      const arr = Array.isArray(data) ? data : (data?.data || data?.shipments || []);
      setList(arr);
    } catch (e) {
      toast.error('Не вдалося завантажити список відправлень');
    }
  }, []);

  const loadJourney = useCallback(async (id) => {
    if (!id) { setJourney(null); return; }
    try {
      const { data } = await axios.get(`${API_URL}/api/shipments/${id}/journey`);
      if (data?.ok && data.shipment) setJourney(data.shipment);
    } catch (e) {
      toast.error('Не вдалося завантажити journey');
    }
  }, []);

  useEffect(() => { loadShipments(); }, [loadShipments]);
  useEffect(() => { if (selectedId) loadJourney(selectedId); }, [selectedId, loadJourney, refreshKey]);

  const filtered = list.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(s.id || '').toLowerCase().includes(q) ||
      String(s.vin || '').toLowerCase().includes(q) ||
      String(s.vehicleTitle || '').toLowerCase().includes(q) ||
      String(s.containerNumber || '').toLowerCase().includes(q)
    );
  });

  const currentStage = (journey?.stages || []).find((s) => s.id === journey?.currentStageId) || null;

  const bump = () => setRefreshKey((k) => k + 1);

  const onAdvance = async () => {
    if (!journey) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/shipments/${journey.id}/stages/advance`);
      if (data?.ok) { toast.success('Перехід на наступний етап'); bump(); }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Помилка переходу');
    }
  };

  const onActivate = async (stageId) => {
    if (!journey) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/shipments/${journey.id}/stages/${stageId}/activate`);
      if (data?.ok) { toast.success('Етап активовано'); bump(); }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Помилка активації');
    }
  };

  const onForceTick = async () => {
    if (!journey) return;
    try {
      await axios.post(`${API_URL}/api/shipments/${journey.id}/tick`);
      toast.success('Tick запущено');
      bump();
    } catch (e) {
      toast.error('Не вдалося запустити tick');
    }
  };

  const onBindVessel = async (stageId, form) => {
    if (!journey) return;
    if (!form.name && !form.mmsi && !form.imo) {
      toast.error('Вкажіть принаймні одне поле: name / mmsi / imo');
      return;
    }
    try {
      const { data } = await axios.put(`${API_URL}/api/shipments/${journey.id}/stages/${stageId}`, {
        vessel: {
          name: form.name || null,
          mmsi: form.mmsi || null,
          imo: form.imo || null,
        },
      });
      if (data?.ok) { toast.success('Судно прив’язано'); bump(); }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Помилка');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="shipment-journey-manager">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Управління маршрутами доставки</h1>
        <p className="text-zinc-500 text-sm mt-1">Етапи, судна, позиція та ручні перемикання</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* List */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-2xl border border-zinc-200 p-4 sticky top-4">
            <div className="flex items-center gap-2 mb-3">
              <MagnifyingGlass size={16} className="text-zinc-400" />
              <input
                data-testid="sjm-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук: VIN, ID, контейнер..."
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <button
                onClick={loadShipments}
                className="p-1 text-zinc-500 hover:text-zinc-800"
                title="Оновити"
                data-testid="sjm-refresh-list"
              >
                <ArrowsClockwise size={14} />
              </button>
            </div>
            <div className="space-y-1 max-h-[75vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <EmptyState text="Немає відправлень" />
              ) : filtered.map((s) => (
                <button
                  key={s.id}
                  data-testid={`sjm-item-${s.id}`}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                    selectedId === s.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-zinc-200 hover:border-zinc-300 bg-white'
                  }`}
                >
                  <div className="font-medium text-zinc-900 truncate">{s.vehicleTitle || s.vin || s.id}</div>
                  <div className="text-xs text-zinc-500 truncate">{s.id}</div>
                  {s.trackingSource && (
                    <div className="text-[10px] text-zinc-400 mt-1">src: {s.trackingSource}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-8 space-y-4">
          {!selectedId && (
            <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center text-zinc-500">
              Виберіть відправлення зліва
            </div>
          )}
          {selectedId && journey && (
            <>
              {/* Controls bar */}
              <div className="flex flex-wrap items-center gap-2 bg-white rounded-2xl border border-zinc-200 p-3" data-testid="sjm-controls">
                <button
                  onClick={onAdvance}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  data-testid="sjm-advance"
                >
                  <SkipForward size={16} /> Наступний етап
                </button>
                <button
                  onClick={onForceTick}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700"
                  data-testid="sjm-tick"
                >
                  <Lightning size={16} /> Force tick
                </button>
                <button
                  onClick={bump}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-sm text-zinc-700 hover:bg-zinc-50"
                  data-testid="sjm-reload"
                >
                  <ArrowsClockwise size={16} /> Оновити
                </button>
                {currentStage && (
                  <div className="ml-auto text-sm text-zinc-600">
                    <span className="text-zinc-400">Поточний етап: </span>
                    <span className="font-medium">{STAGE_TYPE_LABEL[currentStage.type] || currentStage.type}</span>
                    <span className="text-zinc-400"> — </span>
                    <span>{currentStage.label}</span>
                  </div>
                )}
              </div>

              {/* Vessel binder (only if current stage is vessel) */}
              {currentStage?.type === 'vessel' && (
                <VesselBindCard
                  stage={currentStage}
                  onSubmit={(form) => onBindVessel(currentStage.id, form)}
                />
              )}

              {/* Stage quick-activate pills */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                <div className="text-sm font-medium text-zinc-900 mb-2">Перейти до етапу</div>
                <div className="flex flex-wrap gap-2">
                  {(journey.stages || []).map((s) => {
                    const active = s.id === journey.currentStageId;
                    const Icon = s.type === 'vessel' ? Anchor : (s.type === 'land' ? Truck : Package);
                    return (
                      <button
                        key={s.id}
                        onClick={() => !active && onActivate(s.id)}
                        disabled={active}
                        data-testid={`sjm-activate-${s.id}`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
                          active
                            ? 'bg-blue-50 border-blue-300 text-blue-700 cursor-not-allowed'
                            : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                        }`}
                      >
                        <Icon size={14} />
                        {s.label || s.type}
                        {s.status === 'done' && <CheckCircle size={12} className="text-emerald-500" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Visual journey */}
              <JourneyPanel shipmentId={selectedId} initialJourney={journey} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VesselBindCard({ stage, onSubmit }) {
  const [form, setForm] = useState({
    name: stage?.vessel?.name || '',
    mmsi: stage?.vessel?.mmsi || '',
    imo: stage?.vessel?.imo || '',
  });
  useEffect(() => {
    setForm({
      name: stage?.vessel?.name || '',
      mmsi: stage?.vessel?.mmsi || '',
      imo: stage?.vessel?.imo || '',
    });
  }, [stage?.id, stage?.vessel?.name, stage?.vessel?.mmsi, stage?.vessel?.imo]);
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-4" data-testid="sjm-vessel-bind">
      <div className="flex items-center gap-2 mb-3">
        <Anchor size={18} className="text-blue-600" />
        <h3 className="font-semibold text-zinc-900">Прив’язати судно до поточного етапу</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          data-testid="sjm-vessel-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Name (наприклад MSC OSCAR)"
          className="px-3 py-2 rounded-lg border border-zinc-200 text-sm"
        />
        <input
          data-testid="sjm-vessel-mmsi"
          value={form.mmsi}
          onChange={(e) => setForm((f) => ({ ...f, mmsi: e.target.value }))}
          placeholder="MMSI"
          className="px-3 py-2 rounded-lg border border-zinc-200 text-sm"
        />
        <input
          data-testid="sjm-vessel-imo"
          value={form.imo}
          onChange={(e) => setForm((f) => ({ ...f, imo: e.target.value }))}
          placeholder="IMO"
          className="px-3 py-2 rounded-lg border border-zinc-200 text-sm"
        />
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={() => onSubmit(form)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          data-testid="sjm-vessel-submit"
        >
          <Plus size={14} /> Зберегти
        </button>
      </div>
    </div>
  );
}
