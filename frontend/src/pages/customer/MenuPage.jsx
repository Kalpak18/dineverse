import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getCafeBySlug, getCafeMenu, getPublicOffers, getPublicSetting } from '../../services/api';
import { useCart } from '../../context/CartContext';
import { loadOrders } from '../../utils/cafeOrderStorage';
import { getScheduleStatus, getTodayHours } from '../../utils/scheduleUtils';
import LoadingSpinner from '../../components/LoadingSpinner';
import QuantityControl from '../../components/QuantityControl';
import CustomerTour from '../../components/CustomerTour';

// Fallback emoji map (used if API fetch fails)
const FALLBACK_EMOJI_MAP = {
  momos: '🥟', pizza: '🍕', burger: '🍔', biryani: '🍚',
  rice: '🍚', noodle: '🍜', pasta: '🍝', soup: '🥣',
  salad: '🥗', chicken: '🍗', fish: '🐟', seafood: '🦐',
  sandwich: '🥪', wrap: '🌯', roll: '🌯', curry: '🍛',
  dal: '🍲', snack: '🍟', starter: '🥗', bread: '🫓',
  roti: '🫓', naan: '🫓', dessert: '🍰', cake: '🎂',
  'ice cream': '🍦', shake: '🥤', juice: '🧃', coffee: '☕',
  tea: '🍵', drink: '🥤', beverage: '🥤', main: '🍛',
  breakfast: '🥞', thali: '🍱', tikka: '🍢', kebab: '🍢',
  paneer: '🧀', veg: '🥦', egg: '🥚', mutton: '🍖',
};

const DEFAULT_EMOJI = '🍽️';

function getCategoryEmoji(name, emojiMap = FALLBACK_EMOJI_MAP) {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lower.includes(key)) return emoji;
  }
  return DEFAULT_EMOJI;
}

