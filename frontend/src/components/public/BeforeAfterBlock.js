import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Base car images \u2014 confirmed visual content for each slide
const ITEMS = [
  {
    name: 'BMW M5',
    img: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1400&q=80',
    order: '12.12.2025',
    finished: '12.04.2026',
    price: '6,500 EURO',
  },
  {
    name: 'Mercedes-AMG GT',
    img: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1400&q=80',
    order: '18.11.2025',
    finished: '14.03.2026',
    price: '72,400 EURO',
  },
  {
    name: 'Lamborghini Hurac\u00e1n',
    img: 'https://images.pexels.com/photos/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1400',
    order: '02.10.2025',
    finished: '28.02.2026',
    price: '189,900 EURO',
  },
  {
    name: 'Mercedes-Benz S Cabriolet',
    img: 'https://images.pexels.com/photos/193991/pexels-photo-193991.jpeg?auto=compress&cs=tinysrgb&w=1400',
    order: '05.09.2025',
    finished: '18.01.2026',
    price: '118,300 EURO',
  },
];

const Card = ({ item }) => (
  <div className="shrink-0 w-full md:w-[640px] lg:w-[760px] bg-[#0C0C0C] border border-[#1E1E1E] rounded-md p-6 md:p-8">
    <div className="grid grid-cols-2 gap-4">
      {/* / before */}
      <div>
        <div className="text-[13px] uppercase tracking-[0.18em] text-[#7A7A7A] mb-3">/ before</div>
        <div className="aspect-[4/3] rounded overflow-hidden">
          <img
            src={item.img}
            alt={`${item.name} before`}
            className="w-full h-full object-cover"
            loading="lazy"
            style={{ filter: 'grayscale(100%) contrast(1.1) brightness(0.85)' }}
          />
        </div>
      </div>
      {/* / after */}
      <div>
        <div className="text-[13px] uppercase tracking-[0.18em] text-[#FEAE00] mb-3">/ after</div>
        <div className="aspect-[4/3] rounded overflow-hidden">
          <img
            src={item.img}
            alt={`${item.name} after`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      </div>
    </div>

    <div className="mt-6 text-white text-[22px] md:text-[26px] font-bold uppercase">{item.name}</div>

    <div className="mt-5 grid grid-cols-3 gap-4 text-[12px] uppercase tracking-wider">
      <div>
        <div className="text-[#7A7A7A] mb-2">Order date</div>
        <div className="text-white text-[14px] font-medium">{item.order}</div>
      </div>
      <div className="border-l border-[#1E1E1E] pl-4">
        <div className="text-[#7A7A7A] mb-2">Finished car</div>
        <div className="text-white text-[14px] font-medium">{item.finished}</div>
      </div>
      <div className="border-l border-[#1E1E1E] pl-4">
        <div className="text-[#7A7A7A] mb-2">Turnkey price</div>
        <div className="text-[#FEAE00] text-[14px] font-bold">{item.price}</div>
      </div>
    </div>
  </div>
);

export default function BeforeAfterBlock() {
  const [active, setActive] = useState(0);
  const next = () => setActive((i) => (i + 1) % ITEMS.length);
  const prev = () => setActive((i) => (i - 1 + ITEMS.length) % ITEMS.length);

  return (
    <section className="bg-black py-24" data-testid="before-after-section">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
        {/* Heading */}
        <div className="relative flex flex-col items-center mb-14">
          <h2
            className="font-bold uppercase text-[#FEAE00] text-center leading-none"
            style={{ fontSize: 'clamp(34px, 4.2vw, 64px)' }}
          >
            Before and After
          </h2>
          <div className="lg:absolute lg:left-0 lg:top-3 flex items-stretch gap-3 mt-6 lg:mt-0 max-w-[380px]">
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">[</span>
            <p className="text-[12px] md:text-[13px] uppercase tracking-[0.06em] leading-snug">
              <span className="text-[#FEAE00]">Our clients receive</span>
              <br />
              <span className="text-white">the best service</span>
            </p>
            <span className="text-[#FEAE00] text-[28px] leading-none font-light select-none">]</span>
          </div>
        </div>

        {/* Carousel track */}
        <div className="relative overflow-hidden">
          <div
            className="flex gap-6 transition-transform duration-500 ease-out"
            style={{ transform: `translateX(calc(-${active} * (min(760px, 100%) + 24px)))` }}
          >
            {ITEMS.map((it, idx) => (
              <Card key={idx} item={it} />
            ))}
          </div>
        </div>

        {/* Dots + arrows */}
        <div className="flex items-center justify-center gap-6 mt-10">
          <button
            onClick={prev}
            aria-label="Previous"
            className="w-10 h-10 rounded-full border border-[#FEAE00]/60 text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors flex items-center justify-center"
            data-testid="before-after-prev"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            {ITEMS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`transition-all rounded-full ${
                  i === active
                    ? 'w-3 h-3 bg-[#FEAE00]'
                    : 'w-2 h-2 bg-[#FEAE00]/30 hover:bg-[#FEAE00]/60'
                }`}
                data-testid={`before-after-dot-${i}`}
              />
            ))}
          </div>
          <button
            onClick={next}
            aria-label="Next"
            className="w-10 h-10 rounded-full border border-[#FEAE00]/60 text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors flex items-center justify-center"
            data-testid="before-after-next"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
