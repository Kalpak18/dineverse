import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getCafeBySlug, getCafeTables, createReservation } from '../../services/api';
import { loadOrders } from '../../utils/cafeOrderStorage';
import { loadReservations, upsertReservation, removeReservation } from '../../utils/cafeReservationStorage';
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

function nameStyleClass(style) {
  if (style === 'bold')        return 'font-bold';
  if (style === 'italic')      return 'italic';
  if (style === 'bold-italic') return 'font-bold italic';
  return '';
}

// Returns today as YYYY-MM-DD and current time as HH:MM (local)
function nowParts() {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

export default function CafeEntry() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [cafe, setCafe]           = useState(null);
  const [areas, setAreas]         = useState([]);
  const [hasTables, setHasTables] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [showReserve, setShowReserve] = useState(false);
  const [myBookings, setMyBookings] = useState([]);
  const socketRef = useRef(null);

  const [form, setForm] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`session_${slug}`);
      return saved
        ? JSON.parse(saved)
        : { customer_name: '', customer_phone: '', area_id: '', table_id: '', table_number: '', order_type: 'dine-in' };
    } catch {
      return { customer_name: '', customer_phone: '', area_id: '', table_id: '', table_number: '', order_type: 'dine-in' };
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
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = socket;

    const stored = loadReservations(slug);
    stored.forEach((r) => socket.emit('track_reservation', r.id));

    socket.on('connect', () => {
      loadReservations(slug).forEach((r) => socket.emit('track_reservation', r.id));
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

  const handleAreaChange = (areaId) => {
    setForm((f) => ({ ...f, area_id: areaId, table_id: '', table_number: '' }));
    if (errors.table_number) setErrors((e) => ({ ...e, table_number: undefined }));
  };

  const selectedArea = areas.find((a) => a.id === form.area_id);

  // All tables visible in current area (or all areas flattened)
  const visibleTables = selectedArea
    ? selectedArea.tables
    : areas.flatMap((a) => a.tables);

  const validate = () => {
    const e = {};
    if (!form.customer_name.trim()) e.customer_name = 'Please enter your name';
    if (!form.customer_phone?.trim()) e.customer_phone = 'Please enter your mobile number';
    if (form.order_type === 'dine-in') {
      if (hasTables) {
        if (areas.length > 0 && !form.area_id) e.area_id = 'Please select an area';
        if (!form.table_number.trim()) e.table_number = 'Please select a table';
      } else {
        if (!form.table_number.trim()) e.table_number = 'Please enter your table number';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleTableSelect = (table) => {
    if (table.is_reserved) return; // blocked
    setForm((f) => ({ ...f, table_id: table.id, table_number: table.label }));
    if (errors.table_number) setErrors((e) => ({ ...e, table_number: undefined }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    let tableLabel = form.table_number.trim();
    if (hasTables && selectedArea) {
      tableLabel = `${selectedArea.name} — ${tableLabel}`;
    }

    const session = {
      customer_name:  form.customer_name.trim(),
      customer_phone: form.customer_phone || '',
      table_number:   form.order_type === 'takeaway' ? 'Takeaway' : tableLabel,
      order_type:     form.order_type,
    };
    sessionStorage.setItem(`session_${slug}`, JSON.stringify(session));
    navigate(`/cafe/${slug}/menu`);
  };

  const activeOrders  = loadOrders(slug).filter((o) => !['paid', 'cancelled'].includes(o.status));
  const hasAnyHistory = loadOrders(slug).length > 0 || loadReservations(slug).length > 0;

  if (loading) return <LoadingSpinner />;

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

  const nameClass = `text-2xl text-gray-900 ${nameStyleClass(cafe.name_style)}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4 py-8">
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

        {/* Café header */}
        <div className="text-center mb-8">
          {cafe.logo_url ? (
            <img src={cafe.logo_url} alt={cafe.name} className="w-20 h-20 rounded-2xl mx-auto mb-4 object-cover shadow-md" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-md">
              <span className="text-3xl font-bold text-white">{cafe.name.charAt(0)}</span>
            </div>
          )}
          <h1 className={nameClass}>{cafe.name}</h1>
          {cafe.description && <p className="text-gray-500 text-sm mt-1">{cafe.description}</p>}
        </div>

        {/* Entry form */}
        <div className="card shadow-lg">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">Welcome! Let's get started</h2>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Order type */}
            <div>
              <label className="label">Order Type</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                {['dine-in', 'takeaway'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm({ ...form, order_type: type })}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      form.order_type === type ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {type === 'dine-in' ? '🍽️ Dine In' : '🥡 Takeaway'}
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
              hasTables ? (
                <>
                  {/* Area selector */}
                  {areas.length > 0 && (
                    <div>
                      <label className="label">Area</label>
                      <select className="input" value={form.area_id} onChange={(e) => handleAreaChange(e.target.value)}>
                        <option value="">Select area...</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {errors.area_id && <p className="text-red-500 text-xs mt-1">{errors.area_id}</p>}
                    </div>
                  )}

                  {/* Table number text input — always editable; grid below is just quick-select */}
                  <div>
                    <label className="label">Table Number</label>
                    <input
                      type="text"
                      placeholder="e.g. Table 5 or type your own"
                      className="input"
                      value={form.table_number}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, table_number: e.target.value, table_id: '' }));
                        if (errors.table_number) setErrors((e2) => ({ ...e2, table_number: undefined }));
                      }}
                    />
                    {errors.table_number && <p className="text-red-500 text-xs mt-1">{errors.table_number}</p>}
                  </div>

                  {/* Table grid — shows availability; tap to fill the input above */}
                  {(areas.length === 0 || form.area_id) && visibleTables.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">
                        Quick select <span className="text-red-400">🔴 = reserved</span>
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {visibleTables.map((t) => {
                          const isSelected = form.table_id === t.id;
                          const reserved   = t.is_reserved;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={reserved}
                              onClick={() => handleTableSelect(t)}
                              title={reserved ? `Reserved until ${t.reserved_until}` : t.label}
                              className={`relative py-2.5 px-1 rounded-xl border-2 text-xs font-semibold transition-all ${
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
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="label">Table Number</label>
                  <input
                    type="text" placeholder="e.g. Table 5" className="input"
                    value={form.table_number}
                    onChange={(e) => setForm({ ...form, table_number: e.target.value })}
                  />
                  {errors.table_number && <p className="text-red-500 text-xs mt-1">{errors.table_number}</p>}
                </div>
              )
            )}

            {form.order_type === 'takeaway' && (
              <p className="text-xs text-gray-500 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                Your order will be prepared and ready for pickup at the counter.
              </p>
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

      {showReserve && (
        <ReservationModal
          slug={slug}
          cafeName={cafe.name}
          onClose={() => setShowReserve(false)}
          onBooked={(reservation) => {
            upsertReservation(slug, reservation);
            setMyBookings(loadReservations(slug));
            // Immediately track this reservation for live updates
            if (socketRef.current) {
              socketRef.current.emit('track_reservation', reservation.id);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Reservation Modal ────────────────────────────────────────
function ReservationModal({ slug, cafeName, onClose }) {
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
