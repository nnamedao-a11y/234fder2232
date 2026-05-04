/**
 * BIBI Cars — Home page (Coming Soon landing).
 * EN/BG via LanguageContext.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../i18n';
import './ComingSoonPage.css';

const T = {
  en: {
    badge: 'Coming Soon',
    titlePrefix: "We're building ",
    titleAccent: 'something great',
    body1: 'A brand-new BIBI Cars experience is on its way.',
    body2: 'Stay tuned — it will launch shortly.',
    learn: 'Learn About Us',
    contact: 'Contact Us',
  },
  bg: {
    badge: 'Очаквайте скоро',
    titlePrefix: 'Създаваме ',
    titleAccent: 'нещо велико',
    body1: 'Скоро очаквайте изцяло обновеното изживяване BIBI Cars.',
    body2: 'Останете с нас — стартираме скоро.',
    learn: 'Научете повече за нас',
    contact: 'Свържете се с нас',
  },
};

export default function HomePage() {
  const { lang } = useLang();
  const t = lang === 'bg' ? T.bg : T.en;

  return (
    <div className="bibi-coming-soon" data-testid="home-page">
      <section className="bibi-coming-soon__body bibi-coming-soon__body--full">
        <div className="bibi-container">
          <div className="bibi-coming-soon__card">
            <span className="bibi-coming-soon__badge">{t.badge}</span>
            <h2 className="bibi-coming-soon__title">
              {t.titlePrefix}<span className="bibi-accent">{t.titleAccent}</span>.
            </h2>
            <p className="bibi-coming-soon__text">
              {t.body1}<br />
              {t.body2}
            </p>
            <div className="bibi-coming-soon__actions">
              <Link to="/about" className="bibi-btn bibi-btn--primary">
                {t.learn}
              </Link>
              <Link to="/contacts" className="bibi-btn bibi-btn--ghost">
                {t.contact}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
