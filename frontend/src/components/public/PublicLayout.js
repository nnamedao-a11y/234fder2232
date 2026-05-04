/**
 * BIBI Cars — Public Layout (V2)
 *
 * Все публичные страницы используют единый новый header/footer
 * (BibiHeader + BibiFooter) — тот же, что на /about и /contacts.
 *
 * Старые PublicHeader/PublicFooter и связанная с ними логика смены темы
 * удалены — на сайте только тёмная тема и единый язык-свитчер ENG/BG.
 */

import React from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { BibiHeader, BibiFooter } from './BibiPublicLayout';

const ROUTE_TO_KEY = {
  '/catalog': 'catalog',
  '/calculator': 'calculator',
  '/about': 'about',
  '/contacts': 'contacts',
};

const PublicLayout = () => {
  const { pathname } = useLocation();
  // pick active key by longest prefix match
  let active = '';
  for (const [pre, key] of Object.entries(ROUTE_TO_KEY)) {
    if (pathname === pre || pathname.startsWith(pre + '/')) {
      active = key;
      break;
    }
  }

  return (
    <div className="bibi-about min-h-screen flex flex-col bg-black text-white">
      <BibiHeader active={active} />
      <main className="flex-grow bibi-about__main">
        <Outlet />
      </main>
      <BibiFooter />
    </div>
  );
};

export default PublicLayout;
