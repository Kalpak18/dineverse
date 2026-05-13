/**
 * Loads the Google Maps JavaScript SDK once and returns load state.
 * Returns { ready: true } when window.google.maps is available.
 * Returns { unavailable: true } if VITE_GOOGLE_MAPS_API_KEY is not set.
 *
 * All map UI should gate on `ready` before rendering map elements.
 * When `unavailable`, hide map UI — nothing else is affected.
 */
import { useState, useEffect } from 'react';

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

let loadState = 'idle'; // 'idle' | 'loading' | 'ready' | 'unavailable'
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function loadScript() {
  if (loadState !== 'idle') return;
  loadState = 'loading';
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places&loading=async`;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    loadState = 'ready';
    notify();
  };
  script.onerror = () => {
    loadState = 'unavailable';
    notify();
  };
  document.head.appendChild(script);
}

export function useGoogleMaps() {
  const [state, setState] = useState(loadState);

  useEffect(() => {
    if (!GMAPS_KEY) {
      loadState = 'unavailable';
      setState('unavailable');
      return;
    }
    if (loadState === 'ready') { setState('ready'); return; }
    if (loadState === 'unavailable') { setState('unavailable'); return; }

    const update = () => setState(loadState);
    listeners.add(update);
    if (loadState === 'idle') loadScript();

    return () => listeners.delete(update);
  }, []);

  return {
    ready:       state === 'ready',
    loading:     state === 'loading' || state === 'idle',
    unavailable: state === 'unavailable',
  };
}
