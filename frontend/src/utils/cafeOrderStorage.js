// Persists customer orders on the device so they survive page refresh.
// Keyed by cafe slug. Orders are pruned after 24 hours.

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const key = (slug) => `cafe_orders_${slug}`;

export function loadOrders(slug) {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const orders = JSON.parse(raw);
    // Prune stale orders older than 24 h
    const fresh = orders.filter(
      (o) => Date.now() - new Date(o.created_at).getTime() < MAX_AGE_MS
    );
    if (fresh.length !== orders.length) _save(slug, fresh);
    return fresh;
  } catch {
    return [];
  }
}

export function upsertOrder(slug, order) {
  const existing = loadOrders(slug);
  const idx = existing.findIndex((o) => o.id === order.id);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...order };
  } else {
    existing.unshift(order); // newest first
  }
  _save(slug, existing.slice(0, 20)); // cap at 20 orders
}

export function removeOrder(slug, orderId) {
  _save(slug, loadOrders(slug).filter((o) => o.id !== orderId));
}

function _save(slug, orders) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(orders));
  } catch {}
}
