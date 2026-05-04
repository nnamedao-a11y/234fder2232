import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import {
  Heart,
  GitCompare,
  Search,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  Phone,
  RotateCw,
  Bell,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import CarGallery from '../../components/public/CarGallery';
import CarCalculator from '../../components/public/CarCalculator';
import HaveAQuestionBlock from '../../components/public/HaveAQuestionBlock';
import { useCustomerAuth } from './CustomerAuth';
import { userEngagementApi, getCustomerToken } from '../../lib/api';

const API = process.env.REACT_APP_BACKEND_URL || '';

/* ----------------------------- helpers ------------------------------ */

const cleanQuery = (raw) => {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return s.toUpperCase().replace(/[\s-]/g, '');
};

const fmtOdometer = (v, unit) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v).toLocaleString('en-US');
  return `${n} ${unit || 'mi'}`.trim();
};

const fmtMoney = (v, currency = 'USD') => {
  if (v == null || Number.isNaN(Number(v))) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(v));
};

const titleize = (v) => {
  if (!v) return '';
  return String(v).replace(/\b\w/g, (c) => c.toUpperCase());
};

/* ---------------------- presentational sub-parts -------------------- */

const Row = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] gap-4 py-2.5">
    <span className="text-[13px] md:text-[14px] text-[#A0A0A0]">{label}</span>
    <span className="text-[13px] md:text-[14px] font-semibold uppercase text-white break-words">
      {value || <span className="text-[#555452]">—</span>}
    </span>
  </div>
);

const HighlightRow = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] gap-4 py-2.5">
    <span className="text-[13px] md:text-[14px] text-[#A0A0A0]">{label}</span>
    <span className="text-[13px] md:text-[14px] font-bold uppercase text-[#FEAE00] break-words">
      {value || <span className="text-[#555452]">—</span>}
    </span>
  </div>
);

