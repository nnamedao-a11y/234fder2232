/**
 * BIBI Cars — shared public-page Layout (Header + Footer).
 *
 * V3: full EN/BG i18n via LanguageContext. The header switcher writes to the
 * same `bibi_lang` storage / context that the rest of the site reads. Auto
 * detection from browser locale happens once on first visit.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang, PUBLIC_LANGUAGES } from '../../i18n';
import './BibiPublicLayout.css';

const ASSET = '/about-us';

// ----------------------------------------------------------------------------
// Inline EN/BG dictionary for public layout (header + footer)
// ----------------------------------------------------------------------------
const LAYOUT_T = {
  en: {
    nav: {
      catalog: 'Catalog',
      calculator: 'Calculator',
      about: 'About Us',
      contacts: 'Contacts',
    },
    searchPlaceholder: 'Search by VIN or lot number',
    contactUs: 'Contact Us',
    footer: {
      phoneLabel: 'Phone Number:',
      cta: 'Get in touch',
      menu: {
        catalog: 'CATALOG',
        calculator: 'CALCULATOR',
        about: 'ABOUT US',
        blog: 'BLOG',
      },
      addressLabel: 'Address:',
      workingHours: 'Working hours',
      defaultHours: 'Mon - Fri, 10.00 - 19.00',
      viberLabel: 'Join Our Group And Get The Hottest Offers:',
      socialLabel: 'Social Media:',
      copyright: 'ALL RIGHTS RESERVED. BIBI CARS',
      conditions: 'Conditions',
      privacy: 'Privacy Policy',
      cookies: 'Cookies',
      credit: '/ Website design - O.la /',
    },
  },
  bg: {
    nav: {
      catalog: 'Каталог',
      calculator: 'Калкулатор',
      about: 'За нас',
      contacts: 'Контакти',
    },
    searchPlaceholder: 'Търсене по VIN или лот номер',
    contactUs: 'Свържете се с нас',
    footer: {
      phoneLabel: 'Телефонен номер:',
      cta: 'Свържете се с нас',
      menu: {
        catalog: 'КАТАЛОГ',
        calculator: 'КАЛКУЛАТОР',
        about: 'ЗА НАС',
        blog: 'БЛОГ',
      },
      addressLabel: 'Адрес:',
      workingHours: 'Работно време',
      defaultHours: 'Пн - Пт, 10.00 - 19.00',
      viberLabel: 'Присъединете се към нашата група и получете най-горещите оферти:',
      socialLabel: 'Социални мрежи:',
      copyright: 'ВСИЧКИ ПРАВА ЗАПАЗЕНИ. BIBI CARS',
      conditions: 'Общи условия',
      privacy: 'Политика за поверителност',
      cookies: 'Бисквитки',
      credit: '/ Дизайн на сайта - O.la /',
    },
  },
};

const pickLang = (lang) => (lang === 'bg' ? LAYOUT_T.bg : LAYOUT_T.en);

// ----------------------------------------------------------------------------
// Language Switcher — EN/BG dropdown wired to the global LanguageContext.
// ----------------------------------------------------------------------------
function LanguageSwitcher() {
  const { lang, changeLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Public site only knows en/bg — if context says 'uk', display as EN.
  const effective = lang === 'bg' ? 'bg' : 'en';
  const labelOf = (code) => (code === 'bg' ? 'BG' : 'ENG');

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (code) => {
    changeLang(code);
    setOpen(false);
  };

  return (
    <div className="bibi-header__lang-wrap" ref={ref} data-testid="public-lang-switcher">
      <button
        type="button"
        className="bibi-header__lang"
        aria-label="Language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="public-lang-current"
      >
        {labelOf(effective)}
        <img
          src={`${ASSET}/lsicon-down-filled.svg`}
          alt=""
          className={`bibi-header__lang-arrow ${open ? 'is-open' : ''}`}
        />
      </button>
      {open && (
        <ul className="bibi-header__lang-menu" role="listbox">
          {PUBLIC_LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === effective}
                className={`bibi-header__lang-item ${l.code === effective ? 'is-active' : ''}`}
                onClick={() => choose(l.code)}
                data-testid={`public-lang-option-${l.code}`}
              >
                {labelOf(l.code)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Hook to fetch public site-info once and share via window cache
// ----------------------------------------------------------------------------
const SITE_INFO_CACHE_KEY = '__bibi_site_info_promise__';
function useSiteInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const API = process.env.REACT_APP_BACKEND_URL || '';
    if (typeof window !== 'undefined' && !window[SITE_INFO_CACHE_KEY]) {
      window[SITE_INFO_CACHE_KEY] = fetch(`${API}/api/site-info`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    const p = (typeof window !== 'undefined' && window[SITE_INFO_CACHE_KEY])
      || fetch(`${API}/api/site-info`).then((r) => (r.ok ? r.json() : null));
    Promise.resolve(p).then((d) => { if (!cancelled) setInfo(d); });
    return () => { cancelled = true; };
  }, []);
  return info;
}

// ----------------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------------
export function BibiHeader({ active = '' }) {
  const { lang } = useLang();
  const T = pickLang(lang);
  const info = useSiteInfo();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const navItems = [
    { label: T.nav.catalog,    to: '/catalog',    key: 'catalog'    },
    { label: T.nav.calculator, to: '/calculator', key: 'calculator' },
    { label: T.nav.about,      to: '/about',      key: 'about'      },
    { label: T.nav.contacts,   to: '/contacts',   key: 'contacts'   },
  ];

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setOpen(false);
    navigate(`/vin/${encodeURIComponent(q)}`);
  };

  // Header phones: prefer header.phones, fall back to footer.contacts.phones, then defaults
  const phones = (info?.header?.phones && info.header.phones.length)
    ? info.header.phones
    : (info?.footer?.contacts?.phones && info.footer.contacts.phones.length)
      ? info.footer.contacts.phones
      : ['+359 875 313 158', '+359 897 884 804'];

  // CTA label can also be admin-controlled (with i18n fallback)
  const ctaLabel = lang === 'bg'
    ? (info?.header?.cta_label_bg || T.contactUs)
    : (info?.header?.cta_label_en || T.contactUs);

  return (
    <header className="bibi-header">
      <div className="bibi-header__inner">
        <Link to="/" className="bibi-header__logo" aria-label="BIBI Cars">
          <img src={`${ASSET}/BiBi-logo-02-1.svg`} alt="BIBI Cars" />
        </Link>

        <nav className={`bibi-header__nav ${open ? 'is-open' : ''}`}>
          {navItems.map((it) => (
            <Link
              key={it.key}
              to={it.to}
              onClick={() => setOpen(false)}
              className={`bibi-header__nav-link ${active === it.key ? 'is-active' : ''}`}
              data-testid={`bibi-nav-${it.key}`}
            >
              {it.label}
            </Link>
          ))}
        </nav>

        <form className="bibi-header__search" onSubmit={handleSearchSubmit} role="search">
          <button type="submit" aria-label="Search" className="bibi-header__search-btn">
            <img src={`${ASSET}/boxicons-search.svg`} alt="" />
          </button>
          <input
            type="text"
            placeholder={T.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={T.searchPlaceholder}
            data-testid="bibi-header-search-input"
          />
        </form>

        <div className="bibi-header__phones" data-testid="bibi-header-phones">
          {phones.map((p) => (
            <a key={p} href={`tel:${p.replace(/\s+/g, '')}`}>{p}</a>
          ))}
        </div>

        <LanguageSwitcher />

        <Link to="/cabinet/login" className="bibi-header__profile" aria-label="Customer profile">
          <img src={`${ASSET}/iconamoon-profile-light.svg`} alt="" />
        </Link>

        <Link to="/contacts" className="bibi-btn bibi-btn--primary bibi-header__cta">
          {ctaLabel}
        </Link>

        <button
          type="button"
          className={`bibi-header__burger ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------------------
// Footer
// ----------------------------------------------------------------------------
export function BibiFooter() {
  const { lang } = useLang();
  const T = pickLang(lang).footer;
  const info = useSiteInfo();

  const contacts = info?.footer?.contacts || {};
  const socialsRaw = info?.footer?.socials || {};
  const vc = info?.footer?.viber_community || {};
  const phones = contacts.phones && contacts.phones.length
    ? contacts.phones
    : ['+359 875 313 158', '+359 897 884 804'];
  const addresses = contacts.addresses && contacts.addresses.length
    ? contacts.addresses
    : (lang === 'bg'
      ? ['България, София, Драгалевци, бул. Витоша № 230',
         'България, София, бул. България № 81']
      : ['Bulgaria, Sofia, Dragalevtsi, Vitosha Blvd. No. 230',
         'Bulgaria, Sofia, Bulgaria Blvd., No. 81']);
  const hours = contacts.working_hours || T.defaultHours;

  // Helper: get URL only when channel is enabled (supports legacy string format)
  const socialUrl = (key) => {
    const v = socialsRaw[key];
    if (!v) return '';
    if (typeof v === 'string') return v; // legacy
    if (v.enabled === false) return '';
    return v.url || '';
  };

  const SocialIcon = ({ href, label, children }) => {
    if (!href) return null;
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="bibi-footer__social-link">
        {children}
      </a>
    );
  };

  return (
    <footer className="bibi-footer">
      <div className="bibi-footer__inner">
        <div className="bibi-footer__top">
          <Link to="/" className="bibi-footer__logo">
            <img src={`${ASSET}/BiBi-logo-02-1.svg`} alt="BIBI Cars" />
          </Link>

          <div className="bibi-footer__phones">
            <span className="bibi-footer__phones-label">{T.phoneLabel}</span>
            {phones.map((p) => (
              <a key={p} href={`tel:${p.replace(/\s+/g, '')}`}>{p}</a>
            ))}
          </div>

          <Link to="/contacts" className="bibi-btn bibi-btn--primary bibi-footer__cta">
            {T.cta}
          </Link>
        </div>

        <div className="bibi-footer__mid">
          <nav className="bibi-footer__menu">
            <Link to="/catalog">{T.menu.catalog}</Link>
            <Link to="/calculator">{T.menu.calculator}</Link>
            <Link to="/about">{T.menu.about}</Link>
            <Link to="/blog">{T.menu.blog}</Link>
          </nav>

          <div className="bibi-footer__address">
            <span className="bibi-footer__small-label">{T.addressLabel}</span>
            <p className="bibi-footer__address-line">
              {addresses.map((a, i) => (
                <React.Fragment key={i}>
                  {a}
                  {i < addresses.length - 1 && <br />}
                </React.Fragment>
              ))}
            </p>
            <span className="bibi-footer__hours">
              <span className="bibi-footer__hours-mobile">( </span>
              {T.workingHours}: {hours}
              <span className="bibi-footer__hours-mobile"> )</span>
            </span>
          </div>

          {vc.enabled !== false && vc.url && (
            <div className="bibi-footer__viber">
              <span className="bibi-footer__small-label" dangerouslySetInnerHTML={{ __html: T.viberLabel.replace(' And ', ' And<br />').replace('и получете', 'и<br />получете') }} />
              <a href={vc.url} aria-label="Viber Community">
                <img src={`${ASSET}/basil-viber-outline.svg`} alt="Viber" />
              </a>
            </div>
          )}

          <div className="bibi-footer__social">
            <span className="bibi-footer__small-label">{T.socialLabel}</span>
            <div className="bibi-footer__social-icons">
              <SocialIcon href={socialUrl('instagram')} label="Instagram">
                <img src={`${ASSET}/ri-instagram-line.svg`} alt="Instagram" />
              </SocialIcon>
              <SocialIcon href={socialUrl('facebook')} label="Facebook">
                <img src={`${ASSET}/ic-twotone-facebook.svg`} alt="Facebook" />
              </SocialIcon>
              <SocialIcon href={socialUrl('telegram')} label="Telegram">
                <img src={`${ASSET}/ic-round-telegram.svg`} alt="Telegram" />
              </SocialIcon>
              <SocialIcon href={socialUrl('tiktok')} label="TikTok">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" className="bibi-footer__social-svg">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.86a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.29Z"/>
                </svg>
              </SocialIcon>
              <SocialIcon href={socialUrl('whatsapp')} label="WhatsApp">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" className="bibi-footer__social-svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488"/>
                </svg>
              </SocialIcon>
            </div>
          </div>
        </div>

        <div className="bibi-footer__bottom">
          <div className="bibi-footer__copy">
            <img src={`${ASSET}/ant-design-copyright-circle-outlined.svg`} alt="©" />
            <span>2026. {T.copyright}</span>
          </div>
          <div className="bibi-footer__legal">
            <span className="bibi-footer__legal-vat">VAT BG206637283</span>
            <span className="bibi-footer__legal-vat">ID 206637283</span>
            <span className="bibi-footer__legal-vat">PM AUTO GROUP LTD</span>
            <Link to="/conditions" className="bibi-footer__legal-link">{T.conditions}</Link>
            <Link to="/privacy" className="bibi-footer__legal-link">{T.privacy}</Link>
            <Link to="/cookies" className="bibi-footer__legal-link">{T.cookies}</Link>
          </div>
          <div className="bibi-footer__credit">{T.credit}</div>
        </div>
      </div>
    </footer>
  );
}

export default { BibiHeader, BibiFooter };
