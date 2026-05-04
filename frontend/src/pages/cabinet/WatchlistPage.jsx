/**
 * Watchlist Page (Customer Cabinet)
 *
 * /cabinet/:customerId/watchlist
 *
 * Shows VINs the customer registered to be notified about. Real-time updates
 * arrive via Socket.IO `car_found` event — a toast pops up AND the matching
 * row flips to "notified".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check, Trash2, ExternalLink, Loader2, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { io } from 'socket.io-client';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (_) {
    return String(iso);
  }
};

export default function WatchlistPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/cabinet/watchlist`);
      if (res.data?.success) {
        setItems(Array.isArray(res.data.items) ? res.data.items : []);
      }
    } catch (e) {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Realtime: socket.io "car_found" for the signed-in user's room
  useEffect(() => {
    let socket;
    try {
      socket = io(API_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
      });
      socket.on('connect', () => {
        if (customerId) socket.emit('join', { room: `user_${customerId}` });
      });
      socket.on('car_found', (payload) => {
        toast.success(
          `Vehicle found — VIN ${payload.vin}${payload.title ? ' · ' + payload.title : ''}`,
          { duration: 8000 }
        );
        fetchList();
      });
      socket.on('public:car_found', (payload) => {
        toast.info(`New match: ${payload.title || payload.vin}`, { duration: 5000 });
      });
    } catch (_e) {
      /* socket unavailable */
    }
    return () => {
      try {
        if (socket) socket.disconnect();
      } catch (_) {}
    };
  }, [customerId, fetchList]);

  const remove = async (id) => {
    setBusy(id);
    try {
      const res = await axios.delete(`${API_URL}/api/public/search/watch/${id}`);
      if (res.data?.success) {
        toast.success('Removed from watchlist');
        setItems((prev) => prev.filter((it) => it.id !== id));
      } else {
        toast.error('Could not remove');
      }
    } catch (e) {
      toast.error('Could not remove');
    } finally {
      setBusy(null);
    }
  };

  const pending = items.filter((it) => !it.notified);
  const notified = items.filter((it) => it.notified);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-[#18181B]" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="watchlist-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber-100">
            <Bell size={22} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#18181B]">Watchlist</h1>
            <p className="text-[#71717A] text-[13px]">
              {items.length} VIN{items.length === 1 ? '' : 's'} being watched ·{' '}
              <span className="text-amber-700 font-semibold">{pending.length} pending</span>
              {notified.length > 0 ? (
                <>
                  {' · '}
                  <span className="text-emerald-700 font-semibold">{notified.length} matched</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/catalog')}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-[#FEAE00] text-[#18181B] text-[13px] font-semibold hover:bg-[#FFC347] transition-colors"
        >
          <Search size={16} />
          Browse catalog
        </button>
      </div>

      {/* Pending section */}
      <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#F4F4F5] flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
            <Bell size={13} className="text-amber-600" />
          </div>
          <h2 className="font-semibold text-[#18181B] text-[14px]">
            Pending ({pending.length})
          </h2>
          <span className="text-[11px] text-[#A1A1AA] ml-2">
            We scan BidMotors every hour — you'll be pinged instantly when any of these appear.
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="px-5 py-10 text-center text-[#A1A1AA] text-[13px]">
            No pending watchers. Paste a VIN into the search bar — when nothing is found,
            you'll be offered to add it here.
          </div>
        ) : (
          <ul className="divide-y divide-[#F4F4F5]">
            {pending.map((it) => (
              <li
                key={it.id}
                className="px-5 py-3 flex items-center gap-3 hover:bg-[#FAFAFA]"
                data-testid={`watchlist-pending-${it.vin}`}
              >
                <div className="w-10 h-10 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Bell size={15} className="text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] text-[#18181B] font-semibold truncate">
                    {it.vin}
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5">
                    Added {fmtTime(it.createdAt)}
                    {it.note ? <> · {it.note}</> : null}
                  </div>
                </div>
                <button
                  onClick={() => remove(it.id)}
                  disabled={busy === it.id}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white border border-[#E4E4E7] text-[11px] text-[#52525B] font-semibold hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-40 transition-colors"
                  data-testid={`watchlist-remove-${it.vin}`}
                >
                  {busy === it.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Matched section */}
      {notified.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#F4F4F5] flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check size={13} className="text-emerald-600" />
            </div>
            <h2 className="font-semibold text-[#18181B] text-[14px]">
              Matched ({notified.length})
            </h2>
          </div>
          <ul className="divide-y divide-[#F4F4F5]">
            {notified.map((it) => (
              <li
                key={it.id}
                className="px-5 py-3 flex items-center gap-3 hover:bg-[#FAFAFA]"
                data-testid={`watchlist-matched-${it.vin}`}
              >
                <div className="w-16 h-12 rounded-md bg-black/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {it.matched_image ? (
                    <img
                      src={it.matched_image}
                      alt={it.matched_title || it.vin}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Check size={15} className="text-emerald-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[#18181B] font-semibold truncate">
                    {it.matched_title || it.vin}
                  </div>
                  <div className="font-mono text-[11px] text-[#71717A] mt-0.5">
                    {it.vin}
                    {it.matched_lot ? <> · LOT {it.matched_lot}</> : null}
                    <> · matched {fmtTime(it.notifiedAt || it.notified_at)}</>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/vin/${encodeURIComponent(it.vin)}`)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#18181B] text-white text-[11px] font-semibold hover:bg-[#27272A] transition-colors"
                  data-testid={`watchlist-view-${it.vin}`}
                >
                  <ExternalLink size={11} />
                  View
                </button>
                <button
                  onClick={() => remove(it.id)}
                  disabled={busy === it.id}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white border border-[#E4E4E7] text-[11px] text-[#52525B] font-semibold hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-40 transition-colors"
                  data-testid={`watchlist-remove-matched-${it.vin}`}
                >
                  {busy === it.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
