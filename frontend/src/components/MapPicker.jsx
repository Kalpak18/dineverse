/**
 * MapPicker — click/drag to pin a location, search by address.
 *
 * Uses Google Maps if VITE_GOOGLE_MAPS_API_KEY is set.
 * If the key is absent or the SDK fails to load, the map section is hidden
 * and the address field continues to work normally (no coords).
 *
 * Props:
 *   lat, lng   — current coordinates (number | null)
 *   address    — current address string
 *   onChange({ lat, lng, address }) — called when location changes
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useGoogleMaps } from '../hooks/useGoogleMaps';

// ── Geocoding helpers (Google) ─────────────────────────────────────────────────
async function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    const gc = new window.google.maps.Geocoder();
    gc.geocode({ location: { lat, lng } }, (results, status) => {
      resolve(status === 'OK' && results[0] ? results[0].formatted_address : '');
    });
  });
}

async function forwardGeocode(query) {
  return new Promise((resolve) => {
    const gc = new window.google.maps.Geocoder();
    gc.geocode({ address: query }, (results, status) => {
      resolve(status === 'OK' ? results : []);
    });
  });
}

export default function MapPicker({ lat, lng, address, onChange }) {
  const { ready, unavailable } = useGoogleMaps();
  const [expanded, setExpanded]             = useState(false);
  const [search, setSearch]                 = useState('');
  const [suggestions, setSuggestions]       = useState([]);
  const [searching, setSearching]           = useState(false);
  const [locating, setLocating]             = useState(false);
  const [statusMsg, setStatusMsg]           = useState('');
  const [autoLocating, setAutoLocating]     = useState(false);

  const mapRef       = useRef(null); // google.maps.Map
  const markerRef    = useRef(null); // google.maps.Marker
  const containerRef = useRef(null);
  const autocompleteRef = useRef(null);
  const lastAddressRef  = useRef('');
  const inputRef        = useRef(null);

  // ── Init Google Map when expanded + SDK ready ────────────────────────────────
  useEffect(() => {
    if (!expanded || !ready || mapRef.current) return;

    const initLat = parseFloat(lat) || 20.5937;
    const initLng = parseFloat(lng) || 78.9629;
    const initZoom = parseFloat(lat) ? 17 : 5;

    const map = new window.google.maps.Map(containerRef.current, {
      center:            { lat: initLat, lng: initLng },
      zoom:              initZoom,
      mapTypeControl:    false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl:       true,
      zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_BOTTOM },
      gestureHandling:   'greedy',
      styles: [
        { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
      ],
    });

    const marker = new window.google.maps.Marker({
      position: { lat: initLat, lng: initLng },
      map,
      draggable: true,
      animation: window.google.maps.Animation.DROP,
    });

    const handlePick = async (latLng) => {
      const newLat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
      const newLng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
      marker.setPosition({ lat: newLat, lng: newLng });
      const addr = await reverseGeocode(newLat, newLng);
      lastAddressRef.current = addr;
      onChange({ lat: newLat, lng: newLng, address: addr });
    };

    map.addListener('click', (e) => handlePick(e.latLng));
    marker.addListener('dragend', () => handlePick(marker.getPosition()));

    mapRef.current    = map;
    markerRef.current = marker;

    // Places Autocomplete on the search input
    if (inputRef.current && window.google.maps.places) {
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['geocode', 'establishment'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (!place.geometry?.location) return;
        const newLat = place.geometry.location.lat();
        const newLng = place.geometry.location.lng();
        marker.setPosition({ lat: newLat, lng: newLng });
        map.setCenter({ lat: newLat, lng: newLng });
        map.setZoom(17);
        const addr = place.formatted_address || place.name || '';
        lastAddressRef.current = addr;
        setSearch('');
        onChange({ lat: newLat, lng: newLng, address: addr });
      });
      autocompleteRef.current = ac;
    }

    return () => {
      window.google.maps.event.clearInstanceListeners(map);
      window.google.maps.event.clearInstanceListeners(marker);
      mapRef.current    = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, ready]);

  // ── Sync marker when lat/lng prop changes externally ────────────────────────
  useEffect(() => {
    const fLat = parseFloat(lat);
    const fLng = parseFloat(lng);
    if (mapRef.current && markerRef.current && fLat && fLng) {
      markerRef.current.setPosition({ lat: fLat, lng: fLng });
      mapRef.current.panTo({ lat: fLat, lng: fLng });
    }
  }, [lat, lng]);

  // ── Auto-geocode typed address (when no coords yet OR address changed) ──────
  useEffect(() => {
    if (!ready) return;
    const query = (address || '').trim();
    if (!query || query.length < 8) return;
    if (query === lastAddressRef.current) return;

    const timer = setTimeout(async () => {
      setAutoLocating(true);
      const results = await forwardGeocode(query);
      setAutoLocating(false);
      if (!results.length) { setStatusMsg('Could not auto-locate this address'); return; }
      const loc = results[0].geometry.location;
      const newLat = loc.lat();
      const newLng = loc.lng();
      lastAddressRef.current = query;
      setStatusMsg('Auto-located from typed address');
      if (mapRef.current && markerRef.current) {
        markerRef.current.setPosition({ lat: newLat, lng: newLng });
        mapRef.current.panTo({ lat: newLat, lng: newLng });
        mapRef.current.setZoom(17);
      }
      onChange({ lat: newLat, lng: newLng, address: query });
    }, 800);

    return () => clearTimeout(timer);
  }, [address, ready, onChange]);

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setStatusMsg('Location not available on this device'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const newLat = coords.latitude;
        const newLng = coords.longitude;
        setLocating(false);
        if (mapRef.current && markerRef.current) {
          markerRef.current.setPosition({ lat: newLat, lng: newLng });
          mapRef.current.panTo({ lat: newLat, lng: newLng });
          mapRef.current.setZoom(19);
        }
        const addr = ready ? await reverseGeocode(newLat, newLng) : '';
        lastAddressRef.current = addr;
        onChange({ lat: newLat, lng: newLng, address: addr || address });
        setStatusMsg('Pinned to your current location');
      },
      () => { setLocating(false); setStatusMsg('Could not access your location'); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [ready, address, onChange]);

  // Manual search fallback (if Places Autocomplete isn't available)
  const handleManualSearch = useCallback(async () => {
    const q = search.trim();
    if (!q || !ready) return;
    setSearching(true);
    const results = await forwardGeocode(q);
    setSearching(false);
    if (!results.length) { setStatusMsg('No results found'); setSuggestions([]); return; }
    setSuggestions(results.slice(0, 5));
  }, [search, ready]);

  const pickSuggestion = (r) => {
    const loc = r.geometry.location;
    const newLat = loc.lat();
    const newLng = loc.lng();
    setSuggestions([]);
    setSearch('');
    if (mapRef.current && markerRef.current) {
      markerRef.current.setPosition({ lat: newLat, lng: newLng });
      mapRef.current.panTo({ lat: newLat, lng: newLng });
      mapRef.current.setZoom(17);
    }
    const addr = r.formatted_address || '';
    lastAddressRef.current = addr;
    onChange({ lat: newLat, lng: newLng, address: addr });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {/* Toggle button — hide entirely when unavailable */}
      {!unavailable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm text-brand-600 font-medium hover:underline"
        >
          📍 {expanded ? 'Hide map' : lat ? 'Edit pin on map' : 'Pick location on map'}
        </button>
      )}

      {/* Coords display when collapsed */}
      {lat && lng && !expanded && !unavailable && (
        <p className="text-xs text-gray-400">
          Pinned: {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
        </p>
      )}

      {/* Status messages */}
      {(autoLocating || statusMsg) && (
        <p className={`text-xs ${statusMsg.startsWith('Could not') ? 'text-amber-600' : 'text-green-600'}`}>
          {autoLocating ? 'Finding this address on the map…' : statusMsg}
        </p>
      )}

      {/* Map panel */}
      {expanded && !unavailable && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Search bar */}
          <div className="p-2 sm:p-3 bg-gray-50 border-b border-gray-200 relative space-y-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                className="input flex-1 text-sm py-2"
                placeholder="Search address, area or landmark…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualSearch(); } }}
              />
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={locating}
                title="Use my location"
                className="btn-secondary text-sm px-3 py-2 whitespace-nowrap flex items-center gap-1.5"
              >
                {locating ? (
                  <span className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin inline-block" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>
                )}
                <span className="hidden sm:inline">{locating ? 'Locating…' : 'My location'}</span>
              </button>
            </div>

            {/* Fallback suggestions (when Places Autocomplete not available) */}
            {suggestions.length > 0 && (
              <div className="absolute left-2 right-2 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-[9999] max-h-56 overflow-y-auto">
                {suggestions.map((r, i) => (
                  <button key={i} type="button" onClick={() => pickSuggestion(r)}
                    className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    {r.formatted_address}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Map loading skeleton */}
          {!ready && (
            <div className="flex items-center justify-center bg-gray-100" style={{ height: 'clamp(280px, 45vh, 480px)' }}>
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm">Loading map…</p>
              </div>
            </div>
          )}

          {/* Google Map container */}
          <div
            ref={containerRef}
            style={{ height: ready ? 'clamp(280px, 45vh, 480px)' : 0, width: '100%' }}
          />

          <p className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
            Tap the map to place the pin · Drag to adjust · Search or use My Location for exact coordinates
          </p>
        </div>
      )}
    </div>
  );
}