// Standard food-app veg/non-veg indicator (square border + circle dot)
function FoodDot({ isVeg }) {
  return (
    <span className={`inline-flex w-4 h-4 rounded-sm border-2 items-center justify-center flex-shrink-0 ${
      isVeg ? 'border-green-600' : 'border-red-600'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
    </span>
  );
}

export default function MenuPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items: cartItems, addItem, updateQty, itemCount, total, setCafeCurrency } = useCart();
  const [cafe, setCafe] = useState(null);
  const [cafeOpen, setCafeOpen] = useState(true);
  const [menu, setMenu] = useState([]);
  const [offers, setOffers] = useState([]);
  const [emojiMap, setEmojiMap] = useState(FALLBACK_EMOJI_MAP);
  const [loading, setLoading] = useState(true);
  const [foodFilter, setFoodFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedCatId, setSelectedCatId] = useState(null);
  const contentRef = useRef(null);

  const session = JSON.parse(sessionStorage.getItem(`session_${slug}`) || 'null');
  const allOrders    = loadOrders(slug);
  const activeOrders = allOrders.filter((o) => !['paid', 'cancelled'].includes(o.status));
  // If all past orders are terminal and no active ones, the session is stale — force re-enrollment
  const sessionStale = session && allOrders.length > 0 && activeOrders.length === 0;

  // Fetch emoji map from platform settings (one-time on mount)
  useEffect(() => {
    getPublicSetting('category_emoji_map')
      .then((res) => {
        if (res.data.value && typeof res.data.value === 'object') {
          setEmojiMap(res.data.value);
        }
      })
      .catch(() => {
        // Use fallback if fetch fails
        if (import.meta.env.DEV) console.log('Using fallback emoji map');
      });
  }, []);

  useEffect(() => {
    if (!session || sessionStale) {
      sessionStorage.removeItem(`session_${slug}`);
      navigate(`/cafe/${slug}`, { replace: true });
      return;
    }
    Promise.all([getCafeBySlug(slug), getCafeMenu(slug), getPublicOffers(slug).catch(() => ({ data: { offers: [] } }))])
      .then(([cafeRes, menuRes, offersRes]) => {
        const cafeData = cafeRes.data.cafe;
        setCafe(cafeData);
        setCafeOpen(cafeData.is_open !== false);
        setCafeCurrency(cafeData.currency || 'INR');
        // Store tax info in session so CartPage can show breakdown
        const existing = JSON.parse(sessionStorage.getItem(`session_${slug}`) || '{}');
        sessionStorage.setItem(`session_${slug}`, JSON.stringify({
          ...existing,
          gst_rate:     cafeData.gst_rate ?? 0,
          gst_number:   cafeData.gst_number || '',
          tax_inclusive: cafeData.tax_inclusive !== false,
          is_open:      cafeData.is_open !== false,
        }));
        const menuData = menuRes.data.menu;
        setMenu(menuData);
        const offersData = offersRes.data.offers || [];
        setOffers(offersData);
        // Select first non-empty category; fall back to first if all empty
        const hasCombos = offersData.some((o) => o.offer_type === 'combo');
        if (hasCombos) {
          setSelectedCatId('__deals__');
        } else if (menuData.length > 0) {
          const firstNonEmpty = menuData.find((cat) => cat.items.some((i) => i.is_available));
          setSelectedCatId(firstNonEmpty?.id ?? menuData[0].id);
        }
      })
      .catch(() => navigate(`/cafe/${slug}`))
      .finally(() => setLoading(false));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live café open/closed updates via socket
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socket.emit('join_menu', slug);
    socket.on('connect', () => socket.emit('join_menu', slug));
    socket.on('cafe_status', ({ is_open }) => {
      setCafeOpen(is_open);
      setCafe((prev) => prev ? { ...prev, is_open } : prev);
      // Keep session in sync so CartPage reads fresh value
      const existing = JSON.parse(sessionStorage.getItem(`session_${slug}`) || '{}');
      sessionStorage.setItem(`session_${slug}`, JSON.stringify({ ...existing, is_open }));
    });
    return () => socket.disconnect();
  }, [slug]);

  const getItemQty = useCallback(
    (itemId) => cartItems.find((i) => i.id === itemId)?.quantity || 0,
    [cartItems]
  );

  // Flat item list for resolving combo item IDs → names + prices
  const allMenuItems = useMemo(() => menu.flatMap((cat) => cat.items), [menu]);

  const comboOffers   = useMemo(() => offers.filter((o) => o.offer_type === 'combo'), [offers]);
  const bannerOffers  = useMemo(() => offers.filter((o) => o.offer_type !== 'combo'), [offers]);

  // Only non-empty categories (skip categories with zero available items)
  const categories = useMemo(() =>
    menu
      .filter((cat) => cat.items.some((i) => i.is_available))
      .map((cat) => ({
        ...cat,
        thumbnail: cat.items.find((i) => i.image_url && i.is_available)?.image_url ?? null,
      })),
    [menu]
  );

  // Items to display — search searches across all categories
  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (q) {
      return menu.flatMap((cat) =>
        cat.items
          .filter((item) => {
            if (!item.is_available) return false;
            if (foodFilter === 'veg' && !item.is_veg) return false;
            if (foodFilter === 'nonveg' && item.is_veg) return false;
            return (
              item.name.toLowerCase().includes(q) ||
              (item.description || '').toLowerCase().includes(q) ||
              cat.name.toLowerCase().includes(q)
            );
          })
          .map((item) => ({ ...item, _catName: cat.name }))
      );
    }

    const cat = menu.find((c) => c.id === selectedCatId);
    if (!cat) return [];
    return cat.items.filter((item) => {
      if (!item.is_available) return false;
      if (foodFilter === 'veg' && !item.is_veg) return false;
      if (foodFilter === 'nonveg' && item.is_veg) return false;
      return true;
    });
  }, [menu, selectedCatId, foodFilter, search]);

  const handleCategorySelect = (catId) => {
    setSelectedCatId(catId);
    setSearch('');
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (loading) return <LoadingSpinner />;

  const isSearching = search.trim().length > 0;
  const selectedCat = menu.find((c) => c.id === selectedCatId);

  return (
    <div
      className="max-w-2xl mx-auto bg-white flex flex-col overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <CustomerTour />

      {/* ── Dynamic SEO ── */}
      {cafe && (
        <Helmet>
          <title>{cafe.name}{cafe.city ? ` in ${cafe.city}` : ''} | Order Online | DineVerse</title>
          <meta name="description" content={`Order food online from ${cafe.name}${cafe.city ? ` in ${cafe.city}` : ''}. Browse the menu, place your order, and track it in real-time.`} />
          <meta property="og:title" content={`${cafe.name} — Order Online | DineVerse`} />
          <meta property="og:description" content={`Browse the menu and order from ${cafe.name}${cafe.city ? `, ${cafe.city}` : ''}.`} />
          {cafe.cover_image_url && <meta property="og:image" content={cafe.cover_image_url} />}
          <meta property="og:type" content="restaurant" />
          <meta property="og:url" content={`https://dine-verse.com/cafe/${cafe.slug}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={`${cafe.name} — Order Online | DineVerse`} />
          {cafe.cover_image_url && <meta name="twitter:image" content={cafe.cover_image_url} />}
          <script type="application/ld+json">{JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: cafe.name,
            url: `https://dine-verse.com/cafe/${cafe.slug}`,
            ...(cafe.address && { address: { '@type': 'PostalAddress', streetAddress: cafe.address, addressLocality: cafe.city || '' } }),
            ...(cafe.cover_image_url && { image: cafe.cover_image_url }),
            ...(cafe.description && { description: cafe.description }),
            servesCuisine: 'Various',
            hasMenu: `https://dine-verse.com/cafe/${cafe.slug}`,
          })}</script>
        </Helmet>
      )}

      {/* ── Header ── */}
      <header
        className="relative text-white px-4 pt-8 pb-3.5 flex-shrink-0"
        style={
          cafe?.cover_image_url
            ? {
                backgroundImage: `url(${cafe.cover_image_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : { background: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)' }
        }
      >
        <div className={cafe?.cover_image_url ? 'bg-black/55 -mx-4 -mt-8 px-4 pt-8 pb-3.5' : ''}>
          <div className="flex items-center gap-3">
            {cafe?.logo_url ? (
              <img
                src={cafe.logo_url}
                alt={cafe.name}
                className="w-10 h-10 rounded-xl object-cover flex-shrink-0 shadow"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg flex-shrink-0">
                {cafe?.name?.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold leading-tight truncate">{cafe?.name}</h1>
              <p className="text-xs text-white/70 truncate">
                {session?.customer_name}
                {session?.order_type === 'takeaway'
                  ? ' · 🥡 Takeaway'
                  : ` · ${session?.table_number}`}
              </p>
            </div>
            {activeOrders.length > 0 && (
              <button
                onClick={() => navigate(`/cafe/${slug}/confirmation`)}
                className="flex-shrink-0 flex items-center gap-1.5 bg-white/25 hover:bg-white/35 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
              >
                📋 {activeOrders.length} order{activeOrders.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Schedule / Closed Banner (live) ── */}
      {(() => {
        const status = getScheduleStatus(cafe?.opening_hours, cafe?.timezone, cafeOpen ? true : false);
        const todayHours = getTodayHours(cafe?.opening_hours, cafe?.timezone);
        if (!status.isOpen) {
          return (
            <div className="flex items-center justify-between gap-2 bg-red-50 border-b border-red-200 px-4 py-2.5 text-xs flex-shrink-0">
              <span className="text-red-700 font-medium">🔴 {status.reason} — browsing only, no orders</span>
              {todayHours && <span className="text-red-400">Today: {todayHours}</span>}
            </div>
          );
        }
        if (status.closingSoon) {
          return (
            <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-700 font-medium flex-shrink-0">
              ⚠️ {status.reason}
            </div>
          );
        }
        if (todayHours) {
          return (
            <div className="flex items-center gap-2 bg-green-50 border-b border-green-100 px-4 py-2 text-xs text-green-700 flex-shrink-0">
              🟢 Open today: {todayHours}
            </div>
          );
        }
        return null;
      })()}

      {/* ── Offers Banner (% and fixed only — combos are in sidebar) ── */}
      {bannerOffers.length > 0 && (
        <div className="flex-shrink-0 bg-orange-50 border-b border-orange-100 px-3 py-2 overflow-x-auto">
          <div className="flex gap-2 w-max">
            {bannerOffers.map((o) => {
              const label = o.offer_type === 'percentage'
                ? `${o.discount_value}% OFF`
                : `₹${o.discount_value} OFF`;
              return (
                <div key={o.id} className="flex items-center gap-1.5 bg-white border border-orange-200 rounded-full px-3 py-1 shadow-sm whitespace-nowrap">
                  <span className="text-xs">🏷️</span>
                  <span className="text-xs font-bold text-orange-700">{label}</span>
                  {o.min_order_amount > 0 && <span className="text-xs text-gray-500">on orders ₹{o.min_order_amount}+</span>}
                  {o.description && <span className="text-xs text-gray-500">· {o.description}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sticky: Search + Filter ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-100 px-3 py-2.5 space-y-2">
        {/* Search bar */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search dishes or categories…"
            className="w-full bg-gray-100 rounded-xl pl-9 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-300"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          )}
        </div>

        {/* Veg / Non-Veg filter */}
        <div className="flex gap-2">
          {[
            { key: 'all',    label: 'All',      icon: '🍽️', active: 'bg-gray-800 text-white' },
            { key: 'veg',    label: 'Veg',      icon: '🟢',  active: 'bg-green-500 text-white' },
            { key: 'nonveg', label: 'Non-Veg',  icon: '🔴',  active: 'bg-red-500 text-white' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFoodFilter(f.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                foodFilter === f.key ? f.active : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.icon} {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: Sidebar + Content ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Category Sidebar */}
        <aside className="w-[76px] bg-gray-50 border-r border-gray-100 overflow-y-auto flex-shrink-0">
          {/* Deals entry — shown first if any combo offers exist */}
          {comboOffers.length > 0 && (() => {
            const isActive = selectedCatId === '__deals__' && !isSearching;
            return (
              <button
                onClick={() => handleCategorySelect('__deals__')}
                className={`relative w-full flex flex-col items-center gap-1 py-3 px-1.5 border-b border-gray-100 transition-all ${
                  isActive ? 'bg-white' : 'hover:bg-gray-100/70'
                }`}
              >
                {isActive && <span className="absolute left-0 top-3 bottom-3 w-[3px] bg-brand-500 rounded-r-full" />}
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all ${
                  isActive ? 'bg-brand-100' : 'bg-white shadow-sm'
                }`}>
                  🎁
                </div>
                <span className={`text-[10px] text-center leading-tight w-full px-0.5 transition-colors ${
                  isActive ? 'text-brand-700 font-bold' : 'text-gray-500 font-medium'
                }`}>
                  Deals
                </span>
              </button>
            );
          })()}

          {categories.map((cat) => {
            const isActive = cat.id === selectedCatId && !isSearching;
            const emoji = getCategoryEmoji(cat.name, emojiMap);

            return (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id)}
                className={`relative w-full flex flex-col items-center gap-1 py-3 px-1.5 border-b border-gray-100 transition-all ${
                  isActive ? 'bg-white' : 'hover:bg-gray-100/70'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-3 bottom-3 w-[3px] bg-brand-500 rounded-r-full" />
                )}
                {cat.thumbnail ? (
                  <img
                    src={cat.thumbnail}
                    alt={cat.name}
                    className={`w-12 h-12 rounded-xl object-cover transition-all ${
                      isActive ? 'ring-2 ring-brand-400 ring-offset-1' : 'opacity-80'
                    }`}
                  />
                ) : (
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all ${
                    isActive ? 'bg-brand-100' : 'bg-white shadow-sm'
                  }`}>
                    {emoji}
                  </div>
                )}
                <span className={`text-[10px] text-center leading-tight line-clamp-2 w-full px-0.5 transition-colors ${
                  isActive ? 'text-brand-700 font-bold' : 'text-gray-500 font-medium'
                }`}>
                  {cat.name}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Items Content */}
        <main ref={contentRef} className="flex-1 overflow-y-auto">

          {/* ── Deals panel ── */}
          {!isSearching && selectedCatId === '__deals__' ? (
            <>
              <div className="px-3 py-2 border-b border-gray-50">
                <p className="text-xs font-bold text-gray-800">
                  🎁 Deals & Combos
                  <span className="text-gray-400 font-normal ml-1.5">{comboOffers.length} combo{comboOffers.length !== 1 ? 's' : ''}</span>
                </p>
              </div>
              <div className="divide-y divide-gray-50 px-3 py-2 space-y-3">
                {comboOffers.map((offer) => {
                  const rawItems = offer.combo_items
                    ? (typeof offer.combo_items === 'string' ? JSON.parse(offer.combo_items) : offer.combo_items)
                    : [];
                  const resolvedItems = rawItems
                    .map((ci) => {
                      const menuItem = allMenuItems.find((m) => String(m.id) === String(ci.menu_item_id || ci.id));
                      return menuItem ? { ...menuItem, comboQty: ci.quantity || 1 } : null;
                    })
                    .filter(Boolean);
                  const normalPrice = resolvedItems.reduce((sum, i) => sum + parseFloat(i.price) * i.comboQty, 0);
                  const savings = normalPrice > 0 ? normalPrice - parseFloat(offer.combo_price) : 0;

                  return (
                    <div key={offer.id} className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{offer.name}</p>
                          {offer.description && <p className="text-xs text-gray-500 mt-0.5">{offer.description}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-brand-600 text-lg leading-none">₹{parseFloat(offer.combo_price).toFixed(0)}</p>
                          {savings > 0 && (
                            <p className="text-[10px] text-green-600 font-semibold mt-0.5">
                              Save ₹{savings.toFixed(0)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Included items */}
                      {resolvedItems.length > 0 && (
                        <div className="space-y-1 mb-3">
                          {resolvedItems.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-xs text-gray-700">
                              <FoodDot isVeg={item.is_veg} />
                              <span className="flex-1">{item.name}</span>
                              {item.comboQty > 1 && <span className="text-gray-400">×{item.comboQty}</span>}
                              {savings > 0 && (
                                <span className="text-gray-400 line-through">₹{(parseFloat(item.price) * item.comboQty).toFixed(0)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => {
                          resolvedItems.forEach((item) => {
                            for (let i = 0; i < item.comboQty; i++) addItem(item);
                          });
                        }}
                        disabled={resolvedItems.length === 0}
                        className="w-full py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition-colors disabled:opacity-40"
                      >
                        Add Combo to Cart
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="h-28" />
            </>
          ) : (
            <>
              {/* Section label */}
              <div className="px-3 py-2 border-b border-gray-50">
                {isSearching ? (
                  <p className="text-xs text-gray-500">
                    <span className="font-semibold text-gray-700">{displayItems.length}</span>
                    {' '}result{displayItems.length !== 1 ? 's' : ''} for "
                    <span className="text-brand-600">{search}</span>"
                  </p>
                ) : (
                  <p className="text-xs font-bold text-gray-800">
                    {selectedCat?.name}
                    <span className="text-gray-400 font-normal ml-1.5">
                      {displayItems.length} item{displayItems.length !== 1 ? 's' : ''}
                    </span>
                  </p>
                )}
              </div>

              {/* Items list */}
              {displayItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 px-6">
                  <p className="text-4xl mb-3">{isSearching ? '🔍' : '🍽️'}</p>
                  <p className="text-sm text-center font-medium text-gray-500">
                    {isSearching
                      ? `No dishes found for "${search}"`
                      : `No items available${foodFilter !== 'all' ? ` for selected filter` : ''}`}
                  </p>
                  {isSearching && (
                    <button
                      onClick={() => setSearch('')}
                      className="mt-3 text-xs text-brand-600 font-semibold hover:underline"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {displayItems.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      qty={getItemQty(item.id)}
                      categoryLabel={isSearching ? item._catName : null}
                      onAdd={() => addItem(item)}
                      onUpdateQty={(qty) => updateQty(item.id, qty)}
                    />
                  ))}
                </div>
              )}
              <div className="h-28" />
            </>
          )}
        </main>
      </div>

      {/* ── Floating bottom buttons ── */}
      {(itemCount > 0 || activeOrders.length > 0) && (
        <div className="fixed bottom-4 left-0 right-0 px-4 z-20 max-w-2xl mx-auto flex flex-col gap-2">
          {activeOrders.length > 0 && itemCount === 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/confirmation`)}
              className="w-full bg-white border border-teal-200 text-teal-700 font-semibold text-sm py-3 rounded-xl shadow-lg flex items-center justify-center gap-2"
            >
              📋 Track My Orders
              <span className="bg-teal-100 text-teal-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {activeOrders.length}
              </span>
            </button>
          )}
          {itemCount > 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/cart`)}
              className="w-full btn-primary flex items-center justify-between shadow-lg rounded-xl py-3"
            >
              <span className="bg-brand-700 rounded-lg px-2 py-0.5 text-sm font-bold">{itemCount}</span>
              <span className="font-semibold">View Cart</span>
              <span className="font-bold">₹{total.toFixed(2)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItemCard({ item, qty, categoryLabel, onAdd, onUpdateQty }) {
  return (
    <div className={`flex gap-3 px-3 py-3.5 transition-colors ${qty > 0 ? 'bg-brand-50/50' : ''}`}>
      {/* Text content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Category label in search mode */}
        {categoryLabel && (
          <span className="text-[10px] text-brand-600 font-bold uppercase tracking-wide mb-1">
            {categoryLabel}
          </span>
        )}

        {/* Veg/Non-veg dot + name */}
        <div className="flex items-start gap-1.5">
          <FoodDot isVeg={item.is_veg} />
          <h4 className="font-semibold text-gray-900 text-sm leading-snug">{item.name}</h4>
        </div>

        {item.description && (
          <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed pl-5">
            {item.description}
          </p>
        )}

        {/* Dietary / allergen tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 pl-5">
            {item.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                {tag === 'vegan' ? '🌱' : tag === 'gluten-free' ? '🌾' : tag === 'dairy-free' ? '🥛' :
                 tag === 'egg-free' ? '🥚' : tag === 'nuts' ? '🥜' : tag === 'spicy' ? '🌶️' :
                 tag === 'sugar-free' ? '🍬' : ''}
                {' '}{tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2.5 pl-5">
          <span className="font-bold text-gray-900">₹{parseFloat(item.price).toFixed(2)}</span>
          {qty === 0 ? (
            <button
              onClick={onAdd}
              className="text-xs font-bold px-4 py-1.5 rounded-lg border-2 border-brand-500 text-brand-600 hover:bg-brand-50 active:bg-brand-100 transition-colors"
            >
              ADD
            </button>
          ) : (
            <QuantityControl
              qty={qty}
              onDecrement={() => onUpdateQty(qty - 1)}
              onIncrement={onAdd}
            />
          )}
        </div>
      </div>

      {/* Item image */}
      {item.image_url && (
        <div className="flex-shrink-0 self-start">
          <img
            src={item.image_url}
            alt={item.name}
            className="w-24 h-24 rounded-xl object-cover"
          />
        </div>
      )}
    </div>
  );
}
