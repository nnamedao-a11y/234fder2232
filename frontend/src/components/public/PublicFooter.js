import React from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Facebook, Send, MapPin, Phone, Mail } from 'lucide-react';
import BibiLogo from './BibiLogo';

const ViberIcon = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.01 2 10.96c0 2.62 1.24 4.97 3.26 6.58L5 22l4.05-2.14c.95.18 1.93.28 2.95.28 5.52 0 10-4.01 10-8.96S17.52 2 12 2zm5.05 12.39c-.26.68-1.17 1.27-1.95 1.43-.52.11-1.2.2-3.48-.68-2.92-1.12-4.78-4.02-4.92-4.21-.14-.19-1.15-1.56-1.15-2.98 0-1.42.72-2.11.98-2.4.24-.26.55-.33.75-.33.2 0 .4.01.57.02.18.01.43-.07.68.53.26.63.9 2.17.98 2.33.08.16.14.35.02.54-.11.19-.17.31-.33.49-.16.18-.34.39-.48.52-.16.16-.33.33-.14.65.19.32.85 1.3 1.82 2.11 1.25 1.05 2.31 1.38 2.64 1.53.33.15.52.13.72-.08.19-.21.83-.91 1.05-1.22.22-.32.44-.26.74-.16.29.11 1.85.82 2.17.98.32.16.53.24.61.37.08.13.08.76-.17 1.44z" />
  </svg>
);

const SOCIALS = [
  { href: 'https://instagram.com', label: 'Instagram', Icon: Instagram },
  { href: 'https://facebook.com', label: 'Facebook', Icon: Facebook },
  { href: 'https://t.me/', label: 'Telegram', Icon: Send },
  { href: 'viber://chat', label: 'Viber', Icon: ViberIcon },
];

const ColTitle = ({ children }) => (
  <div className="text-[13px] uppercase tracking-[0.18em] text-[#FEAE00] mb-5">{children}</div>
);

export const PublicFooter = () => {
  return (
    <footer
      className="bg-black text-white border-t border-[#1A1A1A]"
      data-testid="public-footer"
    >
      <div className="max-w-[1920px] mx-auto px-6 md:px-10 lg:px-[60px] xl:px-[100px]">
        {/* ===== MAIN GRID ===== */}
        <div className="pt-14 pb-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1.1fr] gap-10 lg:gap-12">
          {/* Col 1 — Brand + tagline + socials */}
          <div>
            <BibiLogo height={56} to="/" />
            <p className="mt-5 text-[14px] text-[#9A9A9A] leading-relaxed max-w-[300px]">
              Turnkey car delivery from the USA, Europe and Korea to Bulgaria —
              sourcing, bidding, customs and registration, all under one roof.
            </p>

            <div className="flex items-center gap-3 mt-6">
              {SOCIALS.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-full border border-[#FEAE00]/50 text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black flex items-center justify-center transition-colors"
                  data-testid={`social-${label.toLowerCase()}`}
                >
                  <Icon size={15} />
                </a>
              ))}
            </div>
          </div>

          {/* Col 2 — Navigation */}
          <div>
            <ColTitle>Navigation</ColTitle>
            <ul className="flex flex-col gap-3">
              {[
                ['/catalog', 'Catalog'],
                ['/calculator', 'Calculator'],
                ['/about', 'About Us'],
                ['/blog', 'Blog'],
                ['/contacts', 'Contacts'],
              ].map(([to, label]) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="text-[14px] text-white hover:text-[#FEAE00] transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 — Services */}
          <div>
            <ColTitle>Services</ColTitle>
            <ul className="flex flex-col gap-3">
              {[
                'Standard delivery',
                'Turnkey (full-service)',
                'Auction sourcing',
                'Customs clearance',
                'Registration',
              ].map((s) => (
                <li
                  key={s}
                  className="text-[14px] text-[#C8C8C8] hover:text-[#FEAE00] transition-colors cursor-default"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4 — Contact */}
          <div>
            <ColTitle>Contact</ColTitle>

            <div className="flex items-start gap-3 mb-4">
              <Phone size={15} className="text-[#FEAE00] mt-1 shrink-0" />
              <div className="flex flex-col gap-1">
                <a
                  href="tel:+359875313158"
                  className="text-[15px] font-medium text-[#FEAE00] hover:brightness-110 leading-tight"
                >
                  +359 875 313 158
                </a>
                <a
                  href="tel:+359897884804"
                  className="text-[15px] font-medium text-[#FEAE00] hover:brightness-110 leading-tight"
                >
                  +359 897 884 804
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3 mb-4">
              <Mail size={15} className="text-[#FEAE00] mt-1 shrink-0" />
              <a
                href="mailto:info@bibicars.bg"
                className="text-[14px] text-white hover:text-[#FEAE00] leading-tight"
              >
                info@bibicars.bg
              </a>
            </div>

            <div className="flex items-start gap-3 mb-6">
              <MapPin size={15} className="text-[#FEAE00] mt-1 shrink-0" />
              <div className="text-[14px] text-[#C8C8C8] leading-snug">
                Sofia, Dragalevtsi, Vitosha Blvd. 230
                <br />
                Sofia, Bulgaria Blvd. 81
              </div>
            </div>

            <Link
              to="/contacts"
              className="btn-amber h-11 px-6 text-[13px]"
              data-testid="footer-contact-us"
            >
              Get in touch
            </Link>
          </div>
        </div>

        {/* ===== LEGAL BAR ===== */}
        <div className="border-t border-[#1A1A1A] py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-[12px] uppercase tracking-wider text-[#7A7A7A]">
          <div data-testid="footer-copyright" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>© 2026 BIBI Cars</span>
            <span className="text-[#333]">·</span>
            <span>VAT BG206637283</span>
            <span className="text-[#333]">·</span>
            <span>ID 206637283</span>
            <span className="text-[#333]">·</span>
            <span>PM Auto Group LTD</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <a href="#conditions" className="hover:text-[#FEAE00] transition-colors">
              Conditions
            </a>
            <a href="#privacy" className="hover:text-[#FEAE00] transition-colors">
              Privacy Policy
            </a>
            <a href="#cookies" className="hover:text-[#FEAE00] transition-colors">
              Cookies
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
