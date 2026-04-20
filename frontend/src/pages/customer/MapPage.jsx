/**
 * MapPage — full-screen DineVerse café finder.
 *
 * Tile layer  : OpenStreetMap standard — free, no key, richest building/road detail
 * Markers     : Custom SVG pins with café logo/initial + pulsing ring on select
 * Data source : /cafes/nearby → only active, subscribed DineVerse cafés with lat/lng
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { getNearbyCafes } from '../../services/api';
import toast from 'react-hot-toast';

const RADIUS_OPTIONS = [3, 5, 10, 20, 50];
const INDIA_CENTER   = [20.5937, 78.9629];
const USER_ZOOM      = 16;   // buildings clearly visible at 16+

// ── Modern pin icon ───────────────────────────────────────────────────────────
function makePinIcon(cafe, selected) {
  const initial = (cafe.name || '?').charAt(0).toUpperCase();
  const hasLogo = !!cafe.logo_url;
  const size    = selected ? 52 : 44;
  const ring    = selected
    ? `<circle cx="26" cy="26" r="24" fill="none" stroke="#f97316" stroke-width="3" stroke-dasharray="5 3" opacity="0.5">
         <animateTransform attributeName="transform" type="rotate" from="0 26 26" to="360 26 26" dur="8s" repeatCount="indefinite"/>
       </circle>`
    : '';

  const inner = hasLogo
    ? `<image href="${cafe.logo_url}" x="6" y="6" width="40" height="40" clip-path="url(#clip-${cafe.id})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="26" y="31" text-anchor="middle" font-size="18" font-weight="700" font-family="system-ui,sans-serif" fill="${selected ? '#fff' : '#fff'}">${initial}</text>`;

  const bg = selected ? '#ea580c' : '#f97316';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="60" viewBox="0 0 52 60">
    <defs>
      <clipPath id="clip-${cafe.id}"><circle cx="26" cy="26" r="20"/></clipPath>
      <filter id="shadow-${cafe.id}" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.25)"/>
      </filter>
    </defs>
    ${ring}
    <circle cx="26" cy="26" r="22" fill="${bg}" filter="url(#shadow-${cafe.id})"/>
    <circle cx="26" cy="26" r="21" fill="${bg}" stroke="white" stroke-width="2.5"/>
    ${inner}
    <polygon points="20,44 26,54 32,44" fill="${bg}"/>
    <polygon points="21,44 26,52 31,44" fill="${bg}"/>
  </svg>`;

  return L.divIcon({
    className:   '',
    html:        svg,
    iconSize:    [52, 60],
    iconAnchor:  [26, 58],
    popupAnchor: [0, -60],
  });
}

function userPinIcon() {
  return L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="10" fill="#3b82f6" stroke="white" stroke-width="2.5" opacity="0.9"/>
      <circle cx="11" cy="11" r="4" fill="white"/>
      <circle cx="11" cy="11" r="11" fill="none" stroke="#3b82f6" stroke-width="2" opacity="0.3">
        <animate attributeName="r" from="11" to="18" dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" from="0.3" to="0" dur="1.6s" repeatCount="indefinite"/>
      </circle>
    </svg>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  });
}

// ── Popup HTML ─────────────────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function popupHtml(cafe) {
  const dist = cafe.distance_km != null
    ? parseFloat(cafe.distance_km) < 1
      ? `${Math.round(parseFloat(cafe.distance_km) * 1000)} m`
      : `${parseFloat(cafe.distance_km).toFixed(1)} km`
    : null;

  const logoHtml = cafe.logo_url
    ? `<img src="${esc(cafe.logo_url)}" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0;border:1.5px solid #f3f4f6"/>`
    : `<div style="width:40px;height:40px;border-radius:10px;background:#fff7ed;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#f97316;flex-shrink:0;border:1.5px solid #f3f4f6">${esc(cafe.name.charAt(0).toUpperCase())}</div>`;

  return `<div style="font-family:system-ui,-apple-system,sans-serif;min-width:200px;max-width:240px;">
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;">
      ${logoHtml}
      <div style="flex:1;min-width:0;">
        <p style="margin:0 0 2px;font-weight:700;font-size:13px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(cafe.name)}</p>
        ${cafe.address ? `<p style="margin:0;font-size:11px;color:#9ca3af;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(cafe.address)}</p>` : ''}
      </div>
    </div>
    ${dist ? `<div style="display:inline-flex;align-items:center;gap:4px;background:#fff7ed;border:1px solid #fed7aa;border-radius:99px;padding:3px 10px;margin-bottom:8px;font-size:11px;font-weight:700;color:#ea580c;">📍 ${esc(dist)} away</div>` : ''}
    <a href="/cafe/${esc(cafe.slug)}" style="display:block;text-align:center;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;padding:8px 14px;border-radius:10px;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.01em;box-shadow:0 2px 8px rgba(249,115,22,.35);">
      View Menu →
    </a>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function MapPage() {
  const navigate = useNavigate();

  const mapDivRef       = useRef(null);
  const mapRef          = useRef(null);
  const initDoneRef     = useRef(false);
  const cafeMarkersRef  = useRef(new Map());
  const userMarkerRef   = useRef(null);

  const [cafes,        setCafes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [locating,     setLocating]     = useState(true);  // true while waiting for GPS
  const [geoError,     setGeoError]     = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedId,   setSelectedId]   = useState(null);
  const [radius,       setRadius]       = useState(10);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searching,    setSearching]    = useState(false);
  const [mobileTab,    setMobileTab]    = useState('map');

  // ── 1. Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current || !mapDivRef.current) return;
    initDoneRef.current = true;

    const map = L.map(mapDivRef.current, {
      zoomControl:        false,
      attributionControl: true,
    }).setView(INDIA_CENTER, 5);

    // OpenStreetMap standard — richest free tile source: shows every building, road, POI
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      subdomains:  'abc',
      maxZoom:     19,
    }).addTo(map);

    // Zoom controls — bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current      = null;
      initDoneRef.current = false;
    };
  }, []);

  // ── 2. Fetch nearby DineVerse cafés ─────────────────────────────────────────
  const fetchNearby = useCallback(async (lat, lng, r) => {
    setLoading(true);
    try {
      const { data } = await getNearbyCafes(lat, lng, r);
      setCafes(data.cafes || []);
      if ((data.cafes || []).length === 0) {
        toast('No DineVerse cafés found in this area — try a wider radius', { icon: '☕' });
      }
    } catch {
      toast.error('Failed to load nearby cafés');
      setCafes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 3. Geolocation ──────────────────────────────────────────────────────────
  const requestGeo = useCallback((onSuccess) => {
    if (!navigator.geolocation) { setGeoError('unavailable'); setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setGeoError(null);
        setLocating(false);
        mapRef.current?.setView([loc.lat, loc.lng], USER_ZOOM);
        onSuccess?.(loc);
      },
      (err) => {
        setGeoError(err.code === 1 ? 'denied' : 'unavailable');
        setLocating(false);
        // Fall back to India overview on error
        mapRef.current?.setView(INDIA_CENTER, 5);
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, []);

  // On mount: check if permission already granted → skip India view, go straight to user location
  useEffect(() => {
    const run = async () => {
      if (navigator.permissions) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' });
          if (status.state !== 'granted') {
            // Permission not yet granted — show India overview, let user decide
            setLocating(false);
          }
          // If granted, keep locating=true (hides India flash) and let getCurrentPosition run
        } catch {
          setLocating(false);
        }
      } else {
        setLocating(false);
      }
      requestGeo((loc) => fetchNearby(loc.lat, loc.lng, radius));
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 4. Re-fetch when radius changes ─────────────────────────────────────────
  const prevRadiusRef = useRef(radius);
  useEffect(() => {
    if (prevRadiusRef.current === radius) return;
    prevRadiusRef.current = radius;
    if (userLocation) fetchNearby(userLocation.lat, userLocation.lng, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ── 5. Sync markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null; }
    if (userLocation) {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon:         userPinIcon(),
        zIndexOffset: 2000,
        interactive:  false,
      }).addTo(map).bindTooltip('You', { permanent: false, direction: 'top', offset: [0, -14], className: 'leaflet-tooltip-user' });
    }

    cafeMarkersRef.current.forEach(({ marker }) => marker.remove());
    cafeMarkersRef.current.clear();

    cafes.forEach((cafe) => {
      if (!cafe.latitude || !cafe.longitude) return;
      const lat        = parseFloat(cafe.latitude);
      const lng        = parseFloat(cafe.longitude);
      const isSelected = cafe.id === selectedId;

      const popupNode = document.createElement('div');
      popupNode.innerHTML = popupHtml(cafe);

      const marker = L.marker([lat, lng], {
        icon:        makePinIcon(cafe, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      })
        .addTo(map)
        .bindPopup(popupNode, {
          maxWidth:    260,
          closeButton: true,
          className:   'dv-popup',
        });

      marker.on('click', () => {
        setSelectedId(cafe.id);
        setMobileTab('map');
        document.getElementById(`mc-${cafe.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      cafeMarkersRef.current.set(cafe.id, { marker, lat, lng });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafes, userLocation]);

  // ── 6. Swap icon on select ──────────────────────────────────────────────────
  useEffect(() => {
    cafeMarkersRef.current.forEach(({ marker }, id) => {
      const cafe = cafes.find((c) => c.id === id);
      if (cafe) marker.setIcon(makePinIcon(cafe, id === selectedId));
      marker.setZIndexOffset(id === selectedId ? 1000 : 0);
    });
  }, [selectedId, cafes]);

  // ── Nominatim search ────────────────────────────────────────────────────────
  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', India')}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (!data.length) { toast.error('Location not found'); return; }
      const loc = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      setUserLocation(loc);
      setGeoError(null);
      mapRef.current?.setView([loc.lat, loc.lng], 13);
      fetchNearby(loc.lat, loc.lng, radius);
    } catch {
      toast.error('Search failed — try again');
    } finally {
      setSearching(false);
    }
  };

  const handleCardClick = (cafe) => {
    setSelectedId(cafe.id);
    setMobileTab('map');
    const entry = cafeMarkersRef.current.get(cafe.id);
    if (entry && mapRef.current) {
      mapRef.current.setView([entry.lat, entry.lng], 16, { animate: true });
      setTimeout(() => entry.marker.openPopup(), 350);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Leaflet popup & tooltip overrides */}
      <style>{`
        .dv-popup .leaflet-popup-content-wrapper {
          border-radius: 14px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,.14) !important;
          padding: 0 !important;
          overflow: hidden;
          border: 1px solid #f3f4f6;
        }
        .dv-popup .leaflet-popup-content { margin: 14px !important; }
        .dv-popup .leaflet-popup-tip-container { margin-top: -1px; }
        .leaflet-tooltip-user {
          background: #1f2937 !important;
          color: #fff !important;
          border: none !important;
          border-radius: 6px !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          padding: 3px 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,.2) !important;
        }
        .leaflet-tooltip-user::before { border-top-color: #1f2937 !important; }
        .leaflet-control-attribution {
          font-size: 10px !important;
          background: rgba(255,255,255,0.8) !important;
          backdrop-filter: blur(4px);
          border-radius: 6px 0 0 0 !important;
        }
      `}</style>

      <div className="h-screen flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 flex-shrink-0 z-20 shadow-sm">
          <div className="px-3 py-3 flex items-center gap-2 max-w-7xl mx-auto">

            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 flex-shrink-0 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M5 12l7 7M5 12l7-7"/>
              </svg>
            </button>

            <form onSubmit={handleSearch} className="flex-1 flex gap-2 min-w-0">
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </span>
                <input
                  className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50 placeholder-gray-400"
                  placeholder="Search city or area…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap"
              >
                {searching ? '…' : 'Search'}
              </button>
            </form>

            <button
              onClick={() => requestGeo((loc) => fetchNearby(loc.lat, loc.lng, radius))}
              className="p-2.5 rounded-xl border border-brand-200 text-brand-600 hover:bg-brand-50 flex-shrink-0 transition-colors"
              title="Use my location"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
                <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" opacity="0.3"/>
              </svg>
            </button>

            {/* Mobile tab toggle */}
            <div className="flex md:hidden border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              {(['map', 'list']).map((v) => (
                <button
                  key={v}
                  onClick={() => setMobileTab(v)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors capitalize ${
                    mobileTab === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {v === 'map' ? '🗺' : '☰'}
                </button>
              ))}
            </div>
          </div>

          {geoError && (
            <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 flex items-center gap-2">
              <span className="text-amber-500 text-sm">⚠️</span>
              <p className="text-xs text-amber-700">
                {geoError === 'denied'
                  ? 'Location access denied — search a city above to find nearby cafés.'
                  : 'Could not get your location — search a city above.'}
              </p>
            </div>
          )}
        </header>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Sidebar ── */}
          <aside className={`w-full md:w-80 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden ${mobileTab === 'list' ? 'flex' : 'hidden'} md:flex`}>

            {/* Sidebar header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900">
                  {loading ? 'Searching…'
                    : userLocation ? `${cafes.length} café${cafes.length !== 1 ? 's' : ''} nearby`
                    : 'Find cafés near you'}
                </p>
                {userLocation && !loading && (
                  <p className="text-xs text-gray-400 mt-0.5">Within {radius} km · DineVerse only</p>
                )}
              </div>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} km</option>)}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center gap-3 py-20 text-sm text-gray-500">
                  <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  Finding cafés…
                </div>
              )}

              {!loading && !locating && !userLocation && (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-gray-700 mb-1">Allow location or search</p>
                  <p className="text-xs text-gray-400 leading-relaxed">Nearby DineVerse cafés will appear on the map</p>
                </div>
              )}

              {!loading && userLocation && cafes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center text-3xl mb-4">☕</div>
                  <p className="text-sm font-bold text-gray-700 mb-1">No cafés found nearby</p>
                  <p className="text-xs text-gray-400">Try increasing the search radius above.</p>
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

          {/* ── Map canvas ── */}
          <div className={`flex-1 relative ${mobileTab === 'list' ? 'hidden md:block' : 'block'}`}>
            <div ref={mapDivRef} className="absolute inset-0" />

            {/* Locating overlay — shown while waiting for GPS when permission was pre-granted */}
            {locating && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[3px] flex flex-col items-center justify-center z-[900] pointer-events-none gap-3">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-800">Getting your location…</p>
                  <p className="text-xs text-gray-400 mt-0.5">Finding cafés nearby</p>
                </div>
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Loading overlay */}
            {!locating && loading && (
              <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] flex items-center justify-center z-[900] pointer-events-none">
                <div className="bg-white rounded-2xl shadow-xl px-5 py-3.5 flex items-center gap-3 border border-gray-100">
                  <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-semibold text-gray-700">Finding cafés…</span>
                </div>
              </div>
            )}

            {/* DineVerse badge — bottom-left */}
            {!loading && cafes.length > 0 && (
              <div className="absolute bottom-8 left-4 z-[900] pointer-events-none">
                <div className="bg-white/90 backdrop-blur-sm border border-gray-200 shadow-md rounded-full px-3.5 py-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-700">
                    {cafes.length} DineVerse café{cafes.length !== 1 ? 's' : ''} in area
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sidebar card ──────────────────────────────────────────────────────────────
function CafeCard({ cafe, selected, onSelect, onNavigate }) {
  const dist = cafe.distance_km != null ? parseFloat(cafe.distance_km) : null;
  const distLabel = dist == null ? null
    : dist < 1 ? `${Math.round(dist * 1000)} m`
    : `${dist.toFixed(1)} km`;

  return (
    <div
      id={`mc-${cafe.id}`}
      onClick={onSelect}
      className={`flex gap-3 p-3 rounded-2xl cursor-pointer transition-all ${
        selected
          ? 'bg-orange-50 ring-1 ring-orange-200 shadow-sm'
          : 'bg-gray-50 hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-gray-200'
      }`}
    >
      {/* Logo */}
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden border border-gray-100 bg-brand-50 flex items-center justify-center shadow-sm">
        {cafe.logo_url
          ? <img src={cafe.logo_url} alt={cafe.name} className="w-full h-full object-cover" />
          : <span className="font-bold text-brand-500 text-xl">{cafe.name.charAt(0).toUpperCase()}</span>
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 text-sm truncate leading-tight">{cafe.name}</p>
        {cafe.address && (
          <p className="text-xs text-gray-400 truncate mt-0.5">{cafe.address}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {distLabel && (
            <span className="text-[11px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
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

      {/* Selected indicator */}
      {selected && (
        <div className="flex-shrink-0 self-center">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
        </div>
      )}
    </div>
  );
}
