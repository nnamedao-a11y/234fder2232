import React from 'react';
import { Car, Bike, Truck, TruckIcon } from 'lucide-react';

const TYPES = [
  { id: 'car', Icon: Car, label: 'Car' },
  { id: 'moto', Icon: Bike, label: 'Moto' },
  { id: 'truck', Icon: Truck, label: 'Truck' },
  { id: 'van', Icon: TruckIcon, label: 'Van' },
];

const PRICES = [
  { id: '10-15', label: '10-15K' },
  { id: '15-25', label: '15-25K' },
  { id: '30-50', label: '30-50K' },
];

/**
 * DealsFilterBar — horizontal filter strip used on Top Vehicles Deals.
 * Left: vehicle type icon pill group
 * Center: price range chip group
 * Right: proposals counter
 */
export const DealsFilterBar = ({ type, setType, price, setPrice, proposals }) => {
  return (
    <div className="flex flex-wrap items-center gap-6 justify-between" data-testid="deals-filter-bar">
      {/* Type + Price combined pill */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="inline-flex items-center bg-transparent border border-[#555452] rounded-md h-[45px] px-1">
          {TYPES.map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setType(id)}
              aria-label={label}
              data-testid={`deals-type-${id}`}
              className={`h-[37px] w-[54px] flex items-center justify-center rounded transition-colors ${
                type === id ? 'bg-[#FEAE00] text-black' : 'text-white hover:text-[#FEAE00]'
              }`}
            >
              <Icon size={20} />
            </button>
          ))}
        </div>

        <div className="inline-flex items-center bg-transparent border border-[#555452] rounded-md h-[45px] overflow-hidden">
          {PRICES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPrice(p.id)}
              data-testid={`deals-price-${p.id}`}
              className={`h-full px-6 text-[13px] font-medium uppercase tracking-wide transition-colors ${
                price === p.id ? 'bg-[#FEAE00] text-black' : 'text-white hover:text-[#FEAE00]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Proposals counter */}
      <div
        className="text-[12px] tracking-[0.18em] uppercase text-[#EFEFEF]"
        data-testid="deals-proposals-count"
      >
        Proposals — {proposals}
      </div>
    </div>
  );
};

export default DealsFilterBar;
