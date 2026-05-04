import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, Zap, Globe2 } from 'lucide-react';

// Lamborghini Huracán — grey exotic GT (not BMW, intentionally different from hero)
const CAR_IMG =
  'https://images.pexels.com/photos/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1400';
const CAR_IMG_FALLBACK =
  'https://images.pexels.com/photos/193991/pexels-photo-193991.jpeg?auto=compress&cs=tinysrgb&w=1400';

/**
 * CalculateYourselfBlock — BIBI signature split block with a Porsche Taycan shot.
 */
export default function CalculateYourselfBlock() {
  const [vin, setVin] = useState('');
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    const v = (vin || '').trim();
    if (!v) {
      navigate('/calculator');
      return;
    }
    // Route VINs / LOTs through the unified vehicle-result page
    // (which also embeds the calculator prefilled once the vehicle is resolved).
    const clean = v.toUpperCase().replace(/[\s-]/g, '');
    navigate(`/vin/${encodeURIComponent(clean)}`);
  };

  return (
    <section className="bg-black py-20 md:py-28" data-testid="calculate-yourself-block">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
        <div className="relative rounded-md border border-[#FEAE00]/40 bg-[#0A0A0A] overflow-hidden">
          <div
            className="absolute -top-40 -left-20 w-[520px] h-[520px] rounded-full opacity-40 pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(254,174,0,0.25) 0%, transparent 60%)' }}
          />
          <div
            className="absolute -bottom-32 -right-20 w-[480px] h-[480px] rounded-full opacity-30 pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(254,174,0,0.2) 0%, transparent 60%)' }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 relative">
            <div className="lg:col-span-6 relative min-h-[440px] lg:min-h-[620px] overflow-hidden">
              <img
                src={CAR_IMG}
                alt="Lamborghini Huracán turnkey calculation"
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.src = CAR_IMG_FALLBACK;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />

              <span className="absolute top-6 left-6 w-10 h-10 border-l-2 border-t-2 border-[#FEAE00]" />
              <span className="absolute top-6 right-6 w-10 h-10 border-r-2 border-t-2 border-[#FEAE00]" />
              <span className="absolute bottom-6 left-6 w-10 h-10 border-l-2 border-b-2 border-[#FEAE00]" />
              <span className="absolute bottom-6 right-6 w-10 h-10 border-r-2 border-b-2 border-[#FEAE00]" />

              <div className="absolute bottom-10 left-10 right-10 flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 border border-[#FEAE00]/40 text-white text-[12px] uppercase tracking-wider backdrop-blur-sm">
                  <ShieldCheck size={14} className="text-[#FEAE00]" />
                  Price Guarantee
                </span>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 border border-[#FEAE00]/40 text-white text-[12px] uppercase tracking-wider backdrop-blur-sm">
                  <Zap size={14} className="text-[#FEAE00]" />
                  Live Rates
                </span>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 border border-[#FEAE00]/40 text-white text-[12px] uppercase tracking-wider backdrop-blur-sm">
                  <Globe2 size={14} className="text-[#FEAE00]" />
                  3 Regions
                </span>
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-col justify-center p-8 md:p-14 lg:p-16 relative">
              <div className="flex items-center gap-2 mb-6">
                <span className="text-[#FEAE00] text-[22px] leading-none font-light">[</span>
                <span className="text-[12px] md:text-[13px] tracking-[0.18em] uppercase text-[#FEAE00]">
                  instant calculator
                </span>
                <span className="text-[#FEAE00] text-[22px] leading-none font-light">]</span>
              </div>

              <h2
                className="font-bold uppercase leading-[1.02] tracking-[-0.01em] mb-6"
                style={{ fontSize: 'clamp(34px, 3.8vw, 58px)' }}
              >
                <span className="block text-[#FEAE00]">Calculate a car</span>
                <span className="block text-white">Yourself —</span>
                <span className="block text-white">With a price guarantee</span>
              </h2>

              <p className="text-[15px] md:text-[17px] text-[#C8C8C8] leading-relaxed mb-10 max-w-[520px]">
                Pull any lot, VIN or catalog item from the USA, Europe or Korea and get the full turnkey
                price to Bulgaria in seconds — shipping, customs, adaptation and registration included.
              </p>

              <div className="grid grid-cols-3 gap-6 mb-10 max-w-[520px]">
                <div>
                  <div className="text-[24px] md:text-[28px] font-bold text-[#FEAE00] leading-none">5K+</div>
                  <div className="text-[11px] uppercase tracking-wider text-[#8A8A8A] mt-2">live lots</div>
                </div>
                <div>
                  <div className="text-[24px] md:text-[28px] font-bold text-[#FEAE00] leading-none">± 0€</div>
                  <div className="text-[11px] uppercase tracking-wider text-[#8A8A8A] mt-2">markup lock</div>
                </div>
                <div>
                  <div className="text-[24px] md:text-[28px] font-bold text-[#FEAE00] leading-none">30s</div>
                  <div className="text-[11px] uppercase tracking-wider text-[#8A8A8A] mt-2">to quote</div>
                </div>
              </div>

              <form onSubmit={submit} className="max-w-[520px]" data-testid="calc-yourself-form">
                <label className="block text-[11px] uppercase tracking-[0.18em] text-[#FEAE00] mb-3">
                  VIN or lot number
                </label>
                <div className="flex items-center h-[56px] border border-[#FEAE00]/60 rounded-md bg-black/40 focus-within:border-[#FEAE00] transition-colors">
                  <Search size={18} className="ml-5 text-[#FEAE00]" />
                  <input
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    placeholder="Search by VIN or lot number"
                    className="flex-1 bg-transparent border-0 px-4 text-[14px] text-white placeholder-[#6A6A6A] focus:outline-none"
                    data-testid="calc-yourself-vin-input"
                  />
                </div>

                <button
                  type="submit"
                  className="btn-amber w-full mt-5 h-[56px] text-[15px]"
                  data-testid="calc-yourself-submit"
                >
                  Calculate
                </button>
              </form>

              <div className="mt-8">
                <Link
                  to="/catalog"
                  className="text-[14px] uppercase underline text-[#FEAE00] hover:brightness-110 tracking-wide"
                  data-testid="calc-yourself-all-catalog"
                >
                  All catalog +
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
