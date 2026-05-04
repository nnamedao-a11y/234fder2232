import React from 'react';

/**
 * Simplified vector representations of 5 car brand logos for the
 * "Most Popular Brands" block. Original brand marks © respective owners
 * — these are minimal functional facsimiles for UI purposes only.
 * Render at roughly 60–90px height.
 */

export const AudiLogo = ({ height = 72 }) => (
  <svg viewBox="0 0 260 90" height={height} width="auto" aria-label="Audi" role="img">
    {/* Four interlocking rings */}
    {[0, 52, 104, 156].map((cx) => (
      <circle key={cx} cx={cx + 32} cy={40} r={30} fill="none" stroke="#BBBBBB" strokeWidth={6} />
    ))}
    <text x={130} y={85} textAnchor="middle" fill="#D8232A" fontFamily="'Audi Type','Arial Black',Arial,sans-serif" fontSize={14} fontWeight={700} letterSpacing="0.18em">AUDI</text>
  </svg>
);

export const BmwLogo = ({ height = 72 }) => (
  <svg viewBox="0 0 80 80" height={height} width="auto" aria-label="BMW" role="img">
    <circle cx={40} cy={40} r={38} fill="#1C1C1C" stroke="#1C1C1C" strokeWidth={2} />
    <circle cx={40} cy={40} r={30} fill="#fff" />
    <path d="M40 10 A30 30 0 0 1 70 40 L40 40 Z" fill="#0066B1" />
    <path d="M40 70 A30 30 0 0 1 10 40 L40 40 Z" fill="#0066B1" />
    <circle cx={40} cy={40} r={30} fill="none" stroke="#1C1C1C" strokeWidth={2} />
    {/* BMW outer text ring */}
    <text x={40} y={17} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={700} fontFamily="Arial,sans-serif">BMW</text>
  </svg>
);

export const ToyotaLogo = ({ height = 72 }) => (
  <svg viewBox="0 0 260 120" height={height} width="auto" aria-label="Toyota" role="img">
    <g transform="translate(85,5) scale(0.78)">
      <ellipse cx={60} cy={55} rx={58} ry={45} fill="none" stroke="#1C1C1C" strokeWidth={6} />
      <ellipse cx={60} cy={55} rx={22} ry={42} fill="none" stroke="#1C1C1C" strokeWidth={6} />
      <ellipse cx={60} cy={40} rx={40} ry={16} fill="none" stroke="#1C1C1C" strokeWidth={6} />
    </g>
    <text x={130} y={117} textAnchor="middle" fill="#EB0A1E" fontFamily="Arial Black,Arial,sans-serif" fontSize={18} fontWeight={900} letterSpacing="0.2em">TOYOTA</text>
  </svg>
);

export const VwLogo = ({ height = 72 }) => (
  <svg viewBox="0 0 100 120" height={height} width="auto" aria-label="Volkswagen" role="img">
    <circle cx={50} cy={50} r={45} fill="none" stroke="#001E50" strokeWidth={5} />
    <g fill="none" stroke="#001E50" strokeWidth={5} strokeLinecap="square">
      {/* V */}
      <path d="M22 28 L50 72 L78 28" />
      {/* W */}
      <path d="M32 28 L42 60 L50 44 L58 60 L68 28" />
    </g>
    <text x={50} y={115} textAnchor="middle" fill="#001E50" fontSize={11} fontFamily="Arial,sans-serif" fontWeight={500}>Volkswagen</text>
  </svg>
);

export const HyundaiLogo = ({ height = 72 }) => (
  <svg viewBox="0 0 260 120" height={height} width="auto" aria-label="Hyundai" role="img">
    {/* Stylized slanted H in oval */}
    <g transform="translate(90,10)">
      <ellipse cx={40} cy={40} rx={38} ry={30} fill="none" stroke="#002C5F" strokeWidth={5} />
      <path d="M18 22 L36 58 M62 22 L44 58 M22 40 L58 40" stroke="#002C5F" strokeWidth={5} strokeLinecap="round" fill="none" />
    </g>
    <text x={130} y={112} textAnchor="middle" fill="#002C5F" fontFamily="Arial,sans-serif" fontSize={18} fontWeight={700} letterSpacing="0.24em">HYUNDAI</text>
  </svg>
);

export const BRAND_LOGOS = {
  Audi: AudiLogo,
  BMW: BmwLogo,
  Toyota: ToyotaLogo,
  Volkswagen: VwLogo,
  Hyundai: HyundaiLogo,
};

export default BRAND_LOGOS;
