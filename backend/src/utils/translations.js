// Menu translations: { [lang]: { name, description } } for the customer app's
// languages. Unknown languages/fields are dropped, text is trimmed and
// length-capped, empty entries removed. Returns undefined when not provided
// (leave unchanged) or a clean object (possibly {} to clear).
const MENU_LANGS = ['hi', 'mr'];
const LIMITS = { name: 150, description: 1000 };

exports.MENU_LANGS = MENU_LANGS;

exports.cleanTranslations = (input) => {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const lang of MENU_LANGS) {
    const src = input[lang];
    if (!src || typeof src !== 'object') continue;
    const entry = {};
    for (const [field, max] of Object.entries(LIMITS)) {
      if (typeof src[field] === 'string' && src[field].trim()) entry[field] = src[field].trim().slice(0, max);
    }
    if (Object.keys(entry).length) out[lang] = entry;
  }
  return out;
};
