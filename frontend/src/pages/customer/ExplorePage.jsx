import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { exploreCafes, getAvailableTables } from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';

function TableBadges({ slug }) {
  const [tables, setTables] = useState(null);

  useEffect(() => {
    getAvailableTables(slug)
      .then(({ data }) => setTables(data.tables))
      .catch(() => setTables([]));
  }, [slug]);

  if (!tables) return null;
  const available = tables.filter((t) => t.is_available).length;
  const total = tables.length;
  if (total === 0) return null;

  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
      }`}
    >
      {available > 0 ? `${available}/${total} tables free` : 'All tables occupied'}
    </span>
  );
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [city, setCity] = useState(searchParams.get('city') || '');
  const [query, setQuery] = useState(searchParams.get('city') || '');
  const [cafes, setCafes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  // Load on mount if city in URL
  useEffect(() => {
    const c = searchParams.get('city');
    if (c) doSearch(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = async (c) => {
    setLoading(true);
    setSearched(true);
    setCity(c);
    try {
      const { data } = await exploreCafes(c);
      setCafes(data.cafes);
    } catch {
      setCafes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchParams({ city: query.trim() });
    doSearch(query.trim());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
          >
            ←
          </button>
          <form onSubmit={handleSubmit} className="flex-1 flex gap-2 min-w-0">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-gray-50"
              placeholder="Search city…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 text-white px-3 sm:px-5 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
            >
              <span className="hidden sm:inline">Search</span>
              <span className="sm:hidden">→</span>
            </button>
          </form>
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

      <div className="max-w-5xl mx-auto px-4 py-8">
        {!searched && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🏙️</p>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Find Cafés Near You</h2>
            <p className="text-gray-500 text-sm">Search by city to discover cafés using DineVerse</p>
          </div>
        )}

        {loading && <LoadingSpinner />}

        {searched && !loading && cafes.length === 0 && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">😕</p>
            <h2 className="text-xl font-bold text-gray-800 mb-2">No cafés found in {city}</h2>
            <p className="text-gray-500 text-sm">
              Try a different city, or{' '}
              <button onClick={() => { setQuery(''); setSearched(false); inputRef.current?.focus(); }} className="text-brand-500 hover:underline">
                search again
              </button>
            </p>
          </div>
        )}

        {searched && !loading && cafes.length > 0 && (
          <>
            <p className="text-sm text-gray-500 mb-5">
              {cafes.length} café{cafes.length !== 1 ? 's' : ''} in <strong>{city}</strong>
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {cafes.map((cafe) => (
                <div
                  key={cafe.id}
                  onClick={() => navigate(`/cafe/${cafe.slug}`)}
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
                        <img
                          src={cafe.logo_url}
                          alt={cafe.name}
                          className="w-12 h-12 rounded-xl object-cover border-2 border-white shadow"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-brand-500 border-2 border-white shadow flex items-center justify-center text-white font-bold text-lg">
                          {cafe.name.charAt(0)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 text-sm leading-tight">{cafe.name}</h3>
                      <TableBadges slug={cafe.slug} />
                    </div>
                    {cafe.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mb-2">{cafe.description}</p>
                    )}
                    {cafe.address && (
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <span>📍</span> {cafe.address}
                      </p>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/cafe/${cafe.slug}`); }}
                      className="mt-3 w-full py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition-colors"
                    >
                      Order Now →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Powered by */}
      <div className="text-center pb-8">
        <p className="text-xs text-gray-400">
          Powered by <span className="text-brand-500 font-medium">DineVerse</span>
        </p>
      </div>
    </div>
  );
}
