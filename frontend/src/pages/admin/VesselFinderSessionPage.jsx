/**
 * VesselFinder Admin Console — simplified
 *
 * Only what an admin actually needs:
 *  1. Status block (cookies / online / heartbeat / успешные тики)
 *  2. One-click «Установить расширение» + «Sync cookies helper»
 *  3. Единый поиск (имя / MMSI / IMO / VIN / container / lot)
 *  4. Список активных shipments с кнопкой «Tick now» напрямую
 *  5. Bind vessel → shipment (предзаполняется из поиска)
 *
 * Никакого bbox, raw payload диагностики и прочего мусора.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import {
  Anchor,
  ArrowClockwise,
  Boat,
  CheckCircle,
  Download,
  Lightning,
  Link as LinkIcon,
  MagnifyingGlass,
  Power,
  Target,
  XCircle,
  Warning,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// ---------- helpers ----------
const fmtAgo = (iso) => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

function StatusPill({ kind, children }) {
  const cls =
    kind === 'healthy'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : kind === 'degraded'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : kind === 'expired'
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {kind === 'healthy' ? <CheckCircle size={12} weight="fill" /> :
       kind === 'expired' ? <XCircle size={12} weight="fill" /> :
       kind === 'degraded' ? <Warning size={12} weight="fill" /> :
       <Power size={12} weight="fill" />}
      {children}
    </span>
  );
}

function Stat({ label, value, sub, icon: Icon, tone = 'slate' }) {
  const toneCls = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    sky: 'text-sky-600',
  }[tone] || 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        {Icon ? <Icon size={14} /> : null}
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-bold ${toneCls}`}>{value ?? '—'}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500 truncate">{sub}</div> : null}
    </div>
  );
}

// ---------- main ----------
export default function VesselFinderSessionPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // shipments list
  const [shipments, setShipments] = useState([]);
  const [tickingId, setTickingId] = useState(null);
  const [tickResults, setTickResults] = useState({}); // shipmentId -> result

  // unified search
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchData, setSearchData] = useState(null);

  // bind
  const [bindShipmentId, setBindShipmentId] = useState('');
  const [bindVin, setBindVin] = useState('');
  const [bindMmsi, setBindMmsi] = useState('');
  const [bindImo, setBindImo] = useState('');
  const [bindName, setBindName] = useState('');
  const [bindContainer, setBindContainer] = useState('');
  const [bindContainerSeal, setBindContainerSeal] = useState('');
  const [bindForceNew, setBindForceNew] = useState(false);
  const [bindNewStageLabel, setBindNewStageLabel] = useState('');
  const [bindBusy, setBindBusy] = useState(false);
  const [bindResult, setBindResult] = useState(null);

  // vessel history for currently-selected shipment
  const [vesselHistory, setVesselHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // help modal
  const [showHelp, setShowHelp] = useState(false);

  // ---- data loaders ----
  const loadStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/vesselfinder/session/status`);
      setStatus(res.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadShipments = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/shipments`);
      const items = res.data?.items || res.data?.data || [];
      setShipments(items);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadStatus();
    loadShipments();
    const t1 = setInterval(loadStatus, 10000);
    const t2 = setInterval(loadShipments, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadStatus, loadShipments]);

  // ---- actions ----
  const downloadExtension = async () => {
    // The extension ZIP is behind `require_admin`, so we can't use a plain
    // <a href> / window.location — the browser does NOT attach the JWT
    // from localStorage to a top-level navigation. We fetch it via axios
    // with Authorization header and trigger the download from the blob.
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) {
      alert('Потрібно увійти як адміністратор перед завантаженням розширення.');
      return;
    }
    try {
      setBusy(true);
      const r = await axios.get(
        `${API_URL}/api/admin/vesselfinder/extension/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob',
        },
      );
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      // filename comes from Content-Disposition but we set explicit too
      a.download = 'bibi-vesselfinder-extension.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      const msg =
        e.response?.status === 401
          ? 'Авторизація протермінована — увійдіть заново.'
          : e.response?.status === 403
          ? 'У вашої ролі немає прав на завантаження розширення (потрібен admin / owner).'
          : e.response?.data?.detail || e.message || 'Не вдалося завантажити розширення';
      alert(msg);
    } finally {
      setBusy(false);
    }
  };

  const pingSession = async () => {
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/vesselfinder/session/test`);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const clearSession = async () => {
    if (!window.confirm('Отключить активную сессию VesselFinder? Cookies будут деактивированы.')) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/api/vesselfinder/session`);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const resetCounters = async () => {
    if (!window.confirm('Сбросить счётчики успехов/ошибок и очистить лог payload\'ов?\n\nCookies и сессия останутся — начнём статистику с нуля.')) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/vesselfinder/session/reset-counters`);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const tickShipment = async (shipmentId) => {
    setTickingId(shipmentId);
    try {
      const res = await axios.post(`${API_URL}/api/shipments/${shipmentId}/tick`);
      setTickResults((prev) => ({ ...prev, [shipmentId]: { ok: true, data: res.data, at: new Date() } }));
    } catch (e) {
      setTickResults((prev) => ({
        ...prev,
        [shipmentId]: { ok: false, error: e?.response?.data?.detail || String(e), at: new Date() },
      }));
    } finally {
      setTickingId(null);
      loadStatus();
    }
  };

  const tickAllActive = async () => {
    const active = shipments.filter((s) => s.trackingActive);
    if (!active.length) return;
    if (!window.confirm(`Запустить Tick для ${active.length} активных shipment'ов?`)) return;
    for (const s of active) {
      // eslint-disable-next-line no-await-in-loop
      await tickShipment(s.id);
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchData(null);
    try {
      // parallel: legacy manager search + NEW unified shipment search + live VF
      const [dbRes, richRes, liveRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/manager/tracking/search`, { params: { q } }),
        axios.get(`${API_URL}/api/admin/shipments/search`, { params: { q, limit: 30 } }),
        axios.get(`${API_URL}/api/vesselfinder/vessels/search`, { params: { bbox: '-180,-80,180,80', query: q } }),
      ]);
      setSearchData({
        db:   dbRes.status   === 'fulfilled' ? dbRes.value.data   : { error: String(dbRes.reason) },
        rich: richRes.status === 'fulfilled' ? richRes.value.data : { error: String(richRes.reason) },
        live: liveRes.status === 'fulfilled' ? liveRes.value.data : { error: String(liveRes.reason?.response?.data?.detail || liveRes.reason) },
      });
    } finally {
      setSearching(false);
    }
  };

  const prefillBind = (v) => {
    setBindMmsi(v.mmsi || '');
    setBindImo(v.imo || '');
    setBindName(v.name || '');
    document.getElementById('bind-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Load vessel history whenever the selected shipment changes
  const loadVesselHistory = useCallback(async (sid) => {
    if (!sid) { setVesselHistory(null); return; }
    setHistoryLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/shipments/${sid}/vessel-history`);
      setVesselHistory(res.data);
    } catch (e) {
      setVesselHistory({ error: e?.response?.data?.detail || String(e) });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVesselHistory(bindShipmentId);
  }, [bindShipmentId, loadVesselHistory]);

  // Auto-prefill Shipment ID from ?shipmentId=... (used by Exceptions deep-link)
  const _location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(_location.search);
    const sid = params.get('shipmentId');
    if (sid && sid !== bindShipmentId) {
      setBindShipmentId(sid);
      setTimeout(() => {
        document.getElementById('bind-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_location.search]);

  // Auto-resolve VIN → shipmentId when VIN is entered (debounced)
  useEffect(() => {
    const vin = bindVin.trim().toUpperCase();
    if (!vin || vin.length < 10) return;
    const h = setTimeout(async () => {
      // Try to find a shipment for this VIN in the shipments list first
      const match = shipments.find((s) => (s.vin || '').toUpperCase() === vin);
      if (match && match.id !== bindShipmentId) setBindShipmentId(match.id);
    }, 400);
    return () => clearTimeout(h);
  }, [bindVin, shipments, bindShipmentId]);

  const doBind = async () => {
    setBindBusy(true);
    setBindResult(null);
    try {
      // If VIN is provided and no shipmentId, route through /bind-by-vin
      if (bindVin.trim() && !bindShipmentId) {
        const res = await axios.post(`${API_URL}/api/shipments/bind-by-vin`, {
          vin:            bindVin.trim(),
          mmsi:           bindMmsi.trim() || null,
          imo:            bindImo.trim() || null,
          name:           bindName.trim() || null,
          container:      bindContainer.trim() || null,
          containerSeal:  bindContainerSeal.trim() || null,
          forceNewStage:  bindForceNew,
          newStageLabel:  bindNewStageLabel.trim() || null,
        });
        setBindResult({ ok: true, data: res.data });
        if (res.data.shipmentId) setBindShipmentId(res.data.shipmentId);
      } else {
        if (!bindShipmentId) {
          setBindResult({ ok: false, error: 'Введи Shipment ID или VIN' });
          return;
        }
        const res = await axios.post(
          `${API_URL}/api/shipments/${bindShipmentId}/vessel`,
          {
            mmsi:          bindMmsi.trim() || null,
            imo:           bindImo.trim() || null,
            name:          bindName.trim() || null,
            container:     bindContainer.trim() || null,
            containerSeal: bindContainerSeal.trim() || null,
            forceNewStage: bindForceNew,
            newStageLabel: bindNewStageLabel.trim() || null,
          }
        );
        setBindResult({ ok: true, data: res.data });
      }
      await loadShipments();
      await loadVesselHistory(bindShipmentId);
    } catch (e) {
      setBindResult({ ok: false, error: e?.response?.data?.detail || String(e) });
    } finally {
      setBindBusy(false);
    }
  };

  // Explicit "Сменить судно" — confirms + calls /transfer-vessel endpoint.
  const doTransferVessel = async () => {
    if (!bindShipmentId) { setBindResult({ ok: false, error: 'Сначала выбери shipment' }); return; }
    if (!bindMmsi.trim() && !bindImo.trim() && !bindName.trim()) {
      setBindResult({ ok: false, error: 'Укажи MMSI / IMO / название нового судна' });
      return;
    }
    const confirmMsg = `⚠️ Это создаст НОВЫЙ этап перевозки.\n\nТекущее судно завершит свой этап (status=done), а новое судно "${bindName || bindMmsi}" станет активным. История сохранится.\n\nПродолжить?`;
    if (!window.confirm(confirmMsg)) return;
    setBindBusy(true);
    setBindResult(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/shipments/${bindShipmentId}/transfer-vessel`,
        {
          mmsi:          bindMmsi.trim() || null,
          imo:           bindImo.trim() || null,
          name:          bindName.trim() || null,
          container:     bindContainer.trim() || null,
          containerSeal: bindContainerSeal.trim() || null,
          label:         bindNewStageLabel.trim() || null,
        }
      );
      setBindResult({ ok: true, data: res.data, transfer: true });
      await loadShipments();
      await loadVesselHistory(bindShipmentId);
    } catch (e) {
      setBindResult({ ok: false, error: e?.response?.data?.detail || String(e) });
    } finally {
      setBindBusy(false);
    }
  };

  // ---- derived ----
  const sessionStatus = status?.sessionStatus || 'not_connected';
  const statusKind = {
    healthy: 'healthy',
    degraded: 'degraded',
    paused: 'degraded',
    expired: 'expired',
    not_connected: 'offline',
  }[sessionStatus] || 'offline';

  // Three-level truth:
  //   1. EXTENSION HEALTH — heartbeat < 5min and cookies present
  //   2. VF FETCH HEALTH — did VesselFinder return vessels recently (cookies valid)
  //   3. MATCH HEALTH — did our target shipment match in the last fetches
  const extensionOk = status?.heartbeatAgeSec != null && status.heartbeatAgeSec < 300 && status.cookiesCount > 0;
  const vfFetchOk = status?.lastVfFetchOkAt
    ? (Date.now() - new Date(status.lastVfFetchOkAt).getTime()) < 10 * 60 * 1000
    : false;
  const vfFetchOkOrMatch = vfFetchOk || (status?.successCount > 0);
  const matchOk = status?.successCount > 0;
  const activeCount = shipments.filter((s) => s.trackingActive).length;
  const parserRunning = extensionOk; // keep name for legacy references below

  const dbShipments = searchData?.db?.data?.shipments || [];
  const dbDeals = searchData?.db?.data?.deals || [];
  const dbVehicles = searchData?.db?.data?.vehicles || [];
  const liveVessels = searchData?.live?.vessels || [];
  const classification = searchData?.db?.classification;
  // NEW: rich search results (VIN / container / vessel name / MMSI / IMO aware)
  const richShipments = searchData?.rich?.results || [];

  const totalFound = useMemo(() => (
    dbShipments.length + dbDeals.length + dbVehicles.length + liveVessels.length + richShipments.length
  ), [dbShipments, dbDeals, dbVehicles, liveVessels, richShipments]);

  // ---- render ----
  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ================ HEADER ================ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Anchor size={26} weight="duotone" className="text-sky-600" />
            VesselFinder Tracker
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Cookie-based live tracker. Устанавливаешь расширение → вставляешь URL CRM в попап
            → логинишься на vesselfinder.com → нажимаешь «Подключить к CRM» → backend автоматически
            двигает суда каждые 2 минуты.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href="/admin/shipments/exceptions"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            title="Исключения: stale, no-vessel, no-container, stuck progress"
          >
            <Warning size={16} weight="fill" /> Exceptions
          </a>
          <button
            onClick={downloadExtension}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 shadow-sm"
          >
            <Download size={16} weight="bold" /> Установить расширение
          </button>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Инструкция
          </button>
          <button
            onClick={() => { loadStatus(); loadShipments(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            title="Обновить"
          >
            <ArrowClockwise size={16} />
          </button>
        </div>
      </div>

      {/* ================ HELP PANEL ================ */}
      {showHelp && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-sm text-slate-800">
          <h3 className="font-semibold text-slate-900 mb-2">Как подключить парсер за 2 минуты</h3>
          <ol className="list-decimal ml-5 space-y-1.5">
            <li>Жми <b>«Установить расширение»</b> выше → распакуй ZIP.</li>
            <li>Открой <code>chrome://extensions</code> → включи «Режим разработчика» → «Загрузить распакованное» → выбери папку из ZIP'а.</li>
            <li>Клик на иконку <b>BIBI Vessel Sync</b> в тулбаре → в поле «Адрес CRM» <b>вставь URL этого сайта</b> <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code>. URL сохраняется автоматически сразу после вставки.</li>
            <li>Открой <a className="text-sky-700 underline" href="https://www.vesselfinder.com" target="_blank" rel="noreferrer">vesselfinder.com</a> и войди в аккаунт.</li>
            <li>Снова открой попап расширения → жми <b>«Подключить к CRM»</b>. Статус ниже станет <b>online</b>.</li>
            <li>Всё — backend сам тикает каждые 2 минуты. Можно нажать «Tick now» у любого shipment ниже чтобы проверить.</li>
          </ol>
        </div>
      )}

      {/* ================ STATUS STRIP ================ */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill kind={extensionOk ? 'healthy' : 'expired'}>
              1. Расширение {extensionOk ? 'работает' : 'оффлайн'}
            </StatusPill>
            <StatusPill kind={vfFetchOkOrMatch ? 'healthy' : (extensionOk ? 'degraded' : 'offline')}>
              2. VF отдаёт данные {vfFetchOkOrMatch ? '✓' : '—'}
            </StatusPill>
            <StatusPill kind={matchOk ? 'healthy' : (vfFetchOkOrMatch ? 'degraded' : 'offline')}>
              3. Наши корабли найдены {matchOk ? '✓' : '—'}
            </StatusPill>
            {status?.extensionVersion && (
              <span className="text-xs text-slate-500 ml-1">ext v{status.extensionVersion}</span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={pingSession}
              disabled={busy || !status?.connected}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              <Lightning size={13} weight="fill" /> Проверить сессию
            </button>
            <button
              onClick={tickAllActive}
              disabled={!activeCount}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Target size={13} weight="fill" /> Tick all ({activeCount})
            </button>
            <button
              onClick={resetCounters}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              title="Сбросить счётчики и лог"
            >
              <ArrowClockwise size={13} /> Сбросить счётчики
            </button>
            <button
              onClick={clearSession}
              disabled={!status?.connected}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            >
              <Power size={13} /> Отключить сессию
            </button>
          </div>
        </div>
        {status?.sessionMessage && (
          <div className={`mb-4 text-sm rounded-lg border px-3 py-2 ${
            sessionStatus === 'healthy' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
            sessionStatus === 'expired' ? 'bg-rose-50 border-rose-200 text-rose-900' :
            'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            {status.sessionMessage}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Cookies" value={status?.cookiesCount ?? 0} icon={CheckCircle} tone={status?.cookiesCount ? 'emerald' : 'slate'} />
          <Stat label="Heartbeat" value={status?.heartbeatAgeSec != null ? fmtAgo(status.lastHeartbeatAt) : '—'} sub={extensionOk ? 'расширение живо' : 'нет сигнала'} tone={extensionOk ? 'emerald' : 'rose'} />
          <Stat label="VF отвечает" value={status?.vfFetchOkCount != null ? (status.vfFetchOkCount + (status?.successCount || 0)) : '—'} sub={status?.lastVfFetchOkAt ? fmtAgo(status.lastVfFetchOkAt) : (status?.lastSuccessAt ? fmtAgo(status.lastSuccessAt) : 'нет удачных')} tone={vfFetchOkOrMatch ? 'emerald' : 'slate'} />
          <Stat label="Наши match" value={status?.successCount ?? 0} sub={status?.lastSuccessAt ? fmtAgo(status.lastSuccessAt) : 'пока нет'} tone={matchOk ? 'emerald' : 'slate'} />
          <Stat label="Последняя причина" value={status?.consecutiveFails != null ? `${status.consecutiveFails} подряд` : '—'} sub={status?.lastFailReason || 'ok'} tone={status?.consecutiveFails > 5 ? 'amber' : 'slate'} />
        </div>
      </section>

      {/* ================ UNIFIED SEARCH ================ */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <MagnifyingGlass size={18} className="text-slate-700" weight="bold" />
          <h2 className="text-base font-semibold text-slate-900">Поиск</h2>
          <span className="text-xs text-slate-500">
            корабль (имя / MMSI / IMO) · контейнер · VIN · лот · shipment id
          </span>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="MSC OSCAR / WBAJA7C52KWW12345 / 227280290 / MSCU1234567 / 67823459"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
          />
          <button
            onClick={runSearch}
            disabled={searching || !query.trim()}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {searching ? 'Ищу…' : 'Найти'}
          </button>
        </div>

        {searchData && (
          <div className="mt-4 space-y-3">
            <div className="text-xs text-slate-600 flex items-center gap-3">
              <span>Найдено: <b>{totalFound}</b></span>
              {classification && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px]">
                  type: {classification}
                </span>
              )}
            </div>

            {/* Live vessels */}
            {liveVessels.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-sky-700 mb-1.5 flex items-center gap-1">
                  <Boat size={14} weight="fill" /> Live суда (VesselFinder) — {liveVessels.length}
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="p-2 text-left">Name</th>
                        <th className="p-2 text-left">MMSI</th>
                        <th className="p-2 text-left">IMO</th>
                        <th className="p-2 text-left">Position</th>
                        <th className="p-2 text-left">Speed</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveVessels.map((v, i) => (
                        <tr key={i} className="border-t border-slate-100 hover:bg-sky-50">
                          <td className="p-2 font-medium">{v.name || '—'}</td>
                          <td className="p-2 font-mono text-[10px]">{v.mmsi || '—'}</td>
                          <td className="p-2 font-mono text-[10px]">{v.imo || '—'}</td>
                          <td className="p-2 font-mono text-[10px]">
                            {v.lat != null ? `${v.lat.toFixed(3)}, ${v.lng?.toFixed(3)}` : '—'}
                          </td>
                          <td className="p-2">{v.speed ?? '—'} kn</td>
                          <td className="p-2">
                            <button
                              onClick={() => prefillBind(v)}
                              className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
                            >
                              Привязать →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Rich shipment results (VIN / container / vessel name / MMSI / IMO) */}
            {richShipments.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                  <Target size={14} weight="fill" /> Shipments (VIN / container / vessel) — {richShipments.length}
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="p-2 text-left">VIN / Авто</th>
                        <th className="p-2 text-left">Контейнер / Судно</th>
                        <th className="p-2 text-left">Маршрут</th>
                        <th className="p-2 text-left">Прогрес</th>
                        <th className="p-2 text-left">Health</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {richShipments.map((s) => {
                        const healthCls = s.trackingHealth === 'ok' ? 'bg-emerald-100 text-emerald-700'
                          : s.trackingHealth === 'stale' ? 'bg-rose-100 text-rose-700'
                          : s.trackingHealth === 'estimated' ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600';
                        const healthLabel = s.trackingHealth === 'ok' ? '🟢 Live'
                          : s.trackingHealth === 'stale' ? '🔴 Stale'
                          : s.trackingHealth === 'estimated' ? '🟡 Estimated'
                          : '⚪ —';
                        return (
                          <tr key={s.id} className="border-t border-slate-100 hover:bg-emerald-50/40" data-testid={`rich-shipment-${s.id}`}>
                            <td className="p-2">
                              <div className="font-mono text-[11px] text-slate-900">{s.vin || '—'}</div>
                              <div className="font-mono text-[10px] text-slate-400">{s.id}</div>
                              {s.vehicleTitle && <div className="text-[11px] text-slate-700 mt-0.5">{s.vehicleTitle}</div>}
                            </td>
                            <td className="p-2">
                              {s.currentContainer?.number && (
                                <div className="text-[11px] font-mono text-indigo-700 flex items-center gap-1">
                                  📦 {s.currentContainer.number}
                                </div>
                              )}
                              {s.currentVessel?.name && (
                                <div className="text-[11px] text-sky-700 flex items-center gap-1 mt-0.5">
                                  ⚓ {s.currentVessel.name}
                                  {s.currentVessel.mmsi && <span className="text-[9px] text-slate-400 font-mono">· {s.currentVessel.mmsi}</span>}
                                </div>
                              )}
                              {!s.currentContainer?.number && !s.currentVessel?.name && (
                                <div className="text-[11px] text-slate-400 italic">не прив'язано</div>
                              )}
                            </td>
                            <td className="p-2 text-[11px] text-slate-600">
                              {s.origin?.name || '—'} <span className="text-slate-400">→</span> {s.destination?.name || '—'}
                              {s.location && <div className="text-[10px] text-slate-500 mt-0.5">📍 {s.location}</div>}
                            </td>
                            <td className="p-2 w-28">
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500" style={{ width: `${Math.round((s.progress || 0) * 100)}%` }} />
                                </div>
                                <span className="text-[10px] font-semibold text-slate-700 w-7 text-right">{Math.round((s.progress || 0) * 100)}%</span>
                              </div>
                            </td>
                            <td className="p-2">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${healthCls}`}>
                                {healthLabel}
                              </span>
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => { setBindShipmentId(s.id); document.getElementById('bind-card')?.scrollIntoView({ behavior: 'smooth' }); }}
                                className="rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700"
                              >
                                Bind →
                              </button>
                              <button
                                onClick={() => tickShipment(s.id)}
                                disabled={tickingId === s.id}
                                className="ml-1 rounded bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                              >
                                {tickingId === s.id ? '…' : 'Tick'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* DB shipments */}
            {dbShipments.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-indigo-700 mb-1.5 flex items-center gap-1">
                  <Target size={14} weight="fill" /> Shipments в БД — {dbShipments.length}
                </div>
                <div className="space-y-1.5">
                  {dbShipments.map((s) => (
                    <div key={s.id} className="rounded-md border border-slate-200 p-2.5 text-xs flex items-center gap-3 hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{s.vehicleTitle || s.id}</div>
                        <div className="text-slate-500 flex gap-2 font-mono text-[10px] mt-0.5">
                          <span>#{s.id}</span>
                          {s.vin && <span>VIN:{s.vin}</span>}
                          {s.vessel?.name && <span>⛴ {s.vessel.name}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => { setBindShipmentId(s.id); document.getElementById('bind-card')?.scrollIntoView({ behavior: 'smooth' }); }}
                        className="text-sky-600 text-[10px] font-semibold hover:text-sky-800"
                      >
                        Use ID →
                      </button>
                      <button
                        onClick={() => tickShipment(s.id)}
                        disabled={tickingId === s.id}
                        className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {tickingId === s.id ? '…' : 'Tick'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No results */}
            {totalFound === 0 && !searching && (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                Ничего не найдено. {searchData?.live?.error ? <span className="text-rose-600">Live: {String(searchData.live.error).slice(0, 120)}</span> : null}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ================ SHIPMENTS WITH TICK ================ */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Boat size={18} weight="duotone" className="text-sky-600" />
            Активные shipments
            <span className="text-xs text-slate-500 font-normal">({shipments.length})</span>
          </h2>
          <button onClick={loadShipments} className="text-xs text-sky-600 hover:text-sky-800 inline-flex items-center gap-1">
            <ArrowClockwise size={12} /> Обновить
          </button>
        </div>
        {shipments.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">Нет shipments</div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="p-2 text-left">Shipment</th>
                  <th className="p-2 text-left">Vessel</th>
                  <th className="p-2 text-left">VIN</th>
                  <th className="p-2 text-left">Tracking</th>
                  <th className="p-2 text-left">Последний результат</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => {
                  const r = tickResults[s.id];
                  return (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-sky-50/40">
                      <td className="p-2">
                        <div className="font-semibold text-slate-900">{s.vehicleTitle || '—'}</div>
                        <div className="font-mono text-[10px] text-slate-500">{s.id}</div>
                      </td>
                      <td className="p-2">
                        {s.vessel?.name ? (
                          <>
                            <div className="font-medium">{s.vessel.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {s.vessel.mmsi ? `MMSI:${s.vessel.mmsi}` : ''} {s.vessel.imo ? `IMO:${s.vessel.imo}` : ''}
                            </div>
                          </>
                        ) : <span className="text-slate-400">не привязан</span>}
                      </td>
                      <td className="p-2 font-mono text-[10px]">{s.vin || '—'}</td>
                      <td className="p-2">
                        {s.trackingActive
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><CheckCircle size={10} weight="fill" /> ON</span>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">OFF</span>}
                      </td>
                      <td className="p-2 text-[10px]">
                        {r ? (
                          r.ok ? (
                            <span className="text-emerald-700">✓ {r.data?.source || 'ok'} @{r.at.toLocaleTimeString()}</span>
                          ) : (
                            <span className="text-rose-600" title={r.error}>✗ {String(r.error).slice(0, 40)}</span>
                          )
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() => tickShipment(s.id)}
                          disabled={tickingId === s.id}
                          className="rounded bg-indigo-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          <Target size={10} /> {tickingId === s.id ? 'тик…' : 'Tick now'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================ BIND (VIN-centric) ================ */}
      <section id="bind-card" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <LinkIcon size={18} className="text-slate-700" weight="bold" />
          <h2 className="text-base font-semibold text-slate-900">Привязать груз к судну</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Основная сущность — <b>VIN</b>. Система сама резолвит VIN → Shipment → активный этап.
          При смене судна <b>предыдущий этап не удаляется</b>, а закрывается (status=done), и создаётся новый этап — так мы сохраняем историю перевозки.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600 font-medium md:col-span-2">
            VIN (приоритетно)
            <input
              value={bindVin}
              onChange={(e) => setBindVin(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              placeholder="WBAJA7C52KWW12345"
            />
            {bindShipmentId && bindVin && (
              <div className="text-[10px] text-emerald-600 mt-0.5 font-mono">
                ✓ резолвлено → {bindShipmentId}
              </div>
            )}
          </label>
          <label className="text-xs text-slate-600 font-medium md:col-span-2">
            Shipment ID (если знаешь напрямую)
            <input
              value={bindShipmentId}
              onChange={(e) => setBindShipmentId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="ship_test_customer_001_1"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600 font-medium">
            🚢 Vessel name
            <input
              value={bindName}
              onChange={(e) => setBindName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="MSC OSCAR"
            />
          </label>
          <label className="text-xs text-slate-600 font-medium">
            MMSI
            <input
              value={bindMmsi}
              onChange={(e) => setBindMmsi(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="227280290"
            />
          </label>
          <label className="text-xs text-slate-600 font-medium">
            IMO
            <input
              value={bindImo}
              onChange={(e) => setBindImo(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="9629344"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600 font-medium">
            📦 Container
            <input
              value={bindContainer}
              onChange={(e) => setBindContainer(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="MSKU1234567"
            />
          </label>
          <label className="text-xs text-slate-600 font-medium">
            Container seal
            <input
              value={bindContainerSeal}
              onChange={(e) => setBindContainerSeal(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="SEAL-001"
            />
          </label>
          <label className="text-xs text-slate-600 font-medium">
            Label нового этапа (опц.)
            <input
              value={bindNewStageLabel}
              onChange={(e) => setBindNewStageLabel(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Перевалка в Algeciras"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={doBind}
            disabled={bindBusy || (!bindShipmentId && !bindVin.trim()) || (!bindMmsi && !bindImo && !bindName)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {bindBusy ? 'Привязываю…' : 'Привязать'}
          </button>

          <button
            onClick={doTransferVessel}
            disabled={bindBusy || !bindShipmentId || (!bindMmsi && !bindImo && !bindName)}
            className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40 inline-flex items-center gap-2"
            title="Создаёт новый этап перевозки. Используй при физической перевалке на другое судно."
          >
            <Warning size={14} weight="fill" /> Сменить судно (перевалка)
          </button>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600 ml-auto">
            <input
              type="checkbox"
              checked={bindForceNew}
              onChange={(e) => setBindForceNew(e.target.checked)}
              className="rounded"
            />
            Force new stage (всегда создавать новый этап)
          </label>
        </div>

        {bindResult?.ok && (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm flex items-start gap-2 ${
            bindResult.data?.createdNewStage
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}>
            <CheckCircle size={16} weight="fill" className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">
                {bindResult.data?.createdNewStage
                  ? `✓ Создан новый этап перевозки: ${bindResult.data?.newStageId}`
                  : '✓ Данные обновлены в активном этапе (без создания нового)'}
              </div>
              <div className="text-xs mt-0.5">
                Shipment <span className="font-mono">{bindResult.data?.shipmentId}</span> · судовых этапов: <b>{bindResult.data?.vesselStagesCount}</b>
                {bindResult.data?.container && <> · контейнер <span className="font-mono">{bindResult.data.container.number}</span></>}
              </div>
            </div>
          </div>
        )}
        {bindResult && !bindResult.ok && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
            <XCircle size={16} weight="fill" /> {bindResult.error}
          </div>
        )}
      </section>

      {/* ================ VESSEL HISTORY ================ */}
      {bindShipmentId && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Boat size={18} weight="duotone" className="text-sky-600" />
            <h2 className="text-base font-semibold text-slate-900">История перевозки</h2>
            <span className="text-xs text-slate-500 font-mono">{bindShipmentId}</span>
            <button
              onClick={() => loadVesselHistory(bindShipmentId)}
              className="ml-auto text-xs text-sky-600 hover:text-sky-800 inline-flex items-center gap-1"
            >
              <ArrowClockwise size={12} /> Обновить
            </button>
          </div>

          {historyLoading && (
            <div className="text-sm text-slate-500">Загрузка…</div>
          )}
          {vesselHistory?.error && (
            <div className="text-sm text-rose-600">{vesselHistory.error}</div>
          )}
          {vesselHistory?.vesselStages?.length === 0 && (
            <div className="text-sm text-slate-500 italic">
              Ещё нет судовых этапов для этого shipment'а. Укажи vessel выше и нажми «Привязать».
            </div>
          )}
          {vesselHistory?.vesselStages?.length > 0 && (
            <div className="space-y-0">
              {vesselHistory.vesselStages.map((st, i) => {
                const isCurrent = st.isCurrent;
                const isDone = st.status === 'done';
                const dot = isCurrent
                  ? 'bg-blue-500 ring-4 ring-blue-200'
                  : isDone
                  ? 'bg-emerald-500'
                  : 'bg-slate-300';
                const txt = isCurrent
                  ? 'text-blue-700'
                  : isDone
                  ? 'text-emerald-700'
                  : 'text-slate-500';
                const line = isDone ? 'bg-emerald-300' : 'bg-slate-200';
                return (
                  <div key={st.stageId} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full ${dot} flex items-center justify-center`}>
                        {isDone ? (
                          <CheckCircle size={14} weight="fill" className="text-white" />
                        ) : (
                          <Boat size={12} weight={isCurrent ? 'fill' : 'regular'} className="text-white" />
                        )}
                      </div>
                      {i < vesselHistory.vesselStages.length - 1 && (
                        <div className={`flex-1 w-0.5 my-1 ${line}`} style={{ minHeight: '2rem' }} />
                      )}
                    </div>
                    <div className="flex-1 pb-5">
                      <div className="flex items-baseline gap-2">
                        <div className={`font-semibold ${txt}`}>{st.label}</div>
                        {isCurrent && (
                          <span className="text-[10px] uppercase tracking-wider text-blue-600 font-bold">активный</span>
                        )}
                        {isDone && (
                          <span className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">завершён</span>
                        )}
                      </div>
                      {(st.from || st.to) && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {st.from} <span className="mx-1">→</span> {st.to}
                        </div>
                      )}
                      <div className="text-[11px] flex flex-wrap gap-1.5 mt-1">
                        {st.vessel?.name && (
                          <span className="font-mono bg-sky-50 text-sky-800 border border-sky-100 px-1.5 py-0.5 rounded">
                            ⚓ {st.vessel.name}
                          </span>
                        )}
                        {st.vessel?.mmsi && (
                          <span className="font-mono bg-slate-50 text-slate-600 border border-slate-100 px-1.5 py-0.5 rounded">
                            MMSI {st.vessel.mmsi}
                          </span>
                        )}
                        {st.vessel?.imo && (
                          <span className="font-mono bg-slate-50 text-slate-600 border border-slate-100 px-1.5 py-0.5 rounded">
                            IMO {st.vessel.imo}
                          </span>
                        )}
                        {st.container?.number && (
                          <span className="font-mono bg-indigo-50 text-indigo-800 border border-indigo-100 px-1.5 py-0.5 rounded">
                            📦 {st.container.number}
                          </span>
                        )}
                      </div>
                      {(st.startedAt || st.completedAt) && (
                        <div className="text-[10px] text-slate-400 mt-1 font-mono">
                          {st.startedAt && <span>начало: {fmtAgo(st.startedAt)}</span>}
                          {st.completedAt && <span className="ml-3">конец: {fmtAgo(st.completedAt)}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
