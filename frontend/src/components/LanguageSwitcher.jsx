import { LANGS, useT } from '../i18n';

// Compact language picker for customer screens (native select = big, easy
// targets on phones and screen-reader friendly).
export default function LanguageSwitcher({ className = '' }) {
  const { lang, setLang, t } = useT();
  return (
    <label className={`inline-flex items-center gap-1 ${className}`}>
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t('lang.label')}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700"
      >
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
