const KEY = (slug) => `dv_notifs_${slug}`;
const MAX = 50;

export function pushNotification(slug, { title, body, type = 'info' }) {
  const existing = getNotifications(slug);
  const notif = { id: Date.now(), title, body, type, read: false, timestamp: new Date().toISOString() };
  const updated = [notif, ...existing].slice(0, MAX);
  localStorage.setItem(KEY(slug), JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('customer:notification', { detail: { slug } }));
  return notif;
}

export function getNotifications(slug) {
  try { return JSON.parse(localStorage.getItem(KEY(slug)) || '[]'); } catch { return []; }
}

export function markAllRead(slug) {
  const updated = getNotifications(slug).map((n) => ({ ...n, read: true }));
  localStorage.setItem(KEY(slug), JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('customer:notification', { detail: { slug } }));
}

export function clearNotifications(slug) {
  localStorage.removeItem(KEY(slug));
  window.dispatchEvent(new CustomEvent('customer:notification', { detail: { slug } }));
}

export function getUnreadCount(slug) {
  return getNotifications(slug).filter((n) => !n.read).length;
}
