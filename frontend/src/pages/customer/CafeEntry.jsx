import { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getCafeBySlug, getCafeTables, createReservation, joinWaitlist, getWaitlistPosition } from '../../services/api';
import { loadOrders } from '../../utils/cafeOrderStorage';
import { loadReservations, upsertReservation, removeReservation } from '../../utils/cafeReservationStorage';
import { getScheduleStatus, getTodayHours } from '../../utils/scheduleUtils';
import { fmtCurrency } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import PhoneInput from '../../components/PhoneInput';
import toast from 'react-hot-toast';

const RESERVATION_STATUS = {
  pending:   { label: 'Pending Confirmation', color: 'bg-yellow-100 text-yellow-800', icon: '⏳' },
  confirmed: { label: 'Confirmed!',           color: 'bg-green-100 text-green-800',  icon: '✅' },
  cancelled: { label: 'Cancelled',            color: 'bg-red-100 text-red-800',      icon: '❌' },
  completed: { label: 'Completed',            color: 'bg-gray-100 text-gray-600',    icon: '🍽️' },
  no_show:   { label: 'Expired / No-show',    color: 'bg-gray-100 text-gray-500',    icon: '🕐' },
};

function parseNameStyle(raw) {
  if (!raw || raw === 'normal') return {};
  if (raw === 'bold')        return { fontWeight: 'bold' };
  if (raw === 'italic')      return { fontStyle: 'italic' };
  if (raw === 'bold-italic') return { fontWeight: 'bold', fontStyle: 'italic' };
  try {
    const obj = JSON.parse(raw);
    return {
      ...(obj.fontFamily && obj.fontFamily !== 'inherit' ? { fontFamily: obj.fontFamily } : {}),
      ...(obj.fontSize ? { fontSize: obj.fontSize + 'px' } : {}),
      ...(obj.bold  ? { fontWeight: 'bold' }   : {}),
      ...(obj.italic ? { fontStyle: 'italic' } : {}),
    };
  } catch { return {}; }
}

// Returns today as YYYY-MM-DD and current time as HH:MM (local)
function nowParts() {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

// Map DB business_type → Schema.org @type
const SCHEMA_TYPE = {
  restaurant:    'Restaurant',
  cafe:          'CafeOrCoffeeShop',
  coffee_shop:   'CafeOrCoffeeShop',
  bakery:        'Bakery',
  bar:           'BarOrPub',
  food_truck:    'FoodEstablishment',
};

// Convert opening_hours JSONB { mon: { open, close, closed }, … } → Schema.org strings
// e.g. "Mo-Fr 09:00-21:00"
function hoursToSchema(hours) {
  if (!hours || typeof hours !== 'object') return [];
  const DAY = { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' };
  return Object.entries(hours)
    .filter(([, v]) => !v?.closed && v?.open && v?.close)
    .map(([day, v]) => `${DAY[day] || day} ${v.open}-${v.close}`);
}

function CafeSeoHead({ cafe, slug }) {
  const pageUrl     = `https://www.dine-verse.com/.cafe/${slug}`;
  const title       = `${cafe.name} — Order Online | DineVerse`;
  const description = cafe.description
    ? `${cafe.description.slice(0, 140)}…`
    : `Order food from ${cafe.name}${cafe.city ? ` in ${cafe.city}` : ''}. Place your order online via DineVerse.`;
  const image = cafe.cover_image_url || cafe.logo_url || 'https://www.dine-verse.com/.preview.png';

  const schemaType = SCHEMA_TYPE[cafe.business_type] || 'FoodEstablishment';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    schemaType,
    name:       cafe.name,
    url:        pageUrl,
    ...(image !== 'https://www.dine-verse.com/.preview.png' && { image }),
    ...(cafe.phone     && { telephone: cafe.phone }),
    ...(cafe.address   && {
      address: {
        '@type':         'PostalAddress',
        streetAddress:   cafe.address,
        ...(cafe.city   && { addressLocality: cafe.city }),
        addressCountry:  cafe.country || 'IN',
      },
    }),
    ...(cafe.latitude && cafe.longitude && {
      geo: {
        '@type':    'GeoCoordinates',
        latitude:   parseFloat(cafe.latitude),
        longitude:  parseFloat(cafe.longitude),
      },
    }),
    ...(cafe.avg_rating && parseInt(cafe.rating_count) > 0 && {
      aggregateRating: {
        '@type':       'AggregateRating',
        ratingValue:   String(cafe.avg_rating),
        reviewCount:   String(cafe.rating_count),
        bestRating:    '5',
        worstRating:   '1',
      },
    }),
    hasMenu: `${pageUrl}/menu`,
    menu:    `${pageUrl}/menu`,
    ...(cafe.opening_hours && {
      openingHours: hoursToSchema(
        typeof cafe.opening_hours === 'string'
          ? JSON.parse(cafe.opening_hours)
          : cafe.opening_hours
      ),
    }),
    servesCuisine: 'Indian',
    potentialAction: {
      '@type':  'ViewAction',
      target:   pageUrl,
    },
  };

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={pageUrl} />

      {/* Open Graph */}
      <meta property="og:type"        content="restaurant" />
      <meta property="og:url"         content={pageUrl} />
      <meta property="og:title"       content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image"       content={image} />
      <meta property="og:site_name"   content="DineVerse" />

      {/* Twitter */}
      <meta name="twitter:card"        content="summary_large_image" />
      <meta name="twitter:title"       content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image"       content={image} />

      {/* JSON-LD structured data */}
      <script type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </script>
    </Helmet>
  );
}

