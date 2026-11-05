import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import { useT, localized } from '../../i18n';
import toast from 'react-hot-toast';
import { tableName } from '../../utils/tableName';

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

// Dishes the café tagged as popular get a "Bestseller" ribbon and a section
const BESTSELLER_TAGS = ['bestseller', 'best seller', 'popular', 'recommended', 'must try', "chef's special", 'chef special'];
const isBestseller = (item) => Array.isArray(item.tags) && item.tags.some((tag) => BESTSELLER_TAGS.includes(String(tag).toLowerCase()));

function FoodDot({ isVeg }) {
  const { t } = useT();
  return (
    <span role="img" aria-label={isVeg ? t('menu.veg') : t('menu.nonVeg')}
      className={`inline-flex w-[14px] h-[14px] rounded-sm border-2 items-center justify-center flex-shrink-0 ${
      isVeg ? 'border-green-600' : 'border-red-600'
    }`}>
      <span className={`w-[7px] h-[7px] rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
    </span>
  );
}

export default function MenuPage() {
  const { t, lang } = useT();
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items: cartItems, addItem, updateQty, itemCount, total, setCafeCurrency } = useCart();
  const [cafe, setCafe] = useState(null);
  const [cafeOpen, setCafeOpen] = useState(true);
  const [menu, setMenu] = useState([]);
  const [offers, setOffers] = useState([]);
  const [emojiMap, setEmojiMap] = useState(FALLBACK_EMOJI_MAP);
  const [loading, setLoading] = useState(true);
  // Menu fetch failed (e.g. server waking up) — show a retry screen instead
  // of silently bouncing the customer back to the start
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  // Menu prices read like a menu: ₹120, not ₹120.00 (paise only when present)
  const cMenu = (n) => (Number.isInteger(Number(n)) ? c(n).replace(/[.,]00$/, '') : c(n));

  useEffect(() => {
    getPublicSetting('category_emoji_map')
      .then((res) => {
        if (res.data.value && typeof res.data.value === 'object') setEmojiMap(res.data.value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setLoadError(false);
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
      .catch((err) => {
        if (err?.response?.status === 404) navigate(`/cafe/${slug}`); // café doesn't exist
        else setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [slug, loadAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-retry a few times — a cold server usually answers within ~30 s
  useEffect(() => {
    if (!loadError || loadAttempt >= 3) return;
    const id = setTimeout(() => setLoadAttempt((n) => n + 1), 5000);
    return () => clearTimeout(id);
  }, [loadError, loadAttempt]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    // join_menu on connect handles both initial connect and reconnects — no need to
    // emit separately before connect fires, which would cause a duplicate join.
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

  // Refetch menu + cafe status when tab regains focus after >2 min away.
  // Prevents customers seeing stale prices or sold-out items after returning.
  useEffect(() => {
    if (!session) return;
    let lastVisible = Date.now();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastVisible = Date.now();
      } else if (Date.now() - lastVisible > 2 * 60 * 1000) {
        Promise.all([getCafeBySlug(slug), getCafeMenu(slug)])
          .then(([cafeRes, menuRes]) => {
            const cafeData = cafeRes.data.cafe;
            setCafe(cafeData);
            setCafeOpen(cafeData.is_open !== false);
            setMenu(menuRes.data.menu);
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Item detail sheet (large photo + full description)
  const [detailItem, setDetailItem] = useState(null);
  const decrementItem = (item) => {
    const combos = cartItems.filter((ci) => (ci.menu_item_id || ci.id) === item.id);
    if (combos.length > 0) { const last = combos[combos.length - 1]; updateQty(last.id, last.quantity - 1); }
    else updateQty(item.id, getItemQty(item.id) - 1);
  };

  // Add-on lookups per item, kept for the visit: after the first tap, "+"
  // adds instantly (taps made while a lookup was in flight used to be lost)
  const modifierCache = useRef(new Map());

  const handleAddItem = async (item) => {
    // The menu says when an item has no add-ons: add it straight away
    if (item.has_options === false) { addItem(item); return; }
    const known = modifierCache.current.get(item.id);
    if (known) {
      if (known.groups.length === 0 && known.variants.length === 0) addItem(item);
      else openModifierDialog(item, known.groups, known.variants);
      return;
    }
    if (fetchingItemId === item.id) return;
    setFetchingItemId(item.id);
    try {
      const res = await getPublicItemModifiers(slug, item.id);
      const groups = res.data.groups || [];
      const variants = res.data.variants || [];
      modifierCache.current.set(item.id, { groups, variants });
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
      // Translated names follow the same "Name (Variant)" shape for the cart
      translations: Object.fromEntries(Object.entries(item.translations || {}).map(([l, v]) =>
        [l, v.name ? { name: `${v.name}${selectedVariant ? ` (${selectedVariant.name})` : ''}` } : {}])),
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
            cat.name.toLowerCase().includes(q) ||
            // also match what the customer reads (e.g. typing in Hindi)
            localized(item, 'name', lang).toLowerCase().includes(q) ||
            localized(cat, 'name', lang).toLowerCase().includes(q)
          );
        })
        .map((item) => ({ ...item, _catName: localized(cat, 'name', lang) }))
    );
  }, [menu, foodFilter, search, lang]);

  const filterItem = (item) => {
    if (!item.is_available) return false;
    if (foodFilter === 'veg' && !item.is_veg) return false;
    if (foodFilter === 'nonveg' && item.is_veg) return false;
    return true;
  };



  // ── Continuous menu: which section is on screen, jump to one, MENU list ──
  const [activeSection, setActiveSection] = useState(null);
  const [menuSheet, setMenuSheet] = useState(false);
  const STICKY_OFFSET = 128; // sticky search + category tabs
  // A section's position inside the scrolling menu
  const sectionTop = (root, el) => root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top;
  const jumpTo = (id) => {
    const root = contentRef.current;
    const el = root?.querySelector(`[data-section="${id}"]`);
    if (!root || !el) return;
    setActiveSection(id);
    root.scrollTo({ top: sectionTop(root, el) - STICKY_OFFSET + 4, behavior: 'smooth' });
  };
  useEffect(() => {
    const root = contentRef.current;
    if (!root || loading) return undefined;
    // Highlight the tab of the section at the top of the screen
    const onScroll = () => {
      const els = [...root.querySelectorAll('[data-section]')];
      let current = els[0]?.dataset.section || null;
      for (const el of els) if (sectionTop(root, el) - STICKY_OFFSET <= root.scrollTop + 8) current = el.dataset.section;
      // At the very bottom the last (short) section can't reach the top
      if (els.length && root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = els[els.length - 1].dataset.section;
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [loading, menu, foodFilter, search]);
  // Keep the active tab visible in the tab strip — scroll only the strip
  // sideways (scrollIntoView would also move the menu and cancel a jump)
  useEffect(() => {
    const strip = contentRef.current?.querySelector('nav[aria-label="Menu categories"]');
    const tab = strip?.querySelector('[aria-current="true"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeSection]);

  if (!session) return <Navigate to={`/cafe/${slug}`} replace />;
  if (loadError && !loading) return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center bg-white">
      <span className="text-5xl" aria-hidden="true">👨‍🍳</span>
      <h1 className="text-lg font-bold text-gray-900">{t('menu.waking')}</h1>
      <p className="text-sm text-gray-500 max-w-xs">
        {loadAttempt < 3 ? t('menu.wakingBody') : t('menu.wakingFailed')}
      </p>
      <button type="button" onClick={() => setLoadAttempt((n) => n + 1)} className="btn-primary min-h-[44px] px-6">
        {t('menu.retry')}
      </button>
    </div>
  );
  if (loading) return <LoadingSpinner />;

  const isSearching = search.trim().length > 0;
  const sections = categories
    .map((cat) => ({
      ...cat,
      direct: (cat.items || []).filter(filterItem),
      subs: (cat.subcategories || [])
        .map((sub) => ({ ...sub, visible: sub.items.filter(filterItem) }))
        .filter((sub) => sub.visible.length > 0),
    }))
    .map((cat) => ({ ...cat, count: cat.direct.length + cat.subs.reduce((n, sub) => n + sub.visible.length, 0) }))
    .filter((cat) => cat.count > 0);
  const bestsellers = categories.flatMap((cat) => allCatItems(cat)).filter((i) => filterItem(i) && isBestseller(i)).slice(0, 8);
  const status = (() => { void scheduleTick; return getScheduleStatus(cafe?.opening_hours, cafe?.timezone, !!cafeOpen); })();
  const todayHours = getTodayHours(cafe?.opening_hours, cafe?.timezone);

  const row = (item, extra = {}) => (
    <MenuItemRow
      key={item.id}
      item={item}
      qty={getItemQty(item.id)}
      onAdd={() => handleAddItem(item)}
      onOpen={() => setDetailItem(item)}
      fetching={fetchingItemId === item.id}
      onUpdateQty={(qty) => {
        const combos = cartItems.filter((ci) => (ci.menu_item_id || ci.id) === item.id);
        if (combos.length > 0) { const last = combos[combos.length - 1]; updateQty(last.id, last.quantity - 1); }
        else updateQty(item.id, qty);
      }}
      c={cMenu}
      {...extra}
    />
  );

  return (
    <div ref={contentRef} className="max-w-2xl mx-auto bg-gray-50 overflow-y-auto overscroll-contain" style={{ height: '100dvh' }}>
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

      {/* ── Café header: cover, logo, name, status, table ── */}
      <header className="relative">
        <div className="h-28 sm:h-36"
          style={cafe?.cover_image_url
            ? { backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,.05), rgba(0,0,0,.45)), url(${cafe.cover_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: 'linear-gradient(135deg, #fb923c 0%, #ea580c 55%, #9a3412 100%)' }} />
        <div className="relative -mt-12 mx-3 bg-white rounded-2xl shadow-md p-4">
          <div className="flex items-start gap-3">
            {cafe?.logo_url ? (
              <img src={cafe.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0 ring-1 ring-gray-100" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center font-black text-2xl flex-shrink-0">
                {cafe?.name?.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-extrabold text-gray-900 leading-tight truncate">{cafe?.name}</h1>
              {(cafe?.address || cafe?.city) && (
                <p className="text-xs text-gray-500 truncate mt-0.5">{[cafe.address, cafe.city].filter(Boolean).join(', ')}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  !status.isOpen ? 'bg-red-50 text-red-700' : status.closingSoon ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${!status.isOpen ? 'bg-red-500' : status.closingSoon ? 'bg-amber-500' : 'bg-green-500'}`} />
                  {!status.isOpen ? 'Closed' : status.closingSoon ? 'Closing soon' : 'Open'}
                  {todayHours && status.isOpen && !status.closingSoon ? ` · ${todayHours}` : ''}
                </span>
                {cafe?.avg_rating > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-700 text-white">★ {cafe.avg_rating}</span>
                )}
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {session?.order_type === 'takeaway' ? '🥡 Takeaway' : `🪑 ${tableName(session?.table_number)}`}
                </span>
              </div>
            </div>
            {activeOrders.length > 0 && (
              <button type="button" onClick={() => navigate(`/cafe/${slug}/confirmation`)}
                className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                📋 {activeOrders.length} active
              </button>
            )}
          </div>
          {!status.isOpen && (
            <p className="mt-3 text-xs font-semibold text-red-700 bg-red-50 rounded-lg px-3 py-2">{status.reason} — you can browse, ordering opens when the café does.</p>
          )}
          {status.isOpen && status.closingSoon && (
            <p className="mt-3 text-xs font-semibold text-amber-800 bg-amber-50 rounded-lg px-3 py-2">⚠️ {status.reason}</p>
          )}
        </div>
      </header>

      {/* ── Offers ── */}
      {bannerOffers.length > 0 && (
        <div className="px-3 pt-3 overflow-x-auto">
          <div className="flex gap-2 w-max">
            {bannerOffers.map((o) => {
              const isPlatform = o.funded_by === 'platform';
              const label = o.offer_type === 'percentage' || o.offer_type === 'first_order'
                ? `${o.discount_value}% OFF`
                : o.offer_type === 'bogo' ? 'Buy 2 Get 1 Free'
                : `${c(o.discount_value)} OFF`;
              return (
                <div key={o.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 border bg-white shadow-sm ${isPlatform ? 'border-purple-200' : 'border-orange-200'}`}>
                  <span className={`text-lg ${isPlatform ? 'text-purple-600' : 'text-orange-600'}`} aria-hidden="true">%</span>
                  <div className="leading-tight">
                    <p className={`text-xs font-extrabold ${isPlatform ? 'text-purple-700' : 'text-orange-700'}`}>{label}</p>
                    <p className="text-[10px] text-gray-500">
                      {o.offer_type === 'first_order' ? 'First order' : o.min_order_amount > 0 ? `On ${c(o.min_order_amount)}+` : 'On every order'}
                      {o.coupon_code ? <> · <span className="font-mono font-bold">{o.coupon_code}</span></> : null}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sticky: search, veg filter, category tabs ── */}
      <div className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur pt-3 pb-2 mt-1 border-b border-gray-200/70">
        <div className="px-3 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none" aria-hidden="true">🔍</span>
            <input
              type="text"
              placeholder={t('menu.search')}
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-9 h-11 text-sm outline-none focus:ring-2 focus:ring-orange-300"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 text-gray-400">✕</button>
            )}
          </div>
          {[
            { key: 'veg', label: t('menu.filterVeg'), dot: 'bg-green-600', on: 'border-green-600 bg-green-50 text-green-800' },
            { key: 'nonveg', label: t('menu.filterNonVeg'), dot: 'bg-red-600', on: 'border-red-600 bg-red-50 text-red-800' },
          ].map((f) => (
            <button key={f.key} type="button" aria-pressed={foodFilter === f.key}
              onClick={() => setFoodFilter((cur) => (cur === f.key ? 'all' : f.key))}
              className={`flex-shrink-0 h-11 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${foodFilter === f.key ? f.on : 'border-gray-200 bg-white text-gray-700'}`}>
              <span className={`w-2.5 h-2.5 rounded-sm ${f.dot}`} aria-hidden="true" />
              {f.label}
            </button>
          ))}
        </div>
        {!isSearching && (
          <nav aria-label="Menu categories" className="mt-2 px-3 overflow-x-auto">
            <div className="flex gap-1.5 w-max">
              {comboOffers.length > 0 && (
                <button type="button" onClick={() => jumpTo('__deals__')}
                  className={`h-9 px-3 rounded-full text-xs font-bold whitespace-nowrap ${activeSection === '__deals__' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
                  🎁 {t('menu.deals')}
                </button>
              )}
              {sections.map((cat) => (
                <button key={cat.id} type="button" onClick={() => jumpTo(cat.id)} aria-current={activeSection === cat.id ? 'true' : undefined}
                  className={`h-9 px-3 rounded-full text-xs font-bold whitespace-nowrap ${activeSection === cat.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
                  {getCategoryEmoji(cat.name, emojiMap)} {localized(cat, 'name', lang)}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      <main style={{ paddingBottom: 'calc(150px + env(safe-area-inset-bottom))' }}>
        {isSearching ? (
          /* ── Search results ── */
          <section className="mt-2">
            <p className="px-4 py-2 text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{displayItems.length}</span> result{displayItems.length !== 1 ? 's' : ''} for “<span className="text-orange-600">{search}</span>”
            </p>
            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="text-5xl mb-3" aria-hidden="true">🔍</span>
                <p className="text-sm font-semibold text-gray-700">No dishes match</p>
                <p className="text-xs text-gray-400 mt-1">Try another word, or clear the search to see the full menu.</p>
                <button type="button" onClick={() => setSearch('')} className="mt-4 min-h-[40px] text-xs text-orange-600 font-bold border border-orange-300 px-4 rounded-full">Clear search</button>
              </div>
            ) : (
              <div className="bg-white">{displayItems.map((item) => row(item, { categoryLabel: item._catName }))}</div>
            )}
          </section>
        ) : (
          <>
            {/* ── Deals & combos ── */}
            {comboOffers.length > 0 && (
              <section data-section="__deals__" className="mt-3">
                <h2 className="px-4 py-2 text-base font-extrabold text-gray-900">🎁 {t('menu.deals')}</h2>
                <div className="px-3 space-y-3">
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
                      <div key={offer.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-orange-100">
                        <div className="px-4 py-3 flex items-start justify-between gap-3 bg-gradient-to-r from-orange-50 to-amber-50">
                          <div className="min-w-0">
                            <p className="font-extrabold text-gray-900 text-sm">{offer.name}</p>
                            {offer.description && <p className="text-xs text-gray-600 mt-0.5">{offer.description}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-black text-gray-900 text-lg leading-none">{c(offer.combo_price)}</p>
                            {savings > 0 && <p className="text-[11px] font-bold text-green-700 mt-1">Save {c(savings)}</p>}
                          </div>
                        </div>
                        {resolvedItems.length > 0 && (
                          <ul className="px-4 py-2.5 space-y-1.5">
                            {resolvedItems.map((item) => (
                              <li key={item.id} className="flex items-center gap-2 text-sm text-gray-800">
                                <FoodDot isVeg={item.is_veg} />
                                <span className="flex-1">{localized(item, 'name', lang)}</span>
                                {item.comboQty > 1 && <span className="text-gray-400 text-xs">×{item.comboQty}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="px-4 pb-3">
                          <button type="button"
                            onClick={() => { resolvedItems.forEach((item) => { for (let i = 0; i < item.comboQty; i++) addItem(item); }); toast.success('Combo added'); }}
                            disabled={resolvedItems.length === 0}
                            className="w-full min-h-[44px] rounded-xl bg-orange-500 active:bg-orange-600 text-white text-sm font-bold disabled:opacity-40">
                            Add combo
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Bestsellers ── */}
            {bestsellers.length > 0 && (
              <section className="mt-3">
                <h2 className="px-4 py-2 text-base font-extrabold text-gray-900">⭐ Bestsellers</h2>
                <div className="bg-white">{bestsellers.map((item) => row(item))}</div>
              </section>
            )}

            {/* ── Every category, one continuous menu ── */}
            {sections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <span className="text-5xl mb-3" aria-hidden="true">🍽️</span>
                <p className="text-sm font-semibold text-gray-700">
                  {foodFilter !== 'all' ? 'Nothing here for this filter' : 'The menu is being updated — please check back soon'}
                </p>
                {foodFilter !== 'all' && (
                  <button type="button" onClick={() => setFoodFilter('all')} className="mt-4 min-h-[40px] text-xs text-orange-600 font-bold border border-orange-300 px-4 rounded-full">Show all dishes</button>
                )}
              </div>
            ) : sections.map((cat) => (
              <section key={cat.id} data-section={cat.id} className="mt-3 scroll-mt-32">
                <h2 className="px-4 py-2 flex items-baseline justify-between">
                  <span className="text-base font-extrabold text-gray-900">{localized(cat, 'name', lang)}</span>
                  <span className="text-xs text-gray-400">{cat.count} item{cat.count !== 1 ? 's' : ''}</span>
                </h2>
                <div className="bg-white">
                  {cat.direct.map((item) => row(item))}
                  {cat.subs.map((sub) => (
                    <div key={sub.id}>
                      <h3 className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-gray-400">{localized(sub, 'name', lang)}</h3>
                      {sub.visible.map((item) => row(item))}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {/* Item detail sheet — rendered regardless of cart state (portals to body) */}
      {detailItem && (
        <ItemDetailSheet
          item={detailItem}
          qty={getItemQty(detailItem.id)}
          fetching={fetchingItemId === detailItem.id}
          onAdd={() => handleAddItem(detailItem)}
          onDecrement={() => decrementItem(detailItem)}
          onClose={() => setDetailItem(null)}
          c={c}
        />
      )}

      {/* ── Category list (MENU button) ── */}
      {menuSheet && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center" onClick={() => setMenuSheet(false)}>
          <div role="dialog" aria-modal="true" aria-label="Categories" className="w-full max-w-sm mb-36 mx-4 bg-gray-900 text-white rounded-2xl p-2 max-h-[55dvh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sections.map((cat) => (
              <button key={cat.id} type="button" onClick={() => { setMenuSheet(false); jumpTo(cat.id); }}
                className={`w-full min-h-[44px] px-3 rounded-xl flex items-center justify-between text-sm ${activeSection === cat.id ? 'font-extrabold text-orange-300' : 'font-medium'}`}>
                <span>{localized(cat, 'name', lang)}</span><span className="text-white/60">{cat.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Floating: MENU, track orders, cart ── */}
      <div className="fixed left-0 right-0 px-3 z-30 max-w-2xl mx-auto flex flex-col gap-2 pointer-events-none" style={{ bottom: 'calc(60px + env(safe-area-inset-bottom) + 12px)' }}>
        {!isSearching && sections.length > 1 && (
          <button type="button" onClick={() => setMenuSheet(true)}
            className="pointer-events-auto self-end min-h-[44px] px-4 rounded-full bg-gray-900 text-white text-xs font-extrabold tracking-wider shadow-lg flex items-center gap-2">
            ☰ MENU
          </button>
        )}
        {activeOrders.length > 0 && itemCount === 0 && (
          <button type="button" onClick={() => navigate(`/cafe/${slug}/confirmation`)}
            className="pointer-events-auto w-full bg-white border border-teal-200 text-teal-700 font-semibold text-sm min-h-[48px] rounded-2xl shadow-lg flex items-center justify-center gap-2">
            📋 Track my orders
            <span className="bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{activeOrders.length}</span>
          </button>
        )}
        {itemCount > 0 && (
          <button type="button" onClick={() => navigate(`/cafe/${slug}/cart`)}
            className="pointer-events-auto w-full bg-green-700 active:bg-green-800 text-white flex items-center justify-between shadow-xl rounded-2xl min-h-[56px] px-4">
            <span className="text-left leading-tight">
              <span className="block text-sm font-extrabold">{itemCount} item{itemCount !== 1 ? 's' : ''} · {c(total)}</span>
              <span className="block text-[11px] text-white/80">Taxes &amp; charges at checkout</span>
            </span>
            <span className="font-extrabold text-sm">{t('menu.viewCart')} ›</span>
          </button>
        )}
      </div>

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

/* ── MenuItemRow — dish card: details left, photo right with ADD on it ── */
function MenuItemRow({ item, qty, categoryLabel, onAdd, onUpdateQty, onOpen, fetching, c }) {
  const { t, lang } = useT();
  const name = localized(item, 'name', lang);
  const description = localized(item, 'description', lang);
  const [imgOk, setImgOk] = useState(!!item.image_url);
  const isLowStock = item.track_stock && item.stock_quantity != null &&
    item.stock_quantity <= (item.low_stock_threshold ?? 5) && item.stock_quantity > 0;

  const addControl = qty === 0 ? (
    <button
      type="button"
      onClick={onAdd}
      disabled={fetching}
      aria-label={`${t('menu.add')} ${name}`}
      className={`min-h-[40px] min-w-[96px] px-4 rounded-xl bg-white border border-gray-200 shadow-md text-sm font-extrabold tracking-wide touch-manipulation active:scale-95 transition ${
        fetching ? 'text-gray-300 cursor-wait' : 'text-green-700'}`}
    >
      {fetching ? '…' : `${t('menu.add')} +`}
    </button>
  ) : (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 px-1">
      <QuantityControl qty={qty} onDecrement={() => onUpdateQty(qty - 1)} onIncrement={onAdd} />
    </div>
  );

  return (
    <div className="flex gap-4 px-4 py-4 border-b border-gray-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <FoodDot isVeg={item.is_veg} />
          {isBestseller(item) && (
            <span className="text-[10px] font-extrabold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">★ Bestseller</span>
          )}
          {categoryLabel && (
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{categoryLabel}</span>
          )}
          {isLowStock && (
            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Only {item.stock_quantity} left</span>
          )}
        </div>
        <button type="button" onClick={onOpen} className="block w-full text-left mt-1 touch-manipulation" aria-haspopup="dialog">
          <h4 className="font-bold text-gray-900 text-[16px] leading-snug">{name}</h4>
          <p className="text-[15px] font-semibold text-gray-800 mt-0.5">{c(item.price)}</p>
          {description && (
            <p className="text-[13px] text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{description}</p>
          )}
        </button>
      </div>

      {/* No photo: ADD sits in the same right-hand column as photo cards */}
      {!imgOk && (
        <div className="flex-shrink-0 w-[118px] flex flex-col items-center justify-center gap-1">
          {addControl}
          {item.has_options && <span className="text-[10px] text-gray-400">Customisable</span>}
        </div>
      )}

      {imgOk && (
        <div className="relative flex-shrink-0 w-[118px] pb-5">
          <button type="button" onClick={onOpen} aria-label={name} className="block w-[118px] h-[110px] rounded-2xl overflow-hidden bg-gray-100 touch-manipulation">
            <img src={item.image_url} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setImgOk(false)} />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0">{addControl}</div>
          {item.has_options && <p className="absolute -bottom-5 inset-x-0 text-center text-[10px] text-gray-400">Customisable</p>}
        </div>
      )}
    </div>
  );
}

// ─── Item detail sheet ────────────────────────────────────────
// Large photo + full description. Bottom sheet on phones, centred dialog on
// larger screens. Esc / backdrop / ✕ close it.
function ItemDetailSheet({ item, qty, fetching, onAdd, onDecrement, onClose, c }) {
  const { t, lang } = useT();
  const name = localized(item, 'name', lang);
  const description = localized(item, 'description', lang);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Portal to <body>: the sheet must not inherit the floating cart bar's
  // stacking context (it's opened from deep inside the menu layout)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-labelledby="item-detail-title"
    >
      <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="relative">
          {item.image_url ? (
            <img src={item.image_url} alt={name} className="w-full aspect-[4/3] object-cover sm:rounded-t-3xl rounded-t-3xl" />
          ) : (
            <div className="w-full h-16" />
          )}
          <button type="button" onClick={onClose} aria-label="Close"
            className="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-700 text-lg">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-start gap-2">
            <span className="mt-1"><FoodDot isVeg={item.is_veg} /></span>
            <h2 id="item-detail-title" className="text-xl font-bold text-gray-900 leading-snug flex-1">{name}</h2>
          </div>
          {description && <p className="text-[15px] text-gray-600 leading-relaxed whitespace-pre-line">{description}</p>}
          {Array.isArray(item.tags) && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium capitalize">{tag}</span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <span className="text-2xl font-black text-gray-900">{c(item.price)}</span>
            {qty === 0 ? (
              <button type="button" onClick={onAdd} disabled={fetching}
                className="min-h-[48px] min-w-[120px] px-6 rounded-2xl bg-brand-500 text-white font-bold text-base disabled:opacity-60 touch-manipulation">
                {fetching ? '…' : t('menu.add')}
              </button>
            ) : (
              <QuantityControl qty={qty} onDecrement={onDecrement} onIncrement={onAdd} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
