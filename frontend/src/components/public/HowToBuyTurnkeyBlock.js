import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, MessageSquare, Search, Ship, Car } from 'lucide-react';

// Partner brands per region (textual chips for a cleaner variant look)
const PARTNERS = {
  usa: ['Copart', 'IAAI', 'Manheim', 'CARFAX'],
  europe: ['Mobile.de', 'AutoScout24', 'Openlane'],
  korea: ['Encar', 'KBChachacha', 'SK Encar'],
};

const STEPS = [
  {
    n: 1,
    icon: FileText,
    title: 'Send an application',
    text: 'Drop a VIN, a lot link or just the model you want. We pick it up instantly in the dashboard.',
  },
  {
    n: 2,
    icon: MessageSquare,
    title: 'Discuss the details',
    text: 'Budget, timing, shipping lane and spec preferences. You get a locked turnkey quote.',
  },
  {
    n: 3,
    icon: Search,
    title: 'We source & buy',
    text: 'Real-time bidding on our side, inspection reports in yours. We win the lot and pay it out.',
  },
  {
    n: 4,
    icon: Ship,
    title: 'Customs + keys in Bulgaria',
    text: 'Sea freight to a European port, customs clearance, adaptation, registration — you just drive.',
  },
];

const RegionBlock = ({ label, partners, accent = false }) => (
  <div
    className={`rounded-md border ${
      accent ? 'border-[#FEAE00]' : 'border-[#2A2A2A]'
    } p-6 bg-[#0C0C0C] relative overflow-hidden`}
  >
    {accent && (
      <div
        className="absolute -top-16 -right-16 w-40 h-40 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(254,174,0,0.18) 0%, transparent 65%)',
        }}
      />
    )}
    <div className="flex items-center gap-3 mb-5">
      <span className="w-2 h-2 rounded-full bg-[#FEAE00]" />
      <span className="text-[11px] uppercase tracking-[0.18em] text-[#8A8A8A]">from</span>
    </div>
    <div className="text-[26px] md:text-[32px] font-bold text-white uppercase leading-none mb-5">
      {label}
    </div>
    <div className="flex flex-wrap gap-2">
      {partners.map((p) => (
        <span
          key={p}
          className="text-[11px] px-3 py-1.5 rounded-full bg-black border border-[#2A2A2A] text-[#C8C8C8] uppercase tracking-wider"
        >
          {p}
        </span>
      ))}
    </div>
  </div>
);

export default function HowToBuyTurnkeyBlock() {
  return (
    <section
      className="relative bg-black py-24 overflow-hidden"
      data-testid="how-to-buy-turnkey-section"
    >
      {/* Decorative dashed road line (centered, vertical) */}
      <div
        className="hidden lg:block absolute left-1/2 top-0 bottom-0 -translate-x-1/2 pointer-events-none"
        aria-hidden="true"
        style={{
          width: 2,
          backgroundImage:
            'repeating-linear-gradient(to bottom, #FEAE00 0, #FEAE00 12px, transparent 12px, transparent 28px)',
          opacity: 0.25,
        }}
      />

      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px] relative">
        {/* Heading */}
        <div className="relative flex flex-col items-center mb-16">
          <h2
            className="font-bold uppercase text-center leading-[1.02]"
            style={{ fontSize: 'clamp(34px, 4.2vw, 64px)' }}
          >
            <span className="block text-[#FEAE00]">How to buy</span>
            <span className="block text-white">A turnkey car</span>
          </h2>
          <div className="lg:absolute lg:right-0 lg:top-3 flex items-stretch gap-3 mt-6 lg:mt-0 max-w-[380px]">
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">[</span>
            <p className="text-[12px] md:text-[13px] uppercase tracking-[0.06em] leading-snug">
              <span className="text-[#FEAE00]">Three origins.</span>
              <br />
              <span className="text-white">One turnkey price to Bulgaria.</span>
            </p>
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">]</span>
          </div>
        </div>

        {/* ===== REGIONS ROW ===== */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
          <RegionBlock label="Europe" partners={PARTNERS.europe} />
          <RegionBlock label="Korea" partners={PARTNERS.korea} accent />
          <RegionBlock label="The USA" partners={PARTNERS.usa} />
        </div>

        {/* Centered decorative small car icon */}
        <div className="flex justify-center mb-10">
          <div className="w-12 h-12 rounded-full bg-[#FEAE00] flex items-center justify-center">
            <Car size={22} className="text-black" />
          </div>
        </div>

        {/* ===== STEPS TIMELINE — horizontal, 4 items ===== */}
        <div className="relative">
          {/* Connector line */}
          <div
            className="hidden lg:block absolute top-6 left-[8%] right-[8%] h-[2px]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, #FEAE00 0, #FEAE00 10px, transparent 10px, transparent 22px)',
              opacity: 0.4,
            }}
            aria-hidden="true"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-6">
            {STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="text-center px-2">
                  {/* Step node */}
                  <div className="relative mx-auto w-12 h-12 rounded-full border-2 border-[#FEAE00] bg-black flex items-center justify-center mb-5">
                    <Icon size={18} className="text-[#FEAE00]" />
                  </div>
                  <div className="text-[13px] uppercase tracking-[0.18em] text-[#FEAE00] mb-3">
                    {s.n}/ Step
                  </div>
                  <h4 className="text-[18px] md:text-[20px] font-bold text-white uppercase leading-tight mb-3">
                    {s.title}
                  </h4>
                  <p className="text-[13px] md:text-[14px] text-[#9A9A9A] leading-relaxed max-w-[260px] mx-auto">
                    {s.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== CTA ROW ===== */}
        <div className="mt-20 flex flex-col md:flex-row items-center justify-center gap-6">
          <Link
            to="/contacts"
            className="btn-amber h-[56px] px-14 text-[15px]"
            data-testid="turnkey-pick-up-cta"
          >
            Pick up a car
            <ArrowRight size={16} />
          </Link>

          <a
            href="https://viber.com"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-4 px-6 h-[56px] rounded-md border border-[#2A2A2A] bg-[#0C0C0C] hover:border-[#FEAE00]/60 transition-colors"
            data-testid="turnkey-viber-join"
          >
            <span className="text-left leading-tight">
              <span className="block text-[13px] text-white uppercase tracking-wider">
                Join our group
              </span>
              <span className="block text-[11px] text-[#8A8A8A] uppercase tracking-wider">
                and get the hottest offers
              </span>
            </span>
            <span className="w-10 h-10 rounded-full bg-[#7C3AED] flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
                className="text-white"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.01 2 10.96c0 2.62 1.24 4.97 3.26 6.58L5 22l4.05-2.14c.95.18 1.93.28 2.95.28 5.52 0 10-4.01 10-8.96S17.52 2 12 2zm5.05 12.39c-.26.68-1.17 1.27-1.95 1.43-.52.11-1.2.2-3.48-.68-2.92-1.12-4.78-4.02-4.92-4.21-.14-.19-1.15-1.56-1.15-2.98 0-1.42.72-2.11.98-2.4.24-.26.55-.33.75-.33.2 0 .4.01.57.02.18.01.43-.07.68.53.26.63.9 2.17.98 2.33.08.16.14.35.02.54-.11.19-.17.31-.33.49-.16.18-.34.39-.48.52-.16.16-.33.33-.14.65.19.32.85 1.3 1.82 2.11 1.25 1.05 2.31 1.38 2.64 1.53.33.15.52.13.72-.08.19-.21.83-.91 1.05-1.22.22-.32.44-.26.74-.16.29.11 1.85.82 2.17.98.32.16.53.24.61.37.08.13.08.76-.17 1.44z" />
              </svg>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
