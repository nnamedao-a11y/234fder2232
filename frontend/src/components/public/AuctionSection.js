/**
 * Auction Section Component
 * 
 * Секція з аукціонами (hot, ending soon, etc.)
 */

import React from 'react';
import VehicleCard from './VehicleCard';

const AuctionSection = ({ title, icon: Icon, data, emptyText }) => {
  if (!data?.length && !emptyText) return null;

  return (
    <section className="py-12" data-testid={`section-${title?.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-3 mb-6">
          {Icon && <Icon size={28} weight="fill" className="text-zinc-800" />}
          <h2 className="text-2xl font-bold text-zinc-900">{title}</h2>
          {data?.length > 0 && (
            <span className="bg-zinc-100 text-zinc-600 text-sm px-3 py-1 rounded-full">
              {data.length}
            </span>
          )}
        </div>

        {data?.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {data.map((item) => (
              <VehicleCard key={item._id || item.id || item.vin} vehicle={item} useSlug={true} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-zinc-100 rounded-xl">
            <p className="text-zinc-500">{emptyText || 'Немає даних'}</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default AuctionSection;
