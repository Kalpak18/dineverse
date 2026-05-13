import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getNearbyCafes, getAvailableTables } from '../../services/api';

// Fallback coords (Mumbai) used only if geolocation is denied
const FALLBACK_LAT = 19.076;
const FALLBACK_LNG = 72.8777;

function highlight(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-brand-100 text-brand-700 rounded px-0.5 not-italic font-semibold">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function TableBadges({ slug }) {
  const [tables, setTables] = useState(null);
  useEffect(() => {
    getAvailableTables(slug).then(({ data }) => setTables(data.tables)).catch(() => setTables([]));
  }, [slug]);
  if (!tables) return null;
  const available = tables.filter((t) => t.is_available).length;
  const total = tables.length;
  if (total === 0) return null;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {available > 0 ? `${available}/${total} tables free` : 'All tables occupied'}
    </span>
  );
}

function CafeCard({ cafe, query, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md cursor-pointer overflow-hidden transition-shadow group"
    >
      {/* Cover */}
      <div className="h-36 bg-gradient-to-br from-brand-100 to-orange-100 relative overflow-hidden">
        {cafe.cover_image_url ? (
          <img
            src={cafe.cover_image_url}
            alt={cafe.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl opacity-30">☕</div>
        )}
        {/* Logo badge */}
        <div className="absolute bottom-3 left-3">
          {cafe.logo_url ? (
            <img src={cafe.logo_url} alt={cafe.name} className="w-12 h-12 rounded-xl object-cover border-2 border-white shadow" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-brand-500 border-2 border-white shadow flex items-center justify-center text-white font-bold text-lg">
              {cafe.name.charAt(0)}
            </div>
          )}
        </div>
        {/* Distance badge */}
        {cafe.distance_km != null && (
          <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {cafe.distance_km < 1
              ? `${Math.round(cafe.distance_km * 1000)} m`
              : `${cafe.distance_km.toFixed(1)} km`}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-bold text-gray-900 text-sm leading-tight">
            {highlight(cafe.name, query)}
          </h3>
          <TableBadges slug={cafe.slug} />
        </div>
        {cafe.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{cafe.description}</p>
        )}
        {cafe.address && (
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <span>📍</span>
            <span>{highlight(cafe.address, query)}</span>
          </p>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="mt-3 w-full py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition-colors"
        >
          Order Now →
        </button>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cafes, setCafes] = useState([]);
  const [suggestions, setSuggestions] = useState([]); // shown in dropdown while typing
  const [loading, setLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(true);
  const [committed, setCommitted] = useState(false); // true after Enter/click — shows result pane
  const [userLat, setUserLat] = useState(null);
  const [userLng, setUserLng] = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1); // keyboard nav in dropdown
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Get user location on mount, then immediately load nearby cafes
  useEffect(() => {
    const onCoords = (lat, lng) => {
      setUserLat(lat);
      setUserLng(lng);
      setLocLoading(false);
      // Auto-load nearby cafes so the page isn't empty on open
      fetchCafes('', lat, lng, true);
      setCommitted(true);
    };

    if (!navigator.geolocation) {
      onCoords(FALLBACK_LAT, FALLBACK_LNG);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onCoords(pos.coords.latitude, pos.coords.longitude),
      ()    => onCoords(FALLBACK_LAT, FALLBACK_LNG),
      { timeout: 6000 }
    );
  }, [fetchCafes]);

  const fetchCafes = useCallback(async (q, lat, lng, forCommit = false) => {
    if (abortRef.current) abortRef.current = false; // signal old fetch to discard
    const token = {};
    abortRef.current = token;

    setLoading(true);
    try {
      const { data } = await getNearbyCafes(lat, lng, { q: q || undefined });
      if (abortRef.current !== token) return; // stale result
      if (forCommit) {
        setCafes(data.cafes);
        setSuggestions([]);
      } else {
        setSuggestions(data.cafes.slice(0, 6));
      }
    } catch {
      if (abortRef.current !== token) return;
      if (forCommit) setCafes([]);
      else setSuggestions([]);
    } finally {
      if (abortRef.current === token) setLoading(false);
    }
  }, []);

  // Debounced suggestion fetch as user types
  useEffect(() => {
    const lat = userLat ?? FALLBACK_LAT;
    const lng = userLng ?? FALLBACK_LNG;
    const q = query.trim();

    if (!q) {
      setSuggestions([]);
      setActiveIdx(-1);
      if (!committed) setCafes([]);
      return;
    }
    if (committed) return; // don't re-fetch suggestions once committed

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchCafes(q, lat, lng, false);
    }, 220);

    return () => clearTimeout(debounceRef.current);
  }, [query, userLat, userLng, committed, fetchCafes]);

  const commit = (q) => {
    const lat = userLat ?? FALLBACK_LAT;
    const lng = userLng ?? FALLBACK_LNG;
    const trimmed = (q || query).trim();
    if (!trimmed) return;
    setSuggestions([]);
    setActiveIdx(-1);
    setCommitted(true);
    fetchCafes(trimmed, lat, lng, true);
    inputRef.current?.blur();
  };

  const handleQueryChange = (e) => {
    setQuery(e.target.value);
    setCommitted(false); // re-open suggestion mode when user edits
    setActiveIdx(-1);
  };

  const handleKeyDown = (e) => {
    if (!suggestions.length) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        navigate(`/cafe/${suggestions[activeIdx].slug}`);
      } else {
        commit();
      }
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveIdx(-1);
    }
  };

  const hasSuggestions = suggestions.length > 0 && !committed;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
          >
            ←
          </button>

          {/* Search input + dropdown wrapper */}
          <div className="flex-1 relative min-w-0">
            <input
              ref={inputRef}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50 pr-8"
              placeholder="Search cafés by name or city…"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSuggestions([]); setCommitted(false); setCafes([]); inputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            )}

            {/* Suggestion dropdown */}
            {hasSuggestions && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl z-40 overflow-hidden">
                {suggestions.map((cafe, i) => (
                  <button
                    key={cafe.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()} // keep input focused
                    onClick={() => navigate(`/cafe/${cafe.slug}`)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      activeIdx === i ? 'bg-brand-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Logo or initial */}
                    <div className="w-9 h-9 rounded-xl bg-brand-100 flex-shrink-0 overflow-hidden">
                      {cafe.logo_url
                        ? <img src={cafe.logo_url} alt={cafe.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-brand-600 font-bold text-sm">{cafe.name.charAt(0)}</div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {highlight(cafe.name, query.trim())}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {highlight(cafe.city || cafe.address || '', query.trim())}
                        {cafe.distance_km != null && (
                          <span className="ml-2 text-brand-500">
                            {cafe.distance_km < 1
                              ? `${Math.round(cafe.distance_km * 1000)} m away`
                              : `${cafe.distance_km.toFixed(1)} km away`}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-gray-300 text-sm flex-shrink-0">→</span>
                  </button>
                ))}
                {/* "See all results" row */}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit()}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-600 border-t border-gray-100 hover:bg-brand-50 transition-colors ${
                    activeIdx === suggestions.length ? 'bg-brand-50' : ''
                  }`}
                >
                  See all results for "{query.trim()}"
                </button>
              </div>
            )}
          </div>

          <Link
            to="/scan"
            className="flex items-center gap-1.5 bg-brand-50 border border-brand-200 hover:bg-brand-100 text-brand-700 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
            title="Scan café QR code"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
              <rect x="14" y="3" width="7" height="7" rx="1" /><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
              <rect x="14" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" /><rect x="18" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="14" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" /><rect x="18" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
            </svg>
            <span className="hidden sm:inline">Scan</span>
          </Link>
          <button
            type="button"
            onClick={() => navigate('/map')}
            className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
            </svg>
            <span className="hidden sm:inline">Map</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Empty state — nothing typed */}
        {!query && !committed && (
          <div className="text-center py-24">
            <p className="text-5xl mb-4">🔍</p>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Search for a Café</h2>
            <p className="text-gray-400 text-sm">Type a café name, city, or area to get started</p>
            {locLoading && (
              <p className="text-xs text-gray-400 mt-3">Getting your location…</p>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && committed && (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Results pane — shown after Enter or "See all" click */}
        {committed && !loading && (
          <>
            {cafes.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-5xl mb-4">😕</p>
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  {query.trim() ? `No cafés found for "${query.trim()}"` : 'No cafés near you yet'}
                </h2>
                <p className="text-gray-500 text-sm">
                  {query.trim() ? 'Try a different name or city' : 'DineVerse is expanding — check back soon'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-5">
                  <span className="font-semibold text-gray-800">{cafes.length}</span> café{cafes.length !== 1 ? 's' : ''}
                  {query.trim() ? <> matching <strong>"{query.trim()}"</strong></> : ' near you'}
                  {userLat && <span className="text-gray-400"> · sorted by distance</span>}
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {cafes.map((cafe) => (
                    <CafeCard
                      key={cafe.id}
                      cafe={cafe}
                      query={query.trim()}
                      onClick={() => navigate(`/cafe/${cafe.slug}`)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="text-center pb-8">
        <p className="text-xs text-gray-400">
          Powered by <span className="text-brand-500 font-medium">DineVerse</span>
        </p>
      </div>
    </div>
  );
}
