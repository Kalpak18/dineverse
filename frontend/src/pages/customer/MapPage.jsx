/**
 * MapPage — full-screen café finder map.
 *
 * Design principles:
 *  • Leaflet objects (icons, markers) are ONLY created inside effects — never at module level.
 *  • Marker recreation is decoupled from selection: clicking a card swaps the icon on the
 *    existing marker instead of destroying and rebuilding everything.
 *  • Map init uses an initDone ref to survive React StrictMode double-invoke.
 *  • Geolocation and Nominatim search both write to the same `userLocation` state,
 *    which triggers a single fetchNearby call.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { getNearbyCafes } from '../../services/api';
import toast from 'react-hot-toast';

const RADIUS_OPTIONS = [5, 10, 20, 30, 50];
const INDIA_CENTER   = [20.5937, 78.9629];

// ── Icon factories (called inside effects only, never at module scope) ──────
function cafeIcon(selected) {
  const size = selected ? 36 : 28;
  const bg   = selected ? '#ea580c' : '#f97316';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${bg};
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.35);
      transition:all .15s ease;
    "></div>`,
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size],
    popupAnchor: [0, -(size + 4)],
  });
}

function userIcon() {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:14px;height:14px;
      background:#3b82f6;border-radius:50%;
      border:3px solid #fff;
      box-shadow:0 0 0 5px rgba(59,130,246,.25);
    "></span>`,
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
  });
}

// ── XSS-safe html escape ─────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Popup HTML for a café marker ─────────────────────────────────────────────
function popupHtml(cafe) {
  const km = cafe.distance_km != null
    ? `<span style="display:inline-block;margin:4px 0 6px;font-size:11px;font-weight:700;
         color:#ea580c;background:#fff7ed;padding:2px 8px;border-radius:99px;">
         ${parseFloat(cafe.distance_km) < 1
           ? Math.round(parseFloat(cafe.distance_km) * 1000) + ' m away'
           : parseFloat(cafe.distance_km).toFixed(1) + ' km away'}
       </span>`
    : '';
  const addr = cafe.address
    ? `<p style="margin:0 0 8px;font-size:11px;color:#9ca3af;line-height:1.4;">${esc(cafe.address)}</p>`
    : '<div style="margin-bottom:8px;"></div>';
  return `
    <div style="min-width:170px;font-family:system-ui,sans-serif;">
      <p style="margin:0 0 2px;font-weight:700;font-size:13px;color:#111;">${esc(cafe.name)}</p>
      ${km}${addr}
      <a href="/cafe/${esc(cafe.slug)}"
        style="display:block;text-align:center;background:#f97316;color:#fff;
               padding:6px 12px;border-radius:8px;text-decoration:none;
               font-size:12px;font-weight:700;">
        View Café →
      </a>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function MapPage() {
  const navigate = useNavigate();

  // DOM refs
  const mapDivRef = useRef(null);

  // Leaflet state refs (never stored in React state — avoids re-renders)
  const mapRef         = useRef(null);
  const initDoneRef    = useRef(false);    // StrictMode guard
  const cafeMarkersRef = useRef(new Map()); // cafeId → { marker, popup }
  const userMarkerRef  = useRef(null);

  // React state
  const [cafes,        setCafes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [geoError,     setGeoError]     = useState(null);  // 'denied'|'unavailable'|null
  const [userLocation, setUserLocation] = useState(null);  // {lat,lng}|null
  const [selectedId,   setSelectedId]   = useState(null);
  const [radius,       setRadius]       = useState(30);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searching,    setSearching]    = useState(false);
  const [mobileTab,    setMobileTab]    = useState('map'); // 'map'|'list'

  // ── 1. Initialise Leaflet map (once) ────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current || !mapDivRef.current) return;
    initDoneRef.current = true;

    const map = L.map(mapDivRef.current, { zoomControl: true })
      .setView(INDIA_CENTER, 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current   = null;
      initDoneRef.current = false;
    };
  }, []);

  // ── 2. Fetch nearby ─────────────────────────────────────────────────────
  const fetchNearby = useCallback(async (lat, lng, r) => {
    setLoading(true);
    try {
      const { data } = await getNearbyCafes(lat, lng, r);
      setCafes(data.cafes || []);
    } catch {
      toast.error('Failed to load nearby cafés');
      setCafes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 3. Geolocation helper ────────────────────────────────────────────────
  const requestGeo = useCallback((onSuccess) => {
    if (!navigator.geolocation) {
      setGeoError('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setGeoError(null);
        mapRef.current?.setView([loc.lat, loc.lng], 13);
        onSuccess?.(loc);
      },
      (err) => setGeoError(err.code === 1 ? 'denied' : 'unavailable'),
      { timeout: 10000 }
    );
  }, []);

  // Kick off geolocation on mount
  useEffect(() => {
    requestGeo((loc) => fetchNearby(loc.lat, loc.lng, radius));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 4. Re-fetch when radius changes (if we already have a location) ──────
  const prevRadiusRef = useRef(radius);
  useEffect(() => {
    if (prevRadiusRef.current === radius) return; // skip initial mount
    prevRadiusRef.current = radius;
    if (userLocation) fetchNearby(userLocation.lat, userLocation.lng, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ── 5. Sync markers when cafes or userLocation change ───────────────────
  //    Does NOT depend on selectedId — selection is handled separately (step 6)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // ── User location dot ──
    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null; }
    if (userLocation) {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: userIcon(),
        zIndexOffset: 2000,
        interactive: false,
      }).addTo(map).bindTooltip('You are here', { direction: 'top', offset: [0, -10] });
    }

    // ── Remove stale café markers ──
    cafeMarkersRef.current.forEach(({ marker }) => marker.remove());
    cafeMarkersRef.current.clear();

    // ── Add fresh café markers ──
    cafes.forEach((cafe) => {
      if (!cafe.latitude || !cafe.longitude) return;

      const lat = parseFloat(cafe.latitude);
      const lng = parseFloat(cafe.longitude);
      const isSelected = cafe.id === selectedId;

      const popupEl = document.createElement('div');
      popupEl.innerHTML = popupHtml(cafe);

      const marker = L.marker([lat, lng], {
        icon: cafeIcon(isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      })
        .addTo(map)
        .bindPopup(popupEl, { maxWidth: 230, closeButton: false });

      marker.on('click', () => {
        setSelectedId(cafe.id);
        setMobileTab('map');
        document.getElementById(`mc-${cafe.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      cafeMarkersRef.current.set(cafe.id, { marker, lat, lng });
    });
  // selectedId intentionally NOT in deps — handled in effect #6
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafes, userLocation]);

  // ── 6. Swap icon on selected/deselected markers (no marker recreation) ──
  useEffect(() => {
    cafeMarkersRef.current.forEach(({ marker }, id) => {
      marker.setIcon(cafeIcon(id === selectedId));
      marker.setZIndexOffset(id === selectedId ? 1000 : 0);
    });
  }, [selectedId]);

  // ── Nominatim search ────────────────────────────────────────────────────
  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (!data.length) { toast.error('Location not found — try a different city'); return; }
      const loc = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      setUserLocation(loc);
      setGeoError(null);
      mapRef.current?.setView([loc.lat, loc.lng], 12);
      fetchNearby(loc.lat, loc.lng, radius);
    } catch {
      toast.error('Search failed — please try again');
    } finally {
      setSearching(false);
    }
  };

  // ── Sidebar card click → pan + open popup ───────────────────────────────
  const handleCardClick = (cafe) => {
    setSelectedId(cafe.id);
    setMobileTab('map');
    const entry = cafeMarkersRef.current.get(cafe.id);
    if (entry && mapRef.current) {
      mapRef.current.setView([entry.lat, entry.lng], 15, { animate: true });
      entry.marker.openPopup();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 flex-shrink-0 shadow-sm z-20">
        <div className="px-3 py-3 flex items-center gap-2 max-w-7xl mx-auto">

          {/* Back */}
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
            aria-label="Go back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M5 12l7 7M5 12l7-7"/>
            </svg>
          </button>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50"
                placeholder="Search city or area…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white
                         px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {searching ? '…' : 'Search'}
            </button>
          </form>

          {/* Near me */}
          <button
            type="button"
            onClick={() => requestGeo((loc) => fetchNearby(loc.lat, loc.lng, radius))}
            className="flex items-center gap-1.5 border border-brand-200 text-brand-600
                       hover:bg-brand-50 px-3 py-2.5 rounded-xl text-sm font-semibold
                       whitespace-nowrap flex-shrink-0 transition-colors"
          >
            <span>📍</span>
            <span className="hidden sm:inline">Near me</span>
          </button>

          {/* Mobile tab toggle */}
          <div className="flex md:hidden border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
            {[['map', '🗺️'], ['list', '📋']].map(([v, icon]) => (
              <button
                key={v}
                onClick={() => setMobileTab(v)}
                className={`px-3 py-2 text-sm transition-colors ${
                  mobileTab === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Geo-denied warning */}
        {geoError && (
          <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 flex items-center gap-2">
            <span className="text-amber-500">⚠️</span>
            <p className="text-xs text-amber-700 flex-1">
              {geoError === 'denied'
                ? 'Location access denied — search for a city above to find nearby cafés.'
                : 'Could not get your location — search for a city above.'}
            </p>
          </div>
        )}
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <aside className={`
          w-full md:w-80 flex-shrink-0 bg-white border-r border-gray-100
          flex flex-col overflow-hidden
          ${mobileTab === 'list' ? 'flex' : 'hidden'} md:flex
        `}>
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <p className="text-sm font-semibold text-gray-800">
              {loading
                ? 'Searching…'
                : userLocation
                  ? `${cafes.length} café${cafes.length !== 1 ? 's' : ''} within ${radius} km`
                  : 'Find cafés near you'}
            </p>
            {/* Radius picker */}
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
          </div>

          {/* Café list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-500">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                Finding cafés…
              </div>
            )}

            {!loading && !userLocation && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center text-3xl mb-4">📍</div>
                <p className="text-sm font-semibold text-gray-700 mb-1">Allow location or search a city</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Nearby cafés on DineVerse will appear here
                </p>
              </div>
            )}

            {!loading && userLocation && cafes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center text-3xl mb-4">☕</div>
                <p className="text-sm font-semibold text-gray-700 mb-1">No cafés found nearby</p>
                <p className="text-xs text-gray-400">
                  Try increasing the radius or search a different city.
                </p>
              </div>
            )}

            {!loading && cafes.length > 0 && (
              <div className="p-3 space-y-2">
                {cafes.map((cafe) => (
                  <CafeCard
                    key={cafe.id}
                    cafe={cafe}
                    selected={cafe.id === selectedId}
                    onSelect={() => handleCardClick(cafe)}
                    onNavigate={() => navigate(`/cafe/${cafe.slug}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── Map ── */}
        <div className={`flex-1 relative ${mobileTab === 'list' ? 'hidden md:block' : 'block'}`}>
          {/* Leaflet mounts here */}
          <div ref={mapDivRef} className="absolute inset-0" />

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-[900] pointer-events-none">
              <div className="bg-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium text-gray-700">Finding cafés…</span>
              </div>
            </div>
          )}

          {/* Café count badge (bottom-left) */}
          {!loading && cafes.length > 0 && (
            <div className="absolute bottom-6 left-4 z-[900] pointer-events-none">
              <span className="bg-white border border-gray-200 shadow text-xs font-semibold text-gray-700 px-3 py-1.5 rounded-full">
                {cafes.length} café{cafes.length !== 1 ? 's' : ''} in view
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar card component ───────────────────────────────────────────────────
function CafeCard({ cafe, selected, onSelect, onNavigate }) {
  const dist = cafe.distance_km != null ? parseFloat(cafe.distance_km) : null;
  const distLabel = dist == null ? null
    : dist < 1 ? `${Math.round(dist * 1000)} m`
    : `${dist.toFixed(1)} km`;

  return (
    <div
      id={`mc-${cafe.id}`}
      onClick={onSelect}
      className={`flex gap-3 p-3 rounded-xl cursor-pointer transition-all border ${
        selected
          ? 'bg-orange-50 border-orange-200 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      {/* Logo / initial */}
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden border border-gray-100 bg-brand-50 flex items-center justify-center">
        {cafe.logo_url
          ? <img src={cafe.logo_url} alt={cafe.name} className="w-full h-full object-cover" />
          : <span className="font-bold text-brand-600 text-lg">{cafe.name.charAt(0).toUpperCase()}</span>
        }
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 text-sm leading-tight truncate">{cafe.name}</p>
        {cafe.address && (
          <p className="text-xs text-gray-400 truncate mt-0.5">{cafe.address}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {distLabel && (
            <span className="text-xs font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
              {distLabel}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            className="text-xs text-brand-600 font-semibold hover:underline"
          >
            View menu →
          </button>
        </div>
      </div>
    </div>
  );
}
