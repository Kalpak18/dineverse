import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getOrderById } from '../services/api';
import { getApiError } from '../utils/apiError';

// Order actions on staff screens go through send() so a tap is never lost:
// - no answer (Wi-Fi blip, server restarting): retried until it lands,
//   shown via `saving` / `retrying`
// - the server refuses (another device changed the order first, or our
//   earlier try did land): the order is re-read; if it is already where this
//   tap wanted it (isDone), that's success — otherwise the latest state is
//   shown with a short note
// send() resolves to the server's data, or null when the action didn't apply.
//   applyOrder(order) — put the server's copy of an order on screen
//   refetch()         — reload the whole list (used if the order can't be read)
//   onSuccess()       — the server answered (e.g. note when the screen last synced)
export function useReliableAction({ applyOrder, refetch, onSuccess, toastStyle } = {}) {
  const [saving, setSaving] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const send = useCallback(async (orderId, call, isDone) => {
    setSaving((n) => n + 1);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const { data } = await call();
          onSuccess?.();
          return data;
        } catch (err) {
          const status = err?.response?.status;
          if (status && status < 500 && status !== 408 && status !== 429) {
            const fresh = await getOrderById(orderId).then((r) => r.data.order).catch(() => null);
            if (fresh) applyOrder?.(fresh);
            if (fresh && isDone?.(fresh)) return { order: fresh };
            toast(fresh ? 'Already changed on another device — showing the latest' : getApiError(err),
              { icon: '↻', ...(toastStyle && { style: toastStyle }) });
            if (!fresh) refetch?.();
            return null;
          }
          setRetrying(true);
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)));
        }
      }
    } finally {
      setSaving((n) => n - 1);
    }
  }, [applyOrder, refetch, onSuccess, toastStyle]);

  useEffect(() => { if (!saving) setRetrying(false); }, [saving]);

  // Closing the tab while a change is still being saved would lose it
  useEffect(() => {
    if (!saving) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving]);

  return { send, saving, retrying };
}

// The floating "Saving…" / "Not saved yet — retrying…" pill
export function SavingPill({ saving, retrying }) {
  if (!saving) return null;
  return (
    <div role="status" className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm font-bold shadow-lg ${retrying ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-100'}`}>
      {retrying ? '⏳ Not saved yet — retrying…' : '⏳ Saving…'}
    </div>
  );
}

// Not receiving live updates: re-check every 20 s until the connection is
// back, and show a banner after a few seconds (short blips don't flash it)
export function useLiveStatus(connected, refetch) {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [showOffline, setShowOffline] = useState(false);
  useEffect(() => {
    const goOnline = () => { setOnline(true); refetch?.(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [refetch]);
  const live = connected && online;
  useEffect(() => {
    if (live) { setShowOffline(false); return undefined; }
    const warn = setTimeout(() => setShowOffline(true), 4000);
    const poll = setInterval(() => refetch?.(), 20000);
    return () => { clearTimeout(warn); clearInterval(poll); };
  }, [live, refetch]);
  return { showOffline };
}

export function OfflineBanner({ show, onRetry }) {
  if (!show) return null;
  return (
    <div role="alert" className="rounded-xl bg-red-600 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm font-bold">
      <span>⚠️ Offline — new orders and changes may not show until the connection is back.</span>
      {onRetry && <button type="button" onClick={onRetry} className="min-h-[40px] px-3 rounded-lg bg-white/20 flex-shrink-0">Retry now</button>}
    </div>
  );
}
