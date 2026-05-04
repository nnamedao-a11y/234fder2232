/**
 * ShipmentTrackingMap — VesselFinder-style live tracking.
 *
 * Visual design inspired by vesselfinder.com:
 *   • Dark nautical map (CartoDB Voyager / dark_nolabels)
 *   • Rotating ship icon (triangle) oriented by course-over-ground
 *   • Green pulsing halo around ship
 *   • Traveled route = solid blue, remaining route = dashed
 *   • Port pins with classy icons
 *   • Floating telemetry card: speed · course · last update · source
 *   • Smooth easing between ticks (animation lock)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCabinetTheme } from '../../context/CabinetThemeContext';
import {
  Anchor,
  ArrowsClockwise,
  Broadcast,
  Compass,
  Gauge,
  MapPin,
  NavigationArrow,
  Path,
  Target,
} from '@phosphor-icons/react';
import { Progress } from '../ui/progress';

// ---------- Guards ----------
const isValidCoord = (lat, lng) =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 &&
  lng >= -180 && lng <= 180;

const clampProgress = (p) => {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const fmtAgo = (d) => {
  if (!d) return '—';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s назад`;
  if (s < 3600) return `${Math.floor(s / 60)}m назад`;
  return `${Math.floor(s / 3600)}h назад`;
};

// ---------- Icons ----------
// Ship icon as a rotatable SVG triangle (kite shape). `course` = heading in degrees (0=N, 90=E).
const makeShipIcon = (course = 0, source = 'simulated') => {
  const isLive = typeof source === 'string' && source.startsWith('real');
  const fill = isLive ? '#22c55e' : '#f59e0b';
  const stroke = isLive ? '#065f46' : '#78350f';
  const pulse = isLive
    ? `<div class="ship-pulse" style="background:${fill}"></div>`
    : '';
  return L.divIcon({
    className: 'vf-ship-icon',
    html: `
      <div class="ship-wrapper" style="transform: rotate(${course}deg);">
        ${pulse}
        <svg viewBox="0 0 32 32" width="38" height="38" style="filter: drop-shadow(0 2px 3px rgba(0,0,0,.55));">
          <defs>
            <linearGradient id="g-${isLive ? 'l' : 's'}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${fill}" stop-opacity="1"/>
              <stop offset="100%" stop-color="${stroke}" stop-opacity="1"/>
            </linearGradient>
          </defs>
          <path d="M16 2 L24 26 L16 22 L8 26 Z"
                fill="url(#g-${isLive ? 'l' : 's'})"
                stroke="white"
                stroke-width="1.8"
                stroke-linejoin="round"/>
          <circle cx="16" cy="16" r="2" fill="white" opacity="0.9"/>
        </svg>
      </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
};

// Port icons — colored dot with anchor glyph
const makePortIcon = (color, kind = 'origin') => {
  const label = kind === 'origin' ? 'A' : 'B';
  return L.divIcon({
    className: 'vf-port-icon',
    html: `
      <div style="
        position: relative;
        width: 28px;
        height: 28px;
        background: ${color};
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 900;
        font-size: 12px;
        font-family: 'Mazzard', 'Mazzard H', 'Mazzard M', -apple-system, system-ui, sans-serif;
        letter-spacing: -0.5px;
      ">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

const originIcon = makePortIcon('#38bdf8', 'origin');
const destinationIcon = makePortIcon('#10b981', 'destination');

// ---------- Map helpers ----------
const FitRouteBounds = ({ bounds, focusPosition }) => {
  const map = useMap();
  useEffect(() => {
    if (focusPosition && isValidCoord(focusPosition[0], focusPosition[1])) {
      // Zoom into ship area but keep context — show within 800km
      map.setView(focusPosition, 4, { animate: true });
    } else if (bounds && bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [bounds, focusPosition, map]);
  return null;
};

// Animated ship marker (lerps between ticks + rotates to course)
const AnimatedShip = ({ position, course, source }) => {
  const [pos, setPos] = useState(position);
  const animRef = useRef({ raf: null, cancelled: false });

  useEffect(() => {
    if (!position) return;
    if (animRef.current.raf) {
      cancelAnimationFrame(animRef.current.raf);
      animRef.current.cancelled = true;
    }
    animRef.current = { raf: null, cancelled: false };

    const [startLat, startLng] = pos;
    const [targetLat, targetLng] = position;
    if (Math.abs(startLat - targetLat) < 1e-7 && Math.abs(startLng - targetLng) < 1e-7) {
      setPos(position);
      return;
    }
    const duration = 1800;
    const t0 = performance.now();
    const tick = (now) => {
      if (animRef.current.cancelled) return;
      const raw = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      setPos([
        startLat + (targetLat - startLat) * eased,
        startLng + (targetLng - startLng) * eased,
      ]);
      if (raw < 1) {
        animRef.current.raf = requestAnimationFrame(tick);
      }
    };
    animRef.current.raf = requestAnimationFrame(tick);
    return () => {
      animRef.current.cancelled = true;
      if (animRef.current.raf) cancelAnimationFrame(animRef.current.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.[0], position?.[1]]);

  const icon = useMemo(() => makeShipIcon(course || 0, source), [course, source]);
  if (!pos || !isValidCoord(pos[0], pos[1])) return null;
  return <Marker position={pos} icon={icon} />;
};

// ---------- Main ----------
const ShipmentTrackingMap = ({ shipment, liveUpdate }) => {
  const { isDark } = useCabinetTheme();
  const initialPos = shipment?.currentPosition;
  const [livePosition, setLivePosition] = useState(
    isValidCoord(initialPos?.lat, initialPos?.lng) ? [initialPos.lat, initialPos.lng] : null
  );
  const [liveProgress, setLiveProgress] = useState(clampProgress(shipment?.progress));
  const [liveEta, setLiveEta] = useState(shipment?.liveEta || shipment?.eta || null);
  const [trackingSource, setTrackingSource] = useState(
    shipment?.trackingSource || shipment?.currentPosition?.source || 'simulated'
  );
  const [vesselSpeed, setVesselSpeed] = useState(
    shipment?.currentPosition?.speed ?? null
  );
  const [vesselCourse, setVesselCourse] = useState(
    shipment?.currentPosition?.course ?? null
  );
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [, tick] = useState(0);

  // Auto-refresh "last update" label every 15s
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  // React to incoming live updates
  useEffect(() => {
    if (!liveUpdate || liveUpdate.shipmentId !== shipment?.id) return;
    const pos = liveUpdate.currentPosition;
    if (pos && isValidCoord(pos.lat, pos.lng)) setLivePosition([pos.lat, pos.lng]);
    if (liveUpdate.progress !== undefined && liveUpdate.progress !== null) {
      setLiveProgress(clampProgress(liveUpdate.progress));
    }
    if (liveUpdate.eta) setLiveEta(liveUpdate.eta);
    if (liveUpdate.type) setTrackingSource(liveUpdate.type);
    if (Number.isFinite(liveUpdate.speed)) setVesselSpeed(liveUpdate.speed);
    if (Number.isFinite(liveUpdate.course)) setVesselCourse(liveUpdate.course);
    setLastUpdateTime(new Date());
  }, [liveUpdate, shipment?.id]);

  // Sync from shipment prop
  useEffect(() => {
    const cp = shipment?.currentPosition;
    if (cp && isValidCoord(cp.lat, cp.lng)) setLivePosition([cp.lat, cp.lng]);
    if (shipment?.progress !== undefined && shipment?.progress !== null) {
      setLiveProgress(clampProgress(shipment.progress));
    }
    if (shipment?.liveEta) setLiveEta(shipment.liveEta);
    if (shipment?.trackingSource) setTrackingSource(shipment.trackingSource);
    if (cp?.speed != null) setVesselSpeed(cp.speed);
    if (cp?.course != null) setVesselCourse(cp.course);
    if (cp?.updatedAt) setLastUpdateTime(new Date(cp.updatedAt));
  }, [
    shipment?.id,
    shipment?.currentPosition?.lat,
    shipment?.currentPosition?.lng,
    shipment?.progress,
    shipment?.liveEta,
    shipment?.trackingSource,
    shipment?.currentPosition?.speed,
    shipment?.currentPosition?.course,
    shipment?.currentPosition?.updatedAt,
  ]);

  if (!shipment) {
    return (
      <div className="bg-slate-100 rounded-xl h-96 flex flex-col items-center justify-center text-slate-500">
        <MapPin size={32} className="mb-2" />
        <p>Немає даних про маршрут</p>
      </div>
    );
  }

  const { origin, destination, route, vessel } = shipment;

  if (!origin || !destination || !isValidCoord(origin.lat, origin.lng) || !isValidCoord(destination.lat, destination.lng)) {
    return (
      <div className="bg-slate-100 rounded-xl h-96 flex flex-col items-center justify-center text-slate-500">
        <MapPin size={32} className="mb-2" />
        <p>Маршрут не визначено</p>
      </div>
    );
  }

  const routePoints = (route || [origin, destination]).filter((p) => p && isValidCoord(p.lat, p.lng));
  const bounds = routePoints.map((p) => [p.lat, p.lng]);
  const center = [(origin.lat + destination.lat) / 2, (origin.lng + destination.lng) / 2];

  // Split the route into traveled vs. remaining based on progress
  const progressClamped = clampProgress(liveProgress);
  const splitIdx = Math.max(0, Math.min(routePoints.length - 1, Math.round(progressClamped * (routePoints.length - 1))));
  const traveledPoints = routePoints.slice(0, splitIdx + 1).map((p) => [p.lat, p.lng]);
  const remainingPoints = routePoints.slice(splitIdx).map((p) => [p.lat, p.lng]);

  const formatEta = (iso) => {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const days = Math.max(0, Math.round((d - new Date()) / (1000 * 60 * 60 * 24)));
      return { formatted: d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }), days };
    } catch {
      return null;
    }
  };
  const etaInfo = formatEta(liveEta);
  const isLive = typeof trackingSource === 'string' && trackingSource.startsWith('real');

  return (
    <div className="space-y-4" data-testid="shipment-tracking-map">
      {/* Inline styles for ship pulse & map chrome (scoped by class) */}
      <style>{`
        .vf-ship-icon { background: transparent !important; border: 0 !important; }
        .ship-wrapper {
          position: absolute;
          inset: 0;
          transform-origin: center center;
          transition: transform 600ms ease-out;
          display: flex; align-items: center; justify-content: center;
        }
        .ship-pulse {
          position: absolute;
          width: 58px; height: 58px; border-radius: 50%;
          opacity: .35;
          animation: vf-pulse 2s cubic-bezier(.2,.8,.2,1) infinite;
          top: 50%; left: 50%;
          margin-left: -29px; margin-top: -29px;
          pointer-events: none;
        }
        @keyframes vf-pulse {
          0%   { transform: scale(0.55); opacity: 0.55; }
          70%  { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        .vf-port-icon { background: transparent !important; border: 0 !important; }
        .leaflet-container.vf-map-light { background: #e7edf2; }
        .leaflet-container.vf-map-dark { background: #0b1220; }
        .leaflet-tile { filter: saturate(1.08) contrast(1.03); }
      `}</style>

      {/* MAP */}
      <div
        className={`relative rounded-2xl overflow-hidden shadow-xl border ${
          isDark
            ? 'border-slate-800 bg-slate-950 shadow-blue-900/20'
            : 'border-slate-200 bg-slate-100 shadow-slate-300/40'
        }`}
      >
        <MapContainer
          center={center}
          zoom={3}
          style={{ height: '540px', width: '100%' }}
          scrollWheelZoom
          zoomControl
          data-testid="map-container"
          attributionControl={false}
          className={isDark ? 'vf-map-dark' : 'vf-map-light'}
        >
          {/* Theme-aware tile layer — CartoDB Voyager (light) / Dark Matter (dark) */}
          <TileLayer
            key={isDark ? 'dark' : 'light'}
            url={
              isDark
                ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
            }
            subdomains="abcd"
            maxZoom={19}
          />
          <FitRouteBounds bounds={bounds} focusPosition={livePosition} />

          {/* Remaining route — dashed light blue */}
          {remainingPoints.length > 1 && (
            <Polyline
              positions={remainingPoints}
              pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.65, dashArray: '6, 10' }}
            />
          )}

          {/* Traveled route — solid bright green */}
          {traveledPoints.length > 1 && (
            <Polyline
              positions={traveledPoints}
              pathOptions={{ color: isLive ? '#22c55e' : '#3b82f6', weight: 4, opacity: 0.9 }}
            />
          )}

          {/* Origin port (A) */}
          <Marker position={[origin.lat, origin.lng]} icon={originIcon} />
          <CircleMarker
            center={[origin.lat, origin.lng]}
            radius={11}
            pathOptions={{ color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.15, weight: 2 }}
          />

          {/* Destination port (B) */}
          <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} />
          <CircleMarker
            center={[destination.lat, destination.lng]}
            radius={11}
            pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.15, weight: 2 }}
          />

          {/* Ship */}
          {livePosition && (
            <AnimatedShip
              position={livePosition}
              course={vesselCourse ?? 0}
              source={trackingSource}
            />
          )}
        </MapContainer>

        {/* Top-left: vessel identity */}
        {vessel?.name && (
          <div className="absolute top-4 left-4 bg-slate-900/85 backdrop-blur-md border border-slate-700/80 rounded-xl px-4 py-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/20">
                <Anchor size={14} weight="fill" className="text-sky-300" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Vessel</div>
                <div className="text-sm font-bold text-white leading-tight">{vessel.name}</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  {vessel.mmsi && `MMSI ${vessel.mmsi}`}
                  {vessel.imo && ` · IMO ${vessel.imo}`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Top-right: LIVE badge + telemetry */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide shadow-lg ${
            isLive
              ? 'bg-emerald-500 text-white'
              : 'bg-amber-500 text-white'
          }`}>
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full bg-white opacity-75 ${isLive ? 'animate-ping' : ''}`}></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            {isLive ? 'LIVE' : 'ESTIMATED'}
          </div>
          <div className="bg-slate-900/85 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-lg px-3 py-2.5 min-w-[200px] space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-slate-400 flex items-center gap-1"><Gauge size={11} /> Швидкість</span>
              <span className="text-white font-mono font-semibold">
                {vesselSpeed != null ? `${Number(vesselSpeed).toFixed(1)} kn` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-slate-400 flex items-center gap-1"><Compass size={11} /> Курс</span>
              <span className="text-white font-mono font-semibold">
                {vesselCourse != null ? `${Math.round(vesselCourse)}°` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-slate-400 flex items-center gap-1"><NavigationArrow size={11} /> Позиція</span>
              <span className="text-white font-mono font-semibold text-[10px]">
                {livePosition
                  ? `${livePosition[0].toFixed(3)}, ${livePosition[1].toFixed(3)}`
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] pt-1 border-t border-slate-700/60">
              <span className="text-slate-400 flex items-center gap-1"><Broadcast size={11} /> Оновлено</span>
              <span className="text-white font-mono font-semibold text-[10px]">
                {fmtAgo(lastUpdateTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom-left: progress bar overlay */}
        <div className="absolute bottom-4 left-4 right-4 md:right-auto md:min-w-[360px] bg-slate-900/85 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-lg px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Path size={14} className="text-sky-300" /> {origin.name}
            </div>
            <div className="text-xs font-bold text-emerald-300">{Math.round(progressClamped * 100)}%</div>
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              {destination.name} <Target size={14} className="text-emerald-300" />
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                isLive
                  ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600'
                  : 'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600'
              }`}
              style={{ width: `${progressClamped * 100}%` }}
            />
          </div>
          {etaInfo && (
            <div className="mt-1.5 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Прибуття: <b className="text-white">{etaInfo.formatted}</b></span>
              <span>
                {etaInfo.days === 0 ? 'сьогодні' : `через ${etaInfo.days} ${etaInfo.days === 1 ? 'день' : 'днів'}`}
              </span>
            </div>
          )}
        </div>

        {/* Copyright */}
        <div className="absolute bottom-1 right-1 text-[9px] text-slate-500 bg-slate-900/60 px-1.5 rounded">
          © OpenStreetMap · CARTO
        </div>
      </div>

      {/* Info Cards — under the map */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-sky-100">
              <MapPin size={16} className="text-sky-600" weight="fill" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Маршрут</span>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-start gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-500 mt-1.5 flex-shrink-0"></div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 uppercase">Відправлення</div>
                <div className="font-semibold text-slate-900 truncate">{origin.name}</div>
              </div>
            </div>
            <div className="border-l-2 border-dashed border-slate-300 ml-[4px] h-4"></div>
            <div className="flex items-start gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 uppercase">Призначення</div>
                <div className="font-semibold text-slate-900 truncate">{destination.name}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-emerald-100">
              <ArrowsClockwise size={16} className="text-emerald-600" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Прогрес</span>
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-3xl font-bold text-slate-900">
              {Math.round(progressClamped * 100)}%
            </span>
            <span className="text-xs text-slate-500">пройдено</span>
          </div>
          <Progress value={progressClamped * 100} className="h-1.5" />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-amber-100">
              <Anchor size={16} className="text-amber-600" weight="fill" />
            </div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Прибуття</span>
          </div>
          {etaInfo ? (
            <>
              <div className="text-sm font-bold text-slate-900">{etaInfo.formatted}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {etaInfo.days === 0 ? 'сьогодні' : `через ${etaInfo.days} ${etaInfo.days === 1 ? 'день' : 'днів'}`}
              </div>
              {isLive && (
                <div className="text-[10px] text-emerald-600 mt-1 font-medium">
                  За даними судна
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-slate-400">Не визначено</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShipmentTrackingMap;
