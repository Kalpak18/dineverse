// Vercel Edge Middleware — injects per-café OG/structured-data meta for social bots.
// Runs before the SPA shell is served; bots (WhatsApp, Twitter, etc.) never execute JS.

const BOT_UA = /bot|crawler|spider|facebookexternalhit|whatsapp|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|applebot|bingbot|googlebot|duckduckbot|yandex|baidu/i;

const BACKEND = process.env.VITE_BACKEND_URL || 'https://dineverse.onrender.com';

export const config = {
  matcher: ['/cafe/:slug/menu', '/cafe/:slug', '/restaurants/:city/:slug'],
};

export default async function middleware(req) {
  const ua = req.headers.get('user-agent') || '';
  if (!BOT_UA.test(ua)) return; // undefined = pass through

  const { pathname } = new URL(req.url);

  let slug;
  const cafeMatch = pathname.match(/^\/cafe\/([^/]+)/);
  const restaurantMatch = pathname.match(/^\/restaurants\/[^/]+\/([^/]+)/);
  if (cafeMatch) slug = cafeMatch[1];
  else if (restaurantMatch) slug = restaurantMatch[1];
  else return;

  let cafe = null;
  try {
    const res = await fetch(`${BACKEND}/api/cafes/${slug}`);
    if (res.ok) {
      const body = await res.json();
      cafe = body.cafe || null;
    }
  } catch {
    return;
  }
  if (!cafe) return;

  const title = `${cafe.name}${cafe.city ? ` in ${cafe.city}` : ''} | Order Online | DineVerse`;
  const desc = `Order food online from ${cafe.name}${cafe.city ? ` in ${cafe.city}` : ''}. Browse the menu and order in real-time.`;
  const image = cafe.cover_image_url || 'https://dine-verse.com/preview.png';
  const url = `https://dine-verse.com/cafe/${slug}`;

  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: cafe.name,
    url,
    ...(cafe.address && { address: { '@type': 'PostalAddress', streetAddress: cafe.address, addressLocality: cafe.city || '' } }),
    ...(cafe.cover_image_url && { image: cafe.cover_image_url }),
    ...(cafe.description && { description: cafe.description }),
    servesCuisine: 'Various',
    hasMenu: url,
  });

  // Pull the base HTML shell (Vite builds to dist/index.html → served as /)
  const shellRes = await fetch(new URL('/index.html', req.url));
  if (!shellRes.ok) return;

  const shell = await shellRes.text();
  const meta = `
    <title>${title}</title>
    <meta name="description" content="${desc.replace(/"/g, '&quot;')}" />
    <meta property="og:title" content="${cafe.name} — Order Online | DineVerse" />
    <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:type" content="restaurant" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${cafe.name} — Order Online | DineVerse" />
    <meta name="twitter:image" content="${image}" />
    <script type="application/ld+json">${ld}</script>`;

  const patched = shell.replace(/<title>[^<]*<\/title>/, meta);

  return new Response(patched, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
