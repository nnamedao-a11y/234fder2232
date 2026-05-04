/**
 * BIBI Cars — Contacts page (V6) — EN/BG i18n.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { BibiHeader, BibiFooter } from '../../components/public/BibiPublicLayout';
import BibiOfficeMap from '../../components/public/BibiOfficeMap';
import { useLang } from '../../i18n';
import './ContactsPage.css';

const ASSET = '/contacts';

const T = {
  en: {
    home: 'HOME',
    crumb: 'contacts',
    title: 'contacts',
    taglineLine1: 'We are located',
    taglineLine2: 'in the center of Bulgaria.',
    addressLabel: 'Our Office Address:',
    addressLine1: 'Bulgaria, Sofia, Dragalevtsi, Vitosha Blvd. No. 230',
    addressLine2: 'Bulgaria, Sofia, Bulgaria Blvd., No. 81',
    workingHours: 'Working hours: Mon - Fri, 10.00 - 19.00',
    phoneLabel: 'Phone Number:',
    emailLabel: 'Email:',
  },
  bg: {
    home: 'НАЧАЛО',
    crumb: 'контакти',
    title: 'контакти',
    taglineLine1: 'Намираме се',
    taglineLine2: 'в центъра на България.',
    addressLabel: 'Адрес на офиса:',
    addressLine1: 'България, София, Драгалевци, бул. Витоша № 230',
    addressLine2: 'България, София, бул. България № 81',
    workingHours: 'Работно време: Пн - Пт, 10.00 - 19.00',
    phoneLabel: 'Телефонен номер:',
    emailLabel: 'Имейл:',
  },
};

function Hero({ t }) {
  return (
    <section className="bibi-hero bibi-contacts-hero">
      <div className="bibi-container">
        <nav className="bibi-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">{t.home}</Link>
          <span className="bibi-breadcrumb__sep"> / </span>
          <span className="bibi-breadcrumb__current">{t.crumb}</span>
        </nav>
        <h1 className="bibi-hero__title">{t.title}</h1>
      </div>
    </section>
  );
}

function PinTagline({ t }) {
  return (
    <div className="bibi-contacts__pin-block">
      <div className="bibi-contacts__pin-inner">
        <img
          className="bibi-contacts__pin"
          src={`${ASSET}/weui-location-filled.svg`}
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <h2 className="bibi-contacts__tagline">
          {t.taglineLine1}<br />
          {t.taglineLine2}
        </h2>
      </div>
    </div>
  );
}

function MapAndInfo({ t }) {
  return (
    <section className="bibi-contacts__row">
      <div className="bibi-contacts__photo">
        <BibiOfficeMap />
      </div>

      <div className="bibi-contacts__info">
        <div className="bibi-contacts__info-block">
          <span className="bibi-contacts__label">{t.addressLabel}</span>
          <h3 className="bibi-contacts__addr">
            {t.addressLine1}
            <br />
            {t.addressLine2}
          </h3>
          <span className="bibi-contacts__hours">{t.workingHours}</span>
        </div>

        <div className="bibi-contacts__info-block">
          <span className="bibi-contacts__label">{t.phoneLabel}</span>
          <div className="bibi-contacts__phones">
            <a href="tel:+359875313158">+359 875 313 158</a>
            <a href="tel:+359897884804">+359 897 884 804</a>
          </div>
        </div>

        <div className="bibi-contacts__info-block">
          <span className="bibi-contacts__label">{t.emailLabel}</span>
          <a className="bibi-contacts__email" href="mailto:hello@bibicars.bg">
            hello@bibicars.bg
          </a>
        </div>
      </div>
    </section>
  );
}

function ContactsBody({ t }) {
  return (
    <section className="bibi-contacts">
      <div className="bibi-container">
        <PinTagline t={t} />
        <MapAndInfo t={t} />
      </div>
    </section>
  );
}

export default function ContactsPage() {
  const { lang } = useLang();
  const t = lang === 'bg' ? T.bg : T.en;
  return (
    <div className="bibi-about" data-testid="contacts-page">
      <BibiHeader active="contacts" />
      <main className="bibi-about__main">
        <Hero t={t} />
        <ContactsBody t={t} />
      </main>
      <BibiFooter />
    </div>
  );
}
