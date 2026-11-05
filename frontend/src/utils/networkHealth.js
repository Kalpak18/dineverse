// What the app knows about its connection, shared by every screen:
//   'offline' — the device has no network
//   'weak'    — it says it's online but requests aren't getting through
//               (common on mobile data); set by real failed API calls
//   'online'  — requests are working
// The API client reports each request's outcome here (services/api.js).
const listeners = new Set();
let weak = false;

export function getNetworkState() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return weak ? 'weak' : 'online';
}
const emit = () => listeners.forEach((fn) => fn(getNetworkState()));

export function reportRequest(ok) {
  if (weak === !ok) return;
  weak = !ok;
  emit();
}

export function subscribeNetwork(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { weak = false; emit(); });
  window.addEventListener('offline', emit);
}
