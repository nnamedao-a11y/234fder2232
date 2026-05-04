/**
 * Favorites Page (Customer Cabinet)
 * ---------------------------------
 * /cabinet/:customerId/favorites
 *
 * Modernized grid of saved cars matching the BIBI cabinet light-theme
 * design system (white cards, neutral borders, accent rose for hearts,
 * amber for prices on hover).
 *
 * Uses GET /api/favorites/me and DELETE /api/favorites/{vin}.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Heart,
  Trash,
  Eye,
  ArrowsClockwise,
  CarSimple,
  MagnifyingGlass,
  Hash,
  WarningCircle,
} from '@phosphor-icons/react';

import { userEngagementApi } from '../../lib/api';

const fmtPrice = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  try {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  } catch {
    return `$${Math.round(n)}`;
  }
};

const fmtOdo = (v, unit) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('en-US')} ${unit || 'mi'}`;
};

const fmtDate = (s) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-white border border-[#E4E4E7] overflow-hidden">
      <div className="aspect-[16/10] bg-[#F4F4F5]" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-[#F4F4F5] rounded w-3/4" />
        <div className="h-3 bg-[#F4F4F5] rounded w-1/2" />
        <div className="h-3 bg-[#F4F4F5] rounded w-2/3" />
      </div>
    </div>
  );
}

function FavoriteCard({ item, onRemove, onOpen }) {
  const title =
    item.title ||
    [item.year, item.make, item.model, item.trim].filter(Boolean).join(' ') ||
    item.vin;
  const price = fmtPrice(item.price);
  const odo = fmtOdo(item.odometer, item.odometer_unit);
  const auction = item.auction_name || item.auction;
  const added = fmtDate(item.createdAt || item.created_at);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="group rounded-2xl bg-white border border-[#E4E4E7] hover:border-[#18181B] hover:shadow-md overflow-hidden cursor-pointer transition-all"
      onClick={onOpen}
      data-testid={`favorite-card-${item.vin}`}
    >
      {/* Image */}
      <div className="relative aspect-[16/10] bg-[#F4F4F5] overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#A1A1AA]">
            <CarSimple size={56} weight="duotone" />
          </div>
        )}

        {/* Top-right: heart remove */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item);
          }}
          title="Видалити з Обраного"
          aria-label="Remove from favorites"
          data-testid={`favorite-remove-${item.vin}`}
          className="absolute top-2.5 right-2.5 w-9 h-9 inline-flex items-center justify-center rounded-full bg-white/95 backdrop-blur text-rose-500 hover:bg-rose-500 hover:text-white shadow-md transition-all"
        >
          <Heart size={18} weight="fill" />
        </button>

        {/* Top-left: archived banner */}
        {item.archived ? (
          <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-medium ring-1 ring-amber-300">
            <WarningCircle size={14} weight="fill" />
            Не в продажу
          </div>
        ) : null}

        {/* Bottom-left: auction chip */}
        {auction ? (
          <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#18181B]/90 text-white text-[11px] font-medium">
            {auction}
          </div>
        ) : null}

        {/* Bottom-right: price chip */}
        {price ? (
          <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-md bg-amber-400 text-[#18181B] text-[12px] font-bold shadow">
            {price}
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className="text-[#18181B] font-semibold leading-tight line-clamp-1 group-hover:text-amber-600 transition-colors">
          {title}
        </h3>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#71717A]">
          <span className="inline-flex items-center gap-1">
            <Hash size={12} className="text-amber-500" />
            <span className="font-mono">{item.vin}</span>
          </span>
          {item.lot_number ? <span>LOT {item.lot_number}</span> : null}
          {odo ? <span>{odo}</span> : null}
        </div>
        {added ? (
          <p className="mt-2 text-[11px] text-[#A1A1AA]">Додано: {added}</p>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center gap-1.5 text-sm text-[#18181B] hover:text-amber-600 font-medium"
            data-testid={`favorite-view-${item.vin}`}
          >
            <Eye size={16} />
            Відкрити
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item);
            }}
            className="inline-flex items-center gap-1.5 text-sm text-[#A1A1AA] hover:text-rose-500 transition-colors"
            data-testid={`favorite-trash-${item.vin}`}
          >
            <Trash size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      try {
        if (showSpinner) setLoading(true);
        const data = await userEngagementApi.favorites.getMine();
        setItems(
          Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
            ? data.data
            : []
        );
      } catch (err) {
        if (err?.status === 401) {
          toast.info('Сесія завершена. Увійдіть знову.');
          navigate(
            '/cabinet/login?redirect=' + encodeURIComponent(window.location.pathname)
          );
        } else {
          toast.error(err?.message || 'Не вдалося завантажити Обране');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  const handleRemove = useCallback(
    async (item) => {
      const id = item.vin || item.vehicleId || item.id;
      if (!id) return;
      // Optimistic
      setItems((prev) =>
        prev.filter((x) => (x.vin || x.id) !== (item.vin || item.id))
      );
      try {
        await userEngagementApi.favorites.remove(id);
        toast('Видалено з Обраного', { description: item.title || id });
      } catch (err) {
        toast.error(err?.message || 'Не вдалося видалити');
        // Roll back: reload
        load(false);
      }
    },
    [load]
  );

  const handleOpen = useCallback(
    (item) => {
      const v = item.vin || item.vehicleId;
      if (v) navigate(`/vin/${encodeURIComponent(v)}`);
    },
    [navigate]
  );

  const total = items.length;

  return (
    <div className="space-y-6" data-testid="favorites-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-rose-100 ring-1 ring-rose-200">
            <Heart size={26} weight="fill" className="text-rose-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#18181B]">Обране</h1>
            <p className="text-sm text-[#71717A]">
              {total > 0 ? `${total} автомобілів` : 'Збережіть авто, щоб не загубити'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="favorites-refresh"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white text-[#18181B] border border-[#E4E4E7] hover:bg-[#F4F4F5] transition-colors text-sm disabled:opacity-60"
          >
            <ArrowsClockwise
              size={16}
              className={refreshing ? 'animate-spin' : ''}
            />
            Оновити
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#18181B] text-white hover:bg-[#27272A] transition-colors text-sm"
          >
            <MagnifyingGlass size={16} />
            Пошук за VIN
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[#E4E4E7] bg-white p-12 md:p-16 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-rose-50 ring-1 ring-rose-200 flex items-center justify-center mb-5">
            <Heart size={32} weight="duotone" className="text-rose-500" />
          </div>
          <h3 className="text-xl md:text-2xl font-semibold text-[#18181B]">
            Поки що немає авто в Обраному
          </h3>
          <p className="mt-2 text-[#71717A] max-w-md mx-auto">
            Знайдіть автомобіль на нашій платформі або введіть VIN — і
            натисніть{' '}
            <Heart
              size={14}
              weight="fill"
              className="inline text-rose-500 mx-0.5"
            />{' '}
            щоб зберегти його сюди.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/vehicles"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 text-[#18181B] font-semibold hover:bg-amber-300 transition-colors"
              data-testid="favorites-cta-catalog"
            >
              <CarSimple size={18} weight="fill" />
              Перейти в каталог
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#18181B] text-white border border-[#18181B] hover:bg-[#27272A] transition-colors"
              data-testid="favorites-cta-search"
            >
              <MagnifyingGlass size={18} />
              Пошук за VIN
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence>
            {items.map((it) => (
              <FavoriteCard
                key={it.vin || it.id}
                item={it}
                onRemove={handleRemove}
                onOpen={() => handleOpen(it)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