const Chip = ({ children, tone = 'default' }) => {
  const palette =
    tone === 'amber'
      ? 'bg-[#FEAE00]/10 text-[#FEAE00] border-[#FEAE00]/40'
      : tone === 'danger'
        ? 'bg-red-500/10 text-red-300 border-red-500/40'
        : tone === 'success'
          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
          : 'bg-white/5 text-white border-white/15';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full border text-[11px] uppercase tracking-wider ${palette}`}
    >
      {children}
    </span>
  );
};

/* ------------------------------- page ------------------------------- */

export default function VinResultPage() {
  const { query: rawQuery } = useParams();
  const navigate = useNavigate();
  const query = cleanQuery(rawQuery);
  const auth = useCustomerAuth();
  const customer = auth?.customer || null;

  const [q, setQ] = useState(query);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [matches, setMatches] = useState([]); // multiple partial-VIN candidates
  const [queryKind, setQueryKind] = useState(null);

  // Favorites / compare state
  const [isFavorite, setIsFavorite] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [inCompare, setInCompare] = useState(false);
  const [cmpBusy, setCmpBusy] = useState(false);
  // Phase II — rescan + watchlist
  const [rescanBusy, setRescanBusy] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchDone, setWatchDone] = useState(false);
  const [watchEmail, setWatchEmail] = useState('');

  const runSearch = useCallback(async (target) => {
    const t = cleanQuery(target);
    if (!t) return;
    setLoading(true);
    setError(null);
    setData(null);
    setSource(null);
    setMatches([]);
    setQueryKind(null);
    try {
      const { data: res } = await axios.get(
        `${API}/api/public/search/${encodeURIComponent(t)}`,
        { timeout: 30000 }
      );
      if (res?.success) {
        setData(res);
        // LIVE-FIRST architecture: prefer the explicit `source` / `data_source`
        // (LIVE | CACHE | STALE_FALLBACK) over the winning_source legacy field.
        setSource(res.source || res.data_source || res.winning_source || 'local');
        setQueryKind(res.query_kind || null);
        if (res.multiple_matches && Array.isArray(res.matches)) {
          setMatches(res.matches);
        }
      } else {
        setError(res?.message || 'Vehicle not found');
        setQueryKind(res?.query_kind || null);
      }
    } catch (e) {
      setError(
        e?.response?.data?.detail ||
          e?.response?.data?.message ||
          'Search failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) {
      setQ(query);
      runSearch(query);
    }
  }, [query, runSearch]);

  // ── Phase II: Rescan (force live fetch, bypass TTL cache) ──
  const runRescan = useCallback(async () => {
    const t = cleanQuery(query);
    if (!t) return;
    setRescanBusy(true);
    try {
      await axios.post(
        `${API}/api/public/search/rescan`,
        { vin: t },
        { timeout: 30000 }
      );
      toast.success('Cache busted — re-fetching live');
      await runSearch(t);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Rescan failed');
    } finally {
      setRescanBusy(false);
    }
  }, [query, runSearch]);

  // ── Phase II: Watchlist register (notify when found) ──
  const runWatch = useCallback(
    async (emailOverride) => {
      const t = cleanQuery(query);
      if (!t) return;
      const email = (emailOverride ?? watchEmail ?? customer?.email ?? '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        toast.error('Enter a valid email');
        return;
      }
      setWatchBusy(true);
      try {
        const res = await axios.post(`${API}/api/public/search/watch`, {
          vin: t,
          email,
          note: `From /vin/${t}`,
        });
        if (res.data?.success) {
          setWatchDone(true);
          if (res.data.already_in_catalog) {
            toast.info('This vehicle is already in our catalog — refreshing…');
            runSearch(t);
          } else if (res.data.duplicate) {
            toast.info('Already on your watchlist — we’ll email you.');
          } else {
            toast.success('You’ll be notified as soon as this VIN appears.');
          }
        }
      } catch (e) {
        toast.error(e?.response?.data?.detail || 'Could not add to watchlist');
      } finally {
        setWatchBusy(false);
      }
    },
    [query, watchEmail, customer, runSearch]
  );

  // Keep a stable key for favorites (VIN preferred; fallback to query/lot)
  const favoriteKey = useMemo(
    () => (data?.vin || query || '').toUpperCase(),
    [data?.vin, query]
  );

  // Load favorite + compare status when vehicle or auth changes
  useEffect(() => {
    let cancelled = false;
    if (!favoriteKey) {
      setIsFavorite(false);
      setInCompare(false);
      return undefined;
    }
    (async () => {
      try {
        if (getCustomerToken()) {
          const res = await userEngagementApi.favorites.check(favoriteKey);
          if (!cancelled) setIsFavorite(Boolean(res?.isFavorite));
        } else if (!cancelled) {
          setIsFavorite(false);
        }
      } catch (_) {
        /* silent */
      }

      // Compare — check local list for now
      try {
        const list = JSON.parse(localStorage.getItem('bibi_compare') || '[]');
        if (!cancelled) setInCompare(list.includes(favoriteKey));
      } catch (_) {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favoriteKey, customer?.customerId]);

  const requireLogin = () => {
    toast.info('Увійдіть, щоб додати до Обраного', {
      description: 'Перенаправляємо на сторінку входу…',
    });
    setTimeout(() => {
      navigate(
        `/cabinet/login?redirect=${encodeURIComponent(
          window.location.pathname
        )}`
      );
    }, 700);
  };

  const toggleFavorite = async () => {
    if (!favoriteKey || !data) {
      toast.error('Зачекайте, поки авто завантажиться');
      return;
    }
    if (!getCustomerToken()) {
      requireLogin();
      return;
    }
    try {
      setFavBusy(true);
      if (isFavorite) {
        await userEngagementApi.favorites.remove(favoriteKey);
        setIsFavorite(false);
        toast('Видалено з Обраного');
      } else {
        await userEngagementApi.favorites.add({
          vin: favoriteKey,
          vehicleId: data.vin || data.lot_number,
          title: data.title,
          year: data.year,
          make: data.make,
          model: data.model,
          trim: data.trim,
          price: data.price,
          image: data.image_urls?.[0] || data.image || null,
          lot_number: data.lot_number,
          auction_name: data.auction_name,
          odometer: data.odometer,
          odometer_unit: data.odometer_unit,
          sourcePage: window.location.pathname,
        });
        setIsFavorite(true);
        toast.success('Додано до Обраного', {
          description: data.title || favoriteKey,
        });
      }
    } catch (err) {
      if (err?.status === 401) {
        requireLogin();
      } else {
        toast.error(err?.message || 'Не вдалося оновити Обране');
      }
    } finally {
      setFavBusy(false);
    }
  };

  const toggleCompare = async () => {
    if (!favoriteKey || !data) {
      toast.error('Wait for vehicle to load first');
      return;
    }
    setCmpBusy(true);
    try {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('bibi_compare') || '[]');
        if (!Array.isArray(list)) list = [];
      } catch (_) {
        list = [];
      }
      const already = list.includes(favoriteKey);
      if (already) {
        const next = list.filter((v) => v !== favoriteKey);
        localStorage.setItem('bibi_compare', JSON.stringify(next));
        setInCompare(false);
        toast.success('Removed from compare');
        try {
          await axios.post(
            `${API}/api/compare/remove/${encodeURIComponent(favoriteKey)}`
          );
        } catch (_) {
          /* non-blocking */
        }
      } else {
        if (list.length >= 4) {
          toast.error('Compare is limited to 4 vehicles — remove one first');
          return;
        }
        const next = [...list, favoriteKey];
        localStorage.setItem('bibi_compare', JSON.stringify(next));
        setInCompare(true);
        toast.success('Added to compare');
        try {
          await axios.post(`${API}/api/compare/add`, {
            customerId: customer?.customerId || 'guest',
            vin: favoriteKey,
          });
        } catch (_) {
          /* non-blocking */
        }
      }
    } finally {
      setCmpBusy(false);
    }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    const t = cleanQuery(q);
    if (!t) return;
    if (t !== query) {
      navigate(`/vin/${encodeURIComponent(t)}`);
    } else {
      runSearch(t);
    }
  };

  const v = data;
  const title =
    v?.title ||
    `${v?.year || ''} ${v?.make || ''} ${v?.model || ''} ${v?.trim || ''}`.replace(/\s+/g, ' ').trim();

  const mainImage = v?.image_urls?.[0];

  // ── LIVE-FIRST source label + visual badge ─────────────────────────
  const srcUpper = String(source || '').toUpperCase();
  const isHistoryOnly = !!(data && (data.history_only || srcUpper === 'STATVIN_HISTORY'));
  const isLiveFirst = ['LIVE', 'CACHE', 'STALE_FALLBACK', 'STALE', 'WESTMOTORS', 'LEMON'].includes(srcUpper);
  const sourceLabel = isHistoryOnly
    ? '📊 HISTORY ONLY — Stat.VIN'
    : isLiveFirst
      ? srcUpper === 'LIVE'
        ? '🟢 LIVE — BidMotors'
        : srcUpper === 'CACHE'
          ? '🟡 CACHE — recent (≤5 min)'
          : srcUpper === 'WESTMOTORS'
            ? '🔵 WestMotors Index — fallback'
            : srcUpper === 'LEMON'
              ? '🍋 Lemon Index — fallback'
              : '🔴 OFFLINE — stale fallback'
      : source === 'bitmotors' || source?.includes('bidmotors_live')
        ? 'BidMotors Live'
        : source === 'local_db+bidmotors_live'
          ? 'Local DB + BidMotors Live'
          : source === 'bid.cars'
            ? 'Bid.Cars'
            : source === 'local_db'
              ? 'Local DB'
              : source
                ? titleize(String(source).replace(/_/g, ' '))
                : '';

  const sourceBadgeClass = isHistoryOnly
    ? 'bg-pink-500/15 text-pink-300 border-pink-500/40'
    : isLiveFirst
      ? srcUpper === 'LIVE'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
        : srcUpper === 'CACHE'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
          : srcUpper === 'WESTMOTORS'
            ? 'bg-blue-500/15 text-blue-300 border-blue-500/40'
            : srcUpper === 'LEMON'
              ? 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40'
              : 'bg-red-500/15 text-red-300 border-red-500/40'
      : 'bg-[#FEAE00]/15 text-[#FEAE00] border-[#FEAE00]/30';

  // ── LIVE vs SOLD pill (UX critical — customer must not place bid on a sold car) ──
  const isLive = data ? (data.is_live !== false) : true; // default to live when ambiguous
  const liveBadge = (data && !isHistoryOnly) ? (
    isLive
      ? { label: '🟢 LIVE — Active auction', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' }
      : { label: '⚫ SOLD — Historical lot', cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40' }
  ) : null;

  // ── stat.vin history block (parallel enrichment, may be null) ──────
  const history = data?.history || null;

  return (
    <div data-testid="vin-result-page" className="bg-black min-h-screen">
      <section className="pt-10 pb-8">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <Breadcrumbs
            items={[
              { label: 'HOME', to: '/' },
              { label: 'SEARCH' },
              { label: query || '—' },
            ]}
          />

          {/* Search bar — always visible */}
          <form
            onSubmit={submitSearch}
            className="mt-8 flex items-center gap-3 max-w-[720px]"
            data-testid="vin-result-search-form"
          >
            <div className="flex-1 flex items-center gap-2 h-[52px] px-4 border border-[#555452] focus-within:border-[#FEAE00] rounded-lg bg-[#0F0F0E] transition-colors">
              <Search size={18} className="text-[#5E5E5E]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Enter VIN or LOT number"
                className="flex-1 bg-transparent outline-none text-[15px] uppercase text-white placeholder:text-[#5E5E5E]"
                data-testid="vin-result-input"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              className="btn-amber h-[52px] px-8"
              data-testid="vin-result-submit"
              type="submit"
            >
              Search
            </button>
          </form>

          {/* History-only banner — shown when no active lot but stat.vin found history */}
          {isHistoryOnly && v ? (
            <div
              className="mt-6 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-pink-500/10 to-amber-500/10 px-5 py-4 flex items-start gap-3"
              data-testid="vin-history-only-banner"
            >
              <span className="text-[24px] leading-none">⚫</span>
              <div className="flex-1">
                <div className="text-[14px] md:text-[15px] font-semibold text-amber-200">
                  Активного лота не найдено
                </div>
                <div className="text-[13px] text-amber-100/80 mt-0.5">
                  Но есть история этого VIN — финальная цена продажи и фото с аукциона ниже.
                </div>
              </div>
              {data?.message ? (
                <span className="hidden md:inline text-[11px] text-zinc-400 max-w-[420px] text-right">
                  {data.message}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Header row */}
          <div className="mt-10 flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[12px] uppercase tracking-[0.2em] text-[#FEAE00]">
                [ vehicle result ]
              </div>
              <h1
                className="text-[32px] md:text-[56px] font-bold text-white leading-tight mt-3"
                data-testid="vin-result-title"
              >
                {loading
                  ? 'Looking up vehicle…'
                  : v
                    ? title
                    : error
                      ? 'No vehicle found'
                      : 'Enter a VIN or LOT'}
              </h1>
              {v ? (
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {v.auction_name ? <Chip tone="amber">{v.auction_name}</Chip> : null}
                  {v.condition ? <Chip tone="success">{titleize(v.condition)}</Chip> : null}
                  {v.damage_primary ? (
                    <Chip tone="danger">{titleize(v.damage_primary)}</Chip>
                  ) : null}
                  {v.keys ? <Chip>Keys: {titleize(v.keys)}</Chip> : null}
                  {sourceLabel ? (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sourceBadgeClass}`}
                      title={isLiveFirst ? `Architecture: LIVE-FIRST · source=${srcUpper}` : sourceLabel}
                      data-testid="vin-result-source-badge"
                    >
                      {sourceLabel}
                    </span>
                  ) : null}
                  {liveBadge ? (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${liveBadge.cls}`}
                      title={isLive ? 'This lot is currently biddable.' : 'This lot is closed — historical record only.'}
                      data-testid="vin-result-live-pill"
                    >
                      {liveBadge.label}
                    </span>
                  ) : null}
                  {history?.has_history ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-pink-500/40 bg-pink-500/15 text-pink-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      title="Stat.VIN historical sale data found"
                      data-testid="vin-result-history-pill"
                    >
                      📊 Sale history
                    </span>
                  ) : null}
                  {data?.warning ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      ⚠ {data.warning}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Rescan — force live fetch, bypass TTL cache */}
              <button
                type="button"
                onClick={runRescan}
                disabled={rescanBusy || loading || !query}
                title="Re-fetch live from BidMotors (bypass cache)"
                className="w-10 h-10 rounded-full border border-[#2A2A28] bg-[#1D1D1B] text-[#FEAE00] flex items-center justify-center hover:bg-[#FEAE00] hover:text-black transition-colors disabled:opacity-50"
                data-testid="vin-result-rescan"
              >
                {rescanBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RotateCw size={16} />
                )}
              </button>
              <button
                type="button"
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
                  inCompare
                    ? 'bg-[#FEAE00] text-black border-[#FEAE00]'
                    : 'border-[#FEAE00] text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black'
                } disabled:opacity-50`}
                aria-label={inCompare ? 'Remove from compare' : 'Add to compare'}
                onClick={toggleCompare}
                disabled={cmpBusy || !data}
                data-testid="vin-result-compare"
              >
                <GitCompare size={16} />
              </button>
              <button
                type="button"
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
                  isFavorite
                    ? 'bg-[#FEAE00] text-black border-[#FEAE00]'
                    : 'border-[#FEAE00] text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black'
                } disabled:opacity-50`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={toggleFavorite}
                disabled={favBusy || !data}
                data-testid="vin-result-favorite"
              >
                <Heart
                  size={16}
                  fill={isFavorite ? 'currentColor' : 'none'}
                />
              </button>
            </div>
          </div>

          {/* --------------------- LOADING --------------------- */}
          {loading && (
            <div
              className="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-8"
              data-testid="vin-result-loading"
            >
              <div className="h-[540px] rounded-lg bg-[#1D1D1B] animate-pulse" />
              <div className="rounded-lg bg-[#1D1D1B] p-8 flex items-center justify-center">
                <div className="text-center text-[#A0A0A0]">
                  <Loader2
                    size={40}
                    className="mx-auto text-[#FEAE00] animate-spin mb-4"
                  />
                  <div className="text-[16px] font-semibold text-white">
                    Resolving {query}
                  </div>
                  <div className="text-[13px] mt-2">
                    Checking local DB → BidMotors live parser…
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --------------------- ERROR / NOT FOUND --------------------- */}
          {!loading && error && (
            <div
              className="mt-16 bg-[#1D1D1B] rounded-lg p-10 md:p-16 text-center max-w-[900px] mx-auto"
              data-testid="vin-result-error"
            >
              <div className="w-16 h-16 rounded-full bg-[#FEAE00]/10 border border-[#FEAE00]/40 flex items-center justify-center mx-auto text-[#FEAE00]">
                <AlertTriangle size={28} />
              </div>
              <h2 className="mt-6 text-[24px] md:text-[32px] font-bold text-white">
                Vehicle not found
              </h2>
              <p className="mt-4 text-[14px] md:text-[15px] text-[#A0A0A0] max-w-[620px] mx-auto">
                {error}
              </p>
              <div className="mt-8 flex items-center justify-center gap-4 flex-wrap">
                <Link
                  to="/catalog"
                  className="btn-amber h-[48px] px-6"
                  data-testid="vin-result-goto-catalog"
                >
                  Browse catalog
                </Link>
                <Link
                  to="/contacts"
                  className="h-[48px] px-6 inline-flex items-center gap-2 rounded border border-[#FEAE00] text-[#FEAE00] text-[13px] uppercase tracking-wider font-semibold hover:bg-[#FEAE00] hover:text-black transition-colors"
                  data-testid="vin-result-contact-us"
                >
                  <Phone size={14} /> Ask a manager
                </Link>
                <button
                  type="button"
                  onClick={runRescan}
                  disabled={rescanBusy}
                  className="h-[48px] px-6 inline-flex items-center gap-2 rounded border border-[#2A2A28] text-[#E4E3DF] text-[13px] uppercase tracking-wider font-semibold hover:bg-[#1D1D1B] disabled:opacity-40 transition-colors"
                  data-testid="vin-result-rescan-cta"
                >
                  {rescanBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                  Re-fetch live
                </button>
              </div>

              {/* ─── Phase II: Notify-me-when-found form ─── */}
              <div
                className="mt-10 max-w-[560px] mx-auto p-5 rounded-xl border border-[#2A2A28] bg-[#0F0F0E] text-left"
                data-testid="vin-result-watchlist"
              >
                {watchDone ? (
                  <div className="flex items-center gap-3 text-emerald-400">
                    <CheckCircle2 size={20} />
                    <div>
                      <div className="font-semibold text-[14px]">You're on the list</div>
                      <div className="text-[12px] text-[#A0A0A0] mt-0.5">
                        We'll email <span className="text-[#FEAE00] font-mono">{watchEmail || customer?.email}</span>{' '}
                        the moment VIN <span className="text-[#FEAE00] font-mono">{query}</span> appears in our feed.
                      </div>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      runWatch();
                    }}
                    className="space-y-3"
                  >
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#FEAE00] font-bold">
                      <Bell size={13} />
                      Notify me when VIN{' '}
                      <span className="font-mono text-white normal-case tracking-normal">{query}</span> appears
                    </div>
                    <p className="text-[12px] text-[#A0A0A0] leading-relaxed">
                      We sync BidMotors every hour. If this vehicle shows up, you'll be the first to know —
                      before managers, before competitors.
                    </p>
                    <div className="flex gap-2 items-stretch">
                      <input
                        type="email"
                        required
                        value={watchEmail || customer?.email || ''}
                        onChange={(e) => setWatchEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="flex-1 h-11 px-4 rounded-md bg-[#18181B] border border-[#3a3a38] text-[13px] text-white placeholder:text-[#5E5E5E] focus:border-[#FEAE00] outline-none"
                        data-testid="vin-result-watch-email"
                      />
                      <button
                        type="submit"
                        disabled={watchBusy}
                        className="h-11 px-5 rounded-md bg-[#FEAE00] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#FFC347] disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                        data-testid="vin-result-watch-submit"
                      >
                        {watchBusy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Bell size={14} />
                        )}
                        Notify me
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* --------------------- MULTIPLE MATCHES (partial VIN) --------------------- */}
          {!loading && matches.length > 1 && (
            <div
              className="mt-10 bg-[#1D1D1B] rounded-lg p-6 md:p-8"
              data-testid="vin-result-multiple-matches"
            >
              <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.2em] text-[#FEAE00] mb-2">
                <Sparkles size={14} />
                [ {matches.length} matches for "{query}" ]
              </div>
              <h3 className="text-[20px] md:text-[24px] font-bold text-white mb-6">
                Your partial VIN matches several vehicles — pick one to see the full card:
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {matches.map((m) => (
                  <button
                    key={m.vin || m.lot_number}
                    type="button"
                    onClick={() =>
                      navigate(`/vin/${encodeURIComponent((m.vin || '').toUpperCase())}`)
                    }
                    className="flex gap-3 items-stretch p-3 rounded-lg border border-[#3a3a38] bg-[#0F0F0E] hover:border-[#FEAE00] transition-colors text-left group"
                    data-testid={`vin-match-${m.vin}`}
                  >
                    <div className="w-24 h-20 rounded bg-[#000] overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {m.image ? (
                        <img
                          src={m.image}
                          alt={m.title || m.vin || ''}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-[10px] text-[#5E5E5E] uppercase">No image</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-white truncate group-hover:text-[#FEAE00] transition-colors">
                        {m.title || `${m.year || ''} ${m.make || ''} ${m.model || ''}`.trim() || m.vin}
                      </div>
                      <div className="text-[11px] text-[#6A6A6A] font-mono uppercase mt-1 truncate">
                        VIN: <span className="text-[#FEAE00]">{m.vin}</span>
                      </div>
                      {m.lot_number ? (
                        <div className="text-[11px] text-[#A0A0A0] mt-0.5">
                          Lot #{m.lot_number} · {m.auction_name || ''}
                        </div>
                      ) : null}
                      {m.price ? (
                        <div className="text-[12px] font-bold text-[#FEAE00] mt-1">
                          {fmtMoney(m.price)}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-6 text-[12px] text-[#A0A0A0]">
                Showing top card below. Click any match above to jump to the full VIN result.
              </div>
            </div>
          )}

          {/* --------------------- RESULT --------------------- */}
          {!loading && v && (
            <div
              className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-8 mt-12"
              data-testid="vin-result-card"
            >
              <CarGallery images={v.image_urls || (mainImage ? [mainImage] : [])} />

              <div className="bg-[#1D1D1B] rounded-lg p-6 md:p-10 flex flex-col">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h2 className="text-[18px] font-semibold text-white">Car information</h2>
                  {fmtMoney(v.price) ? (
                    <div
                      className="px-4 h-9 border border-[#FEAE00] rounded flex items-center text-[15px] font-bold text-[#FEAE00]"
                      data-testid="vin-result-price"
                    >
                      {fmtMoney(v.price)}
                    </div>
                  ) : null}
                </div>
                <div className="border-b border-[#3a3a38] my-3" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div>
                    <Row label="Make" value={v.make} />
                    <Row label="Model" value={v.model} />
                    <Row label="Year" value={v.year} />
                    <Row label="Mileage" value={fmtOdometer(v.odometer, v.odometer_unit)} />
                    <Row label="Engine" value={v.engine} />
                    <Row label="Fuel" value={v.fuel_type} />
                  </div>
                  <div>
                    <Row label="Transmission" value={v.transmission} />
                    <Row label="Drivetrain" value={v.drivetrain} />
                    <Row label="Color" value={v.color} />
                    <Row label="Keys" value={v.keys} />
                    <HighlightRow
                      label="Damage"
                      value={
                        [v.damage_primary, v.damage_secondary]
                          .filter(Boolean)
                          .map(titleize)
                          .join(' / ') || '—'
                      }
                    />
                    <Row label="Condition" value={v.condition} />
                  </div>
                </div>

                <h2 className="text-[18px] font-semibold text-white mt-8">Auction details</h2>
                <div className="border-b border-[#3a3a38] my-3" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div>
                    <HighlightRow label="VIN" value={v.vin} />
                    <Row label="Lot #" value={v.lot_number} />
                    <Row label="Auction" value={v.auction_name} />
                    <Row label="Location" value={v.location} />
                  </div>
                  <div>
                    <Row label="Sale date" value={v.sale_date} />
                    <Row label="Seller" value={v.seller} />
                    <Row label="Title" value={v.title_status} />
                    <Row
                      label="Updated"
                      value={
                        v.updated_at
                          ? new Date(v.updated_at).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'
                      }
                    />
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-3 flex-wrap">
                  {v.source_url ? (
                    <a
                      href={v.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-[13px] text-[#FEAE00] hover:brightness-110 underline"
                      data-testid="vin-result-source-link"
                    >
                      <ExternalLink size={14} /> View source listing
                    </a>
                  ) : null}
                  {typeof v.confidence === 'number' ? (
                    <span className="text-[12px] text-[#6A6A6A] uppercase tracking-wider">
                      Confidence: {Math.round(v.confidence * 100)}%
                    </span>
                  ) : null}
                </div>

                <a
                  href="#calculator"
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .querySelector('[data-testid="vin-result-calc-anchor"]')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="btn-amber mt-8 self-center w-full md:w-auto md:px-10 text-center"
                  data-testid="vin-result-exact-cost"
                >
                  Exact cost in Bulgaria
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* -------------------- SOLD HISTORY (Stat.VIN parallel enrichment) -------------------- */}
      {!loading && v && history && history.has_history ? (
        <section className="bg-gradient-to-b from-black via-zinc-950 to-black pb-12 pt-4" data-testid="vin-result-history-section">
          <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
            <div className="rounded-2xl border border-pink-500/30 bg-gradient-to-br from-pink-950/40 via-zinc-900/80 to-zinc-900/80 p-6 md:p-8 shadow-2xl">
              <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-pink-500/40 bg-pink-500/15 text-pink-300 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
                      📊 Sale history
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-600/40 bg-zinc-800/40 text-zinc-300 px-3 py-1 text-[11px] font-medium uppercase tracking-wider">
                      Source: Stat.VIN
                    </span>
                  </div>
                  <h2 className="text-[22px] md:text-[26px] font-bold text-white">
                    Vehicle history & price intelligence
                  </h2>
                  <p className="text-[13px] text-zinc-400 mt-1">
                    This VIN was previously sold at auction. The data below comes from public auction records.
                  </p>
                </div>
                {history.source_url ? (
                  <a
                    href={history.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-pink-300 hover:text-pink-200 underline underline-offset-4"
                  >
                    View on stat.vin →
                  </a>
                ) : null}
              </div>

              {/* Highlight tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
                {history.sale_price_usd ? (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                    <div className="text-[11px] text-emerald-300 uppercase tracking-wider font-semibold">Final sale price</div>
                    <div className="text-[24px] md:text-[28px] font-extrabold text-emerald-200 mt-1">
                      ${typeof history.sale_price_usd === 'number'
                        ? history.sale_price_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })
                        : history.sale_price_usd}
                    </div>
                  </div>
                ) : null}
                {history.sale_date ? (
                  <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-4">
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Sale date</div>
                    <div className="text-[18px] font-bold text-white mt-1">{history.sale_date}</div>
                  </div>
                ) : null}
                {history.auction_name ? (
                  <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-4">
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Auction</div>
                    <div className="text-[18px] font-bold text-white mt-1">{history.auction_name}</div>
                  </div>
                ) : null}
                {history.location ? (
                  <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-4">
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Location</div>
                    <div className="text-[15px] font-bold text-white mt-1 leading-tight">{history.location}</div>
                  </div>
                ) : null}
              </div>

              {/* Damage row */}
              {history.damage_primary ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 mb-4">
                  <span className="text-[11px] text-red-300 uppercase tracking-wider font-semibold mr-3">Damage on sale:</span>
                  <span className="text-[14px] font-semibold text-red-200">{history.damage_primary}</span>
                </div>
              ) : null}

              {/* Photo gallery from stat.vin */}
              {Array.isArray(history.image_urls) && history.image_urls.length > 0 ? (
                <div>
                  <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold mb-2">
                    Auction photos ({history.image_urls.length})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
                    {history.image_urls.slice(0, 10).map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block aspect-[4/3] rounded-lg overflow-hidden border border-zinc-700/60 hover:border-pink-500/50 transition-colors"
                      >
                        <img
                          src={url}
                          alt={`Auction photo ${i + 1}`}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </a>
                    ))}
                  </div>
                  {history.image_urls.length > 10 ? (
                    <p className="text-[12px] text-zinc-500 mt-2">+{history.image_urls.length - 10} more photos available on the source page.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* -------------------- CALCULATOR (only if vehicle found) -------------------- */}
      {!loading && v ? (
        <section className="bg-black pb-16" data-testid="vin-result-calc-anchor">
          <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
            <CarCalculator
              vehicle={{
                title,
                make: v.make,
                vin: v.vin,
                price: v.price,
              }}
              initialVin={v.vin || query}
              initialPrice={v.price || null}
            />
            <div className="text-center mt-12">
              <Link
                to="/catalog"
                className="text-[14px] uppercase underline text-[#FEAE00] hover:brightness-110 tracking-wider"
                data-testid="vin-result-back-to-catalog"
              >
                Go back to catalog
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Have a question */}
      <section className="bg-black py-16">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <HaveAQuestionBlock />
        </div>
      </section>
    </div>
  );
}
