import React from 'react';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import { useLang } from '../../i18n';

const T = {
  en: { home: 'HOME', blog: 'BLOG', title: 'Blog', soon: 'Coming soon.' },
  bg: { home: 'НАЧАЛО', blog: 'БЛОГ', title: 'Блог', soon: 'Очаквайте скоро.' },
};

export default function BlogPage() {
  const { lang } = useLang();
  const t = lang === 'bg' ? T.bg : T.en;
  return (
    <div data-testid="blog-page" className="bg-black min-h-[60vh]">
      <section className="pt-12 pb-20">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <Breadcrumbs items={[{ label: t.home, to: '/' }, { label: t.blog }]} />
          <h1 className="text-[48px] md:text-[80px] font-bold uppercase text-[#FEAE00] mt-10 leading-none">{t.title}</h1>
          <p className="text-[20px] text-white mt-12">{t.soon}</p>
        </div>
      </section>
    </div>
  );
}
