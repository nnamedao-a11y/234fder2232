/**
 * CabinetThemeContext
 *
 * Adds a `light` / `dark` theme toggle to the Customer Cabinet WITHOUT rewriting
 * the existing light-theme components. The theme is applied as a `data-theme`
 * attribute on a single wrapper div and CSS overrides in index.css do the rest.
 *
 * Persistence: `localStorage.bibi_cabinet_theme` (default: 'dark').
 * Scope: cabinet only — does NOT affect public pages / auth screens.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'bibi_cabinet_theme';
const DEFAULT_THEME = 'dark';

const CabinetThemeContext = createContext(null);

export const CabinetThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const isDark = theme === 'dark';

  return (
    <CabinetThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark }}>
      {children}
    </CabinetThemeContext.Provider>
  );
};

export const useCabinetTheme = () => {
  const ctx = useContext(CabinetThemeContext);
  if (!ctx) {
    // Safe fallback — never throws if a stray consumer is outside the provider.
    return { theme: DEFAULT_THEME, setTheme: () => {}, toggleTheme: () => {}, isDark: false };
  }
  return ctx;
};

export default CabinetThemeContext;
