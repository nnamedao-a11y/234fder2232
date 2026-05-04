/**
 * VinSearchAutocomplete
 * ----------------------
 * Header search input with a live dropdown of mini vehicle-cards.
 *
 * UX:
 *  - Typing ≥ 2 chars (debounced 250 ms) → hits /api/public/search/suggest
 *  - Shows up to 6 mini-cards (image, title, VIN, LOT #, price)
 *  - ↑/↓ navigates, Enter opens selection, Esc/outside-click closes
 *  - Clicking a card or pressing Enter on one navigates to `/vin/:fullVin`
 *  - Enter without a selection submits the raw query to `/vin/:q`
 *
 * Design: matches current BIBI dark/amber header.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, Hash, MapPin, Bell, Check } from 'lucide-react';

import FavoriteButton from '../engagement/FavoriteButton';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

/** Upper-case and strip spaces/dashes (VIN/LOT friendly). URLs are passed through. */
const normalize = (raw) => {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.toUpperCase().replace(/[\s-]/g, '');
};

const fmtPrice = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  try {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  } catch (_) {
    return `$${Math.round(n)}`;
  }
};

const fmtOdo = (v, unit) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('en-US')} ${unit || 'mi'}`;
};

/* ------------------------------ Mini-card --------------------------------- */

const MiniCard = React.memo(function MiniCard({ item, active, onMouseEnter, onClick }) {
  const img = item.image;
  const title =
    item.title ||
    [item.year, item.make, item.model, item.trim].filter(Boolean).join(' ') ||
    item.vin;
  const price = fmtPrice(item.price);
  const odo = fmtOdo(item.odometer, item.odometer_unit);
  const isLive = item._src === 'live';
  const isWestMotors = item._src === 'westmotors';

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault() /* keep focus on input */}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`group relative cursor-pointer w-full text-left flex gap-3 items-stretch px-3 py-2.5 transition-colors border-l-2 ${
        active
          ? 'bg-[#17150D] border-[#FEAE00]'
          : 'bg-transparent border-transparent hover:bg-[#17150D]/60 hover:border-[#FEAE00]/40'
      }`}
      data-testid={`vin-suggest-item-${item.vin || item.lot_number}`}
    >
      {/* Thumbnail */}
      <div className="w-[72px] h-[54px] rounded overflow-hidden bg-[#0A0A09] flex-shrink-0 flex items-center justify-center border border-[#2A2A28]">
        {img ? (
          <img
            src={img}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const p = e.currentTarget.parentElement;
              if (p) {
                p.innerHTML =
                  '<span class="text-[9px] text-[#5E5E5E] uppercase tracking-wider">No photo</span>';
              }
            }}
          />
        ) : (
          <span className="text-[9px] text-[#5E5E5E] uppercase tracking-wider">No photo</span>
        )}
      </div>

      {/* Center text column */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        {/* Row 1 — title + small LIVE chip inline (heart sits in right column) */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-white truncate uppercase tracking-wide min-w-0">
            {title}
          </span>
          {isLive ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-sm bg-[#FEAE00]/15 text-[#FEAE00] text-[8.5px] font-bold uppercase tracking-wider border border-[#FEAE00]/30 flex-shrink-0"
              title="Fetched live from BidMotors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#FEAE00] animate-pulse" />
              Live
            </span>
          ) : null}
          {isWestMotors ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-sm bg-[#3B82F6]/15 text-[#3B82F6] text-[8.5px] font-bold uppercase tracking-wider border border-[#3B82F6]/30 flex-shrink-0"
              title="Fetched from WestMotors index (fallback)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
              WM
            </span>
          ) : null}
        </div>

        {/* Row 2 — VIN · LOT */}
        <div className="flex items-center gap-2 text-[10.5px] text-[#B5B5B3] font-mono uppercase min-w-0">
          <span className="truncate min-w-0">
            VIN: <span className="text-[#FEAE00]">{item.vin || '—'}</span>
          </span>
          {item.lot_number ? (
            <span className="inline-flex items-center gap-1 flex-shrink-0">
              <Hash size={10} className="text-[#5E5E5E]" />
              {item.lot_number}
            </span>
          ) : null}
        </div>

        {/* Row 3 — auction · odometer · location */}
        <div className="flex items-center gap-2 text-[10.5px] text-[#8C8A86] whitespace-nowrap overflow-hidden min-w-0">
          {item.auction_name ? (
            <span className="uppercase tracking-wider font-semibold text-[#E4E3DF] flex-shrink-0">
              {item.auction_name}
            </span>
          ) : null}
          {odo ? (
            <span className="flex-shrink-0">
              <span className="text-[#5E5E5E] mx-1">·</span>
              {odo}
            </span>
          ) : null}
          {item.location ? (
            <span className="inline-flex items-center gap-1 truncate min-w-0">
              <span className="text-[#5E5E5E] mx-1">·</span>
              <MapPin size={9} className="flex-shrink-0" />
              <span className="truncate">{item.location}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Right column — heart on top, price under */}
      <div className="flex-shrink-0 flex flex-col items-end justify-between gap-1 pl-1">
        {item.vin ? (
          <FavoriteButton
            variant="icon"
            size="xs"
            vin={item.vin}
            vehicleId={item.vin}
            snapshot={{
              title,
              year: item.year,
              make: item.make,
              model: item.model,
              trim: item.trim,
              price: item.price,
              image: item.image,
              lot_number: item.lot_number,
              auction_name: item.auction_name,
              odometer: item.odometer,
              odometer_unit: item.odometer_unit,
            }}
            testid={`vin-suggest-fav-${item.vin}`}
          />
        ) : (
          <span className="block w-7 h-7" aria-hidden />
        )}
        {price ? (
          <span className="text-[12.5px] font-bold text-[#FEAE00] whitespace-nowrap leading-none">
            {price}
          </span>
        ) : null}
      </div>
    </div>
  );
});

/* ---------------------------- Main component ------------------------------ */

export default function VinSearchAutocomplete({
  width = 278,
  className = '',
  placeholder = 'SEARCH BY VIN OR LOT NUMBER',
  testId = 'header-vin-search',
}) {
  const [value, setValue] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1); // keyboard-selected index
  const [meta, setMeta] = useState({ source: null, live_used: false, cache_hit: false, response_time_ms: 0 });
  // Watchlist mini-form state (for empty-state)
  const [watchEmail, setWatchEmail] = useState('');
  const [watchSubmitting, setWatchSubmitting] = useState(false);
  const [watchDone, setWatchDone] = useState(false);
  const navigate = useNavigate();

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef('');

  /* ---------- Debounced fetch ---------- */
  const fetchSuggestions = useCallback(async (q) => {
    const norm = normalize(q);
    lastQueryRef.current = norm;
    if (norm.length < 2 || /^https?:\/\//i.test(norm)) {
      setItems([]);
      setLoading(false);
      return;
    }
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/public/search/suggest`, {
        params: { q: norm, limit: 6 },
        signal: ctrl.signal,
        timeout: 8000,
      });
      // Guard against race — only accept if query still matches
      if (lastQueryRef.current !== norm) return;
      if (res.data?.success) {
        setItems(Array.isArray(res.data.items) ? res.data.items : []);
        setMeta({
          source: res.data.source || res.data.data_source || null,
          live_used: !!res.data.live_used,
          cache_hit: !!res.data.cache_hit,
          live_failed: !!res.data.live_failed,
          warning: res.data.warning || null,
          response_time_ms: res.data.response_time_ms || 0,
        });
      } else {
        setItems([]);
        setMeta({ source: null, live_used: false, cache_hit: false, response_time_ms: 0 });
      }
    } catch (e) {
      if (!axios.isCancel?.(e) && e?.name !== 'CanceledError') {
        // network / server error — keep list empty, don't spam the user
        setItems([]);
      }
    } finally {
      if (lastQueryRef.current === norm) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [value, fetchSuggestions]);

  // Reset watchlist form whenever the query changes
  useEffect(() => {
    setWatchDone(false);
  }, [value]);

  const submitWatch = useCallback(
    async (rawVin, email) => {
      const vin = normalize(rawVin);
      const clean = (email || '').trim().toLowerCase();
      if (!vin) return;
      if (!clean || clean.length < 4 || !clean.includes('@')) return;
      setWatchSubmitting(true);
      try {
        const res = await axios.post(`${API_URL}/api/public/search/watch`, {
          vin,
          email: clean,
        });
        if (res.data?.success) {
          setWatchDone(true);
        }
      } catch (_e) {
        /* toast handled elsewhere if needed */
      } finally {
        setWatchSubmitting(false);
      }
    },
    []
  );

  /* ---------- Outside-click / escape ---------- */
  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /* ---------- Submit helpers ---------- */
  const goToItem = useCallback(
    (item) => {
      if (!item) return;
      const v = (item.vin || '').toUpperCase();
      if (!v) return;
      setOpen(false);
      navigate(`/vin/${encodeURIComponent(v)}`);
    },
    [navigate]
  );

  const submitQuery = useCallback(() => {
    const v = normalize(value);
    if (!v) return;
    setOpen(false);
    navigate(`/vin/${encodeURIComponent(v)}`);
  }, [value, navigate]);

  /* ---------- Input events ---------- */
  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' && items.length > 0) {
        setOpen(true);
        setCursor(0);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        submitQuery();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (items.length ? (c + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor >= 0 && items[cursor]) {
        goToItem(items[cursor]);
      } else {
        submitQuery();
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  /* ---------- Render ---------- */
  const showDropdown =
    open &&
    (loading || items.length > 0 || (normalize(value).length >= 2 && !loading));

  const emptyState = useMemo(
    () => !loading && items.length === 0 && normalize(value).length >= 2,
    [loading, items, value]
  );

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      style={{ width }}
      data-testid={testId}
    >
      {/* Input frame — matches header style */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cursor >= 0 && items[cursor]) goToItem(items[cursor]);
          else submitQuery();
        }}
        className={`flex items-center gap-2 rounded-lg border bg-transparent px-3 h-10 transition-colors ${
          showDropdown ? 'border-[#FEAE00]' : 'border-[#555452] focus-within:border-[#FEAE00]'
        }`}
      >
        <button
          type="submit"
          aria-label="Search"
          className="text-[#5E5E5E] hover:text-[#FEAE00] flex-shrink-0"
          data-testid={`${testId}-submit`}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin text-[#FEAE00]" />
          ) : (
            <Search size={18} />
          )}
        </button>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursor(-1);
            setOpen(true);
          }}
          onFocus={() => {
            if (normalize(value).length >= 2) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-[14px] uppercase tracking-wide text-white placeholder:text-[#5E5E5E] placeholder:tracking-wide"
          autoComplete="off"
          spellCheck={false}
          data-testid={`${testId}-input`}
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={`${testId}-listbox`}
        />
      </form>

      {/* Dropdown — wider than input so the meta row + LIVE badge + price always fit */}
      {showDropdown ? (
        <div
          id={`${testId}-listbox`}
          role="listbox"
          className="absolute left-0 top-full mt-2 z-[120] w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-[#FEAE00]/60 bg-[#0A0A09] shadow-[0_24px_48px_rgba(0,0,0,0.6)] overflow-hidden"
          data-testid={`${testId}-dropdown`}
        >
          {/* Header pill */}
          <div className="px-3 py-2 border-b border-[#2A2A28] flex items-center justify-between bg-[#111110]">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#FEAE00] font-bold flex items-center gap-2">
              {loading
                ? 'Searching…'
                : items.length > 0
                ? `${items.length} match${items.length === 1 ? '' : 'es'}`
                : 'No matches'}
              {!loading && meta.source && items.length > 0 ? (() => {
                const src = String(meta.source).toUpperCase();
                const palette =
                  src === 'LIVE'
                    ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/40'
                    : src === 'CACHE'
                    ? 'bg-[#FEAE00]/15 text-[#FEAE00] border-[#FEAE00]/40'
                    : src === 'WESTMOTORS' || src === 'WM'
                    ? 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/40'
                    : src === 'STALE_FALLBACK' || src === 'STALE'
                    ? 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/40'
                    : 'bg-[#737373]/10 text-[#A3A3A3] border-[#737373]/30';
                const label =
                  src === 'STALE_FALLBACK' ? '🔴 OFFLINE'
                  : src === 'CACHE' ? '🟡 CACHE'
                  : src === 'LIVE' ? '🟢 LIVE'
                  : src === 'WESTMOTORS' ? '🔵 WM'
                  : src;
                return (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded-sm text-[8.5px] font-bold tracking-wider border ${palette}`}
                    title={`Source: ${meta.source} · ${meta.response_time_ms} ms${meta.warning ? ' · ' + meta.warning : ''}`}
                  >
                    {label}
                  </span>
                );
              })() : null}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[#5E5E5E]">
              press <span className="text-[#E4E3DF]">↵</span> to open
            </span>
          </div>

          {loading && items.length === 0 ? (
            <div
              className="px-4 py-6 text-center text-[12px] text-[#8C8A86] flex items-center justify-center gap-2"
              data-testid={`${testId}-loading`}
            >
              <Loader2 size={14} className="animate-spin text-[#FEAE00]" />
              Looking up vehicles…
            </div>
          ) : items.length > 0 ? (
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[#1F1F1E]">
              {items.map((it, idx) => (
                <MiniCard
                  key={it.vin || it.lot_number || idx}
                  item={it}
                  active={cursor === idx}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => goToItem(it)}
                />
              ))}
            </div>
          ) : emptyState ? (
            <div
              className="px-4 py-5 text-center text-[12px] text-[#8C8A86]"
              data-testid={`${testId}-empty`}
            >
              <div className="text-[#E4E3DF] font-semibold mb-1">
                Nothing matched "{value}"
              </div>
              <div className="text-[11px] mb-3">
                Press <span className="text-[#FEAE00] font-bold">Enter</span> to run a full
                search (VIN / LOT / URL) or source this vehicle manually.
              </div>
              {/* Notify-when-found mini-form. Only offered for VIN-like inputs (>=11 chars) */}
              {normalize(value).length >= 11 ? (
                watchDone ? (
                  <div
                    className="mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400"
                    data-testid={`${testId}-watch-done`}
                  >
                    <Check size={13} />
                    <span>
                      We'll email you as soon as{' '}
                      <span className="font-mono text-[#FEAE00]">{normalize(value)}</span> shows up.
                    </span>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitWatch(value, watchEmail);
                    }}
                    className="mt-2 flex flex-col gap-2 items-stretch"
                    data-testid={`${testId}-watch-form`}
                  >
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#FEAE00] font-semibold">
                      <Bell size={11} />
                      Notify me when this VIN appears
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={watchEmail}
                        onChange={(e) => setWatchEmail(e.target.value)}
                        onMouseDown={(e) => e.stopPropagation()}
                        placeholder="your@email.com"
                        className="flex-1 h-9 px-3 rounded-md bg-[#111110] border border-[#2A2A28] text-[12px] text-white placeholder:text-[#5E5E5E] focus:border-[#FEAE00] outline-none"
                        data-testid={`${testId}-watch-email`}
                        required
                      />
                      <button
                        type="submit"
                        disabled={watchSubmitting}
                        className="h-9 px-3 rounded-md bg-[#FEAE00] text-[#111110] text-[11px] font-bold uppercase tracking-wider hover:bg-[#FFC347] disabled:opacity-50 transition-colors inline-flex items-center gap-1"
                        data-testid={`${testId}-watch-submit`}
                      >
                        {watchSubmitting ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Bell size={12} />
                        )}
                        Notify me
                      </button>
                    </div>
                  </form>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
