import { useState } from 'react';
import { LANGS } from '../i18n';

// Owner-side: optional name/description per customer language. Customers who
// pick that language see these; anything left blank shows the English text.
const OTHER_LANGS = LANGS.filter((l) => l.code !== 'en');

export default function TranslationFields({ value = {}, onChange, withDescription = true, idPrefix = 'tr' }) {
  const filled = OTHER_LANGS.filter((l) => value[l.code]?.name || value[l.code]?.description).length;
  const [open, setOpen] = useState(filled > 0);

  const set = (lang, field, text) => onChange({ ...value, [lang]: { ...(value[lang] || {}), [field]: text } });

  return (
    <div className="border border-gray-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full min-h-[44px] flex items-center justify-between px-3 text-sm font-semibold text-gray-700"
      >
        <span>🌐 Translations {filled ? `(${filled}/${OTHER_LANGS.length})` : <span className="font-normal text-gray-400">— optional</span>}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-gray-400">Shown to customers who choose that language. Leave blank to show the English text.</p>
          {OTHER_LANGS.map((l) => (
            <div key={l.code} className="space-y-1.5">
              <label className="label" htmlFor={`${idPrefix}-${l.code}-name`}>{l.label} — name</label>
              <input id={`${idPrefix}-${l.code}-name`} className="input" maxLength={150} lang={l.code}
                value={value[l.code]?.name || ''} onChange={(e) => set(l.code, 'name', e.target.value)} />
              {withDescription && (
                <>
                  <label className="label" htmlFor={`${idPrefix}-${l.code}-desc`}>{l.label} — description</label>
                  <textarea id={`${idPrefix}-${l.code}-desc`} className="input resize-none" rows={2} maxLength={1000} lang={l.code}
                    value={value[l.code]?.description || ''} onChange={(e) => set(l.code, 'description', e.target.value)} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
