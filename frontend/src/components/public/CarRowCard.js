import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, GitCompare, Copy } from 'lucide-react';
import { toast } from 'sonner';

// Rotating fallback images so cards visually differ even when backend returns no image
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=70',
  'https://images.pexels.com/photos/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'https://images.pexels.com/photos/193991/pexels-photo-193991.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1200&q=70',
  'https://images.pexels.com/photos/3954445/pexels-photo-3954445.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1200&q=70',
];

const pickFallback = (idx = 0) => FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length];

const Label = ({ children }) => (
  <span className="text-[13px] text-[#9A9A9A] capitalize whitespace-nowrap">{children}</span>
);
const Value = ({ children }) => (
  <span className="text-[13px] font-bold uppercase text-[#FEAE00] whitespace-nowrap overflow-hidden text-ellipsis">{children || '—'}</span>
);

const copy = (text) => {
  try {
    navigator.clipboard.writeText(text || '');
    toast.success('Copied');
  } catch (_) {
    /* noop */
  }
};

export const CarRowCard = ({ v, idx = 0 }) => {
  const id = v.vin || v._id || v.id;
  const img = (v.images && v.images[0]) || v.image_url || pickFallback(idx);
  const title = v.title || `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle';
  const lot = v.lot_number || v.lot || v.lotNumber || '—';
  const mileage = v.odometer
    ? `${Number(v.odometer).toLocaleString()} ${v.odometer_unit || 'km'}`
    : '—';
  const engine =
    v.engine ||
    v.engine_info ||
    (v.fuel_type ? `${v.engine_size || ''} ${v.fuel_type}`.trim() : '—');
  const drive = v.drive || v.drivetrain || v.transmission || '—';
  const damage = v.damage_primary || v.damage || '—';
  const condition = v.condition || v.quality || '—';
  const auction = v.auction_name || v.auction || v.source || '—';
  const price = v.price || v.current_bid || '2,550 EURO';
  const date = v.sale_date || v.auction_date || '—';

  return (
    <div
      className="bg-[#0F0F0F] border border-[#1E1E1E] rounded-md overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] xl:grid-cols-[400px_1fr_220px] gap-5 p-5 hover:border-[#FEAE00]/40 transition-colors"
      data-testid={`car-row-${idx}`}
    >
      <Link to={`/catalog/${encodeURIComponent(id)}`} className="block">
        <img
          src={img}
          alt={title}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = pickFallback(idx + 1);
          }}
          className="w-full h-[220px] md:h-[280px] xl:h-[320px] object-cover rounded"
          data-testid={`car-row-${idx}-image`}
        />
      </Link>
      <div className="flex flex-col gap-3 min-w-0">
        <Link
          to={`/catalog/${encodeURIComponent(id)}`}
          className="text-[20px] md:text-[22px] xl:text-[24px] font-bold text-white hover:text-[#FEAE00] transition-colors leading-tight"
          data-testid={`car-row-${idx}-title`}
        >
          {title}
        </Link>
        <div className="flex flex-col gap-1 text-[12px] uppercase text-[#7A7A7A]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">LOT: #{lot}</span>
            <button onClick={() => copy(lot)} className="hover:text-[#FEAE00] shrink-0" aria-label="Copy LOT">
              <Copy size={13} />
            </button>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">VIN: {v.vin || '—'}</span>
            <button
              onClick={() => copy(v.vin)}
              className="hover:text-[#FEAE00] shrink-0"
              aria-label="Copy VIN"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[90px_1fr] md:grid-cols-[100px_1fr] gap-x-4 gap-y-2 mt-3 min-w-0">
          <Label>Mileage</Label>
          <Value>{mileage}</Value>
          <Label>Engine</Label>
          <Value>{engine}</Value>
          <Label>Drive</Label>
          <Value>{drive}</Value>
          <Label>Damage</Label>
          <Value>{damage}</Value>
          <Label>Condition</Label>
          <Value>{condition}</Value>
          <Label>Auction</Label>
          <Value>{auction}</Value>
        </div>
      </div>
      <div className="flex flex-col justify-between md:col-span-2 xl:col-span-1 md:border-t xl:border-t-0 md:border-[#1E1E1E] md:pt-4 xl:pt-0">
        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            className="w-8 h-8 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors"
            aria-label="Compare"
            data-testid={`car-row-${idx}-compare`}
          >
            <GitCompare size={14} />
          </button>
          <button
            type="button"
            className="w-8 h-8 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors"
            aria-label="Favorite"
            data-testid={`car-row-${idx}-favorite`}
          >
            <Heart size={14} />
          </button>
        </div>
        <div className="flex flex-row xl:flex-col gap-6 xl:gap-3 mt-4 xl:mt-6 flex-wrap items-start xl:items-stretch">
          <div className="min-w-[120px]">
            <div className="text-[12px] uppercase tracking-wider text-[#9A9A9A]">Current rate</div>
            <div
              className="text-[20px] font-bold uppercase text-[#FEAE00] mt-1 whitespace-nowrap"
              data-testid={`car-row-${idx}-price`}
            >
              {price}
            </div>
          </div>
          <div className="min-w-[120px]">
            <div className="text-[12px] uppercase tracking-wider text-[#9A9A9A]">Auction date</div>
            <div className="text-[14px] font-bold uppercase text-white mt-1 whitespace-nowrap">{date}</div>
          </div>
          <Link
            to={`/catalog/${encodeURIComponent(id)}`}
            className="btn-amber w-full xl:mt-2 min-w-[180px]"
            data-testid={`car-row-${idx}-cta`}
          >
            Exact cost in Bulgaria
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CarRowCard;
