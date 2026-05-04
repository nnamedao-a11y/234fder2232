import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

// Mercedes-AMG S-Class Cabriolet — premium open-top dream-car lifestyle
const BG_IMG =
  'https://images.pexels.com/photos/193991/pexels-photo-193991.jpeg?auto=compress&cs=tinysrgb&w=2400';
const BG_FALLBACK =
  'https://images.pexels.com/photos/3954445/pexels-photo-3954445.jpeg?auto=compress&cs=tinysrgb&w=2400';

export default function DreamCarCTABlock() {
  return (
    <section className="bg-black py-14" data-testid="dream-car-cta-section">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
        <div className="relative rounded-md overflow-hidden" style={{ minHeight: 520 }}>
          <img
            src={BG_IMG}
            alt="Premium driving lifestyle"
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = BG_FALLBACK;
            }}
          />
          {/* Darken overlay for left-side copy readability */}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* BIBI marker top-left */}
          <div className="absolute top-8 left-8 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FEAE00]" />
            <span className="text-[12px] uppercase tracking-[0.22em] text-[#FEAE00] font-bold">
              BIBI Cars
            </span>
          </div>

          <div className="relative px-8 md:px-14 lg:px-20 py-16 md:py-24 min-h-[520px] flex items-center">
            <div className="w-full grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 items-end">
              {/* Left — headline */}
              <div>
                <h2
                  className="font-bold uppercase leading-[1.02] tracking-[-0.01em]"
                  style={{ fontSize: 'clamp(36px, 4.6vw, 72px)' }}
                >
                  <span className="block text-[#FEAE00]">Want to drive</span>
                  <span className="block text-white">Your dream car?</span>
                </h2>
              </div>

              {/* Right — copy + CTA */}
              <div className="lg:pl-10">
                <p
                  className="text-[16px] md:text-[18px] text-white/90 leading-snug mb-8"
                  style={{ maxWidth: 420 }}
                >
                  Fill out the application and we will find the best offer for you —
                  turnkey to Bulgaria, no hidden fees.
                </p>
                <Link
                  to="/contacts"
                  className="btn-amber w-full md:w-auto h-[56px] px-12 text-[15px]"
                  data-testid="dream-car-cta-button"
                >
                  Contact Us
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
