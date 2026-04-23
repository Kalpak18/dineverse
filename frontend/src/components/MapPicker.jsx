import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Nominatim reverse geocode (OpenStreetMap, free, no API key)
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    return data.display_name || '';
  } catch {
    return '';
  }
}

// Nominatim forward geocode
async function forwardGeocode(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    );
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * MapPicker — click/drag to pin location, search by address.
 *
 * Props:
 *   lat, lng          — current values (numbers or null)
 *   address           — current address string
 *   onChange({ lat, lng, address }) — called when user picks a location
 */
export default function MapPicker({ lat, lng, address, onChange }) {
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const containerRef = useRef(null);
  const lastAutoAddressRef = useRef('');
  const manuallyPinnedRef = useRef(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [autoLocating, setAutoLocating] = useState(false);
  const [autoLocationLabel, setAutoLocationLabel] = useState('');

  // Default to India center if no coords
  const initLat = lat || 20.5937;
  const initLng = lng || 78.9629;
  const initZoom = lat ? 15 : 5;

  useEffect(() => {
    if (!expanded || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([initLat, initLng], initZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const marker = L.marker([initLat, initLng], { draggable: true }).addTo(map);
    markerRef.current = marker;
    mapRef.current = map;

    const handlePick = async (latlng) => {
      manuallyPinnedRef.current = true;
      marker.setLatLng(latlng);
      const addr = await reverseGeocode(latlng.lat, latlng.lng);
      onChange({ lat: latlng.lat, lng: latlng.lng, address: addr });
    };

    map.on('click', (e) => handlePick(e.latlng));
    marker.on('dragend', () => handlePick(marker.getLatLng()));

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync marker when lat/lng prop changes externally
  useEffect(() => {
    if (mapRef.current && markerRef.current && lat && lng) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], 15);
    }
  }, [lat, lng]);

  useEffect(() => {
    const query = (address || '').trim();
    if (!query || query.length < 8) {
      setAutoLocationLabel('');
      return;
    }
    if (query === lastAutoAddressRef.current) return;
    if (manuallyPinnedRef.current && lat && lng) return;

    const timeout = setTimeout(async () => {
      setAutoLocating(true);
      const results = await forwardGeocode(query);
      setAutoLocating(false);

      const first = Array.isArray(results) ? results[0] : null;
      if (!first?.lat || !first?.lon) {
        setAutoLocationLabel('Could not auto-locate this address yet');
        return;
      }

      const newLat = parseFloat(first.lat);
      const newLng = parseFloat(first.lon);
      lastAutoAddressRef.current = query;
      setAutoLocationLabel('Auto-located from typed address');

      if (mapRef.current && markerRef.current) {
        markerRef.current.setLatLng([newLat, newLng]);
        mapRef.current.setView([newLat, newLng], 16);
      }

      onChange({ lat: newLat, lng: newLng, address });
    }, 700);

    return () => clearTimeout(timeout);
  }, [address, lat, lng, onChange]);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    const results = await forwardGeocode(search);
    setSuggestions(results);
    setSearching(false);
  };

  const pickSuggestion = (s) => {
    manuallyPinnedRef.current = true;
    const newLat = parseFloat(s.lat);
    const newLng = parseFloat(s.lon);
    setSuggestions([]);
    setSearch('');
    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
      mapRef.current.setView([newLat, newLng], 16);
    }
    onChange({ lat: newLat, lng: newLng, address: s.display_name });
  };

  return (
    <div className="space-y-2">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm text-brand-600 font-medium hover:underline"
      >
        📍 {expanded ? 'Hide map' : lat ? 'Edit pin on map' : 'Pick location on map'}
      </button>

      {lat && lng && !expanded && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400">
            Pinned: {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
          </p>
          {autoLocationLabel && (
            <p className="text-xs text-green-600">{autoLocationLabel}</p>
          )}
        </div>
      )}

      {!lat && !lng && (autoLocating || autoLocationLabel) && (
        <p className={`text-xs ${autoLocationLabel.startsWith('Could not') ? 'text-amber-600' : 'text-gray-500'}`}>
          {autoLocating ? 'Finding this address on the map...' : autoLocationLabel}
        </p>
      )}

      {expanded && (
        <div className="border border-gray-200 rounded-xl overflow-hidden space-y-0">
          {/* Search bar */}
          <div className="flex gap-2 p-2 bg-gray-50 border-b border-gray-200 relative">
            <input
              type="text"
              className="input flex-1 text-sm py-1.5"
              placeholder="Search address or landmark..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching}
              className="btn-secondary text-sm px-3 py-1.5"
            >
              {searching ? '…' : 'Search'}
            </button>

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute top-full left-2 right-2 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-[9999] max-h-48 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Map container */}
          <div ref={containerRef} style={{ height: '280px', width: '100%', zIndex: 0 }} />

          <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50">
            Click on the map or drag the pin to set your exact location.
          </p>
        </div>
      )}
    </div>
  );
}