export default function CafeEntry() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [cafe, setCafe]           = useState(null);
  const [areas, setAreas]         = useState([]);
  const [hasTables, setHasTables] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [showReserve, setShowReserve]   = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [myBookings, setMyBookings] = useState([]);
  const socketRef = useRef(null);

  const tableFromUrl = searchParams.get('table') || '';
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem(`session_${slug}`);
      const base = saved
        ? JSON.parse(saved)
        : { customer_name: '', customer_phone: '', area_id: '', table_id: '', table_number: '', order_type: 'dine-in' };
      // QR table param always wins over stale session value
      if (tableFromUrl) base.table_number = tableFromUrl;
      return base;
    } catch {
      return { customer_name: '', customer_phone: '', area_id: '', table_id: '', table_number: tableFromUrl, order_type: 'dine-in' };
    }
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const { date, time } = nowParts();
    Promise.all([getCafeBySlug(slug), getCafeTables(slug, { date, time })])
      .then(([cafeRes, tablesRes]) => {
        setCafe(cafeRes.data.cafe);
        setAreas(tablesRes.data.areas || []);
        setHasTables(tablesRes.data.has_tables || false);
      })
      .catch(() => setCafe(null))
      .finally(() => setLoading(false));

    // Load stored bookings for this cafe
    setMyBookings(loadReservations(slug));

    // Connect socket to track reservation status updates
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
    });
    socketRef.current = socket;

    const stored = loadReservations(slug);
    stored.forEach((r) => socket.emit('track_reservation', r.id));

    socket.on('connect', () => {
      socket.emit('join_menu', slug);
      loadReservations(slug).forEach((r) => socket.emit('track_reservation', r.id));
    });
    socket.emit('join_menu', slug);

    socket.on('cafe_status', ({ is_open }) => {
      setCafe((prev) => prev ? { ...prev, is_open } : prev);
    });

    socket.on('reservation_updated', (updated) => {
      upsertReservation(slug, updated);
      setMyBookings(loadReservations(slug));
      if (updated.status === 'confirmed') {
        toast.success('Your table reservation has been confirmed! ✅', { duration: 6000 });
      } else if (updated.status === 'cancelled') {
        toast.error('Your reservation was cancelled by the café.', { duration: 6000 });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [slug]);

  // Normalize table number: "5" → "Table 5", "T5" → "Table 5", already "Table 5" → unchanged
  const normalizeTableNumber = (raw, areaName) => {
    const t = raw.trim();
    if (!t) return t;
    // If purely numeric or "T<number>", prefix with "Table "
    const normalized = /^\d+$/.test(t) ? `Table ${t}`
      : /^t\d+$/i.test(t) ? `Table ${t.slice(1)}`
      : t;
    // Prepend area name if area is set and not already included
    if (areaName && areaName !== 'General' && !normalized.startsWith(areaName)) {
      return `${areaName} — ${normalized}`;
    }
    return normalized;
  };

  const validate = () => {
    const e = {};
    if (!form.customer_name.trim()) e.customer_name = 'Please enter your name';
    if (!form.customer_phone?.trim()) e.customer_phone = 'Please enter your mobile number';
    if (form.order_type === 'dine-in') {
      if (!form.table_number.trim()) e.table_number = 'Please enter your table number';
    }
    // delivery: address is collected at CartPage — no table needed here
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const selectedArea = areas.find((a) => String(a.id) === String(form.area_id));
    const tableLabel = normalizeTableNumber(form.table_number, selectedArea?.name);

    const session = {
      customer_name:  form.customer_name.trim(),
      customer_phone: form.customer_phone || '',
      table_number:   form.order_type === 'takeaway' ? 'Takeaway' : form.order_type === 'delivery' ? 'Delivery' : tableLabel,
      order_type:     form.order_type,
      cafe_name:      cafe?.name || '',
      currency:       cafe?.currency || 'INR',
      // GST + delivery config forwarded to CartPage
      gst_rate:         cafe?.gst_rate,
      gst_number:       cafe?.gst_number,
      tax_inclusive:    cafe?.tax_inclusive,
      is_open:          cafe?.is_open,
      delivery_enabled:   cafe?.delivery_enabled,
      delivery_fee_base:  cafe?.delivery_fee_base,
      delivery_fee_per_km: cafe?.delivery_fee_per_km,
      delivery_min_order: cafe?.delivery_min_order,
      delivery_est_mins:  cafe?.delivery_est_mins,
      delivery_radius_km: cafe?.delivery_radius_km,
    };
    localStorage.setItem(`session_${slug}`, JSON.stringify(session));
    navigate(`/cafe/${slug}/menu`);
  };

  const activeOrders  = loadOrders(slug).filter((o) => !['paid', 'cancelled'].includes(o.status));
  const hasAnyHistory = loadOrders(slug).length > 0 || loadReservations(slug).length > 0;

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4 animate-pulse">
        <div className="h-20 w-20 rounded-2xl bg-white/60 mx-auto" />
        <div className="h-6 rounded-lg bg-white/60 w-40 mx-auto" />
        <div className="card shadow-lg space-y-3">
          <div className="h-4 rounded bg-gray-100 w-32" />
          <div className="h-10 rounded-xl bg-gray-100" />
          <div className="h-10 rounded-xl bg-gray-100" />
          <div className="h-10 rounded-xl bg-gray-100" />
          <div className="h-11 rounded-xl bg-brand-100" />
        </div>
      </div>
    </div>
  );

  if (!cafe) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h1 className="text-2xl font-bold text-gray-800">Café not found</h1>
          <p className="text-gray-500 mt-2">This café link may be invalid or inactive.</p>
        </div>
      </div>
    );
  }

  const nameStyleCss = parseNameStyle(cafe.name_style);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4 py-8">
      <CafeSeoHead cafe={cafe} slug={slug} />
      <Link to="/" className="fixed top-4 left-4 z-50 flex items-center gap-1.5 bg-white/80 hover:bg-white border border-gray-200 text-gray-600 hover:text-brand-600 text-sm font-medium px-3 py-2 rounded-xl shadow-sm backdrop-blur-sm transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        Home
      </Link>
      <div className="w-full max-w-sm">

        {/* Active orders banner / My Orders button */}
        {activeOrders.length > 0 ? (
          <button
            onClick={() => navigate(`/cafe/${slug}/my-orders`)}
            className="w-full mb-5 bg-teal-500 hover:bg-teal-600 text-white rounded-2xl px-4 py-4 text-left shadow-lg transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-sm">
                  📋 {activeOrders.length} active order{activeOrders.length !== 1 ? 's' : ''} in progress
                </p>
                <p className="text-teal-100 text-xs mt-0.5">Tap to track status, chat with café →</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg flex-shrink-0">
                {activeOrders.length}
              </div>
            </div>
          </button>
        ) : hasAnyHistory ? (
          <button
            onClick={() => navigate(`/cafe/${slug}/my-orders`)}
            className="w-full mb-5 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 rounded-2xl px-4 py-3 text-left transition-colors flex items-center justify-between"
          >
            <span className="text-sm font-medium">🧾 My Orders & Bookings</span>
            <span className="text-gray-300 text-sm">→</span>
          </button>
        ) : null}

        {/* Closed / schedule banner */}
        {(() => {
          const status = getScheduleStatus(cafe.opening_hours, cafe.timezone, cafe.is_open);
          const todayHours = getTodayHours(cafe.opening_hours, cafe.timezone);
          if (!status.isOpen) {
            return (
              <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl px-4 py-4 text-center">
                <p className="text-red-700 font-semibold text-sm">🔴 {status.reason}</p>
                {todayHours && <p className="text-red-500 text-xs mt-1">Today's hours: {todayHours}</p>}
                <p className="text-red-400 text-xs mt-0.5">You can browse the menu but cannot place orders right now.</p>
              </div>
            );
          }
          if (status.closingSoon) {
            return (
              <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center">
                <p className="text-amber-700 font-semibold text-sm">⚠️ {status.reason}</p>
              </div>
            );
          }
          if (todayHours) {
            return (
              <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl px-4 py-2.5 text-center">
                <p className="text-green-700 text-xs font-medium">🟢 Open today: {todayHours}</p>
              </div>
            );
          }
          return null;
        })()}

        {/* Café header */}
        <div className="text-center mb-8">
          {cafe.logo_url ? (
            <img src={cafe.logo_url} alt={cafe.name} className="w-20 h-20 rounded-2xl mx-auto mb-4 object-cover shadow-md" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-md">
              <span className="text-3xl font-bold text-white">{cafe.name.charAt(0)}</span>
            </div>
          )}
          <h1 className="text-2xl text-gray-900" style={nameStyleCss}>{cafe.name}</h1>
          {cafe.description && <p className="text-gray-500 text-sm mt-1">{cafe.description}</p>}
          {cafe.delivery_enabled && (
            <div className="inline-flex items-center gap-1.5 mt-2 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium px-3 py-1 rounded-full">
              <span>🛵</span>
              <span>Delivery available{cafe.delivery_est_mins ? ` · Est. ${cafe.delivery_est_mins} min` : ''}</span>
            </div>
          )}
        </div>

        {/* Entry form */}
        <div className="card shadow-lg">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">Welcome! Let's get started</h2>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Order type */}
            <div>
              <label className="label">Order Type</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                {[
                  { key: 'dine-in',  label: '🍽️ Dine In'  },
                  { key: 'takeaway', label: '🥡 Takeaway' },
                  ...(cafe?.delivery_enabled ? [{ key: 'delivery', label: '🛵 Delivery' }] : []),
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm({ ...form, order_type: key })}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      form.order_type === key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="label">Your Name</label>
              <input
                type="text" placeholder="e.g. Rahul" className="input"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              />
              {errors.customer_name && <p className="text-red-500 text-xs mt-1">{errors.customer_name}</p>}
            </div>

            {/* Phone */}
            <div>
              <label className="label">Mobile Number</label>
              <PhoneInput
                value={form.customer_phone}
                onChange={(v) => setForm({ ...form, customer_phone: v })}
                placeholder="e.g. 9876543210"
              />
              {errors.customer_phone && <p className="text-red-500 text-xs mt-1">{errors.customer_phone}</p>}
            </div>

            {/* Table selection — dine-in only */}
            {form.order_type === 'dine-in' && (
              <TableSearch
                hasTables={hasTables}
                areas={areas}
                form={form}
                setForm={setForm}
                errors={errors}
                setErrors={setErrors}
                normalizeTableNumber={normalizeTableNumber}
              />
            )}

            {form.order_type === 'takeaway' && (
              <p className="text-xs text-gray-500 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                Your order will be prepared and ready for pickup at the counter.
              </p>
            )}

            {form.order_type === 'delivery' && (
              <div className="text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 space-y-0.5">
                <p className="font-semibold text-blue-800">🛵 Delivery to your address</p>
                {cafe?.delivery_fee_base > 0
                  ? <p className="text-blue-600">Delivery fee: {fmtCurrency(cafe.delivery_fee_base, cafe?.currency)}</p>
                  : <p className="text-blue-600">Free delivery!</p>
                }
                {cafe?.delivery_est_mins > 0 && (
                  <p className="text-blue-600">Estimated time: ~{cafe.delivery_est_mins} min</p>
                )}
                {cafe?.delivery_min_order > 0 && (
                  <p className="text-blue-600">Min order: {fmtCurrency(cafe.delivery_min_order, cafe?.currency)}</p>
                )}
                <p className="text-blue-500 mt-1">You'll enter your delivery address at checkout.</p>
              </div>
            )}

            <button type="submit" className="btn-primary w-full mt-2">
              View Menu →
            </button>
          </form>
        </div>

        {/* Book a Table */}
        <button
          onClick={() => setShowReserve(true)}
          className="w-full mt-4 py-3 rounded-xl border-2 border-brand-300 text-brand-700 font-semibold text-sm hover:bg-brand-50 transition-colors"
        >
          📅 Book a Table in Advance
        </button>

        {/* Join Waitlist */}
        <button
          onClick={() => setShowWaitlist(true)}
          className="w-full mt-2 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 transition-colors"
        >
          🕐 Join Waitlist
        </button>

        {/* My Bookings — live status tracker */}
        {myBookings.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">My Bookings</p>
            {myBookings.map((r) => {
              const cfg = RESERVATION_STATUS[r.status] || RESERVATION_STATUS.pending;
              const dateStr = r.reserved_date
                ? new Date(r.reserved_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                : '';
              const timeStr = r.reserved_time ? r.reserved_time.slice(0, 5) : '';
              return (
                <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3 flex items-start justify-between gap-3 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{r.customer_name}</p>
                    <p className="text-xs text-gray-500">
                      {dateStr} at {timeStr} · {r.party_size} {r.party_size === 1 ? 'person' : 'people'}
                    </p>
                    {r.status === 'confirmed' && (
                      <p className="text-xs text-green-700 font-medium mt-1">
                        Your table is confirmed — see you then!
                      </p>
                    )}
                    {r.status === 'cancelled' && (
                      <p className="text-xs text-red-600 mt-1">
                        This booking was cancelled. Please contact the café or book again.
                      </p>
                    )}
                    {r.status === 'pending' && (
                      <p className="text-xs text-yellow-700 mt-1">
                        Waiting for café to confirm your table…
                      </p>
                    )}
                  </div>
                  {['cancelled', 'completed', 'no_show'].includes(r.status) && (
                    <button
                      onClick={() => {
                        removeReservation(slug, r.id);
                        setMyBookings(loadReservations(slug));
                      }}
                      className="text-gray-300 hover:text-gray-500 text-lg leading-none flex-shrink-0"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Address + map link */}
        {(cafe.address || cafe.city) && (
          <div className="text-center mt-4 space-y-0.5">
            {cafe.address && <p className="text-xs text-gray-400">📍 {cafe.address}</p>}
            {cafe.address_line2 && <p className="text-xs text-gray-400">{cafe.address_line2}</p>}
            {(cafe.city || cafe.state || cafe.pincode) && (
              <p className="text-xs text-gray-400">
                {[cafe.city, cafe.state, cafe.pincode].filter(Boolean).join(', ')}
              </p>
            )}
            {cafe.latitude && cafe.longitude && (
              <a
                href={`https://www.google.com/maps?q=${cafe.latitude},${cafe.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:underline font-medium"
              >
                Open in Google Maps →
              </a>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-300 mt-6 pb-2">
          Powered by <span className="text-brand-400">DineVerse</span>
        </p>
      </div>

      {showWaitlist && (
        <WaitlistModal slug={slug} cafeName={cafe.name} onClose={() => setShowWaitlist(false)} />
      )}

      {showReserve && (
        <ReservationModal
          slug={slug}
          cafeName={cafe.name}
          onClose={() => setShowReserve(false)}
          onBooked={(reservation) => {
            upsertReservation(slug, reservation);
            setMyBookings(loadReservations(slug));
            // Track this reservation — emit now if connected, otherwise queue via connect handler
            const sock = socketRef.current;
            if (sock) {
              if (sock.connected) {
                sock.emit('track_reservation', reservation.id);
              } else {
                sock.once('connect', () => sock.emit('track_reservation', reservation.id));
              }
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Reservation Modal ────────────────────────────────────────
function ReservationModal({ slug, cafeName, onClose, onBooked }) {
  const todayISO = new Date().toLocaleDateString('en-CA');
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', party_size: 2,
    reserved_date: todayISO, reserved_time: '',
    area_id: '', table_id: '', notes: '',
  });
  const [saving, setSaving]           = useState(false);
  const [tableAreas, setTableAreas]   = useState([]);
  const [loadingTables, setLoadingTables] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Fetch table availability whenever date+time are both set
  const fetchAvailability = useCallback(async (date, time) => {
    if (!date || !time) { setTableAreas([]); return; }
    setLoadingTables(true);
    try {
      const res = await getCafeTables(slug, { date, time });
      setTableAreas(res.data.areas || []);
    } catch {
      setTableAreas([]);
    } finally {
      setLoadingTables(false);
    }
  }, [slug]);

  useEffect(() => {
    if (form.reserved_date && form.reserved_time) {
      fetchAvailability(form.reserved_date, form.reserved_time);
    }
  }, [form.reserved_date, form.reserved_time, fetchAvailability]);

  const allTables = tableAreas.flatMap((a) => a.tables.map((t) => ({ ...t, area_name: a.name })));
  const hasTableData = allTables.length > 0;
  const selectedAreaTables = form.area_id
    ? tableAreas.find((a) => a.id === form.area_id)?.tables || []
    : allTables;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error('Name is required');
    if (!form.reserved_date)        return toast.error('Date is required');
    if (!form.reserved_time)        return toast.error('Time is required');
    setSaving(true);
    try {
      const res = await createReservation(slug, {
        customer_name:    form.customer_name.trim(),
        customer_phone:   form.customer_phone.trim(),
        party_size:       parseInt(form.party_size) || 2,
        reserved_date:    form.reserved_date,
        reserved_time:    form.reserved_time,
        area_id:          form.area_id  || null,
        table_id:         form.table_id || null,
        notes:            form.notes.trim() || null,
        duration_minutes: 90,
      });
      // Save to device so customer can track status
      if (res.data?.reservation) {
        onBooked(res.data.reservation);
      }
      toast.success("Table booked! We'll confirm shortly.");
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not book table');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-y-auto max-h-[92dvh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Book a Table</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-500">Reserve a table at <strong>{cafeName}</strong></p>

          <div>
            <label className="label">Your Name *</label>
            <input className="input" placeholder="e.g. Rahul" value={form.customer_name} onChange={set('customer_name')} />
          </div>
          <div>
            <label className="label">Mobile Number</label>
            <input className="input" type="tel" placeholder="for confirmation" value={form.customer_phone} onChange={set('customer_phone')} />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date *</label>
              <input className="input" type="date" min={todayISO} value={form.reserved_date} onChange={set('reserved_date')} />
            </div>
            <div>
              <label className="label">Time *</label>
              <input className="input" type="time" value={form.reserved_time} onChange={set('reserved_time')} />
            </div>
          </div>

          <div>
            <label className="label">Party Size</label>
            <input className="input" type="number" min="1" max="50" value={form.party_size} onChange={set('party_size')} />
          </div>

          {/* Table picker — appears once date+time are chosen */}
          {form.reserved_date && form.reserved_time && (
            <div>
              <label className="label">
                Choose a Table
                <span className="text-gray-400 font-normal text-xs ml-1">
                  {loadingTables ? '— checking...' : '— 🔴 reserved for this slot'}
                </span>
              </label>

              {loadingTables ? (
                <p className="text-xs text-gray-400 py-2">Checking availability…</p>
              ) : !hasTableData ? (
                <p className="text-xs text-gray-400 py-1">No specific tables configured — we'll assign one for you.</p>
              ) : (
                <>
                  {/* Area filter */}
                  {tableAreas.length > 1 && (
                    <div className="mb-2">
                      <select
                        className="input text-sm"
                        value={form.area_id}
                        onChange={(e) => setForm((f) => ({ ...f, area_id: e.target.value, table_id: '' }))}
                      >
                        <option value="">All areas</option>
                        {tableAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Table grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {selectedAreaTables.map((t) => {
                      const reserved   = t.is_reserved;
                      const isSelected = form.table_id === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={reserved}
                          onClick={() => setForm((f) => ({ ...f, table_id: isSelected ? '' : t.id }))}
                          title={reserved ? `Reserved until ${t.reserved_until}` : `Book ${t.label}`}
                          className={`py-2.5 px-1 rounded-xl border-2 text-xs font-semibold transition-all ${
                            reserved
                              ? 'border-red-200 bg-red-50 text-red-400 cursor-not-allowed opacity-70'
                              : isSelected
                                ? 'border-brand-500 bg-brand-50 text-brand-700'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50'
                          }`}
                        >
                          {t.label}
                          {reserved && (
                            <span className="block text-[9px] font-normal text-red-400 mt-0.5">
                              until {t.reserved_until}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {!form.table_id && (
                    <p className="text-xs text-gray-400 mt-1">No table selected — café will assign one</p>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label className="label">Special Requests (optional)</label>
            <textarea
              className="input resize-none" rows={2}
              placeholder="e.g. window seat, birthday..."
              value={form.notes} onChange={set('notes')}
            />
          </div>

          {/* Info about slot expiry */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <p className="text-xs text-amber-700">
              <strong>Note:</strong> Your reserved table is held for <strong>90 minutes</strong> from your booking time.
              If you're running late, please call ahead — the slot expires 15 minutes after your time if not confirmed.
            </p>
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? 'Booking…' : 'Confirm Reservation'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Waitlist Join Modal ──────────────────────────────────────
function WaitlistModal({ slug, cafeName, onClose }) {
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', party_size: 2, notes: '' });
  const [saving, setSaving] = useState(false);
  const [joined, setJoined] = useState(null); // { id, position, ... }
  const [called, setCalled] = useState(false); // true when café seats this customer
  const [assignedTable, setAssignedTable] = useState(null);
  const socketRef = useRef(null);

  // Join per-entry socket room once we have the entry ID, listen for café call
  useEffect(() => {
    if (!joined?.id) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.emit('track_waitlist', joined.id);
    socket.on('waitlist_called', ({ table_number } = {}) => {
      setCalled(true);
      setAssignedTable(table_number || null);
      const msg = table_number
        ? `Your table is ready! Please go to Table ${table_number}.`
        : 'Your table is ready! Please proceed to the café.';
      toast.success(msg, { duration: 10000 });
    });
    return () => socket.disconnect();
  }, [joined?.id]);

  // Poll position every 60s while waiting
  useEffect(() => {
    if (!joined?.id || called) return;
    const poll = async () => {
      try {
        const { data } = await getWaitlistPosition(slug, joined.id);
        if (data.position != null) setJoined((prev) => ({ ...prev, position: data.position }));
        if (data.status === 'seated') setCalled(true);
      } catch { /* ignore — socket is the primary channel */ }
    };
    const timer = setInterval(poll, 60000);
    return () => clearInterval(timer);
  }, [joined?.id, called, slug]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      const { data } = await joinWaitlist(slug, {
        customer_name:  form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        party_size:     parseInt(form.party_size) || 2,
        notes:          form.notes.trim() || undefined,
      });
      setJoined(data.entry);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not join waitlist');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Join Waitlist</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {joined ? (
          <div className="px-5 py-6 text-center space-y-3">
            {called ? (
              <>
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto text-3xl">🍽️</div>
                <p className="font-bold text-green-700 text-lg">Your table is ready!</p>
                {assignedTable ? (
                  <p className="text-sm text-gray-700 font-medium">Please go to <strong className="text-green-700">Table {assignedTable}</strong> at <strong>{cafeName}</strong>.</p>
                ) : (
                  <p className="text-sm text-gray-500">Please proceed to <strong>{cafeName}</strong>. The team is expecting you.</p>
                )}
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto text-3xl">🕐</div>
                <p className="font-bold text-gray-900">You're on the waitlist!</p>
                <p className="text-sm text-gray-500">
                  You are <strong className="text-brand-600">#{joined.position}</strong> in line at <strong>{cafeName}</strong>.
                </p>
                <p className="text-xs text-gray-400">The café will notify you when your table is ready.</p>
              </>
            )}
            <button onClick={onClose} className="btn-primary w-full mt-2">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-500">Add yourself to the waiting list at <strong>{cafeName}</strong>.</p>
            <div>
              <label className="label">Your Name *</label>
              <input
                className="input" placeholder="e.g. Rahul"
                value={form.customer_name}
                onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Mobile Number</label>
              <input
                className="input" type="tel" placeholder="for café to reach you"
                value={form.customer_phone}
                onChange={(e) => setForm((f) => ({ ...f, customer_phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Party Size</label>
              <input
                className="input" type="number" min="1" max="50"
                value={form.party_size}
                onChange={(e) => setForm((f) => ({ ...f, party_size: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input
                className="input" placeholder="e.g. high chair needed"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full">
              {saving ? 'Adding…' : 'Join Waitlist'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Smart table search combobox ──────────────────────────────
function TableSearch({ hasTables, areas, form, setForm, errors, setErrors, normalizeTableNumber }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const namedAreas = areas.filter((a) => a.id !== null);
  const selectedArea = areas.find((a) => String(a.id) === String(form.area_id));
  const allTables = selectedArea ? selectedArea.tables : areas.flatMap((a) => a.tables);

  // Filter suggestions by what the user typed
  const query = form.table_number.toLowerCase().trim();
  const availableTables = hasTables ? allTables.filter((t) => !t.is_reserved) : [];
  const allReserved = hasTables && allTables.length > 0 && availableTables.length === 0;
  const suggestions = availableTables
    .filter((t) => {
      const label = t.label.toLowerCase();
      const areaLabel = (t.area_name || '').toLowerCase();
      return !query || label.includes(query) || areaLabel.includes(query) ||
        label.replace('table ', '').startsWith(query);
    })
    .slice(0, 8);

  const handleSelect = (t) => {
    const aName = selectedArea?.name || t.area_name;
    const normalized = normalizeTableNumber(t.label, aName !== 'General' ? aName : '');
    setForm((f) => ({ ...f, table_number: normalized, table_id: t.id }));
    setErrors((e) => ({ ...e, table_number: undefined }));
    setOpen(false);
    inputRef.current?.blur();
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="space-y-3">
      {/* Area filter — only when multiple named areas */}
      {namedAreas.length > 0 && (
        <div>
          <label className="label">Area <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
          <select
            className="input"
            value={form.area_id}
            onChange={(e) => {
              setForm((f) => ({ ...f, area_id: e.target.value, table_id: '', table_number: '' }));
              setErrors((er) => ({ ...er, table_number: undefined }));
            }}
          >
            <option value="">All areas</option>
            {namedAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {/* Smart search input */}
      <div className="relative">
        <label className="label">Table Number</label>
        <input
          ref={inputRef}
          type="text"
          className="input"
          placeholder={hasTables ? 'Type to search or enter table number…' : 'e.g. 5 or Table 5'}
          value={form.table_number}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setForm((f) => ({ ...f, table_number: e.target.value, table_id: '' }));
            setErrors((er) => ({ ...er, table_number: undefined }));
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />

        {/* Dropdown */}
        {open && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
          >
            {suggestions.map((t) => (
              <button
                key={t.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(t); }}
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

        {errors.table_number && <p className="text-red-500 text-xs mt-1">{errors.table_number}</p>}
        {allReserved && (
          <p className="text-xs text-amber-600 mt-1">All tables appear occupied right now — you can still type your table number manually.</p>
        )}
        {!hasTables && (
          <p className="text-xs text-gray-400 mt-1">Type "5" and it'll appear as "Table 5" on your order</p>
        )}
      </div>
    </div>
  );
}
