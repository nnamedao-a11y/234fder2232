import React from 'react';

const CAR_IMG =
  'https://images.pexels.com/photos/3954445/pexels-photo-3954445.jpeg?auto=compress&cs=tinysrgb&w=900';

const ADVANTAGES = [
  {
    title: 'Large selection',
    text: 'More trim levels, colors and rare models you won’t find in local dealers.',
  },
  {
    title: 'Much cheaper',
    text:
      'Even with delivery and customs clearance, the car often comes out 20–50% cheaper than a local purchase.',
  },
  {
    title: 'Better trim levels',
    text:
      'More options — better multimedia, higher level of comfort, factory packs as standard.',
  },
  {
    title: 'Transparent history',
    text: 'Full VIN checks (Carfax, AutoCheck) — you see the real story before you bid.',
  },
];

const Bullet = ({ title, text }) => (
  <div>
    <div className="text-[18px] md:text-[20px] font-bold text-white">
      <span className="text-[#FEAE00] mr-2">/</span>
      {title}
    </div>
    <p className="mt-3 text-[14px] md:text-[15px] text-[#9A9A9A] leading-relaxed max-w-[340px]">
      {text}
    </p>
  </div>
);

export default function CarAdvantagesBlock() {
  return (
    <section className="bg-black py-24 relative overflow-hidden" data-testid="car-advantages-section">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px] relative">
        {/* Small header */}
        <div className="text-center mb-16">
          <div className="font-bold uppercase tracking-[-0.01em] leading-[1.1]" style={{ fontSize: 'clamp(26px, 2.6vw, 40px)' }}>
            <span className="text-[#FEAE00]">Why you pay less</span>
            <span className="text-white"> — and get more</span>
          </div>
        </div>

        {/* Giant stacked headline overlay */}
        <div className="relative" style={{ minHeight: '520px' }}>
          {/* Layer 1 — big CAR (white) */}
          <div
            className="absolute left-0 top-0 font-black uppercase text-white leading-[0.85] pointer-events-none select-none"
            style={{ fontSize: 'clamp(120px, 18vw, 280px)', letterSpacing: '-0.04em' }}
            aria-hidden="true"
          >
            CAR
          </div>
          {/* Layer 2 — ADVANTAGES (dark ghost) offset right */}
          <div
            className="absolute right-0 top-[60px] md:top-[80px] font-black uppercase leading-[0.85] pointer-events-none select-none"
            style={{
              fontSize: 'clamp(80px, 12vw, 200px)',
              letterSpacing: '-0.03em',
              color: 'rgba(255,255,255,0.06)',
              textAlign: 'right',
              maxWidth: '80%',
            }}
            aria-hidden="true"
          >
            ADVANTAGES
          </div>

          {/* Content overlay grid — 2 columns of advantages with a center car */}
          <div className="relative pt-[220px] md:pt-[260px] grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-10 lg:gap-12 items-start">
            {/* Left column */}
            <div className="flex flex-col gap-12">
              <Bullet title={ADVANTAGES[0].title} text={ADVANTAGES[0].text} />
              <Bullet title={ADVANTAGES[2].title} text={ADVANTAGES[2].text} />
            </div>

            {/* Center car image */}
            <div className="hidden lg:flex w-[320px] justify-center items-center">
              <div
                className="relative w-full aspect-[5/4] rounded-md overflow-hidden"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 50%, rgba(254,174,0,0.15) 0%, transparent 70%)',
                }}
              >
                <img
                  src={CAR_IMG}
                  alt="Premium performance car"
                  className="absolute inset-0 w-full h-full object-cover opacity-90"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                {/* Corner brackets */}
                <span className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-[#FEAE00]" />
                <span className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-[#FEAE00]" />
                <span className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-[#FEAE00]" />
                <span className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-[#FEAE00]" />
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-12 lg:items-start">
              <Bullet title={ADVANTAGES[1].title} text={ADVANTAGES[1].text} />
              <Bullet title={ADVANTAGES[3].title} text={ADVANTAGES[3].text} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
