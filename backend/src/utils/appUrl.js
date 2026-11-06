// Public address of the app, used for links in emails. APP_URL wins; otherwise
// the first CLIENT_URL entry that is the real domain — not a *.vercel.app /
// *.onrender.com deploy address or localhost (CLIENT_URL also lists those for CORS).
const DEFAULT_APP_URL = 'https://www.dine-verse.com';

function appUrl() {
  const clean = (u) => u.trim().replace(/\/+$/, '');
  if (process.env.APP_URL?.trim()) return clean(process.env.APP_URL);
  const entries = (process.env.CLIENT_URL || '').split(',').map(clean).filter(Boolean);
  const own = entries.find((u) => !/\.vercel\.app$|\.onrender\.com$|localhost|127\.0\.0\.1/i.test(u));
  return own || DEFAULT_APP_URL;
}

module.exports = { appUrl, DEFAULT_APP_URL };
