import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { useCart } from '../../context/CartContext';
import { placeOrder, previewOffer, validateCoupon, getCafeTables, getUpsellSuggestions, getPublicOffers } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import { upsertOrder, loadOrders } from '../../utils/cafeOrderStorage';
import { fmtCurrency } from '../../utils/formatters';
import toast from 'react-hot-toast';
import QuantityControl from '../../components/QuantityControl';

// Normalise "5"→"Table 5", "T5"→"Table 5"; prepend area if given
function normTable(raw, areaName) {
  const t = (raw || '').trim();
  if (!t) return t;
  const n = /^\d+$/.test(t) ? `Table ${t}` : /^t\d+$/i.test(t) ? `Table ${t.slice(1)}` : t;
  return (areaName && areaName !== 'General' && !n.startsWith(areaName)) ? `${areaName} — ${n}` : n;
}

export default function CartPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, total, itemCount, cafeCurrency, addItem, updateQty, clearCart } = useCart();
  const c = (n) => fmtCurrency(n, cafeCurrency);
  const [sessionTick, setSessionTick] = useState(0); // incremented to re-read localStorage without full reload
  const [loading, setLoading] = useState(false);
  const [slowNetwork, setSlowNetwork] = useState(false); // shows "Still connecting..." after 5s
  const [submitAttempt, setSubmitAttempt] = useState(0); // 0=idle, 1+=attempt number for retry UI
  const slowNetworkTimer = useRef(null);
  const submittingRef = useRef(false);
  // Persisted idempotency key — survives page remounts/refreshes so retries dedup on server.
  // Reset only after a confirmed successful order placement.
  const orderIdRef = useRef(null);
  if (!orderIdRef.current) {
    const stored = sessionStorage.getItem(`dv_order_id_${slug}`);
    orderIdRef.current = stored ?? crypto.randomUUID();
    if (!stored) sessionStorage.setItem(`dv_order_id_${slug}`, orderIdRef.current);
  }
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [tip, setTip] = useState(0);
  const [orderError, setOrderError] = useState(null);
  const [offerPreview, setOfferPreview] = useState(null); // { applied, offer_name, discount_amount, final_amount }
  const [allOffers, setAllOffers]       = useState([]);   // Zomato-style offer panel — all active public offers
  const offerDebounce = useRef(null);
  const [couponInput, setCouponInput]     = useState('');
  const [couponApplied, setCouponApplied] = useState(false); // true when offer was set via coupon
  const [couponLoading, setCouponLoading] = useState(false);
  const [suggestions, setSuggestions]   = useState([]);

  // Table / order-type re-confirm state
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableForm, setTableForm] = useState({ order_type: 'dine-in', table_number: '' });
  const [tableAreas, setTableAreas] = useState([]);
  const [tableDropOpen, setTableDropOpen] = useState(false);
  const tableInputRef = useRef(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const session = JSON.parse(localStorage.getItem(`session_${slug}`) || 'null'); // re-read on sessionTick change
  // sessionTick is referenced here to force re-evaluation when table is re-confirmed
  void sessionTick;

  // Delivery address form state
  const [deliveryForm, setDeliveryForm] = useState({
    delivery_address:      '',
    delivery_address2:     '',
    delivery_city:         '',
    delivery_zipcode:      '',
    delivery_phone:        session?.customer_phone || '',
    delivery_instructions: '',
  });

  const isDelivery = session?.order_type === 'delivery';
  const deliveryFeeBase  = Math.max(0, parseFloat(session?.delivery_fee_base  ?? 0) || 0);
  const deliveryEstMins  = parseInt(session?.delivery_est_mins || 30);
  const deliveryMinOrder = Math.max(0, parseFloat(session?.delivery_min_order ?? 0) || 0);

  const TIP_OPTIONS = [0, 10, 20, 50];
  const [cafeOpen, setCafeOpen] = useState(session?.is_open !== false);

  useEffect(() => {
    const name = session?.cafe_name;
    document.title = name ? `Cart — ${name}` : 'Your Cart — DineVerse';
    return () => { document.title = 'DineVerse'; };
  }, [session?.cafe_name]);

  // Fetch all public offers once for the Zomato-style "Offers for you" panel.
  // Owner offers + DineVerse-funded offers; auto-applied ones light up as
  // the cart total crosses each offer's min_order_amount.
  useEffect(() => {
    if (!slug) return;
    getPublicOffers(slug)
      .then(({ data }) => setAllOffers(data.offers || []))
      .catch(() => setAllOffers([]));
  }, [slug]);

  // Upsell suggestions — debounced, only when cart has items
  useEffect(() => {
    if (!items.length) { setSuggestions([]); return; }
    const ids = items.map((i) => i.menu_item_id || i.id).filter(Boolean);
    if (!ids.length) return;
    const t = setTimeout(() => {
      getUpsellSuggestions(slug, ids)
        .then(({ data }) => setSuggestions(data.data?.suggestions || []))
        .catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [slug, items]);

  // Live open/closed updates — same room MenuPage uses
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socket.emit('join_menu', slug);
    socket.on('connect', () => socket.emit('join_menu', slug));
    socket.on('cafe_status', ({ is_open }) => setCafeOpen(is_open));
    return () => socket.disconnect();
  }, [slug]);

  // GST breakdown — supports both inclusive (baked into price) and exclusive (added on top)
  const gstRate     = parseInt(session?.gst_rate ?? 0);
  const hasGst      = gstRate > 0;
  const taxInclusive = session?.tax_inclusive === true; // default false — add tax on top

  let taxableAmt, totalTax, grandTotal;
  const discountAmt = offerPreview?.applied ? Math.min(total, Math.max(0, parseFloat(offerPreview.discount_amount || 0))) : 0;

  if (hasGst) {
    if (taxInclusive) {
      // Prices include GST — extract tax: tax = total × rate / (100 + rate)
      taxableAmt = total / (1 + gstRate / 100);
      totalTax   = total - taxableAmt;
      grandTotal = total - discountAmt + tip + (isDelivery ? deliveryFeeBase : 0);
    } else {
      // Prices are pre-tax — add GST on top
      taxableAmt = total - discountAmt; // base after discount
      totalTax   = taxableAmt * gstRate / 100;
      grandTotal = taxableAmt + totalTax + tip + (isDelivery ? deliveryFeeBase : 0);
    }
  } else {
    taxableAmt = total;
    totalTax   = 0;
    grandTotal = total - discountAmt + tip + (isDelivery ? deliveryFeeBase : 0);
  }

  // Platform charge — transparent DineVerse service fee added on top
  const platformFeeRate = parseFloat(session?.platform_fee_rate ?? 0);
  const platformFee = platformFeeRate > 0
    ? parseFloat((grandTotal * platformFeeRate / 100).toFixed(2))
    : 0;
  grandTotal = parseFloat((grandTotal + platformFee).toFixed(2));

  const allOrders    = loadOrders(slug);
  const activeOrders = allOrders.filter((o) => !['paid', 'cancelled'].includes(o.status));
  const availableTables = tableAreas
    .filter((area) => !tableForm.area_id || String(area.id) === String(tableForm.area_id))
    .flatMap((area) => area.tables.map((table) => ({ ...table, area_name: area.name })));
  const tableQuery = tableForm.table_number.toLowerCase();
  const tableSuggestions = availableTables
    .filter((table) => !tableQuery || table.label.toLowerCase().includes(tableQuery))
    .slice(0, 12);
  // Detect "new session" — previous orders exist but all are paid/cancelled
  const needsTableConfirm = allOrders.length > 0 && activeOrders.length === 0;

  // When a new session is needed, init the table form from the current session and open modal
  useEffect(() => {
    if (!needsTableConfirm) return;
    setTableForm({
      order_type:   session?.order_type || 'dine-in',
      table_number: '',
      area_id: '',
    });
    setShowTableModal(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTableConfirm]);

  useEffect(() => {
    if (!showTableModal) return;
    const { date, time } = (() => {
      const d = new Date();
      return {
        date: d.toLocaleDateString('en-CA'),
        time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
      };
    })();
    getCafeTables(slug, { date, time })
      .then(({ data }) => setTableAreas(data.areas || []))
      .catch(() => {});
  }, [showTableModal, slug]);

  const handleConfirmTable = () => {
    if (tableForm.order_type === 'dine-in' && !tableForm.table_number.trim()) {
      toast.error('Please enter your table number');
      return;
    }
    const selectedArea = tableAreas.find((a) => String(a.id) === String(tableForm.area_id));
    const tableLabel = tableForm.order_type === 'dine-in'
      ? normTable(tableForm.table_number, selectedArea?.name)
      : tableForm.order_type === 'takeaway' ? 'Takeaway' : 'Delivery';

    const updated = {
      ...session,
      order_type:   tableForm.order_type,
      table_number: tableLabel,
      area_id:      tableForm.order_type === 'dine-in' ? tableForm.area_id : '',
    };
    localStorage.setItem(`session_${slug}`, JSON.stringify(updated));
    setShowTableModal(false);
    setSessionTick((t) => t + 1); // re-read session without destroying cart state
  };

  // Debounced offer preview: refetch when cart total OR customer phone changes
  // (phone matters for first_order eligibility — repeat customers don't qualify)
  const previewPhone = (deliveryForm?.delivery_phone || session?.customer_phone || '').trim();
  // Track the previously-applied auto offer so we can toast when it
  // disappears (e.g. customer removed an item and dropped below min_order).
  const prevAutoOfferRef = useRef(null);
  useEffect(() => {
    // If a coupon is manually applied, re-validate it (cart may have shrunk
    // below min_order or the offer may have hit its usage cap). On failure
    // auto-remove with a toast so the customer is never about to checkout
    // expecting a discount that won't apply.
    if (couponApplied) {
      if (!items.length) return;
      clearTimeout(offerDebounce.current);
      offerDebounce.current = setTimeout(async () => {
        try {
          const { data } = await validateCoupon(slug, {
            coupon_code: couponInput.trim(),
            items: items.map((i) => ({
              menu_item_id: i.menu_item_id || i.id,
              quantity: i.quantity,
              variant_id: i.variant_id || null,
              selected_modifiers: i.selected_modifiers || [],
              modifier_total: i.modifier_total || 0,
            })),
            total,
          });
          setOfferPreview(data);
        } catch (err) {
          // No longer eligible — strip silently and let the auto path take over
          setCouponApplied(false);
          setCouponInput('');
          setOfferPreview(null);
          toast(err?.response?.data?.message || 'Coupon removed — no longer eligible', { icon: '⚠️' });
        }
      }, 500);
      return () => clearTimeout(offerDebounce.current);
    }

    if (!items.length) { setOfferPreview(null); prevAutoOfferRef.current = null; return; }
    clearTimeout(offerDebounce.current);
    offerDebounce.current = setTimeout(async () => {
      try {
        const payload = {
          items: items.map((i) => ({
            menu_item_id: i.menu_item_id || i.id,
            quantity: i.quantity,
            variant_id: i.variant_id || null,
            selected_modifiers: i.selected_modifiers || [],
            modifier_total: i.modifier_total || 0,
          })),
          total,
          customer_phone: previewPhone || undefined,
        };
        const { data } = await previewOffer(slug, payload);
        setOfferPreview(data);
        // Toast when an auto-applied offer disappears because the cart shrank
        const wasApplied = prevAutoOfferRef.current;
        const nowApplied = data?.applied ? data.offer_name : null;
        if (wasApplied && !nowApplied) {
          toast(`Offer removed: "${wasApplied}" no longer eligible`, { icon: '⚠️', duration: 4000 });
        }
        prevAutoOfferRef.current = nowApplied;
      } catch {
        setOfferPreview(null);
      }
    }, 500);
    return () => clearTimeout(offerDebounce.current);
  }, [slug, total, items, couponApplied, previewPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // (handleApplyCoupon was removed — coupon application is now inline in the
  //  OffersPanel's onApplyCode callback, triggered by tapping a specific offer.)

  const handleRemoveCoupon = () => {
    setCouponInput('');
    setCouponApplied(false);
    setOfferPreview(null);
  };

  if (!session || !['dine-in', 'takeaway', 'delivery'].includes(session.order_type)) return <Navigate to={`/cafe/${slug}`} replace />;

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto bg-white min-h-screen">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
            ← Back
          </button>
          <h1 className="font-bold text-lg">Your Cart</h1>
        </div>
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-3">🛒</div>
          <p>Your cart is empty</p>
          <button onClick={() => navigate(`/cafe/${slug}/menu`)} className="btn-primary mt-4">
            Browse Menu
          </button>
        </div>
      </div>
    );
  }

  const handlePlaceOrder = async () => {
    if (submittingRef.current) return;
    setOrderError(null);
    // Validate delivery form before locking — errors should be retryable
    if (isDelivery) {
      if (!deliveryForm.delivery_address.trim()) { toast.error('Please enter your delivery address'); return; }
      if (!deliveryForm.delivery_phone.trim())   { toast.error('Please enter your phone number for delivery'); return; }
      if (deliveryMinOrder > 0 && total < deliveryMinOrder) {
        toast.error(`Minimum order for delivery is ${c(deliveryMinOrder)}`);
        return;
      }
    }
    submittingRef.current = true;
    setLoading(true);
    setSlowNetwork(false);
    setShowConfirm(false);
    // Show "Still connecting…" hint after 5 s so users don't rage-refresh
    slowNetworkTimer.current = setTimeout(() => setSlowNetwork(true), 5000);

    const orderPayload = {
      customer_name:  session.customer_name,
      customer_phone: session.customer_phone || undefined,
      table_number:   session.table_number,
      order_type:     session.order_type || 'dine-in',
      notes:          notes.trim() || undefined,
      tip_amount:     tip || undefined,
      // Stable per-attempt key — retries send the same UUID, backend deduplicates
      client_order_id: orderIdRef.current,
      // Trust check: backend rejects if its computed total drifts > ₹1 from this.
      // Customer is never charged a different amount than what they tapped.
      client_quoted_total: grandTotal,
      coupon_code: couponApplied ? couponInput.trim() : null,
      ...(session.reservation_id && { reservation_id: session.reservation_id }),
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id || i.id,
        quantity: i.quantity,
        variant_id: i.variant_id || null,
        variant_name: i.variant_name || null,
        selected_modifiers: i.selected_modifiers || [],
        modifier_total: i.modifier_total || 0,
      })),
      ...(isDelivery && {
        delivery_address:      deliveryForm.delivery_address.trim(),
        delivery_address2:     deliveryForm.delivery_address2.trim() || undefined,
        delivery_city:         deliveryForm.delivery_city.trim() || undefined,
        delivery_zipcode:      deliveryForm.delivery_zipcode.trim() || undefined,
        delivery_phone:        deliveryForm.delivery_phone.trim(),
        delivery_instructions: deliveryForm.delivery_instructions.trim() || undefined,
      }),
    };

    // Auto-retry with exponential backoff (network-error only). Same client_order_id
    // each attempt so the backend dedups and we can never create a duplicate order.
    const MAX_ATTEMPTS = 3;
    const BACKOFF_MS   = [0, 2000, 4000]; // delay before each attempt
    let lastErr = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      setSubmitAttempt(attempt + 1);
      if (BACKOFF_MS[attempt]) {
        setSlowNetwork(true); // visual: still trying…
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
      try {
        const { data } = await placeOrder(slug, orderPayload);
        if (data?.order) {
          upsertOrder(slug, data.order);
          clearCart();
          // Reset table_number + area_id for next order so customer doesn't accidentally
          // place at the wrong table; keep customer_name/phone for convenience.
          try {
            const sk = `session_${slug}`;
            const cur = JSON.parse(localStorage.getItem(sk) || '{}');
            localStorage.setItem(sk, JSON.stringify({
              ...cur, table_number: '', area_id: '', reservation_id: undefined,
            }));
          } catch { /* ignore parse errors */ }
          // Rotate UUID so the next order gets a fresh idempotency key
          const nextId = crypto.randomUUID();
          sessionStorage.setItem(`dv_order_id_${slug}`, nextId);
          orderIdRef.current = nextId;
          clearTimeout(slowNetworkTimer.current);
          setSlowNetwork(false);
          setSubmitAttempt(0);
          setLoading(false);
          submittingRef.current = false;
          navigate(`/cafe/${slug}/confirmation`, { state: { order: data.order } });
          return;
        }
        // Server returned 200 but no order body — treat as transient error
        lastErr = new Error('Empty response');
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        // Don't retry on validation/auth/business errors (4xx). Only retry on
        // network failures (no response) or 5xx server errors.
        if (status && status < 500 && status !== 408 && status !== 425 && status !== 429) break;
      }
    }

    // All attempts failed
    clearTimeout(slowNetworkTimer.current);
    setSlowNetwork(false);
    setSubmitAttempt(0);
    setLoading(false);
    submittingRef.current = false;
    const isNetworkErr = !lastErr?.response;
    const msg = isNetworkErr
      ? 'Connection issue — your order is safe. Tap "Place Order" again to confirm; we won\'t create a duplicate.'
      : getApiError(lastErr);
    toast.error(msg, { duration: isNetworkErr ? 7000 : 4000 });
    setOrderError(msg);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white min-h-screen pb-44">
      <div className="sticky top-0 bg-white z-10 border-b border-gray-100">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-sm">
            ← Back
          </button>
          <h1 className="font-bold text-lg flex-1">Your Cart</h1>
          {activeOrders.length > 0 && (
            <button
              onClick={() => navigate(`/cafe/${slug}/confirmation`)}
              className="flex items-center gap-1 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1.5 rounded-lg"
            >
              📋 <span>{activeOrders.length} order{activeOrders.length !== 1 ? 's' : ''}</span>
            </button>
          )}
        </div>
        {/* Ordering-for strip */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span>{session.order_type === 'takeaway' ? '🥡' : session.order_type === 'delivery' ? '🛵' : '🍽️'}</span>
            <span className="font-medium">{session.table_number || session.order_type}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">{session.customer_name}</span>
          </div>
          <button
            onClick={() => {
              setTableForm({
                order_type:   session?.order_type || 'dine-in',
                table_number: session?.order_type === 'dine-in' ? (session?.table_number || '') : '',
                area_id:      session?.area_id || '',
              });
              setShowTableModal(true);
            }}
            className="text-xs text-brand-600 font-medium hover:underline"
          >
            Change
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-3">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
              <div className="text-xs text-gray-400 mt-1 space-y-1">
                <p>{c(parseFloat(item.price))} each</p>
                {item.variant_name && <p>Variant: {item.variant_name}</p>}
                {item.selected_modifiers?.length > 0 && (
                  <p>
                    Add-ons: {item.selected_modifiers.map((mod) => mod.option_name || mod.group_name).join(', ')}
                  </p>
                )}
              </div>
            </div>
            <QuantityControl
              qty={item.quantity}
              onDecrement={() => updateQty(item.id, item.quantity - 1)}
              onIncrement={() => updateQty(item.id, item.quantity + 1)}
            />
            <span className="font-bold text-sm w-16 text-right">
              {c(parseFloat(item.price) * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      {/* Upsell suggestions */}
      {suggestions.length > 0 && (
        <div className="px-4 mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customers also ordered</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => addItem({ id: s.id, menu_item_id: s.id, name: s.name, price: s.price, image_url: s.image_url })}
                className="flex-shrink-0 w-28 bg-white border border-gray-100 rounded-xl p-2 text-left hover:border-brand-300 transition-colors shadow-sm"
              >
                {s.image_url ? (
                  <img src={s.image_url} alt={s.name} className="w-full h-14 object-cover rounded-lg mb-1.5" />
                ) : (
                  <div className="w-full h-14 bg-gray-100 rounded-lg mb-1.5 flex items-center justify-center text-2xl">🍽️</div>
                )}
                <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight">{s.name}</p>
                <p className="text-xs text-brand-600 font-bold mt-0.5">{c(parseFloat(s.price))}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Min-order progress bar (delivery only) */}
      {isDelivery && deliveryMinOrder > 0 && total < deliveryMinOrder && (
        <div className="mx-4 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex justify-between text-xs text-amber-700 font-medium mb-1.5">
            <span>Min. order for delivery: {c(deliveryMinOrder)}</span>
            <span>Add {c(deliveryMinOrder - total)} more</span>
          </div>
          <div className="w-full bg-amber-100 rounded-full h-2">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min((total / deliveryMinOrder) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Delivery address form — only for delivery orders */}
      {isDelivery && (
        <div className="px-4 mt-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🛵</span>
            <h3 className="font-semibold text-gray-800">Delivery Details</h3>
          </div>
          {deliveryEstMins > 0 && (
            <p className="text-xs text-gray-500">Estimated delivery: ~{deliveryEstMins} min</p>
          )}
          {deliveryMinOrder > 0 && (
            <div className={`rounded-xl px-3 py-2.5 text-xs font-medium flex items-center justify-between ${
              total >= deliveryMinOrder
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <span>Min. order for delivery: {c(deliveryMinOrder)}</span>
              {total < deliveryMinOrder
                ? <span className="font-bold">Add {c(deliveryMinOrder - total)} more</span>
                : <span>✓ Met</span>}
            </div>
          )}
          <input
            className="input"
            placeholder="Street address *"
            value={deliveryForm.delivery_address}
            onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_address: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Apartment, floor, landmark (optional)"
            value={deliveryForm.delivery_address2}
            onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_address2: e.target.value }))}
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input flex-1"
              placeholder="City"
              value={deliveryForm.delivery_city}
              onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_city: e.target.value }))}
            />
            <input
              className="input sm:w-32"
              placeholder="Pincode"
              value={deliveryForm.delivery_zipcode}
              onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_zipcode: e.target.value }))}
            />
          </div>
          <input
            className="input"
            placeholder="Phone for delivery *"
            type="tel"
            value={deliveryForm.delivery_phone}
            onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_phone: e.target.value }))}
          />
          <input
            className="input"
            placeholder="Delivery instructions (optional)"
            value={deliveryForm.delivery_instructions}
            onChange={(e) => setDeliveryForm((f) => ({ ...f, delivery_instructions: e.target.value }))}
          />
        </div>
      )}

      <div className="px-4 mt-4">
        <label className="label">Special Instructions (optional)</label>
        <textarea
          className="input resize-none"
          rows={2}
          placeholder="e.g. No sugar, extra spicy..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Offers panel — Zomato/Swiggy-style. Auto-applies when threshold met,
          tap-to-apply for coded offers. Min order is checked against pre-tax total. */}
      <OffersPanel
        offers={allOffers}
        total={total}
        offerPreview={offerPreview}
        couponApplied={couponApplied}
        couponLoading={couponLoading}
        appliedCode={couponInput}
        currencyFmt={c}
        onApplyCode={async (code) => {
          if (!code) return;
          setCouponInput(code);
          setCouponLoading(true);
          try {
            const { data } = await validateCoupon(slug, {
              coupon_code: code,
              items: items.map((i) => ({
                menu_item_id: i.menu_item_id || i.id,
                quantity: i.quantity,
                variant_id: i.variant_id || null,
                selected_modifiers: i.selected_modifiers || [],
                modifier_total: i.modifier_total || 0,
              })),
              total,
            });
            setOfferPreview(data);
            setCouponApplied(true);
            toast.success(`Coupon applied — you save ${c(data.discount_amount)}`);
          } catch (err) {
            setCouponInput('');
            setCouponApplied(false);
            toast.error(err?.response?.data?.message || 'Coupon could not be applied');
          } finally {
            setCouponLoading(false);
          }
        }}
        onRemove={handleRemoveCoupon}
      />

      <div className="mx-4 mt-4 bg-gray-50 rounded-xl p-4">
        <h3 className="font-semibold text-gray-800 mb-3">Bill Summary</h3>
        <div className="space-y-1 text-sm">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-gray-600">
              <span>{item.name} × {item.quantity}</span>
              <span>{c(parseFloat(item.price) * item.quantity)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-200 mt-4 pt-4 space-y-3 text-sm">
          {hasGst && (
            <div className="rounded-2xl bg-white border border-gray-200 p-3">
              <p className="text-xs uppercase tracking-[0.18em] font-semibold text-gray-500 mb-3">
                {taxInclusive
                  ? 'GST included in menu prices'
                  : 'GST is calculated on your subtotal'}
              </p>
              {taxInclusive ? (
                <>
                  <div className="flex justify-between text-gray-500">
                    <span>Base amount</span>
                    <span>{c(taxableAmt)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>CGST ({(gstRate / 2).toFixed(1)}%)</span>
                    <span>{c(totalTax / 2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>SGST ({(gstRate / 2).toFixed(1)}%)</span>
                    <span>{c(totalTax / 2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-700 font-medium border-t border-gray-100 pt-3">
                    <span>Total item price</span>
                    <span>{c(total)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>{c(total)}</span>
                  </div>
                  {discountAmt > 0 && (
                    <div className="flex justify-between text-green-600 font-medium">
                      <span>Discount</span>
                      <span>-{c(discountAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-500">
                    <span>CGST ({(gstRate / 2).toFixed(1)}%)</span>
                    <span>{c(totalTax / 2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>SGST ({(gstRate / 2).toFixed(1)}%)</span>
                    <span>{c(totalTax / 2)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {!hasGst && (
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{c(total)}</span>
            </div>
          )}

          {offerPreview?.applied && discountAmt > 0 && (!hasGst || taxInclusive) && (
            <div className="flex justify-between text-green-600 font-medium">
              <span>🎉 {offerPreview.offer_name || 'Offer applied'}</span>
              <span>-{c(discountAmt)}</span>
            </div>
          )}

          {tip > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Tip</span>
              <span>{c(tip)}</span>
            </div>
          )}

          {isDelivery && (
            <div className="flex justify-between text-gray-600">
              <span>🛵 Delivery fee</span>
              <span>{deliveryFeeBase > 0 ? c(deliveryFeeBase) : 'Free'}</span>
            </div>
          )}

          {platformFee > 0 && (
            <div className="flex justify-between text-gray-500">
              <span className="flex items-center gap-1">
                Platform charge ({platformFeeRate}%)
                <span className="text-[10px] bg-gray-100 text-gray-400 rounded px-1">DineVerse</span>
              </span>
              <span>{c(platformFee)}</span>
            </div>
          )}

          <div className="flex justify-between items-center font-bold text-gray-900 pt-3 border-t border-gray-200">
            <span className="text-base">Total amount due</span>
            <span className="text-base">{c(grandTotal)}</span>
          </div>
        </div>
      </div>

      <div className="mx-4 mt-3 bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2.5">Add a tip? 🙏</p>
        <div className="flex gap-2 flex-wrap">
          {TIP_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTip(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                tip === t
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
              }`}
            >
              {t === 0 ? 'No tip' : c(t)}
            </button>
          ))}
          <input
            type="number"
            min="0"
            placeholder="Custom"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-24 focus:border-brand-400 outline-none"
            value={tip > 0 && !TIP_OPTIONS.includes(tip) ? tip : ''}
            onChange={(e) => setTip(Math.max(0, parseFloat(e.target.value) || 0))}
          />
        </div>
      </div>

      <div className="fixed bottom-[60px] left-0 right-0 bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-2">
          {!cafeOpen && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
              🔴 This café is currently closed — orders cannot be placed right now.
            </div>
          )}
          {orderError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 space-y-2">
              <p>⚠️ {orderError}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePlaceOrder}
                  disabled={loading}
                  className="font-semibold underline disabled:opacity-50"
                >
                  Try again
                </button>
                <button
                  onClick={() => navigate(`/cafe/${slug}/my-orders`)}
                  className="font-semibold underline text-teal-700"
                >
                  Check My Orders →
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => {
              // Validate delivery form before opening confirm modal so errors show inline
              if (isDelivery) {
                if (!deliveryForm.delivery_address.trim()) { toast.error('Please enter your delivery address'); return; }
                if (!deliveryForm.delivery_phone.trim())   { toast.error('Please enter your phone number for delivery'); return; }
              }
              setShowConfirm(true);
            }}
            disabled={loading || !cafeOpen || (isDelivery && deliveryMinOrder > 0 && total < deliveryMinOrder)}
            className="btn-primary w-full flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
            title={!cafeOpen ? 'This café is currently closed' : undefined}
          >
            <span>
              {slowNetwork && submitAttempt > 1
                ? `Reconnecting… (${submitAttempt}/3)`
                : slowNetwork
                ? 'Still connecting…'
                : loading
                ? 'Placing order…'
                : 'Place Order'}
            </span>
            <span>{c(grandTotal)}</span>
          </button>
        </div>
      </div>

      {/* Table / order-type re-confirm modal — shown when previous orders are all paid */}
      {showTableModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-brand-500 rounded-t-2xl" />
            <div className="p-5 space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">🍽️</span>
                </div>
                <h3 className="font-bold text-gray-900 text-lg">New Order?</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Your previous order was paid. Please confirm where you're sitting for this new order.
                </p>
              </div>

              {/* Order type selector */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Order Type</label>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                  {[
                    { key: 'dine-in',  label: '🍽️ Dine In' },
                    { key: 'takeaway', label: '🥡 Takeaway' },
                    { key: 'delivery', label: '🛵 Delivery' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTableForm((f) => ({ ...f, order_type: key, table_number: '' }))}
                      className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                        tableForm.order_type === key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {tableForm.order_type === 'dine-in' && tableAreas.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Area</label>
                  <select
                    className="input"
                    value={tableForm.area_id}
                    onChange={(e) => setTableForm((f) => ({ ...f, area_id: e.target.value, table_number: '' }))}
                  >
                    <option value="">All areas</option>
                    {tableAreas.map((area) => (
                      <option key={area.id} value={area.id}>{area.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {tableForm.order_type === 'dine-in' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Table Number</label>
                  <div className="relative">
                    <input
                      ref={tableInputRef}
                      type="text"
                      className="input"
                      placeholder="e.g. 5 or Table 5"
                      value={tableForm.table_number}
                      autoComplete="off"
                      onChange={(e) => {
                        setTableForm((f) => ({ ...f, table_number: e.target.value }));
                        setTableDropOpen(true);
                      }}
                      onFocus={() => setTableDropOpen(true)}
                      onBlur={() => setTimeout(() => setTableDropOpen(false), 150)}
                    />
                    {/* Suggestions from fetched tables */}
                    {tableDropOpen && tableSuggestions.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-64">
                        {tableSuggestions.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setTableForm((f) => ({ ...f, table_number: t.label, area_id: String(t.area_id) }));
                              setTableDropOpen(false);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-brand-50 flex items-center justify-between"
                          >
                            <span className="font-medium text-gray-800">{t.label}</span>
                            {t.area_name && t.area_name !== 'General' && (
                              <span className="text-xs text-gray-400">{t.area_name}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tableForm.order_type === 'takeaway' && (
                <p className="text-xs text-gray-500 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                  Your order will be ready for pickup at the counter.
                </p>
              )}

              {tableForm.order_type === 'delivery' && (
                <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  Delivery details will be collected in the cart before checkout.
                </p>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={handleConfirmTable}
                  className="btn-primary w-full py-3"
                >
                  Confirm & Continue
                </button>
                <button
                  onClick={() => navigate(`/cafe/${slug}`)}
                  className="btn-secondary w-full py-3"
                >
                  Back to Entry
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6"
          onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-brand-500 rounded-t-2xl" />

            <div className="p-5 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">🔔</span>
                </div>
                <h3 className="font-bold text-gray-900 text-lg">Confirm Your Order?</h3>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                  Once the café confirms your order,{' '}
                  <span className="font-semibold text-gray-800">it cannot be modified or cancelled.</span>
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800">Ordering more later?</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  You can place another order anytime — it'll reach the kitchen separately and
                  be included in your table's final bill.
                </p>
              </div>

              {session.cafe_name && (
                <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                  <span className="text-green-600 text-lg">🔒</span>
                  <div className="text-center">
                    <p className="text-xs text-green-700">Payment goes to</p>
                    <p className="text-sm font-bold text-green-900">{session.cafe_name}</p>
                  </div>
                </div>
              )}

              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                  <span>{session.table_number || session.order_type}</span>
                </div>
                {hasGst && (
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>GST ({gstRate}%)</span>
                    <span>{taxInclusive ? 'included' : `+${c(totalTax)}`}</span>
                  </div>
                )}
                {discountAmt > 0 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Discount</span>
                    <span>-{c(discountAmt)}</span>
                  </div>
                )}
                {tip > 0 && (
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Tip</span>
                    <span>{c(tip)}</span>
                  </div>
                )}
                {isDelivery && deliveryFeeBase > 0 && (
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Delivery fee</span>
                    <span>{c(deliveryFeeBase)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
                  <span>Total</span>
                  <span>{c(grandTotal)}</span>
                </div>
              </div>

              <p className="text-center text-xs text-gray-400 leading-relaxed">
                By placing this order you agree to the café's service terms.
                See DineVerse{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">Terms</a>
                {' & '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">Privacy Policy</a>.
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={handlePlaceOrder}
                  disabled={loading}
                  className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {slowNetwork && submitAttempt > 1
                    ? `Reconnecting… (${submitAttempt}/3)`
                    : slowNetwork ? 'Still connecting…'
                    : loading ? 'Placing…'
                    : 'Yes, Place Order'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="btn-secondary w-full py-3"
                >
                  Review Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// OffersPanel — Zomato/Swiggy-style "Offers for you" section.
//
// Logic:
//   • Currently applied offer (auto OR coupon) shows at the top with
//     "Applied · Remove" and the savings amount.
//   • Coupon-coded offers visible to the customer with their code; tap
//     "Apply" to use that specific code (becomes the manual coupon).
//   • Codeless offers show a "Auto-applied when ₹X" hint or, if eligible,
//     a "Best offer" badge confirming the auto path will pick it.
//   • Locked offers (min_order not met) show progress: "Add ₹X more".
//   • Combo offers point the customer back to the menu's Deals tab.
// ────────────────────────────────────────────────────────────────────
function OffersPanel({ offers, total, offerPreview, couponApplied, couponLoading, appliedCode, currencyFmt, onApplyCode, onRemove }) {
  const c = currencyFmt;
  const orderTotal = parseFloat(total) || 0;

  // Currently applied offer (matches by name+funded_by — backend returns these)
  const appliedName = offerPreview?.applied ? offerPreview.offer_name : null;
  const appliedFundedBy = offerPreview?.applied ? offerPreview.funded_by : null;
  const appliedDiscount = parseFloat(offerPreview?.discount_amount || 0);

  // Group offers
  const visibleOffers = (offers || []).filter((o) => o.offer_type !== 'combo');
  const comboCount = (offers || []).filter((o) => o.offer_type === 'combo').length;

  const isApplied = (o) =>
    appliedName && o.name === appliedName && (o.funded_by || 'owner') === (appliedFundedBy || 'owner');

  const offerLabel = (o) => {
    if (o.offer_type === 'percentage')   return `${parseFloat(o.discount_value)}% OFF`;
    if (o.offer_type === 'fixed')        return `${c(o.discount_value)} OFF`;
    if (o.offer_type === 'first_order')  return `${parseFloat(o.discount_value)}% OFF · First order`;
    if (o.offer_type === 'bogo')         return 'Buy 2 Get 1 Free';
    return 'Offer';
  };

  const minNeeded = (o) => Math.max(0, parseFloat(o.min_order_amount || 0) - orderTotal);

  return (
    <div className="mx-4 mt-4">
      {/* Applied banner — sticky on top so customer always sees the discount */}
      {appliedName && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 border-2 mb-3 ${
          appliedFundedBy === 'platform' ? 'bg-purple-50 border-purple-300' : 'bg-green-50 border-green-300'
        }`}>
          <span className="text-xl">{appliedFundedBy === 'platform' ? '⚡' : '✓'}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold truncate ${appliedFundedBy === 'platform' ? 'text-purple-800' : 'text-green-800'}`}>
              {appliedName} {couponApplied && appliedCode ? `· ${appliedCode}` : ''}
            </p>
            <p className={`text-xs ${appliedFundedBy === 'platform' ? 'text-purple-600' : 'text-green-600'}`}>
              You saved {c(appliedDiscount)}{appliedFundedBy === 'platform' ? ' · DineVerse offer' : ''}
            </p>
          </div>
          <button onClick={onRemove} className="text-xs font-semibold text-gray-500 hover:text-red-500 px-2 py-1">Remove</button>
        </div>
      )}

      {/* Offers list */}
      {visibleOffers.length === 0 && comboCount === 0 ? null : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-orange-50 via-yellow-50 to-orange-50 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">🎉 Offers for you</h3>
            <span className="text-[10px] font-bold uppercase tracking-wide text-orange-600">
              {visibleOffers.length}{comboCount > 0 ? ` + ${comboCount} combos` : ''}
            </span>
          </div>

          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {visibleOffers.map((o) => {
              const applied  = isApplied(o);
              const eligible = orderTotal >= parseFloat(o.min_order_amount || 0);
              const hasCode  = !!o.coupon_code;
              const platform = o.funded_by === 'platform';
              const need     = minNeeded(o);

              return (
                <div key={o.id} className={`px-4 py-3 flex items-start gap-3 ${applied ? 'bg-green-50/50' : ''}`}>
                  <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-lg ${
                    platform ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'
                  }`}>
                    {platform ? '⚡' : (o.offer_type === 'first_order' ? '🥇' : o.offer_type === 'bogo' ? '🎁' : '🏷️')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs font-black uppercase ${platform ? 'text-purple-700' : 'text-orange-700'}`}>
                        {offerLabel(o)}
                      </span>
                      {o.max_discount_amount && (
                        <span className="text-[10px] text-gray-400 font-medium">up to {c(o.max_discount_amount)}</span>
                      )}
                      {platform && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-1.5 rounded">DineVerse</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{o.name}</p>
                    {o.description && (
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{o.description}</p>
                    )}

                    {/* Status row */}
                    <div className="mt-1.5 text-[11px]">
                      {applied ? (
                        <span className="text-green-700 font-bold">✓ Applied</span>
                      ) : !eligible ? (
                        <div className="flex items-center gap-1 text-amber-700 font-medium">
                          🔒 Add {c(need)} more to use this
                        </div>
                      ) : hasCode ? (
                        <span className="text-gray-500">Tap "Apply" to use code <span className="font-mono font-bold">{o.coupon_code}</span></span>
                      ) : (
                        <span className="text-gray-500">
                          Auto-applied — {parseFloat(o.min_order_amount || 0) > 0
                            ? `min order ${c(o.min_order_amount)}`
                            : 'no minimum'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action button */}
                  <div className="flex-shrink-0 self-center">
                    {applied ? (
                      <span className="inline-block text-[10px] font-bold text-green-700 bg-green-100 px-2 py-1 rounded-md">APPLIED</span>
                    ) : !eligible ? (
                      <span className="inline-block text-[10px] font-medium text-gray-400">—</span>
                    ) : hasCode ? (
                      <button
                        onClick={() => onApplyCode(o.coupon_code)}
                        disabled={couponLoading || couponApplied}
                        className="text-xs font-bold text-orange-600 hover:text-orange-700 border border-orange-300 rounded-lg px-3 py-1.5 hover:bg-orange-50 disabled:opacity-40 transition-colors"
                      >
                        {couponLoading ? '…' : 'Apply'}
                      </button>
                    ) : (
                      <span className="inline-block text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-md">AUTO</span>
                    )}
                  </div>
                </div>
              );
            })}

            {comboCount > 0 && (
              <div className="px-4 py-3 bg-gray-50 text-center">
                <p className="text-xs text-gray-500">
                  🎁 {comboCount} combo deal{comboCount !== 1 ? 's' : ''} available — see them in the menu
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
