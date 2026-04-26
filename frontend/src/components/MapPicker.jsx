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

const TILE_LAYERS = {
  detailed: {
    label: 'Detailed',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    },
  },
};

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
  const tileLayerRef = useRef(null);
  const lastAutoAddressRef = useRef('');
  const manuallyPinnedRef = useRef(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [autoLocating, setAutoLocating] = useState(false);
  const [autoLocationLabel, setAutoLocationLabel] = useState('');
  const [mapStyle, setMapStyle] = useState('detailed');
  const [locatingUser, setLocatingUser] = useState(false);

  // Default to India center if no coords
  const initLat = parseFloat(lat) || 20.5937;
  const initLng = parseFloat(lng) || 78.9629;
  const initZoom = parseFloat(lat) ? 15 : 5;

  useEffect(() => {
    if (!expanded || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true }).setView([initLat, initLng], initZoom);
    const style = TILE_LAYERS[mapStyle];
    const tileLayer = L.tileLayer(style.url, style.options).addTo(map);
    tileLayerRef.current = tileLayer;

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

  useEffect(() => {
    if (!expanded || !mapRef.current) return;
    const map = mapRef.current;
    const currentLayer = tileLayerRef.current;
    if (currentLayer) map.removeLayer(currentLayer);
    const style = TILE_LAYERS[mapStyle];
    tileLayerRef.current = L.tileLayer(style.url, style.options).addTo(map);
  }, [expanded, mapStyle]);

  useEffect(() => {
    if (!expanded || !mapRef.current) return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [expanded, suggestions.length]);

  // Sync marker when lat/lng prop changes externally
  useEffect(() => {
    const fLat = parseFloat(lat);
    const fLng = parseFloat(lng);
    if (mapRef.current && markerRef.current && fLat && fLng) {
      markerRef.current.setLatLng([fLat, fLng]);
      mapRef.current.setView([fLat, fLng], 15);
    }
  }, [lat, lng]);

  useEffect(() => {
    const query = (address || '').trim();
    if (!query || query.length < 8) {
      setAutoLocationLabel('');
      return;
    }
    if (query === lastAutoAddressRef.current) return;
    if (lat && lng) return;

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

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setAutoLocationLabel('Location access is not available on this device');
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;
        manuallyPinnedRef.current = true;
        setLocatingUser(false);
        if (mapRef.current && markerRef.current) {
          markerRef.current.setLatLng([newLat, newLng]);
          mapRef.current.flyTo([newLat, newLng], 18, { duration: 0.8 });
        }
        const resolvedAddress = await reverseGeocode(newLat, newLng);
        onChange({ lat: newLat, lng: newLng, address: resolvedAddress || address });
        setAutoLocationLabel('Pinned to your current location');
      },
      () => {
        setLocatingUser(false);
        setAutoLocationLabel('Could not access your current location');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
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
          <div className="p-2 sm:p-3 bg-gray-50 border-b border-gray-200 relative space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className="input flex-1 text-sm py-2"
                placeholder="Search address, area, or landmark..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching}
                  className="btn-secondary text-sm px-3 py-2 whitespace-nowrap"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={locatingUser}
                  className="btn-secondary text-sm px-3 py-2 whitespace-nowrap"
                >
                  {locatingUser ? 'Locating...' : 'My location'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(TILE_LAYERS).map(([key, layer]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMapStyle(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    mapStyle === key
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-brand-300'
                  }`}
                >
                  {layer.label}
                </button>
              ))}
            </div>

            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute top-full left-2 right-2 sm:left-3 sm:right-3 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-[9999] max-h-56 overflow-y-auto">
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
          <div
            ref={containerRef}
            style={{ height: 'clamp(320px, 52vh, 520px)', width: '100%', zIndex: 0 }}
            className="touch-pan-x touch-pan-y"
          />

          <div className="px-3 py-2 bg-gray-50 space-y-1">
            <p className="text-xs text-gray-500">
              Tap to place the pin, drag it for precision, or switch to satellite for an easier building-level view.
            </p>
            <p className="text-xs text-gray-400">
              Detailed mode is best for roads and labels. Satellite is best when you want to match the real building.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
