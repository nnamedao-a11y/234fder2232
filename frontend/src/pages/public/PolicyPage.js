/**
 * BIBI Cars — Generic Policy Page (Privacy / Terms / Cookies / Conditions).
 * Content comes from /api/site-info?lang=en|bg. EN/BG UI.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { BibiHeader, BibiFooter } from '../../components/public/BibiPublicLayout';
import { useLang } from '../../i18n';
import './PolicyPage.css';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const T = {
  en: { home: 'Home /', loading: 'Loading…', empty: 'No content yet.', back: '← Back to home', unavailable: '<p>Content unavailable.</p>' },
  bg: { home: 'Начало /', loading: 'Зареждане…', empty: 'Още няма съдържание.', back: '← Обратно към началото', unavailable: '<p>Съдържанието не е налично.</p>' },
};

export default function PolicyPage({ policyKey }) {
  const { lang } = useLang();
  const t = lang === 'bg' ? T.bg : T.en;
  const { pathname } = useLocation();
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  const apiLang = lang === 'bg' ? 'bg' : 'en';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/site-info/policy/${policyKey}`, { params: { lang: apiLang } });
        if (!cancelled) setPolicy(r.data);
      } catch {
        if (!cancelled) setPolicy({ title: policyKey, content: t.unavailable });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [policyKey, apiLang, t.unavailable]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className="bibi-policy-page bg-black min-h-screen flex flex-col text-white">
      <BibiHeader />
      <main className="flex-grow">
        <section className="bibi-policy-hero">
          <div className="bibi-container">
            <nav className="bibi-policy-breadcrumb" aria-label="Breadcrumb">
              <Link to="/">{t.home}</Link>
              <span>{policy?.title || '...'}</span>
            </nav>
            <h1 className="bibi-policy-title">{policy?.title || (loading ? t.loading : '')}</h1>
          </div>
        </section>

        <section className="bibi-policy-body">
          <div className="bibi-container">
            <article
              className="bibi-policy-prose"
              dangerouslySetInnerHTML={{ __html: policy?.content || (loading ? `<p>${t.loading}</p>` : `<p>${t.empty}</p>`) }}
            />
            <p className="bibi-policy-back">
              <Link to="/">{t.back}</Link>
            </p>
          </div>
        </section>
      </main>
      <BibiFooter />
    </div>
  );
}
