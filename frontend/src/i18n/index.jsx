import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings';

// Customer-app languages. Adding one = a dictionary in strings.js + an entry
// here (+ the code in the backend's MENU_LANGS for menu translations).
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
];
const STORAGE_KEY = 'dv_lang';

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch { /* storage blocked */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return STRINGS[nav] ? nav : 'en';
}

const LanguageContext = createContext({ lang: 'en', setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((code) => {
    if (!STRINGS[code]) return;
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage blocked */ }
  }, []);

  const t = useCallback((key, vars) => {
    let s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useT = () => useContext(LanguageContext);

// Menu text in the customer's language, falling back to the original
// (owner-entered English) when there's no translation for that field.
export function localized(entity, field, lang) {
  if (!entity) return '';
  return (lang !== 'en' && entity.translations?.[lang]?.[field]) || entity[field] || '';
}
