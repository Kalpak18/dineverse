import { useEffect, useRef, useState } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

// Thin bar at the top of the screen when the connection is down or weak, and a
// short "Back online" when it returns. Screens that must not act while
// offline (placing an order) also read useNetworkStatus themselves.
export default function NetworkBanner() {
  const state = useNetworkStatus();
  const [back, setBack] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    if (state !== 'online') { wasDown.current = true; setBack(false); return undefined; }
    if (!wasDown.current) return undefined;
    wasDown.current = false;
    setBack(true);
    const t = setTimeout(() => setBack(false), 2500);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'online' && !back) return null;
  const tone = state === 'offline' ? 'bg-gray-900 text-white' : state === 'weak' ? 'bg-amber-500 text-gray-950' : 'bg-green-600 text-white';
  const text = state === 'offline'
    ? 'You’re offline — we’ll reconnect automatically. Nothing is sent until you’re back.'
    : state === 'weak'
      ? 'Slow or unstable connection — retrying…'
      : 'Back online';
  return (
    <div role={state === 'online' ? 'status' : 'alert'} aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[9997] px-4 py-2 text-center text-sm font-semibold shadow ${tone}`}
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
      {text}
    </div>
  );
}
