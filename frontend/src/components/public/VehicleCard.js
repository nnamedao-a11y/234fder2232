/**
 * Vehicle Card Component
 * 
 * Картка авто для каталогу з ranking та timer
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Gauge, Fire, Lightning } from '@phosphor-icons/react';
import AuctionTimer from './AuctionTimer';

const VehicleCard = ({ vehicle, useSlug = false }) => {
  const {
    id,
    _id,
    vin,
    slug,
    title,
    make,
    model,
    year,
    price,
    currentBid,
    buyNowPrice,
    estimatedRetail,
    mileage,
    location,
    auctionLocation,
    images,
    primaryImage,
    auctionDate,
    rankingScore,
    lotNumber,
    damageType,
    primaryDamage,
    isFeatured,
  } = vehicle;

  const isHot = isFeatured || rankingScore >= 0.65;
  const displayTitle = title || `${year || ''} ${make || ''} ${model || ''}`.trim() || 'Авто';
  const displayImage = primaryImage || images?.[0] || '/images/car-placeholder.jpg';
  const displayPrice = price || currentBid || buyNowPrice || estimatedRetail;
  const displayLocation = location || auctionLocation;
  const displayDamage = damageType || primaryDamage;
  
  // Use slug for link if available, otherwise fallback to id
  const linkUrl = useSlug && slug ? `/cars/${slug}` : `/vehicle/${id || _id}`;

  return (
    <Link 
      to={linkUrl}
      className="group bg-white rounded-xl border border-zinc-200 overflow-hidden hover:shadow-lg hover:border-zinc-300 transition-all duration-300"
      data-testid={`vehicle-card-${vin}`}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100">
        <img
          src={displayImage}
          alt={displayTitle}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={(e) => {
            e.target.src = '/images/car-placeholder.jpg';
          }}
        />
        
        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          {isHot && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
              <Fire size={12} weight="fill" />
              HOT
            </span>
          )}
          {auctionDate && new Date(auctionDate).getTime() - Date.now() < 24 * 60 * 60 * 1000 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
              <Lightning size={12} weight="fill" />
              Скоро
            </span>
          )}
        </div>

        {/* Lot Number */}
        {lotNumber && (
          <div className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded">
            Лот #{lotNumber}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Title */}
        <h3 className="font-semibold text-zinc-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
          {displayTitle}
        </h3>

        {/* VIN */}
        <p className="text-xs text-zinc-400 font-mono mt-1">
          VIN: {vin}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-3 text-xs text-zinc-500">
          {mileage && (
            <span className="flex items-center gap-1">
              <Gauge size={14} />
              {mileage.toLocaleString()} mi
            </span>
          )}
          {displayLocation && (
            <span className="flex items-center gap-1">
              <MapPin size={14} />
              {displayLocation}
            </span>
          )}
        </div>

        {/* Damage */}
        {displayDamage && (
          <p className="text-xs text-amber-600 mt-2">
            Пошкодження: {displayDamage}
          </p>
        )}

        {/* Price & Timer */}
        <div className="flex items-end justify-between mt-4 pt-4 border-t border-zinc-100">
          <div>
            {displayPrice ? (
              <p className="text-xl font-bold text-zinc-900">
                ${displayPrice.toLocaleString()}
              </p>
            ) : (
              <p className="text-sm text-zinc-400">Ціна невідома</p>
            )}
          </div>

          {auctionDate && new Date(auctionDate) > new Date() && (
            <AuctionTimer date={auctionDate} />
          )}
        </div>
      </div>
    </Link>
  );
};

export default VehicleCard;
