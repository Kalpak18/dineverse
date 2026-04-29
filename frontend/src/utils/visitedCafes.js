const KEY = 'dv_visited_cafes';
const MAX = 12;

export function trackVisit(slug, name, logoUrl) {
  if (!slug || !name) return;
  const existing = loadVisited().filter((v) => v.slug !== slug);
  const updated = [{ slug, name, logo_url: logoUrl || null, visited_at: Date.now() }, ...existing].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(updated)); } catch {}
}

export function loadVisited() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
