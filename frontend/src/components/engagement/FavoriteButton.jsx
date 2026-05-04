/**
 * FavoriteButton
 * --------------
 * Toggle a vehicle in the customer's favorites.
 *
 * Behaviour
 *  • Optimistic UI: heart fills/unfills immediately, rolls back on error
 *  • Auto-detects current state if `initialFavorite` is undefined and `vin`
 *    is provided (one cheap GET /api/favorites/check/:vin call)
 *  • If the user is not authenticated → toast.info + redirect to /login
 *    (with `redirect=` query param so they come back here after login)
 *  • Tasteful animation on toggle (heart pulse)
 *
 * Variants
 *  • `variant="icon"`   — round 36×36 icon button (use on grid/dropdown cards)
 *  • `variant="default"`— pill with icon + label (use on detail pages)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { userEngagementApi, getCustomerToken } from '../../lib/api';

export default function FavoriteButton({
  vin,
  vehicleId,
  snapshot,            // { title, make, model, year, price, image, lot_number, ... }
  initialFavorite,     // boolean | undefined  → if undefined, will probe /check
  size = 'md',
  variant = 'default', // 'default' | 'icon'
  showText = true,
  onToggle,
  className = '',
  testid,
}) {
  const navigate = useNavigate();
  const [isFav, setIsFav] = useState(Boolean(initialFavorite));
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);

  // Probe current state when not provided (and we have a token)
  useEffect(() => {
    let cancelled = false;
    if (initialFavorite !== undefined) {
      setIsFav(Boolean(initialFavorite));
      return () => {};
    }
    const v = (vin || vehicleId || '').toString();
    if (!v) return () => {};
    if (!getCustomerToken()) return () => {};
    (async () => {
      try {
        const res = await userEngagementApi.favorites.check(v);
        if (!cancelled && res?.success) setIsFav(Boolean(res.isFavorite));
      } catch {
        /* silent — defaults to false */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vin, vehicleId, initialFavorite]);

  const requireAuth = useCallback(() => {
    if (getCustomerToken()) return true;
    toast.info('Увійдіть, щоб додати до Обраного', {
      description: 'Перенаправляємо на сторінку входу…',
      duration: 2500,
    });
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    setTimeout(() => navigate(`/cabinet/login?redirect=${redirect}`), 600);
    return false;
  }, [navigate]);

  const handleClick = useCallback(
    async (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      if (busy) return;
      if (!requireAuth()) return;

      const id = (vin || vehicleId || '').toString().toUpperCase();
      if (!id) {
        toast.error('Немає VIN — неможливо зберегти');
        return;
      }

      const next = !isFav;
      // Optimistic
      setIsFav(next);
      setPulse(true);
      setBusy(true);
      try {
        if (next) {
          await userEngagementApi.favorites.add({
            vin: id,
            vehicleId: vehicleId || id,
            sourcePage: window.location.pathname,
            ...(snapshot || {}),
          });
          toast.success('Додано до Обраного', {
            description: snapshot?.title || id,
            duration: 2500,
          });
        } else {
          await userEngagementApi.favorites.remove(id);
          toast('Видалено з Обраного', {
            description: snapshot?.title || id,
            duration: 2000,
          });
        }
        onToggle?.(next);
      } catch (err) {
        // Rollback
        setIsFav(!next);
        if (err?.status === 401) {
          requireAuth();
        } else {
          toast.error(err?.message || 'Не вдалося оновити Обране');
        }
      } finally {
        setBusy(false);
        setTimeout(() => setPulse(false), 350);
      }
    },
    [busy, isFav, vin, vehicleId, snapshot, onToggle, requireAuth]
  );

  // ── Icon-only round button (compact) ───────────────────────────────
  if (variant === 'icon') {
    const dim = size === 'xs' ? 26 : size === 'sm' ? 32 : size === 'lg' ? 44 : 36;
    const iconSz = size === 'xs' ? 13 : size === 'sm' ? 16 : size === 'lg' ? 22 : 18;
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={isFav ? 'Видалити з Обраного' : 'Додати до Обраного'}
        aria-pressed={isFav}
        data-testid={testid || 'favorite-button-icon'}
        style={{ width: dim, height: dim }}
        className={[
          'relative inline-flex items-center justify-center rounded-full',
          'transition-all duration-200 select-none',
          isFav
            ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 ring-1 ring-rose-400/40'
            : 'bg-black/40 text-white/80 hover:bg-black/60 ring-1 ring-white/15 hover:text-rose-300',
          busy ? 'opacity-60 cursor-wait' : 'cursor-pointer',
          pulse ? 'scale-110' : 'scale-100',
          className,
        ].join(' ')}
      >
        <Heart
          size={iconSz}
          fill={isFav ? 'currentColor' : 'none'}
          strokeWidth={isFav ? 2 : 1.8}
          className={pulse ? 'animate-[ping_0.35s_ease-out_1]' : ''}
        />
      </button>
    );
  }

  // ── Default pill button (with optional label) ──────────────────────
  const sizeCls =
    size === 'sm'
      ? 'px-2.5 py-1.5 text-xs gap-1.5'
      : size === 'lg'
      ? 'px-4 py-2.5 text-base gap-2.5'
      : 'px-3 py-2 text-sm gap-2';
  const iconSz = size === 'sm' ? 16 : size === 'lg' ? 22 : 18;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-pressed={isFav}
      data-testid={testid || 'favorite-button'}
      className={[
        'inline-flex items-center font-medium rounded-lg border transition-all duration-200',
        sizeCls,
        isFav
          ? 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
          : 'bg-white/5 border-white/15 text-white/80 hover:bg-white/10 hover:border-rose-500/40 hover:text-rose-300',
        busy ? 'opacity-60 cursor-wait' : 'cursor-pointer',
        pulse ? 'scale-[1.03]' : 'scale-100',
        className,
      ].join(' ')}
    >
      <Heart
        size={iconSz}
        fill={isFav ? 'currentColor' : 'none'}
        strokeWidth={isFav ? 2 : 1.8}
        className={pulse ? 'animate-[ping_0.35s_ease-out_1]' : ''}
      />
      {showText && (
        <span>{busy ? '…' : isFav ? 'В Обраному' : 'В Обране'}</span>
      )}
    </button>
  );
}
