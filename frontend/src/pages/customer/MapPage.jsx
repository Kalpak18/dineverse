import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { getNearbyCafes } from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';

// Fix Leaflet default icon paths broken by Vite bundling
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Orange teardrop icon for cafés
function makeCafeIcon(selected = false) {
  const size = selected ? 36 : 28;
  const bg   = selected ? '#c2410c' : '#f97316';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${bg};border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -(size + 4)],
  });
}

// Blue pulsing dot for user's own position
const userIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:16px;height:16px;background:#3b82f6;
    border-radius:50%;border:3px solid white;
    box-shadow:0 0 0 4px rgba(59,130,246,0.25);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const RADIUS_OPTIONS = [5, 10, 20, 30, 50];

export default function MapPage() {
  const navigate    = useNavigate();
  const mapDivRef   = useRef(null);
  const mapRef      = useRef(null);
  const markersRef  = useRef(new Map()); // cafe.id → L.marker
  const userDotRef  = useRef(null);      // blue dot marker

  const [cafes,        setCafes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [geoError,     setGeoError]     = useState(null); // 'denied' | 'unavailable'
  const [userLocation, setUserLocation] = useState(null); // { lat, lng }
  const [selectedCafe, setSelectedCafe] = useState(null);
  const [activeView,   setActiveView]   = useState('map'); // 'map' | 'list' (mobile)
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searching,    setSearching]    = useState(false);
  const [radius,       setRadius]       = useState(30);

  // ── Map init (once on mount) ─────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: true })
      .setView([20.5937, 78.9629], 5); // India

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Fetch nearby cafés ───────────────────────────────────────
  const fetchNearby = useCallback(async (lat, lng, r) => {
    setLoading(true);
    try {
      const { data } = await getNearbyCafes(lat, lng, r);
      setCafes(data.cafes || []);
    } catch {
      toast.error('Failed to load nearby cafés');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Geolocation on mount ─────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        mapRef.current?.setView([loc.lat, loc.lng], 12);
        fetchNearby(loc.lat, loc.lng, radius);
      },
      (err) => setGeoError(err.code === 1 ? 'denied' : 'unavailable'),
      { timeout: 10000 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-fetch when radius changes ─────────────────────────────
  useEffect(() => {
    if (userLocation) fetchNearby(userLocation.lat, userLocation.lng, radius);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ── Sync markers when cafes/userLocation change ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old café markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current.clear();

    // Remove old user dot
    if (userDotRef.current) { map.removeLayer(userDotRef.current); userDotRef.current = null; }

    // Add user dot
    if (userLocation) {
      userDotRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: userIcon,
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(map).bindTooltip('You are here', { permanent: false, direction: 'top' });
    }

    // Add café markers
    cafes.forEach((cafe) => {
      if (!cafe.latitude || !cafe.longitude) return;

      const isSelected = selectedCafe?.id === cafe.id;
      const marker = L.marker([parseFloat(cafe.latitude), parseFloat(cafe.longitude)], {
        icon: makeCafeIcon(isSelected),
        zIndexOffset: isSelected ? 500 : 0,
      }).addTo(map);

      const distText = cafe.distance_km != null
        ? `<span style="font-size:11px;background:#fff7ed;color:#c2410c;padding:1px 6px;border-radius:99px;font-weight:600;">
            ${parseFloat(cafe.distance_km).toFixed(1)} km away
           </span>`
        : '';

      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'min-width:160px;font-family:sans-serif;';
      popupEl.innerHTML = `
        <p style="font-weight:700;font-size:13px;margin:0 0 4px;color:#111;">${escHtml(cafe.name)}</p>
        ${distText}
        ${cafe.address ? `<p style="font-size:11px;color:#9ca3af;margin:4px 0 8px;line-height:1.4;">${escHtml(cafe.address)}</p>` : '<div style="margin-bottom:8px;"></div>'}
        <a href="/cafe/${escHtml(cafe.slug)}"
          style="display:block;text-align:center;background:#f97316;color:white;
                 padding:6px 12px;border-radius:8px;text-decoration:none;
                 font-size:12px;font-weight:600;">
          View Café →
        </a>`;

      marker.bindPopup(popupEl, { maxWidth: 230, closeButton: false });

      marker.on('click', () => {
        setSelectedCafe(cafe);
        // Scroll sidebar card into view
        setTimeout(() => {
          document.getElementById(`map-card-${cafe.id}`)?.scrollIntoView({
            behavior: 'smooth', block: 'nearest',
          });
        }, 50);
      });

      markersRef.current.set(cafe.id, marker);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafes, userLocation, selectedCafe?.id]);

  // ── Nominatim search ─────────────────────────────────────────
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery.trim())}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (!data.length) {
        toast.error('Location not found — try a different city name');
        return;
      }
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      setUserLocation({ lat, lng });
      mapRef.current?.setView([lat, lng], 12);
      fetchNearby(lat, lng, radius);
    } catch {
      toast.error('Search failed, please try again');
    } finally {
      setSearching(false);
    }
  };

  // ── Near Me button ───────────────────────────────────────────
  const handleNearMe = () => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported by your browser'); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        mapRef.current?.setView([loc.lat, loc.lng], 12);
        fetchNearby(loc.lat, loc.lng, radius);
        setGeoError(null);
      },
      (err) => {
        if (err.code === 1) toast.error('Location access denied — search for a city above');
        else toast.error('Could not detect your location');
      },
      { timeout: 10000 }
    );
  };

  // ── Sidebar card click → pan map + open popup ────────────────
  const handleCardClick = (cafe) => {
    setSelectedCafe(cafe);
    const marker = markersRef.current.get(cafe.id);
    if (marker && mapRef.current) {
      mapRef.current.setView([parseFloat(cafe.latitude), parseFloat(cafe.longitude)], 15);
      marker.openPopup();
    }
    setActiveView('map');
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">

      {/* ── Sticky Header ── */}
      <div className="bg-white border-b border-gray-100 flex-shrink-0 z-20">
        <div className="px-3 py-3 flex items-center gap-2">

          {/* Back */}
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
            aria-label="Go back"
          >
            ←
          </button>

          {/* Search form */}
          <form onSubmit={handleSearch} className="flex-1 flex gap-2 min-w-0">
            <input
              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50"
              placeholder="Search city or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="submit"
              disabled={searching}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
            >
              {searching ? '…' : 'Go'}
            </button>
          </form>

          {/* Near Me */}
          <button
            type="button"
            onClick={handleNearMe}
            className="flex items-center gap-1 border border-brand-300 text-brand-600 hover:bg-brand-50 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0"
          >
            <span>📍</span>
            <span className="hidden sm:inline">Near me</span>
          </button>

          {/* Mobile map/list toggle */}
          <div className="flex md:hidden border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
            {['map', 'list'].map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  activeView === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {v === 'map' ? '🗺️' : '📋'}
              </button>
            ))}
          </div>
        </div>

        {/* Geo error banner */}
        {geoError && (
          <div className="bg-amber-50 border-t border-amber-200 px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
            <span>⚠️</span>
            {geoError === 'denied'
              ? 'Location access denied. Search for a city above to find nearby cafés.'
              : 'Could not detect your location. Search for a city above.'}
          </div>
        )}
      </div>

      {/* ── Body: sidebar + map ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <div className={`
          w-full md:w-80 flex-shrink-0 border-r border-gray-200 bg-white
          flex flex-col overflow-hidden
          ${activeView === 'list' ? 'flex' : 'hidden'} md:flex
        `}>
          {/* Sidebar header */}
          <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <p className="text-sm font-semibold text-gray-700">
              {loading
                ? 'Searching…'
                : userLocation
                  ? `${cafes.length} café${cafes.length !== 1 ? 's' : ''} nearby`
                  : 'Cafés near you'
              }
            </p>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white cursor-pointer"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
          </div>

          {/* Sidebar body */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner />
              </div>
            )}

            {!loading && !userLocation && cafes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="text-5xl mb-4">📍</span>
                <p className="text-sm font-semibold text-gray-700 mb-1">Find cafés near you</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Allow location access or search a city above to discover cafés on the map.
                </p>
              </div>
            )}

            {!loading && userLocation && cafes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="text-5xl mb-4">☕</span>
                <p className="text-sm font-semibold text-gray-700 mb-1">No cafés found nearby</p>
                <p className="text-xs text-gray-400">
                  Try increasing the radius or search a different city.
                </p>
              </div>
            )}

            {!loading && cafes.length > 0 && (
              <div className="p-2 space-y-1.5">
                {cafes.map((cafe) => (
                  <CafeSidebarCard
                    key={cafe.id}
                    cafe={cafe}
                    selected={selectedCafe?.id === cafe.id}
                    onClick={() => handleCardClick(cafe)}
                    onNavigate={() => navigate(`/cafe/${cafe.slug}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Map ── */}
        <div className={`flex-1 relative ${activeView === 'list' ? 'hidden md:block' : 'block'}`}>
          <div ref={mapDivRef} className="w-full h-full" />

          {/* Loading overlay on map */}
          {loading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 pointer-events-none">
              <LoadingSpinner />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar Café Card ─────────────────────────────────────────
function CafeSidebarCard({ cafe, selected, onClick, onNavigate }) {
  const distKm = cafe.distance_km != null ? parseFloat(cafe.distance_km) : null;

  return (
    <div
      id={`map-card-${cafe.id}`}
      onClick={onClick}
      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
        selected
          ? 'bg-brand-50 border-brand-200 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      {/* Logo or initial */}
      <div className="w-11 h-11 rounded-xl flex-shrink-0 overflow-hidden bg-brand-100 flex items-center justify-center">
        {cafe.logo_url
          ? <img src={cafe.logo_url} alt={cafe.name} className="w-full h-full object-cover" />
          : <span className="font-bold text-brand-600 text-base">{cafe.name.charAt(0).toUpperCase()}</span>
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 text-sm truncate leading-tight">{cafe.name}</p>
        {cafe.address && (
          <p className="text-xs text-gray-400 truncate mt-0.5">{cafe.address}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {distKm != null && (
            <span className="text-xs font-semibold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">
              {distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            className="text-xs text-brand-600 font-semibold hover:underline"
          >
            View →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
