import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, GitCompare, Heart } from 'lucide-react';

const fallbackImage =
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=70';

/**
 * CarCardVertical — exactly matches Figma spec (560 × 764 container).
 * Built using responsive proportions so it scales down on small screens
 * but preserves the same internal ratios.
 */
export const CarCardVertical = ({ v, idx = 0 }) => {
  const id = v?.vin || v?._id || v?.id || idx;
  const img = (v?.images && v.images[0]) || v?.image_url || fallbackImage;
  const title =
    v?.title ||
    `${v?.year || ''} ${v?.make || ''} ${v?.model || ''}`.trim() ||
    'Vehicle';
  const mileage = v?.odometer
    ? `${v.odometer.toLocaleString()} KM`
    : v?.mileage || '65 900 KM';
  const engine =
    v?.engine_info ||
    (v?.engine_size && v?.fuel_type
      ? `${v.engine_size}L / ${String(v.fuel_type).toUpperCase()}`
      : '4.6L / PATROL');
  const drive = (v?.drive || v?.drivetrain || 'All-wheel').toUpperCase();
  const turnkey = v?.turnkey_price || v?.price_bulgaria || '5, 950 EURO';
  const average = v?.average_price || '16, 200 EURO';
  const tradingDate = v?.sale_date || v?.auction_date || 'Trading date — 34.13.2027';
  const timer = v?.auction_countdown || '1 d: 4h: 35m';

  return (
    <Link
      to={`/catalog/${encodeURIComponent(id)}`}
      className="group bg-[#1D1D1B] rounded-lg overflow-hidden flex flex-col transition-colors hover:bg-[#232321]"
      data-testid={`car-card-${idx}`}
    >
      {/* ---------- IMAGE ---------- */}
      <div className="relative aspect-[517/388] bg-black">
        <img
          src={img}
          alt={title}
          loading="lazy"
          onError={(e) => { e.currentTarget.src = fallbackImage; }}
          className="absolute inset-0 w-full h-full object-cover"
          data-testid={`car-card-${idx}-image`}
        />
        {/* Trading date badge — top-left, semi-transparent white */}
        <div
          className="absolute top-4 left-4 px-3 h-8 flex items-center text-[13px] font-medium text-black bg-white/70 rounded-sm"
          data-testid={`car-card-${idx}-trading-date`}
        >
          {tradingDate}
        </div>
        {/* Timer pill — bottom-left, amber */}
        <div
          className="absolute bottom-4 left-4 px-3 h-8 flex items-center gap-2 bg-[#FEAE00] text-black text-[13px] font-medium rounded-sm"
          data-testid={`car-card-${idx}-timer`}
        >
          <Clock size={16} strokeWidth={2} />
          <span>{timer}</span>
        </div>
        {/* Compare + favorite icons — bottom-right circular outline */}
        <div className="absolute bottom-4 right-4 flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="w-8 h-8 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] bg-black/20 hover:bg-[#FEAE00] hover:text-black transition-colors"
            aria-label="Compare"
            data-testid={`car-card-${idx}-compare`}
          >
            <GitCompare size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="w-8 h-8 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] bg-black/20 hover:bg-[#FEAE00] hover:text-black transition-colors"
            aria-label="Add to favorites"
            data-testid={`car-card-${idx}-favorite`}
          >
            <Heart size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ---------- TITLE ---------- */}
      <div className="px-6 pt-6 pb-4">
        <h3
          className="text-white font-bold leading-tight"
          style={{ fontSize: 24 }}
          data-testid={`car-card-${idx}-title`}
        >
          {title}
        </h3>
      </div>

      {/* ---------- MAIN INFO: left price box + right specs ---------- */}
      <div className="px-6 pb-4 grid grid-cols-[1fr_1fr] gap-4">
        {/* Left: Black turnkey price box */}
        <div className="bg-black rounded-lg px-4 py-4 flex flex-col justify-between min-h-[120px]">
          <div className="text-[14px] text-[#EFEFEF] leading-snug">
            Estimated turnkey price in Bulgaria
          </div>
          <div
            className="text-[#FEAE00] font-bold uppercase tracking-wide mt-2"
            style={{ fontSize: 20 }}
            data-testid={`car-card-${idx}-turnkey-price`}
          >
            {turnkey}
          </div>
        </div>

        {/* Right: Mileage / Engine / Drive */}
        <div className="flex flex-col justify-center gap-3 pl-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-white capitalize">Mileage</span>
            <span
              className="text-[14px] font-bold uppercase text-[#FEAE00] text-right"
              data-testid={`car-card-${idx}-mileage`}
            >
              {mileage}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-white capitalize">Engine</span>
            <span className="text-[14px] font-bold uppercase text-[#FEAE00] text-right whitespace-nowrap">
              {engine}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-white capitalize">Drive</span>
            <span className="text-[14px] font-bold uppercase text-[#FEAE00] text-right">
              {drive}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- FOOTER: Average cost + More details button ---------- */}
      <div className="px-6 pb-6 pt-4 mt-auto flex items-end justify-between gap-4">
        <div>
          <div className="text-[14px] text-[#EFEFEF] mb-1">Average cost in Bulgaria</div>
          <div
            className="text-[14px] font-bold uppercase text-[#FEAE00]"
            data-testid={`car-card-${idx}-average-price`}
          >
            {average}
          </div>
        </div>
        <span
          className="inline-flex items-center justify-center bg-[#FEAE00] hover:bg-[#FFBF2D] text-black text-[14px] font-medium rounded-md h-[45px] px-8 transition-colors"
          data-testid={`car-card-${idx}-more-details`}
        >
          More details
        </span>
      </div>
    </Link>
  );
};

export default CarCardVertical;
