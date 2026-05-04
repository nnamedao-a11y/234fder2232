import React from 'react';
import { ArrowUpRight, Star } from 'lucide-react';

const TESTIMONIALS = [
  {
    name: 'Georgi',
    text:
      'I really liked the approach — everything was clear, transparent, and without “surprises.” The car was chosen to fit my budget and wishes, and they were constantly in touch. I’m already recommending it to my friends!',
  },
  {
    name: 'Dimitar',
    text:
      'I bought a car from an auction — the team really knows their stuff. They explained all the nuances, helped me win the bid, and organized delivery. The result — top value for money.',
  },
];

const GoogleBadge = () => (
  <div className="inline-flex items-center gap-3 bg-black/60 border border-[#1E1E1E] rounded-md px-4 py-3">
    {/* Inline Google "G" logo */}
    <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
    <div className="leading-tight">
      <div className="flex items-center gap-2">
        <span className="text-white text-[18px] font-bold">4.9</span>
        <div className="flex items-center gap-0.5 text-[#FEAE00]">
          {[0, 1, 2, 3, 4].map((s) => (
            <Star key={s} size={12} fill="#FEAE00" strokeWidth={0} />
          ))}
        </div>
      </div>
      <div className="text-[11px] text-[#9A9A9A] uppercase tracking-wider">31 Google reviews</div>
    </div>
  </div>
);

export default function OurClientsSayBlock() {
  return (
    <section className="bg-black py-24 relative overflow-hidden" data-testid="our-clients-say-section">
      {/* Centered ghost number 460+ */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-x-0 top-[46%] flex items-center justify-center"
      >
        <span
          className="font-black leading-none"
          style={{
            fontSize: 'clamp(180px, 26vw, 420px)',
            color: 'rgba(255,255,255,0.025)',
            letterSpacing: '-0.03em',
          }}
        >
          460+
        </span>
      </div>

      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px] relative">
        {/* Heading */}
        <div className="relative flex flex-col items-center mb-16">
          <h2
            className="font-bold uppercase text-[#FEAE00] text-center leading-none"
            style={{ fontSize: 'clamp(34px, 4.2vw, 64px)' }}
          >
            Our Clients Say
          </h2>
          <div className="lg:absolute lg:right-0 lg:top-3 flex items-stretch gap-3 mt-6 lg:mt-0 max-w-[380px]">
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">[</span>
            <p className="text-[12px] md:text-[13px] uppercase tracking-[0.06em] leading-snug">
              <span className="text-[#FEAE00]">Satisfied clients</span>
              <br />
              <span className="text-white">are our priority</span>
            </p>
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">]</span>
          </div>
        </div>

        {/* Top row: Google + Tagline */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-10 items-end mb-12">
          <GoogleBadge />
          <div className="flex items-end gap-6">
            <h3
              className="font-bold uppercase text-[#FEAE00] leading-[1.02] flex-1"
              style={{ fontSize: 'clamp(26px, 2.6vw, 40px)' }}
            >
              What customers say
              <br />
              when they work with us
            </h3>
            <div className="w-14 h-14 rounded-full border border-[#FEAE00] flex items-center justify-center shrink-0">
              <ArrowUpRight size={22} className="text-[#FEAE00]" />
            </div>
          </div>
        </div>

        {/* Testimonial cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="bg-[#141414] border border-[#1E1E1E] rounded-md p-8 md:p-10"
              data-testid={`testimonial-${i}`}
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3A3A3A] to-[#1D1D1B] border border-[#2A2A2A] flex items-center justify-center">
                  <span className="text-[#FEAE00] font-bold text-[16px]">
                    {t.name.charAt(0)}
                  </span>
                </div>
                <span className="text-[20px] font-bold text-[#FEAE00]">{t.name}</span>
              </div>
              <p className="text-[15px] md:text-[16px] text-[#C8C8C8] leading-relaxed">{t.text}</p>
            </div>
          ))}
        </div>

        {/* Carousel dots */}
        <div className="flex items-center justify-center gap-3 mt-10">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`rounded-full ${
                i === 0 ? 'w-3 h-3 bg-[#FEAE00]' : 'w-2 h-2 bg-[#FEAE00]/30'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
