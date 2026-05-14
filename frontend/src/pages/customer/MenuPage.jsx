import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getCafeBySlug, getCafeMenu, getPublicOffers, getPublicItemModifiers, getPublicSetting } from '../../services/api';
import { useCart } from '../../context/CartContext';
import { loadOrders } from '../../utils/cafeOrderStorage';
import { fmtCurrency } from '../../utils/formatters';
import { getScheduleStatus, getTodayHours } from '../../utils/scheduleUtils';
import LoadingSpinner from '../../components/LoadingSpinner';
import QuantityControl from '../../components/QuantityControl';
import CustomerTour from '../../components/CustomerTour';

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

function FoodDot({ isVeg }) {
  return (
    <span className={`inline-flex w-[14px] h-[14px] rounded-sm border-2 items-center justify-center flex-shrink-0 ${
      isVeg ? 'border-green-600' : 'border-red-600'
    }`}>
      <span className={`w-[7px] h-[7px] rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
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
  const [modifierDialog, setModifierDialog] = useState({
    item: null, groups: [], variants: [], selectedVariantId: null,
    selectedOptions: {}, isOpen: false, loading: false, error: null,
  });
  const [fetchingItemId, setFetchingItemId] = useState(null);
  const [scheduleTick, setScheduleTick] = useState(0);
  const contentRef = useRef(null);

  const session = JSON.parse(localStorage.getItem(`session_${slug}`) || 'null');
  const allOrders = loadOrders(slug);
  const activeOrders = allOrders.filter((o) => !['paid', 'cancelled'].includes(o.status));
  const c = (n) => fmtCurrency(n, session?.currency || cafe?.currency || 'INR');

  useEffect(() => {
    getPublicSetting('category_emoji_map')
      .then((res) => {
        if (res.data.value && typeof res.data.value === 'object') setEmojiMap(res.data.value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    Promise.all([getCafeBySlug(slug), getCafeMenu(slug), getPublicOffers(slug).catch(() => ({ data: { offers: [] } }))])
      .then(([cafeRes, menuRes, offersRes]) => {
        const cafeData = cafeRes.data.cafe;
        setCafe(cafeData);
        setCafeOpen(cafeData.is_open !== false);
        setCafeCurrency(cafeData.currency || 'INR');
        const existing = JSON.parse(localStorage.getItem(`session_${slug}`) || '{}');
        localStorage.setItem(`session_${slug}`, JSON.stringify({
          ...existing,
          currency: cafeData.currency || 'INR',
          gst_rate: cafeData.gst_rate ?? 0,
          gst_number: cafeData.gst_number || '',
          tax_inclusive: cafeData.tax_inclusive !== false,
          is_open: cafeData.is_open !== false,
        }));
        const menuData = menuRes.data.menu;
        setMenu(menuData);
        const offersData = offersRes.data.offers || [];
        setOffers(offersData);
        const hasCombos = offersData.some((o) => o.offer_type === 'combo');
        if (hasCombos) {
          setSelectedCatId('__deals__');
        } else if (menuData.length > 0) {
          const hasAvailable = (cat) =>
            cat.items.some((i) => i.is_available) ||
            (cat.subcategories || []).some((s) => s.items.some((i) => i.is_available));
          const firstNonEmpty = menuData.find(hasAvailable);
          setSelectedCatId(firstNonEmpty?.id ?? menuData[0].id);
        }
      })
      .catch(() => navigate(`/cafe/${slug}`))
      .finally(() => setLoading(false));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socket.emit('join_menu', slug);
    socket.on('connect', () => socket.emit('join_menu', slug));
    socket.on('cafe_status', ({ is_open }) => {
      setCafeOpen(is_open);
      setCafe((prev) => prev ? { ...prev, is_open } : prev);
      const existing = JSON.parse(localStorage.getItem(`session_${slug}`) || '{}');
      localStorage.setItem(`session_${slug}`, JSON.stringify({ ...existing, is_open }));
    });
    return () => socket.disconnect();
  }, [slug]);

  useEffect(() => {
    const id = setInterval(() => setScheduleTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const getItemQty = useCallback(
    (itemId) => cartItems
      .filter((i) => (i.menu_item_id || i.id) === itemId)
      .reduce((sum, i) => sum + i.quantity, 0),
    [cartItems]
  );

  const openModifierDialog = (item, groups, variants) => {
    setModifierDialog({
      item, groups, variants,
      selectedVariantId: variants.length > 0 ? variants[0].id : null,
      selectedOptions: {}, isOpen: true, loading: false, error: null,
    });
  };

  const closeModifierDialog = () => {
    setModifierDialog((prev) => ({ ...prev, isOpen: false, error: null }));
  };

  const toggleModifierOption = (groupId, optionId, selectionType) => {
    setModifierDialog((prev) => {
      const current = prev.selectedOptions[groupId] || [];
      let next = [];
      if (selectionType === 'single') {
        next = [optionId];
      } else {
        next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
      }
      return { ...prev, selectedOptions: { ...prev.selectedOptions, [groupId]: next } };
    });
  };

  const handleAddItem = async (item) => {
    if (fetchingItemId === item.id) return;
    setFetchingItemId(item.id);
    try {
      const res = await getPublicItemModifiers(slug, item.id);
      const groups = res.data.groups || [];
      const variants = res.data.variants || [];
      if (groups.length === 0 && variants.length === 0) { addItem(item); return; }
      openModifierDialog(item, groups, variants);
    } catch {
      setModifierDialog({
        item, groups: [], variants: [], selectedVariantId: null, selectedOptions: {},
        isOpen: true, loading: false,
        error: 'Could not load customizations. Please check your connection and try again.',
      });
    } finally {
      setFetchingItemId(null);
    }
  };

  const getModifierDialogTotal = () => {
    if (!modifierDialog.item) return 0;
    const selectedVariant = modifierDialog.variants.find((v) => v.id === modifierDialog.selectedVariantId);
    const basePrice = selectedVariant
      ? parseFloat(selectedVariant.price || modifierDialog.item.price)
      : parseFloat(modifierDialog.item.price || 0);
    const modifierTotal = modifierDialog.groups.reduce((total, group) => {
      const selectedIds = modifierDialog.selectedOptions[group.id] || [];
      return selectedIds.reduce((sum, optionId) => {
        const option = group.options.find((o) => o.id === optionId);
        return sum + parseFloat(option?.price || 0);
      }, total);
    }, 0);
    return basePrice + modifierTotal;
  };

  const confirmModifierSelection = () => {
    const item = modifierDialog.item;
    if (!item) return;
    const invalidGroup = modifierDialog.groups.find((group) => {
      const selectedIds = modifierDialog.selectedOptions[group.id] || [];
      if (group.is_required && selectedIds.length === 0) return true;
      if ((group.is_required || selectedIds.length > 0) && group.min_selections && selectedIds.length < group.min_selections) return true;
      if (group.max_selections && selectedIds.length > group.max_selections) return true;
      return false;
    });
    if (invalidGroup) {
      setModifierDialog((prev) => ({ ...prev, error: 'Please select all required options and respect variant limits.' }));
      return;
    }
    const selectedModifiers = modifierDialog.groups.flatMap((group) => {
      const selectedIds = modifierDialog.selectedOptions[group.id] || [];
      return selectedIds.map((optionId) => {
        const option = group.options.find((o) => o.id === optionId);
        return { group_id: group.id, group_name: group.name, option_id: option?.id, option_name: option?.name, price: parseFloat(option?.price || 0) };
      });
    });
    const modifierTotal = selectedModifiers.reduce((sum, mod) => sum + mod.price, 0);
    const selectedVariant = modifierDialog.variants.find((v) => v.id === modifierDialog.selectedVariantId);
    const basePrice = selectedVariant ? parseFloat(selectedVariant.price || item.price) : parseFloat(item.price || 0);
    const finalPrice = parseFloat((basePrice + modifierTotal).toFixed(2));
    addItem({
      id: `${item.id}:${selectedVariant?.id || 'base'}:${selectedModifiers.map((mod) => mod.option_id).join(',')}`,
      menu_item_id: item.id,
      name: `${item.name}${selectedVariant ? ` (${selectedVariant.name})` : ''}`,
      price: finalPrice, unit_price: finalPrice,
      variant_id: selectedVariant?.id || null, variant_name: selectedVariant?.name || null,
      selected_modifiers: selectedModifiers, modifier_total: modifierTotal,
    });
    closeModifierDialog();
  };

  const handleVariantChange = (variantId) => {
    setModifierDialog((prev) => ({ ...prev, selectedVariantId: variantId }));
  };

  const allMenuItems = useMemo(() => menu.flatMap((cat) => cat.items), [menu]);
  const comboOffers = useMemo(() => offers.filter((o) => o.offer_type === 'combo'), [offers]);
  const bannerOffers = useMemo(() => {
    const platform = offers.filter((o) => o.funded_by === 'platform' && o.offer_type !== 'combo');
    const owner = offers.filter((o) => o.funded_by !== 'platform' && o.offer_type !== 'combo');
    return [...platform, ...owner];
  }, [offers]);

  const allCatItems = (cat) => [...cat.items, ...(cat.subcategories || []).flatMap((s) => s.items)];

  const categories = useMemo(() =>
    menu
      .filter((cat) => allCatItems(cat).some((i) => i.is_available))
      .map((cat) => ({
        ...cat,
        thumbnail: allCatItems(cat).find((i) => i.image_url && i.is_available)?.image_url ?? null,
      })),
    [menu]
  );

  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return menu.flatMap((cat) =>
      allCatItems(cat)
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
  }, [menu, foodFilter, search]);

  const filterItem = (item) => {
    if (!item.is_available) return false;
    if (foodFilter === 'veg' && !item.is_veg) return false;
    if (foodFilter === 'nonveg' && item.is_veg) return false;
    return true;
  };

  const handleCategorySelect = (catId) => {
    setSelectedCatId(catId);
    setSearch('');
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (!session) return <Navigate to={`/cafe/${slug}`} replace />;
  if (loading) return <LoadingSpinner />;

  const isSearching = search.trim().length > 0;
  const selectedCat = menu.find((c) => c.id === selectedCatId);

  return (
    <div className="max-w-2xl mx-auto bg-white flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      <CustomerTour />

      {cafe && (
        <Helmet>
          <title>{cafe.name}{cafe.city ? ` in ${cafe.city}` : ''} | Order Online | DineVerse</title>
          <meta name="description" content={`Order food online from ${cafe.name}${cafe.city ? ` in ${cafe.city}` : ''}. Browse the menu, place your order, and track it in real-time.`} />
          <meta property="og:title" content={`${cafe.name} — Order Online | DineVerse`} />
          <meta property="og:description" content={`Browse the menu and order from ${cafe.name}${cafe.city ? `, ${cafe.city}` : ''}.`} />
          {cafe.cover_image_url && <meta property="og:image" content={cafe.cover_image_url} />}
          <meta property="og:type" content="restaurant" />
          <meta property="og:url" content={`https://www.dine-verse.com/.cafe/${cafe.slug}`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={`${cafe.name} — Order Online | DineVerse`} />
          {cafe.cover_image_url && <meta name="twitter:image" content={cafe.cover_image_url} />}
          <script type="application/ld+json">{JSON.stringify({
            '@context': 'https://schema.org', '@type': 'Restaurant',
            name: cafe.name, url: `https://www.dine-verse.com/.cafe/${cafe.slug}`,
            ...(cafe.address && { address: { '@type': 'PostalAddress', streetAddress: cafe.address, addressLocality: cafe.city || '' } }),
            ...(cafe.cover_image_url && { image: cafe.cover_image_url }),
            ...(cafe.description && { description: cafe.description }),
            servesCuisine: 'Various', hasMenu: `https://www.dine-verse.com/.cafe/${cafe.slug}`,
          })}</script>
        </Helmet>
      )}

      {/* ── Header ── */}
      <header className="flex-shrink-0 relative overflow-hidden" style={{ minHeight: 72 }}>
        {/* Background layer */}
        <div
          className="absolute inset-0"
          style={
            cafe?.cover_image_url
              ? { backgroundImage: `url(${cafe.cover_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { background: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)' }
          }
        />
        {cafe?.cover_image_url && <div className="absolute inset-0 bg-black/60" />}

        {/* Content */}
        <div className="relative px-4 pt-4 pb-3 flex items-center gap-3">
          {/* Logo */}
          {cafe?.logo_url ? (
            <img src={cafe.logo_url} alt={cafe.name} className="w-11 h-11 rounded-2xl object-cover flex-shrink-0 shadow-lg ring-2 ring-white/30" />
          ) : (
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center font-black text-lg text-white flex-shrink-0 ring-2 ring-white/30">
              {cafe?.name?.charAt(0)}
            </div>
          )}

          {/* Cafe + customer info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-extrabold text-white leading-tight truncate tracking-tight">{cafe?.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-white/70 truncate">
                {session?.customer_name}
              </span>
              <span className="text-white/40 text-[10px]">·</span>
              <span className="text-[11px] text-white/70">
                {session?.order_type === 'takeaway' ? '🥡 Takeaway' : `🪑 ${session?.table_number}`}
              </span>
            </div>
          </div>

          {/* Active orders pill */}
          {activeOrders.length > 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/confirmation`)}
              className="flex-shrink-0 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors border border-white/20"
            >
              📋 {activeOrders.length} active
            </button>
          )}
        </div>
      </header>

      {/* ── Status Banner ── */}
      {(() => {
        void scheduleTick;
        const status = getScheduleStatus(cafe?.opening_hours, cafe?.timezone, cafeOpen ? true : false);
        const todayHours = getTodayHours(cafe?.opening_hours, cafe?.timezone);
        if (!status.isOpen) {
          return (
            <div className="flex items-center justify-between gap-2 bg-red-600 px-4 py-2 text-xs flex-shrink-0">
              <span className="text-white font-semibold">🔴 {status.reason} — browsing only</span>
              {todayHours && <span className="text-red-200 text-[10px]">{todayHours}</span>}
            </div>
          );
        }
        if (status.closingSoon) {
          return (
            <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs text-white font-semibold flex-shrink-0">
              ⚠️ {status.reason}
            </div>
          );
        }
        if (todayHours) {
          return (
            <div className="flex items-center gap-2 bg-emerald-600 px-4 py-2 text-xs text-white flex-shrink-0">
              🟢 <span className="font-medium">Open today:</span> {todayHours}
            </div>
          );
        }
        return null;
      })()}

      {/* ── Offers Banner ── */}
      {bannerOffers.length > 0 && (
        <div className="flex-shrink-0 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100 px-3 py-2 overflow-x-auto">
          <div className="flex gap-2 w-max">
            {bannerOffers.map((o) => {
              const isPlatform = o.funded_by === 'platform';
              const label = o.offer_type === 'percentage' || o.offer_type === 'first_order'
                ? `${o.discount_value}% OFF`
                : o.offer_type === 'bogo' ? 'Buy 2 Get 1 Free'
                : `${c(o.discount_value)} OFF`;
              return (
                <div key={o.id} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 whitespace-nowrap border shadow-sm ${
                  isPlatform ? 'bg-purple-50 border-purple-200' : 'bg-white border-orange-200'
                }`}>
                  <span className="text-xs">{isPlatform ? '⚡' : '🏷️'}</span>
                  <span className={`text-xs font-bold ${isPlatform ? 'text-purple-700' : 'text-orange-700'}`}>{label}</span>
                  {isPlatform && <span className="text-xs font-semibold text-purple-500">DineVerse</span>}
                  {o.offer_type === 'first_order' && <span className="text-[10px] text-gray-500">First order</span>}
                  {o.min_order_amount > 0 && <span className="text-[10px] text-gray-500">on {c(o.min_order_amount)}+</span>}
                  {o.coupon_code && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isPlatform ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'}`}>
                      {o.coupon_code}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Search + Filter bar ── */}
      <div className="flex-shrink-0 bg-white px-3 py-2.5 border-b border-gray-100 space-y-2.5">
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Search dishes or categories…"
            className="w-full bg-gray-100 rounded-2xl pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-300 focus:bg-white transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-base leading-none"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All', icon: null, active: 'bg-gray-900 text-white' },
            { key: 'veg', label: 'Pure Veg', icon: '🟢', active: 'bg-green-600 text-white' },
            { key: 'nonveg', label: 'Non-Veg', icon: '🔴', active: 'bg-red-600 text-white' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFoodFilter(f.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                foodFilter === f.key ? f.active : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.icon && <span className="text-[10px]">{f.icon}</span>}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body: Sidebar + Content ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Category Sidebar ── */}
        <aside className="w-[72px] bg-gray-50 border-r border-gray-100 overflow-y-auto flex-shrink-0 overscroll-contain">
          {comboOffers.length > 0 && (() => {
            const isActive = selectedCatId === '__deals__' && !isSearching;
            return (
              <button
                onClick={() => handleCategorySelect('__deals__')}
                className={`relative w-full flex flex-col items-center gap-1.5 pt-3 pb-2.5 px-1 border-b border-gray-100/80 transition-all ${
                  isActive ? 'bg-white' : 'hover:bg-gray-100/60'
                }`}
              >
                {isActive && <span className="absolute left-0 top-4 bottom-4 w-[3px] bg-brand-500 rounded-r-full" />}
                <div className={`w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center transition-transform ${
                  isActive ? 'ring-2 ring-brand-400 ring-offset-1 scale-105' : ''
                } bg-gradient-to-br from-orange-100 to-amber-100`}>
                  <span className="text-xl">🎁</span>
                </div>
                <span className={`text-[9px] text-center leading-snug font-semibold w-full px-0.5 transition-colors ${
                  isActive ? 'text-brand-700' : 'text-gray-500'
                }`}>Deals</span>
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
                className={`relative w-full flex flex-col items-center gap-1.5 pt-3 pb-2.5 px-1 border-b border-gray-100/80 transition-all ${
                  isActive ? 'bg-white' : 'hover:bg-gray-100/60'
                }`}
              >
                {isActive && <span className="absolute left-0 top-4 bottom-4 w-[3px] bg-brand-500 rounded-r-full" />}
                <div className={`w-11 h-11 rounded-xl overflow-hidden transition-all ${
                  isActive ? 'ring-2 ring-brand-400 ring-offset-1 scale-105' : ''
                }`}>
                  {cat.thumbnail ? (
                    <img src={cat.thumbnail} alt={cat.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center text-xl ${
                      isActive ? 'bg-brand-50' : 'bg-white'
                    }`}>
                      {emoji}
                    </div>
                  )}
                </div>
                <span className={`text-[9px] text-center leading-snug line-clamp-2 w-full px-0.5 font-semibold transition-colors ${
                  isActive ? 'text-brand-700' : 'text-gray-500'
                }`}>{cat.name}</span>
              </button>
            );
          })}
          {/* Bottom padding for scroll */}
          <div className="h-8" />
        </aside>

        {/* ── Items Content ── */}
        <main ref={contentRef} className="flex-1 overflow-y-auto overscroll-contain" style={{ background: '#f8f8f8', paddingBottom: itemCount > 0 || activeOrders?.length > 0 ? 'calc(120px + env(safe-area-inset-bottom))' : undefined }}>

          {/* ── Deals panel ── */}
          {!isSearching && selectedCatId === '__deals__' ? (
            <>
              <div className="px-4 py-3 bg-white border-b border-gray-100">
                <p className="text-sm font-bold text-gray-900">Deals &amp; Combos</p>
                <p className="text-xs text-gray-400 mt-0.5">{comboOffers.length} combo{comboOffers.length !== 1 ? 's' : ''} available</p>
              </div>
              <div className="px-3 pt-3 space-y-3 pb-4">
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
                    <div key={offer.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                      <div className="bg-gradient-to-r from-brand-500 to-orange-500 px-4 py-3.5 flex items-center justify-between">
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="font-bold text-white text-sm leading-tight">{offer.name}</p>
                          {offer.description && <p className="text-xs text-white/80 mt-0.5 leading-snug">{offer.description}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-black text-white text-xl leading-none">{c(offer.combo_price)}</p>
                          {savings > 0 && <p className="text-[11px] text-white/80 mt-0.5">Save {c(savings)}</p>}
                        </div>
                      </div>
                      {resolvedItems.length > 0 && (
                        <div className="px-4 py-3 space-y-2.5 border-b border-gray-100">
                          {resolvedItems.map((item) => (
                            <div key={item.id} className="flex items-center gap-2.5">
                              <FoodDot isVeg={item.is_veg} />
                              <span className="flex-1 text-sm text-gray-800 font-medium">{item.name}</span>
                              {item.comboQty > 1 && <span className="text-gray-400 text-xs">×{item.comboQty}</span>}
                              {savings > 0 && <span className="text-gray-400 text-xs line-through">{c(parseFloat(item.price) * item.comboQty)}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="px-4 py-3">
                        <button
                          onClick={() => { resolvedItems.forEach((item) => { for (let i = 0; i < item.comboQty; i++) addItem(item); }); }}
                          disabled={resolvedItems.length === 0}
                          className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
                        >
                          Add Combo to Cart
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="h-32" />
            </>

          ) : isSearching ? (
            /* ── Search results ── */
            <>
              <div className="px-4 py-3 bg-white border-b border-gray-100">
                <p className="text-xs text-gray-500">
                  <span className="font-semibold text-gray-900">{displayItems.length}</span>
                  {' '}result{displayItems.length !== 1 ? 's' : ''} for "
                  <span className="text-brand-600">{search}</span>"
                </p>
              </div>
              {displayItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6">
                  <span className="text-5xl mb-4">🔍</span>
                  <p className="text-sm text-center font-semibold text-gray-600">No dishes found</p>
                  <p className="text-xs text-gray-400 mt-1 text-center">Try a different keyword</p>
                  <button onClick={() => setSearch('')} className="mt-4 text-xs text-brand-600 font-bold border border-brand-300 px-4 py-1.5 rounded-full hover:bg-brand-50 transition-colors">
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="pb-3 pt-1">
                  {displayItems.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      qty={getItemQty(item.id)}
                      categoryLabel={item._catName}
                      onAdd={() => handleAddItem(item)}
                      fetching={fetchingItemId === item.id}
                      onUpdateQty={(qty) => {
                        const combos = cartItems.filter((ci) => (ci.menu_item_id || ci.id) === item.id);
                        if (combos.length > 0) { const last = combos[combos.length - 1]; updateQty(last.id, last.quantity - 1); }
                        else updateQty(item.id, qty);
                      }}
                      c={c}
                    />
                  ))}
                </div>
              )}
              <div className="h-32" />
            </>

          ) : (
            /* ── Category tree view ── */
            <>
              {/* Category title */}
              <div className="px-4 py-3 bg-white border-b border-gray-100">
                <p className="text-sm font-bold text-gray-900">{selectedCat?.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedCat ? allCatItems(selectedCat).filter(filterItem).length : 0} item
                  {(allCatItems(selectedCat || { items: [], subcategories: [] }).filter(filterItem).length !== 1) ? 's' : ''} available
                </p>
              </div>

              {selectedCat && (() => {
                const directItems = (selectedCat.items || []).filter(filterItem);
                const subs = (selectedCat.subcategories || [])
                  .map((s) => ({ ...s, filteredItems: s.items.filter(filterItem) }))
                  .filter((s) => s.filteredItems.length > 0);
                const totalVisible = directItems.length + subs.reduce((n, s) => n + s.filteredItems.length, 0);

                if (totalVisible === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-20 px-6">
                      <span className="text-5xl mb-4">🍽️</span>
                      <p className="text-sm text-center font-semibold text-gray-600">
                        No items available{foodFilter !== 'all' ? ' for selected filter' : ''}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="pb-3">
                    {directItems.length > 0 && (
                      <div className="pt-1">
                        {directItems.map((item) => (
                          <MenuItemRow
                            key={item.id}
                            item={item}
                            qty={getItemQty(item.id)}
                            onAdd={() => handleAddItem(item)}
                            fetching={fetchingItemId === item.id}
                            onUpdateQty={(qty) => {
                              const combos = cartItems.filter((ci) => (ci.menu_item_id || ci.id) === item.id);
                              if (combos.length > 0) { const last = combos[combos.length - 1]; updateQty(last.id, last.quantity - 1); }
                              else updateQty(item.id, qty);
                            }}
                            c={c}
                          />
                        ))}
                      </div>
                    )}

                    {subs.map((sub) => (
                      <div key={sub.id}>
                        {/* Subcategory divider */}
                        <div className="flex items-center gap-3 px-4 py-2 mt-1">
                          <div className="h-px flex-1 bg-gray-200" />
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{sub.name}</span>
                          <div className="h-px flex-1 bg-gray-200" />
                        </div>
                        {sub.filteredItems.map((item) => (
                          <MenuItemRow
                            key={item.id}
                            item={item}
                            qty={getItemQty(item.id)}
                            onAdd={() => handleAddItem(item)}
                            fetching={fetchingItemId === item.id}
                            onUpdateQty={(qty) => {
                              const combos = cartItems.filter((ci) => (ci.menu_item_id || ci.id) === item.id);
                              if (combos.length > 0) { const last = combos[combos.length - 1]; updateQty(last.id, last.quantity - 1); }
                              else updateQty(item.id, qty);
                            }}
                            c={c}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="h-32" />
            </>
          )}
        </main>
      </div>

      {/* ── Floating bottom buttons ── */}
      {(itemCount > 0 || activeOrders.length > 0) && (
        <div className="fixed left-0 right-0 px-3 z-20 max-w-2xl mx-auto flex flex-col gap-2" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom) + 12px)' }}>
          {activeOrders.length > 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/confirmation`)}
              className="w-full bg-white border border-teal-200 text-teal-700 font-semibold text-sm py-3 rounded-2xl shadow-lg flex items-center justify-center gap-2"
            >
              📋 Track My Orders
              <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {activeOrders.length}
              </span>
            </button>
          )}
          {itemCount > 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/cart`)}
              className="w-full btn-primary flex items-center justify-between shadow-xl rounded-2xl py-3.5 px-4"
            >
              <span className="bg-brand-700/80 rounded-lg px-2 py-0.5 text-sm font-bold min-w-[24px] text-center">{itemCount}</span>
              <span className="font-bold text-sm">View Cart</span>
              <span className="font-black text-sm">{c(total)}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Modifier Dialog ── */}
      {modifierDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end" onClick={closeModifierDialog}>
          <div
            className="w-full max-w-2xl mx-auto bg-white rounded-t-3xl shadow-2xl max-h-[85dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
              {modifierDialog.item?.image_url && (
                <img src={modifierDialog.item.image_url} alt={modifierDialog.item.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {modifierDialog.item && <FoodDot isVeg={modifierDialog.item.is_veg} />}
                  <p className="text-sm font-bold text-gray-900 leading-snug">{modifierDialog.item?.name}</p>
                </div>
                <p className="text-xs text-gray-400">Customise your order</p>
              </div>
              <button
                onClick={closeModifierDialog}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 text-lg font-bold leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Scrollable options */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
              {modifierDialog.variants.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Choose Variant</p>
                  <div className="grid gap-2.5">
                    {modifierDialog.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => handleVariantChange(variant.id)}
                        className={`rounded-2xl border p-3.5 text-left text-sm transition-all ${
                          modifierDialog.selectedVariantId === variant.id
                            ? 'border-brand-500 bg-brand-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                              modifierDialog.selectedVariantId === variant.id ? 'border-brand-500' : 'border-gray-300'
                            }`}>
                              {modifierDialog.selectedVariantId === variant.id && <span className="w-2.5 h-2.5 rounded-full bg-brand-500" />}
                            </span>
                            <span className="font-semibold text-gray-900">{variant.name}</span>
                          </div>
                          <span className="text-sm font-bold text-gray-700">{c(variant.price)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {modifierDialog.groups.map((group) => {
                const selectedIds = modifierDialog.selectedOptions[group.id] || [];
                const isMulti = group.selection_type === 'multiple';
                return (
                  <div key={group.id} className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-700">{group.name}</p>
                        {(group.min_selections || group.max_selections) && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {group.min_selections && group.max_selections
                              ? `Select ${group.min_selections}–${group.max_selections}`
                              : group.min_selections ? `Select at least ${group.min_selections}`
                              : `Select up to ${group.max_selections}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isMulti && <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-semibold">Multiple</span>}
                        {group.is_required && <span className="text-[9px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-full uppercase">Required</span>}
                      </div>
                    </div>
                    <div className="grid gap-2">
                      {group.options.map((option) => {
                        const selected = selectedIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleModifierOption(group.id, option.id, group.selection_type)}
                            className={`rounded-2xl border p-3.5 text-left text-sm transition-all ${
                              selected ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {isMulti ? (
                                <span className={`flex-shrink-0 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                                  selected ? 'border-brand-500 bg-brand-500' : 'border-gray-300 bg-white'
                                }`}>
                                  {selected && (
                                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </span>
                              ) : (
                                <span className={`flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  selected ? 'border-brand-500' : 'border-gray-300'
                                }`}>
                                  {selected && <span className="w-2.5 h-2.5 rounded-full bg-brand-500" />}
                                </span>
                              )}
                              <p className="flex-1 font-medium text-gray-900">{option.name}</p>
                              {option.price > 0 && (
                                <p className="text-xs font-bold text-brand-600 flex-shrink-0">+{c(option.price)}</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {modifierDialog.error && (
                <div className="rounded-2xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-700">
                  {modifierDialog.error}
                </div>
              )}
            </div>

            {/* Dialog footer */}
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 bg-white">
              <div>
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Total</p>
                <p className="text-xl font-black text-gray-900 leading-tight">{modifierDialog.item && c(getModifierDialogTotal())}</p>
              </div>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={closeModifierDialog}
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmModifierSelection}
                  className="rounded-2xl bg-brand-600 px-6 py-3 text-sm font-bold text-white hover:bg-brand-700 active:bg-brand-800 transition-colors"
                >
                  Add to Cart →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── MenuItemRow — horizontal list card optimised for large menus ── */
function MenuItemRow({ item, qty, categoryLabel, onAdd, onUpdateQty, fetching, c }) {
  const hasImage = !!item.image_url;
  const isLowStock = item.track_stock && item.stock_quantity != null &&
    item.stock_quantity <= (item.low_stock_threshold ?? 5) && item.stock_quantity > 0;

  return (
    <div className={`bg-white mx-0 border-b border-gray-100 transition-colors ${qty > 0 ? 'bg-brand-50/30' : ''}`}>
      <div className="flex items-start gap-3 px-4 py-3.5">

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Top row: veg dot + category badge */}
          <div className="flex items-center gap-2 mb-1">
            <FoodDot isVeg={item.is_veg} />
            {categoryLabel && (
              <span className="text-[9px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                {categoryLabel}
              </span>
            )}
            {isLowStock && (
              <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                Only {item.stock_quantity} left
              </span>
            )}
          </div>

          {/* Name */}
          <h4 className="font-semibold text-gray-900 text-[13px] leading-snug line-clamp-2">{item.name}</h4>

          {/* Description */}
          {item.description && (
            <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{item.description}</p>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium capitalize">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Price row */}
          <div className="flex items-center justify-between mt-2">
            <span className="font-bold text-gray-900 text-[13px]">{c(item.price)}</span>
            {/* Add / Quantity control */}
            <div>
              {qty === 0 ? (
                <button
                  onClick={onAdd}
                  disabled={fetching}
                  className={`text-xs font-bold px-4 py-1.5 rounded-xl border-2 transition-all min-w-[60px] text-center ${
                    fetching
                      ? 'border-brand-300 text-brand-300 cursor-wait'
                      : 'border-brand-500 text-brand-600 hover:bg-brand-50 active:bg-brand-100 active:scale-95'
                  }`}
                >
                  {fetching ? '…' : 'ADD'}
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
        </div>

        {/* Image */}
        {hasImage && (
          <div className="relative flex-shrink-0 w-24 h-24 rounded-2xl overflow-hidden bg-gray-100 mt-0.5">
            <img
              src={item.image_url}
              alt={item.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
            />
            {qty > 0 && (
              <div className="absolute inset-0 bg-brand-500/10" />
            )}
            {qty > 0 && (
              <span className="absolute bottom-1.5 right-1.5 bg-brand-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                {qty}
              </span>
            )}
          </div>
        )}

        {/* No image: show qty badge inline if in cart */}
        {!hasImage && qty > 0 && (
          <span className="flex-shrink-0 self-center bg-brand-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm mt-0.5">
            {qty}
          </span>
        )}
      </div>
    </div>
  );
}
