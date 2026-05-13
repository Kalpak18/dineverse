/**
 * MapPage — full-screen DineVerse café finder.
 *
 * Map engine : Google Maps JS API (via useGoogleMaps hook)
 * Fallback   : If VITE_GOOGLE_MAPS_API_KEY is absent or load fails,
 *              the map canvas is hidden and a banner is shown.
 *              The sidebar list still works fully via getNearbyCafes.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNearbyCafes } from '../../services/api';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import toast from 'react-hot-toast';

const RADIUS_OPTIONS = [3, 5, 10, 20, 50];
const INDIA_CENTER   = { lat: 20.5937, lng: 78.9629 };

// ─────────────────────────────────────────────────────────────────────────────
export default function MapPage() {
  const navigate       = useNavigate();
  const { ready: mapsReady, unavailable: mapsUnavailable } = useGoogleMaps();

  const mapDivRef       = useRef(null);
  const mapRef          = useRef(null);
  const markersRef      = useRef(new Map()); // cafeId → google.maps.Marker
  const userMarkerRef   = useRef(null);
  const infoWindowRef   = useRef(null);
  const initDoneRef     = useRef(false);

  const [cafes,        setCafes]        = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [locating,     setLocating]     = useState(true);
  const [geoError,     setGeoError]     = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedId,   setSelectedId]   = useState(null);
  const [radius,       setRadius]       = useState(10);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [mobileTab,    setMobileTab]    = useState('map');

  // ── Fetch cafes ──────────────────────────────────────────────────────────────
  const fetchCafes = useCallback(async (lat, lng) => {
    setLoading(true);
    try {
      const { data } = await getNearbyCafes(lat, lng, { radius: 20000 });
      setCafes(data.cafes || []);
    } catch {
      toast.error('Failed to load cafés');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Geolocation ──────────────────────────────────────────────────────────────
  const geoLocate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('unavailable');
      setLocating(false);
      fetchCafes(INDIA_CENTER.lat, INDIA_CENTER.lng);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        setUserLocation(loc);
        setGeoError(null);
        setLocating(false);
        mapRef.current?.panTo(loc);
        mapRef.current?.setZoom(14);
        fetchCafes(loc.lat, loc.lng);
      },
      (err) => {
        setGeoError(err.code === 1 ? 'denied' : 'unavailable');
        setLocating(false);
        fetchCafes(INDIA_CENTER.lat, INDIA_CENTER.lng);
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  }, [fetchCafes]);

  useEffect(() => { geoLocate(); }, [geoLocate]);

  // ── Init Google Map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsReady || initDoneRef.current || !mapDivRef.current) return;
    initDoneRef.current = true;

    const G = window.google.maps;
    const map = new G.Map(mapDivRef.current, {
      center:            INDIA_CENTER,
      zoom:              5,
      mapTypeControl:    true,
      mapTypeControlOptions: {
        style:      2, // DROPDOWN_MENU numeric value — avoids enum access timing issue
        position:   3, // TOP_RIGHT
        mapTypeIds: ['roadmap', 'satellite', 'hybrid'],
      },
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl:       true,
      zoomControlOptions: { position: 9 }, // RIGHT_BOTTOM
      gestureHandling:   'greedy',
    });

    infoWindowRef.current = new window.google.maps.InfoWindow();
    mapRef.current = map;

    // If user location already resolved before map was ready, fly there now
    if (userLocation) {
      map.panTo(userLocation);
      map.setZoom(14);
    }

    return () => {
      initDoneRef.current = false;
      mapRef.current = null;
    };
  }, [mapsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── User location marker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsReady || !mapRef.current || !userLocation) return;
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);
    userMarkerRef.current = new window.google.maps.Marker({
      position:    userLocation,
      map:         mapRef.current,
      title:       'You are here',
      zIndex:      999,
      icon: {
        path:        0, // SymbolPath.CIRCLE = 0
        scale:       10,
        fillColor:   '#3b82f6',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      },
    });
    mapRef.current.panTo(userLocation);
    mapRef.current.setZoom(14);
  }, [mapsReady, userLocation]);

  // ── Cafe markers ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();

    cafes.forEach((cafe) => {
      if (!cafe.latitude || !cafe.longitude) return;
      const pos = { lat: parseFloat(cafe.latitude), lng: parseFloat(cafe.longitude) };

      const isSelected = cafe.id === selectedId;
      const markerOptions = {
        position: pos,
        map:      mapRef.current,
        title:    cafe.name,
        icon: {
          path:         0, // SymbolPath.CIRCLE
          scale:        18,
          fillColor:    isSelected ? '#ea580c' : '#f97316',
          fillOpacity:  1,
          strokeColor:  '#fff',
          strokeWeight: 2.5,
        },
        label: {
          text:      cafe.name.charAt(0).toUpperCase(),
          color:     '#fff',
          fontWeight: 'bold',
          fontSize:  '12px',
        },
      };
      const marker = new window.google.maps.Marker(markerOptions);

      marker.addListener('click', () => {
        setSelectedId(cafe.id);
        setMobileTab('map');
        showInfoWindow(cafe, marker);
        document.getElementById(`mc-${cafe.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      markersRef.current.set(cafe.id, marker);
    });
  }, [mapsReady, cafes]); // eslint-disable-line react-hooks/exhaustive-deps

  const showInfoWindow = (cafe, marker) => {
    if (!infoWindowRef.current) return;
    const dist = cafe.distance_km != null
      ? parseFloat(cafe.distance_km) < 1
        ? `${Math.round(parseFloat(cafe.distance_km) * 1000)} m`
        : `${parseFloat(cafe.distance_km).toFixed(1)} km`
      : null;

    const logoHtml = cafe.logo_url
      ? `<img src="${cafe.logo_url}" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0" />`
      : `<div style="width:40px;height:40px;border-radius:10px;background:#fff7ed;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#f97316;flex-shrink:0">${cafe.name.charAt(0)}</div>`;

    infoWindowRef.current.setContent(`
      <div style="font-family:system-ui,sans-serif;min-width:200px;max-width:240px;padding:4px">
        <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
          ${logoHtml}
          <div style="flex:1;min-width:0">
            <p style="margin:0 0 2px;font-weight:700;font-size:13px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cafe.name}</p>
            ${cafe.address ? `<p style="margin:0;font-size:11px;color:#9ca3af;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${cafe.address}</p>` : ''}
          </div>
        </div>
        ${dist ? `<p style="font-size:11px;font-weight:700;color:#ea580c;margin-bottom:8px">📍 ${dist} away</p>` : ''}
        <a href="/cafe/${cafe.slug}" style="display:block;text-align:center;background:#f97316;color:#fff;padding:8px 14px;border-radius:10px;text-decoration:none;font-size:12px;font-weight:700">View Menu →</a>
      </div>
    `);
    infoWindowRef.current.open(mapRef.current, marker);
  };

  // ── Selected marker highlight ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsReady) return;
    markersRef.current.forEach((marker, id) => {
      if (!marker.getIcon || typeof marker.getIcon() !== 'object') return;
      const icon = marker.getIcon();
      if (icon?.path === 0) { // 0 = SymbolPath.CIRCLE
        marker.setIcon({ ...icon, fillColor: id === selectedId ? '#ea580c' : '#f97316' });
      }
    });
  }, [mapsReady, selectedId]);

  // ── Map search (Places Autocomplete on header input) ────────────────────────
  const searchInputRef = useRef(null);
  useEffect(() => {
    if (!mapsReady || !searchInputRef.current) return;
    const ac = new window.google.maps.places.Autocomplete(searchInputRef.current, {
      types: ['establishment', 'geocode'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place.geometry?.location) {
        // No geometry — try to match in cafes list
        const q = (searchInputRef.current?.value || '').trim().toLowerCase();
        const match = filteredCafes.find((c) => c.name.toLowerCase().includes(q));
        if (match) { handleCardClick(match); return; }
        return;
      }
      mapRef.current?.panTo(place.geometry.location);
      mapRef.current?.setZoom(15);
    });
  }, [mapsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sidebar list (client-side filter) ───────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const filteredCafes = cafes.filter((c) => {
    if (q) {
      const hay = `${c.name} ${c.city || ''} ${c.address || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (!q && c.distance_km != null && parseFloat(c.distance_km) > radius) return false;
    return true;
  });

  const handleCardClick = (cafe) => {
    setSelectedId(cafe.id);
    setMobileTab('map');
    const marker = markersRef.current.get(cafe.id);
    if (marker && mapRef.current) {
      mapRef.current.panTo(marker.getPosition());
      mapRef.current.setZoom(16);
      showInfoWindow(cafe, marker);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const match = filteredCafes[0];
    if (match) handleCardClick(match);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 flex-shrink-0 z-20 shadow-sm">
        <div className="px-3 py-3 flex items-center gap-2 max-w-7xl mx-auto">
          <button onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 flex-shrink-0 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M5 12l7 7M5 12l7-7"/>
            </svg>
          </button>

          <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </span>
              <input
                ref={searchInputRef}
                className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50 placeholder-gray-400"
                placeholder={mapsReady ? 'Search cafés, city or area…' : 'Search café name or city…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button type="submit"
              className="bg-brand-500 hover:bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap">
              Search
            </button>
          </form>

          {/* Re-locate button */}
          <button
            onClick={() => { setLocating(true); geoLocate(); }}
            className="p-2.5 rounded-xl border border-brand-200 text-brand-600 hover:bg-brand-50 flex-shrink-0 transition-colors"
            title="Use my location"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
            </svg>
          </button>

          {/* Mobile map/list toggle — only show if map is available */}
          {!mapsUnavailable && (
            <div className="flex md:hidden border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
              {['map', 'list'].map((v) => (
                <button key={v} onClick={() => setMobileTab(v)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${mobileTab === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-500'}`}>
                  {v === 'map' ? '🗺' : '☰'}
                </button>
              ))}
            </div>
          )}
        </div>

        {geoError && (
          <div className="bg-amber-50 border-t border-amber-100 px-4 py-2 flex items-center gap-2">
            <span className="text-amber-500 text-sm">⚠️</span>
            <p className="text-xs text-amber-700">
              {geoError === 'denied'
                ? 'Location access denied — search a city or area above to find cafés.'
                : 'Could not get your location — search above or browse the list.'}
            </p>
          </div>
        )}
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <aside className={`${mapsUnavailable ? 'w-full' : 'w-full md:w-80'} flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden ${mobileTab === 'list' || mapsUnavailable ? 'flex' : 'hidden'} md:flex`}>

          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-bold text-gray-900">
                {loading ? 'Searching…'
                  : q ? `${filteredCafes.length} match${filteredCafes.length !== 1 ? 'es' : ''} for "${q}"`
                  : userLocation ? `${filteredCafes.length} café${filteredCafes.length !== 1 ? 's' : ''} nearby`
                  : 'Find cafés near you'}
              </p>
              {!loading && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {q ? `All distances · ${cafes.length} total` : `Within ${radius} km · ${cafes.length} total`}
                </p>
              )}
            </div>
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-200">
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
            {!loading && filteredCafes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="text-3xl mb-3">☕</div>
                <p className="text-sm font-bold text-gray-700 mb-1">
                  {q ? `No cafés match "${q}"` : 'No cafés in this radius'}
                </p>
                <p className="text-xs text-gray-400">
                  {q ? 'Try a different name or clear search.' : 'Increase the radius or try a different area.'}
                </p>
              </div>
            )}
            {!loading && filteredCafes.length > 0 && (
              <div className="p-3 space-y-2">
                {filteredCafes.map((cafe) => (
                  <SidebarCard
                    key={cafe.id}
                    cafe={cafe}
                    selected={cafe.id === selectedId}
                    searchQuery={q}
                    onSelect={() => handleCardClick(cafe)}
                    onNavigate={() => navigate(`/cafe/${cafe.slug}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── Map canvas ── */}
        {!mapsUnavailable && (
          <div className={`flex-1 relative ${mobileTab === 'list' ? 'hidden md:block' : 'block'}`}>

            {/* Map unavailable banner — shown while SDK loading or if key bad */}
            {mapsUnavailable && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 z-10">
                <p className="text-4xl mb-3">🗺️</p>
                <p className="text-sm font-bold text-gray-700 mb-1">Map unavailable</p>
                <p className="text-xs text-gray-400 text-center max-w-xs">
                  Google Maps API key not configured. Browse the list on the left to find and visit cafés.
                </p>
              </div>
            )}

            {/* Google Map div */}
            <div ref={mapDivRef} className="absolute inset-0" />

            {/* Locating overlay */}
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

            {/* SDK loading overlay */}
            {!mapsReady && !mapsUnavailable && (
              <div className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center z-[800] pointer-events-none gap-3">
                <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Loading Google Maps…</p>
              </div>
            )}

            {/* Café count badge */}
            {!loading && cafes.length > 0 && mapsReady && (
              <div className="absolute bottom-8 left-4 z-[900] pointer-events-none">
                <div className="bg-white/90 backdrop-blur-sm border border-gray-200 shadow-md rounded-full px-3.5 py-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-700">
                    {cafes.length} DineVerse café{cafes.length !== 1 ? 's' : ''} on map
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar card ──────────────────────────────────────────────────────────────
function highlight(text, q) {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded-sm not-italic font-semibold px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function SidebarCard({ cafe, selected, searchQuery, onSelect, onNavigate }) {
  const dist = cafe.distance_km != null ? parseFloat(cafe.distance_km) : null;
  const distLabel = dist == null ? null
    : dist < 1 ? `${Math.round(dist * 1000)} m`
    : `${dist.toFixed(1)} km`;

  return (
    <div id={`mc-${cafe.id}`} onClick={onSelect}
      className={`flex gap-3 p-3 rounded-2xl cursor-pointer transition-all ${
        selected ? 'bg-orange-50 ring-1 ring-orange-200 shadow-sm' : 'bg-gray-50 hover:bg-white hover:shadow-sm hover:ring-1 hover:ring-gray-200'
      }`}
    >
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden border border-gray-100 bg-brand-50 flex items-center justify-center shadow-sm">
        {cafe.logo_url
          ? <img src={cafe.logo_url} alt={cafe.name} className="w-full h-full object-cover" />
          : <span className="font-bold text-brand-500 text-xl">{cafe.name.charAt(0).toUpperCase()}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 text-sm truncate leading-tight">
          {highlight(cafe.name, searchQuery)}
        </p>
        {(cafe.city || cafe.address) && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {highlight(cafe.city || cafe.address, searchQuery)}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {distLabel && (
            <span className="text-[11px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{distLabel}</span>
          )}
          {cafe.avg_rating != null && (
            <span className="text-[11px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              ★ {parseFloat(cafe.avg_rating).toFixed(1)} <span className="font-normal opacity-70">({cafe.rating_count})</span>
            </span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            className="text-xs text-brand-600 font-semibold hover:underline">
            View menu →
          </button>
        </div>
      </div>
      {selected && <div className="flex-shrink-0 self-center w-2 h-2 rounded-full bg-orange-400" />}
    </div>
  );
}
