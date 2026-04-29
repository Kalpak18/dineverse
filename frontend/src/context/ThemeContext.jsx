import { createContext, useContext, useEffect, useState } from 'react';

export const THEMES = {
  ember: {
    name: 'Ember',
    swatch: '#f97316',
    vars: {
      '--brand-50':  '#fff7ed', '--brand-100': '#ffedd5', '--brand-200': '#fed7aa',
      '--brand-300': '#fdba74', '--brand-400': '#fb923c', '--brand-500': '#f97316',
      '--brand-600': '#ea580c', '--brand-700': '#c2410c', '--brand-800': '#9a3412', '--brand-900': '#7c2d12',
    },
  },
  ocean: {
    name: 'Ocean',
    swatch: '#3b82f6',
    vars: {
      '--brand-50':  '#eff6ff', '--brand-100': '#dbeafe', '--brand-200': '#bfdbfe',
      '--brand-300': '#93c5fd', '--brand-400': '#60a5fa', '--brand-500': '#3b82f6',
      '--brand-600': '#2563eb', '--brand-700': '#1d4ed8', '--brand-800': '#1e40af', '--brand-900': '#1e3a8a',
    },
  },
  forest: {
    name: 'Forest',
    swatch: '#22c55e',
    vars: {
      '--brand-50':  '#f0fdf4', '--brand-100': '#dcfce7', '--brand-200': '#bbf7d0',
      '--brand-300': '#86efac', '--brand-400': '#4ade80', '--brand-500': '#22c55e',
      '--brand-600': '#16a34a', '--brand-700': '#15803d', '--brand-800': '#166534', '--brand-900': '#14532d',
    },
  },
  violet: {
    name: 'Violet',
    swatch: '#8b5cf6',
    vars: {
      '--brand-50':  '#f5f3ff', '--brand-100': '#ede9fe', '--brand-200': '#ddd6fe',
      '--brand-300': '#c4b5fd', '--brand-400': '#a78bfa', '--brand-500': '#8b5cf6',
      '--brand-600': '#7c3aed', '--brand-700': '#6d28d9', '--brand-800': '#5b21b6', '--brand-900': '#4c1d95',
    },
  },
  rose: {
    name: 'Rose',
    swatch: '#f43f5e',
    vars: {
      '--brand-50':  '#fff1f2', '--brand-100': '#ffe4e6', '--brand-200': '#fecdd3',
      '--brand-300': '#fda4af', '--brand-400': '#fb7185', '--brand-500': '#f43f5e',
      '--brand-600': '#e11d48', '--brand-700': '#be123c', '--brand-800': '#9f1239', '--brand-900': '#881337',
    },
  },
  teal: {
    name: 'Teal',
    swatch: '#14b8a6',
    vars: {
      '--brand-50':  '#f0fdfa', '--brand-100': '#ccfbf1', '--brand-200': '#99f6e4',
      '--brand-300': '#5eead4', '--brand-400': '#2dd4bf', '--brand-500': '#14b8a6',
      '--brand-600': '#0d9488', '--brand-700': '#0f766e', '--brand-800': '#115e59', '--brand-900': '#134e4a',
    },
  },
  amber: {
    name: 'Amber',
    swatch: '#f59e0b',
    vars: {
      '--brand-50':  '#fffbeb', '--brand-100': '#fef3c7', '--brand-200': '#fde68a',
      '--brand-300': '#fcd34d', '--brand-400': '#fbbf24', '--brand-500': '#f59e0b',
      '--brand-600': '#d97706', '--brand-700': '#b45309', '--brand-800': '#92400e', '--brand-900': '#78350f',
    },
  },
  slate: {
    name: 'Slate',
    swatch: '#64748b',
    vars: {
      '--brand-50':  '#f8fafc', '--brand-100': '#f1f5f9', '--brand-200': '#e2e8f0',
      '--brand-300': '#cbd5e1', '--brand-400': '#94a3b8', '--brand-500': '#64748b',
      '--brand-600': '#475569', '--brand-700': '#334155', '--brand-800': '#1e293b', '--brand-900': '#0f172a',
    },
  },
};

function applyTheme(themeId) {
  const theme = THEMES[themeId] || THEMES.ember;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

const ThemeContext = createContext({ themeId: 'ember', setThemeId: () => {}, themes: THEMES });

export function ThemeProvider({ children }) {
  const [themeId, _setThemeId] = useState(() => {
    const saved = localStorage.getItem('dv_theme');
    return saved && THEMES[saved] ? saved : 'ember';
  });

  const setThemeId = (id) => {
    if (!THEMES[id]) return;
    _setThemeId(id);
    localStorage.setItem('dv_theme', id);
    applyTheme(id);
  };

  useEffect(() => { applyTheme(themeId); }, []); // eslint-disable-line

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
