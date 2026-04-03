// Persists customer reservations on the device so they can track status.
// Keyed by cafe slug. Reservations are pruned after 7 days.

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const key = (slug) => `cafe_reservations_${slug}`;

export function loadReservations(slug) {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const items = JSON.parse(raw);
    const fresh = items.filter(
      (r) => Date.now() - new Date(r.created_at || r.reserved_date).getTime() < MAX_AGE_MS
    );
    if (fresh.length !== items.length) _save(slug, fresh);
    return fresh;
  } catch {
    return [];
  }
}

export function upsertReservation(slug, reservation) {
  const existing = loadReservations(slug);
  const idx = existing.findIndex((r) => r.id === reservation.id);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...reservation };
  } else {
    existing.unshift(reservation);
  }
  _save(slug, existing.slice(0, 10));
}

export function removeReservation(slug, id) {
  _save(slug, loadReservations(slug).filter((r) => r.id !== id));
}

function _save(slug, items) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(items));
  } catch {}
}
