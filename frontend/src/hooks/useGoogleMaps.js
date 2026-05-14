import { useState, useEffect } from 'react';

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

let loadState = 'idle';
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

function waitForMaps(resolve) {
  // Poll until window.google.maps.Map is actually a constructor
  if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
    loadState = 'ready';
    notify();
    resolve();
  } else {
    setTimeout(() => waitForMaps(resolve), 50);
  }
}

function loadScript() {
  if (loadState !== 'idle') return;
  loadState = 'loading';

  // Use the callback pattern — Google calls this when fully ready
  window.__gmapsReady = () => {
    new Promise((resolve) => waitForMaps(resolve)).then(() => {
      delete window.__gmapsReady;
    });
  };

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places,geometry&callback=__gmapsReady`;
  script.async = true;
  script.defer = true;
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
