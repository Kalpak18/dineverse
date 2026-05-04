// Persists customer waitlist entries on the device so they can track status.
// Keyed by cafe slug. Waitlist entries are pruned after 7 days.

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const key = (slug) => `cafe_waitlist_${slug}`;

export function loadWaitlist(slug) {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const items = JSON.parse(raw);
    const fresh = items.filter(
      (w) => Date.now() - new Date(w.created_at).getTime() < MAX_AGE_MS
    );
    if (fresh.length !== items.length) _save(slug, fresh);
    return fresh;
  } catch {
    return [];
  }
}

export function upsertWaitlist(slug, entry) {
  const existing = loadWaitlist(slug);
  const idx = existing.findIndex((w) => w.id === entry.id);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...entry };
  } else {
    existing.unshift(entry);
  }
  _save(slug, existing.slice(0, 10));
}

export function removeWaitlist(slug, id) {
  _save(slug, loadWaitlist(slug).filter((w) => w.id !== id));
}

function _save(slug, items) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(items));
  } catch {}
}
