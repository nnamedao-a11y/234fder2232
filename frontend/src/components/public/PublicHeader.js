import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { User } from 'lucide-react';
import BibiLogo from './BibiLogo';
import LanguageSwitcher from './LanguageSwitcher';
import CabinetThemeToggle from '../cabinet/CabinetThemeToggle';
import VinSearchAutocomplete from './VinSearchAutocomplete';

const NAV = [
  { label: 'CATALOG', to: '/catalog' },
  { label: 'CALCULATOR', to: '/calculator' },
  { label: 'ABOUT US', to: '/about' },
  { label: 'CONTACTS', to: '/contacts' },
];

export const PublicHeader = () => {
  return (
    <header
      className="sticky top-0 z-40 w-full bg-[#1D1D1B] border-b border-[#222]"
      data-testid="public-header"
    >
      <div className="max-w-[1920px] mx-auto h-[80px] px-6 xl:px-12 flex items-center gap-6 xl:gap-8">
        <BibiLogo height={42} className="flex-shrink-0" />

        <nav className="hidden lg:flex items-center gap-6 xl:gap-8 flex-shrink-0" data-testid="header-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `text-[13px] xl:text-[14px] font-normal tracking-[0.04em] whitespace-nowrap transition-colors ${
                  isActive ? 'text-[#FEAE00]' : 'text-white hover:text-[#FEAE00]'
                }`
              }
              data-testid={`nav-${n.label.toLowerCase().replace(/ /g, '-')}`}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        {/* VIN search with live autocomplete dropdown (mini-cards) */}
        <div className="hidden xl:flex min-w-[240px] max-w-[340px] flex-1">
          <VinSearchAutocomplete
            width="100%"
            placeholder="SEARCH BY VIN OR LOT NUMBER"
            testId="header-vin-search"
          />
        </div>

        {/* Phones — horizontal, compact, never wrap */}
        <div className="hidden md:flex flex-col items-end leading-[1.15] flex-shrink-0 whitespace-nowrap" data-testid="header-phones">
          <a href="tel:+359875313158" className="text-[13px] font-semibold text-[#FEAE00] hover:brightness-110">+359 875 313 158</a>
          <a href="tel:+359897884804" className="text-[13px] font-semibold text-[#FEAE00] hover:brightness-110">+359 897 884 804</a>
        </div>

        <LanguageSwitcher className="hidden md:inline-flex flex-shrink-0" />

        <CabinetThemeToggle variant="compact" className="hidden md:inline-flex flex-shrink-0" />

        <Link
          to="/cabinet/login"
          className="text-[#E7E7E7] hover:text-[#FEAE00] flex-shrink-0"
          data-testid="header-account-icon"
          aria-label="Account"
        >
          <User size={22} strokeWidth={1.5} />
        </Link>

        <Link
          to="/contacts"
          className="inline-flex items-center justify-center bg-[#FEAE00] hover:bg-[#FFBF2D] active:bg-[#E89D00] text-black font-medium text-[13px] tracking-[0.04em] uppercase px-5 h-[40px] rounded-md transition-colors whitespace-nowrap flex-shrink-0"
          data-testid="header-contact-us-button"
        >
          CONTACT US
        </Link>
      </div>
    </header>
  );
};

export default PublicHeader;
