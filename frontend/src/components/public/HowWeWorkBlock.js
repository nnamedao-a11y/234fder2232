import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import HaveAQuestionBlock from './HaveAQuestionBlock';

/**
 * HowWeWorkBlock — variant of the reference design.
 * BIBI signature: bracket-framed tagline on the right, [N] corner numbering.
 * Cards keep the three-plan UX (Standard / Turnkey / Sourcing + Delivery + Support)
 * with the Turnkey plan rendered in amber as the "popular" highlight.
 */
const PLANS = [
  {
    key: 'standard',
    num: 1,
    tag: 'Standard',
    desc: 'Sourcing, inspection, bidding, purchase, and delivery to Bulgaria.',
    accent: 'From there, you handle everything yourself.',
    popular: false,
  },
  {
    key: 'turnkey',
    num: 2,
    tag: 'Turnkey',
    desc:
      'Full-service with zero involvement required: sourcing, inspection, purchase, delivery, adaptation, technical inspection, and registration.',
    accent: 'You simply pick up a ready-to-drive car.',
    popular: true,
  },
  {
    key: 'sourcing',
    num: 3,
    tag: 'Sourcing + Delivery\n+ Support',
    desc: 'Sourcing, inspection, purchase, and delivery.',
    accent:
      'You handle registration, and we guide you to trusted service partners for adaptation and repairs.',
    popular: false,
  },
];

const Bracket = ({ children }) => (
  <span className="inline-flex items-center gap-2">
    <span className="text-[22px] leading-none font-light select-none">[</span>
    <span>{children}</span>
    <span className="text-[22px] leading-none font-light select-none">]</span>
  </span>
);

export default function HowWeWorkBlock() {
  return (
    <section className="bg-black py-24" data-testid="how-we-work-section">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
        {/* Heading row — centered title + right-side bracketed tagline (variant twist) */}
        <div className="relative flex flex-col items-center mb-14">
          <h2
            className="font-bold uppercase text-[#FEAE00] text-center leading-none"
            style={{ fontSize: 'clamp(34px, 4.2vw, 64px)' }}
          >
            How We Work
          </h2>
          <div className="lg:absolute lg:right-0 lg:top-3 flex items-stretch gap-3 mt-6 lg:mt-0 max-w-[400px]">
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">[</span>
            <p className="text-[12px] md:text-[13px] uppercase tracking-[0.06em] leading-snug">
              <span className="text-[#FEAE00]">We work for each client</span>
              <br />
              <span className="text-white">depending on the budget</span>
            </p>
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">]</span>
          </div>
        </div>

        {/* Three plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((p) => {
            const isAmber = p.popular;
            const base = isAmber ? 'bg-[#FEAE00]' : 'bg-[#141414]';
            const bracketColor = isAmber ? 'text-black/70' : 'text-[#FEAE00]';
            const titleColor = isAmber ? 'text-black' : 'text-[#FEAE00]';
            const descColor = isAmber ? 'text-black/80' : 'text-[#C8C8C8]';
            const accentColor = isAmber ? 'text-black' : 'text-white';
            return (
              <div
                key={p.key}
                className={`${base} rounded-md relative flex flex-col min-h-[560px] p-8 md:p-10 overflow-hidden`}
                style={
                  !isAmber
                    ? {
                        backgroundImage:
                          'radial-gradient(circle at 20% 0%, rgba(254,174,0,0.06), transparent 40%), linear-gradient(180deg, #141414 0%, #0C0C0C 100%)',
                      }
                    : {}
                }
                data-testid={`plan-card-${p.key}`}
              >
                {/* [N] bracketed number — top-left */}
                <div className={`absolute top-6 left-8 ${bracketColor} text-[13px] font-medium tracking-[0.06em]`}>
                  <Bracket>{p.num}</Bracket>
                </div>

                {/* [popular] pill — top-right of amber card */}
                {p.popular && (
                  <div className="absolute top-6 right-8 px-3 py-1 border border-black/70 rounded text-[11px] font-medium uppercase tracking-wider text-black">
                    <Bracket>popular</Bracket>
                  </div>
                )}

                {/* Title */}
                <div className="mt-14" />
                <h3
                  className={`font-bold uppercase leading-tight mb-8 whitespace-pre-line ${titleColor}`}
                  style={{ fontSize: 'clamp(26px, 2.1vw, 34px)' }}
                >
                  {p.tag}
                </h3>

                {/* Desc */}
                <p className={`text-[15px] md:text-[16px] leading-relaxed mb-8 ${descColor}`}>
                  {p.desc}
                </p>

                {/* Accent highlight line */}
                <p
                  className={`text-[18px] md:text-[20px] font-bold leading-snug mt-auto mb-8 ${accentColor}`}
                >
                  {p.accent}
                </p>

                {/* CTA — variant: outlined on amber card, solid on dark cards */}
                <Link
                  to="/contacts"
                  className={
                    isAmber
                      ? 'w-full h-[52px] inline-flex items-center justify-center gap-2 rounded bg-black text-[#FEAE00] font-semibold uppercase text-[13px] tracking-wider hover:bg-[#1D1D1B] transition-colors'
                      : 'w-full h-[52px] inline-flex items-center justify-center gap-2 rounded bg-[#FEAE00] text-black font-semibold uppercase text-[13px] tracking-wider hover:bg-[#FFBF2D] transition-colors'
                  }
                  data-testid={`plan-cta-${p.key}`}
                >
                  More details
                  <ArrowRight size={14} />
                </Link>
              </div>
            );
          })}
        </div>

        {/* Bottom: Have a question contact card */}
        <div className="mt-16">
          <HaveAQuestionBlock />
        </div>
      </div>
    </section>
  );
}
