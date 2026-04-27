/**
 * generate-sitemap.js
 *
 * Runs before `vite build` to produce a fully static sitemap.xml.
 * Fetches all active café slugs from the backend with a 60-second timeout
 * (enough to survive a Render cold start). Falls back to static pages only
 * if the API is unreachable, so the build never fails.
 *
 * Usage: node scripts/generate-sitemap.js
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL  = 'https://dine-verse.com';
const API_BASE  = 'https://dineverse.onrender.com/api';

const STATIC_PAGES = [
  { loc: `${BASE_URL}/`,        changefreq: 'weekly',  priority: 1.0 },
  { loc: `${BASE_URL}/explore`, changefreq: 'daily',   priority: 0.9 },
  { loc: `${BASE_URL}/map`,     changefreq: 'daily',   priority: 0.8 },
  { loc: `${BASE_URL}/contact`, changefreq: 'monthly', priority: 0.5 },
  { loc: `${BASE_URL}/terms`,   changefreq: 'monthly', priority: 0.4 },
  { loc: `${BASE_URL}/privacy`, changefreq: 'monthly', priority: 0.4 },
  { loc: `${BASE_URL}/refund`,  changefreq: 'monthly', priority: 0.3 },
];

async function fetchCafeSlugs() {
  const url = `${API_BASE}/cafes/sitemap-slugs`;
  try {
    console.log('[sitemap] Fetching café slugs from', url);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(60_000), // 60s: long enough for Render cold start
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const { slugs } = await res.json();
    console.log(`[sitemap] Got ${slugs.length} café(s)`);
    return slugs;
  } catch (err) {
    console.warn(`[sitemap] Could not fetch café slugs (${err.message}) — building static-only sitemap`);
    return [];
  }
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

async function main() {
  const cafeSlugs = await fetchCafeSlugs();

  const cafeEntries = cafeSlugs.map(({ slug, updated_at }) => ({
    loc:        `${BASE_URL}/cafe/${slug}`,
    lastmod:    updated_at ? new Date(updated_at).toISOString().slice(0, 10) : undefined,
    changefreq: 'weekly',
    priority:   0.7,
  }));

  const allEntries = [...STATIC_PAGES, ...cafeEntries];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '',
    allEntries.map(urlEntry).join('\n\n'),
    '',
    '</urlset>',
  ].join('\n');

  const outPath = resolve(__dirname, '../public/sitemap.xml');
  writeFileSync(outPath, xml, 'utf8');
  console.log(`[sitemap] Wrote ${allEntries.length} URL(s) to ${outPath}`);
}

main().catch((err) => {
  console.error('[sitemap] Fatal:', err);
  process.exit(1);
});
