/**
 * MyOrdersPage — customer-facing "My Orders & Bookings" page.
 * Shows all orders and reservations stored on this device for a given café slug.
 * Live status updates via Socket.io.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { fmtToken, fmtPrice, fmtTime, fmtCurrency, groupByDate } from '../../utils/formatters';
import { useCart } from '../../context/CartContext';
import { loadOrders, upsertOrder, removeOrder } from '../../utils/cafeOrderStorage';
import { loadReservations, upsertReservation, removeReservation } from '../../utils/cafeReservationStorage';
import { getOrderStatus, cancelOrder, getCafeBySlug, getCustomerMessages, postCustomerMessage } from '../../services/api';
import toast from 'react-hot-toast';

const ORDER_STATUS = {
  pending:   { label: 'Waiting',   color: 'bg-yellow-100 text-yellow-800 border-yellow-200', dot: 'bg-yellow-400', icon: '⏳' },
  confirmed: { label: 'Accepted',  color: 'bg-blue-100 text-blue-800 border-blue-200',       dot: 'bg-blue-400',   icon: '✅' },
  preparing: { label: 'Preparing', color: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-400', icon: '👨‍🍳' },
  ready:     { label: 'Ready!',    color: 'bg-teal-100 text-teal-800 border-teal-200',        dot: 'bg-teal-400',   icon: '🔔' },
  served:    { label: 'Served',    color: 'bg-green-100 text-green-800 border-green-200',     dot: 'bg-green-400',  icon: '🍽️' },
  paid:      { label: 'Paid',      color: 'bg-purple-100 text-purple-800 border-purple-200',  dot: 'bg-purple-400', icon: '💜' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800 border-red-200',           dot: 'bg-red-400',    icon: '❌' },
};

const RES_STATUS = {
  pending:   { label: 'Awaiting Confirmation', color: 'bg-yellow-100 text-yellow-800', icon: '⏳' },
  confirmed: { label: 'Confirmed',             color: 'bg-green-100 text-green-800',   icon: '✅' },
  cancelled: { label: 'Cancelled',             color: 'bg-red-100 text-red-800',       icon: '❌' },
  completed: { label: 'Completed',             color: 'bg-gray-100 text-gray-600',     icon: '🍽️' },
  no_show:   { label: 'Expired',               color: 'bg-gray-100 text-gray-500',     icon: '🕐' },
};

const TABS = { ACTIVE: 'active', RESERVATIONS: 'reservations', HISTORY: 'history' };

export default function MyOrdersPage() {
  const { slug }              = useParams();
  const navigate              = useNavigate();
  const { addItem, clearCart } = useCart();
  const [cafeCurrency, setCafeCurrency] = useState(
    () => { try { return JSON.parse(localStorage.getItem(`session_${slug}`) || '{}').currency || 'INR'; } catch { return 'INR'; } }
  );
  const c = (n) => fmtCurrency(n, cafeCurrency);
  const [orders, setOrders]           = useState([]);
  const [reservations, setReservations] = useState([]);
  const [cafeName, setCafeName]       = useState('');
  const [activeTab, setActiveTab]     = useState(TABS.ACTIVE);
  const [initialized, setInitialized] = useState(false);
  const socketRef   = useRef(null);
  const pollRef     = useRef(null);
  const pollStartTs = useRef(null);
  const trackedIds  = useRef(new Set());

  const refreshOrders = useCallback(() => setOrders(loadOrders(slug)), [slug]);
  const refreshRes    = useCallback(() => setReservations(loadReservations(slug)), [slug]);

  // Poll one order
  const pollOrder = useCallback(async (order) => {
    try {
      const { data } = await getOrderStatus(slug, order.id);
      upsertOrder(slug, data.order);
      refreshOrders();
    } catch {}
  }, [slug, refreshOrders]);

  useEffect(() => {
    // Load stored data
    refreshOrders();
    refreshRes();

    // Load café name + currency for display
    getCafeBySlug(slug).then(({ data }) => {
      setCafeName(data.cafe?.name || '');
      if (data.cafe?.currency) setCafeCurrency(data.cafe.currency);
    }).catch(() => {});

    // If nothing stored, redirect back
    const storedOrders = loadOrders(slug);
    const storedRes    = loadReservations(slug);
    if (storedOrders.length === 0 && storedRes.length === 0) {
      navigate(`/cafe/${slug}`, { replace: true });
      return;
    }

    setInitialized(true);

    // Socket setup
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
    });
    socketRef.current = socket;

    // Track all live orders
    const liveOrders = storedOrders.filter((o) => !['paid', 'cancelled'].includes(o.status));
    liveOrders.forEach((o) => {
      socket.emit('track_order', o.id);
      trackedIds.current.add(o.id);
    });
    // Track all reservations
    storedRes.forEach((r) => socket.emit('track_reservation', r.id));

    socket.on('connect', () => {
      trackedIds.current.forEach((id) => socket.emit('track_order', id));
      loadReservations(slug).forEach((r) => socket.emit('track_reservation', r.id));
    });

    socket.on('order_updated', (updated) => {
      upsertOrder(slug, updated);
      refreshOrders();
      if (updated.status === 'ready')     toast('🔔 Your order is ready!', { duration: 6000 });
      if (updated.status === 'cancelled') toast.error('Order cancelled by café.');
    });

    socket.on('reservation_updated', (updated) => {
      upsertReservation(slug, updated);
      refreshRes();
      if (updated.status === 'confirmed') toast.success('Table reservation confirmed! ✅', { duration: 6000 });
      if (updated.status === 'cancelled') toast.error('Reservation cancelled by café.');
    });

    // Fallback polling — stops after 2h or when all orders reach terminal state
    const POLL_MAX_MS = 2 * 60 * 60 * 1000;
    pollStartTs.current = Date.now();
    const pollAll = async () => {
      if (Date.now() - pollStartTs.current > POLL_MAX_MS) {
        clearInterval(pollRef.current);
        return;
      }
      const live = loadOrders(slug).filter((o) => !['paid', 'cancelled'].includes(o.status));
      if (live.length === 0) { clearInterval(pollRef.current); return; }
      await Promise.all(live.map(pollOrder));
    };
    pollAll();
    pollRef.current = setInterval(pollAll, 15000);

    return () => {
      clearInterval(pollRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // When new orders appear, track them
  useEffect(() => {
    orders.forEach((o) => {
      if (!['paid', 'cancelled'].includes(o.status) && !trackedIds.current.has(o.id)) {
        socketRef.current?.emit('track_order', o.id);
        trackedIds.current.add(o.id);
      }
    });
  }, [orders]);

  const handleCancel = async (order) => {
    try {
      const { data } = await cancelOrder(slug, order.id);
      upsertOrder(slug, data.order);
      refreshOrders();
      toast.success('Order cancelled');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Cannot cancel this order');
    }
  };

  const handleDismissOrder = (id) => {
    removeOrder(slug, id);
    const remaining = loadOrders(slug);
    setOrders(remaining);
    if (remaining.length === 0 && reservations.length === 0) navigate(`/cafe/${slug}`);
  };

  const handleDismissRes = (id) => {
    removeReservation(slug, id);
    refreshRes();
  };

  const handleReorder = (order) => {
    clearCart();
    (order.items || []).forEach((oi) => {
      const item = { id: oi.menu_item_id, name: oi.item_name, price: oi.unit_price };
      for (let q = 0; q < (oi.quantity || 1); q++) addItem(item);
    });
    toast.success('Items added to cart — review before ordering');
    navigate(`/cafe/${slug}/cart`);
  };

  const activeOrders  = orders.filter((o) => !['paid', 'cancelled'].includes(o.status));
  const historyOrders = orders.filter((o) => ['paid', 'cancelled'].includes(o.status));
  const activeRes     = reservations.filter((r) => ['pending', 'confirmed'].includes(r.status));

  // All done — no active orders AND no active reservations
  const allDone = activeOrders.length === 0 && activeRes.length === 0 && orders.length > 0;

  const startNewOrder = () => {
    localStorage.removeItem(`session_${slug}`);
    navigate(`/cafe/${slug}`, { replace: true });
  };

  const tabCounts = {
    [TABS.ACTIVE]:       activeOrders.length,
    [TABS.RESERVATIONS]: reservations.length,
    [TABS.HISTORY]:      historyOrders.length,
  };

  if (!initialized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(`/cafe/${slug}`)} className="p-2 -ml-2 rounded-xl hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-gray-900 text-base">My Orders</h1>
            {cafeName && <p className="text-xs text-gray-400 truncate">{cafeName}</p>}
          </div>
          <Link
            to={`/cafe/${slug}/menu`}
            className="text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-xl transition-colors border border-brand-200"
          >
            + Order More
          </Link>
        </div>

        {/* Tabs */}
        <div className="max-w-lg mx-auto px-4 flex border-t border-gray-50">
          {[
            { key: TABS.ACTIVE,       label: 'Active' },
            { key: TABS.RESERVATIONS, label: 'Bookings' },
            { key: TABS.HISTORY,      label: 'History' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
              {tabCounts[key] > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === key ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tabCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4 pb-20">

        {/* ── Active Orders ── */}
        {activeTab === TABS.ACTIVE && (
          <>
            {activeOrders.length === 0 ? (
              allDone ? (
                <div className="text-center py-12 px-4">
                  <div className="text-5xl mb-3">🙏</div>
                  <h2 className="font-bold text-gray-900 text-lg">All done!</h2>
                  <p className="text-gray-500 text-sm mt-1 mb-5">Your orders are complete. Hope you enjoyed!</p>
                  <button
                    onClick={startNewOrder}
                    className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors"
                  >
                    + New Order
                  </button>
                </div>
              ) : (
                <EmptyState icon="📋" title="No active orders" sub="Place a new order from the menu." action={{ label: 'View Menu', to: `/cafe/${slug}/menu` }} />
              )
            ) : (
              activeOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  slug={slug}
                  socketRef={socketRef}
                  onCancel={handleCancel}
                  onDismiss={handleDismissOrder}
                />
              ))
            )}
          </>
        )}

        {/* ── Reservations ── */}
        {activeTab === TABS.RESERVATIONS && (
          <>
            {reservations.length === 0 ? (
              <EmptyState icon="📅" title="No bookings" sub="Book a table from the café page." action={{ label: 'Book a Table', to: `/cafe/${slug}` }} />
            ) : (
              reservations.map((r) => (
                <ReservationCard key={r.id} res={r} onDismiss={handleDismissRes} />
              ))
            )}
          </>
        )}

        {/* ── History — grouped by date ── */}
        {activeTab === TABS.HISTORY && (
          <>
            {historyOrders.length === 0 ? (
              <EmptyState icon="🧾" title="No past orders" sub="Completed orders will appear here." />
            ) : (
              groupByDate(historyOrders.filter((o) => o.created_at)).map(({ label, orders: dayOrders }) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">{label}</p>
                  {dayOrders.map((order) => (
                    <div key={order.id} className="mb-3">
                      <OrderCard
                        order={order}
                        slug={slug}
                        socketRef={socketRef}
                        onCancel={handleCancel}
                        onDismiss={handleDismissOrder}
                        onReorder={handleReorder}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────
function OrderCard({ order, slug, socketRef, onCancel, onDismiss, onReorder }) {
  const [chatOpen, setChatOpen] = useState(false);
  const currency = (() => { try { return JSON.parse(localStorage.getItem(`session_${slug}`) || '{}').currency || 'INR'; } catch { return 'INR'; } })();
  const c = (n) => fmtCurrency(n, currency);
  const cfg        = ORDER_STATUS[order.status] || ORDER_STATUS.pending;
  const isPending  = order.status === 'pending';
  const isTerminal = ['paid', 'cancelled'].includes(order.status);
  const isReady    = order.status === 'ready' || (order.order_type === 'takeaway' && order.status === 'served');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Status bar */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-gray-50 ${cfg.color} bg-opacity-60`}>
        <span className="text-base">{cfg.icon}</span>
        <span className="text-xs font-bold tracking-wide">{cfg.label}</span>
        <div className={`ml-auto w-2 h-2 rounded-full ${cfg.dot} ${!isTerminal ? 'animate-pulse' : ''}`} />
      </div>

      <div className="px-4 py-3">
        {/* Order meta */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-gray-400 font-medium tracking-wide">
              {order.order_type === 'takeaway' ? 'PICKUP TOKEN' : 'TABLE TOKEN'}
            </p>
            <p className="font-black text-gray-900 text-xl leading-none tracking-tight">
              {fmtToken(order.daily_order_number, order.order_type)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{fmtTime(order.created_at)}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">
              {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-0.5 mb-3 border-t border-dashed border-gray-100 pt-2.5">
          {(order.items || []).map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <div className="flex-1">
                <span className={`text-gray-700 ${isTerminal && order.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                  {item.item_name} × {item.quantity}
                </span>
                {/* Item status for individual mode */}
                {order.kitchen_mode === 'individual' && item.item_status && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      item.item_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      item.item_status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                      item.item_status === 'ready' ? 'bg-teal-100 text-teal-700' :
                      item.item_status === 'served' ? 'bg-green-100 text-green-700' :
                      item.item_status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {item.item_status === 'pending' ? '⏳' :
                       item.item_status === 'preparing' ? '👨‍🍳' :
                       item.item_status === 'ready' ? '🔔' :
                       item.item_status === 'served' ? '✅' :
                       item.item_status === 'cancelled' ? '❌' : '❓'}
                      {item.item_status}
                    </span>
                    {item.cancellation_reason && (
                      <span className="text-[10px] text-red-600 ml-1">{item.cancellation_reason}</span>
                    )}
                  </div>
                )}
              </div>
              <span className="text-gray-600 font-medium">{c(item.subtotal)}</span>
            </div>
          ))}
        </div>

        {/* Price breakdown */}
        <div className="pt-2 border-t border-gray-100 space-y-1 text-sm">
          {parseFloat(order.tax_amount || 0) > 0 && (
            <div className="flex justify-between text-gray-400 text-xs">
              <span>GST {order.tax_rate}%</span>
              <span>{c(order.tax_amount)}</span>
            </div>
          )}
          {parseFloat(order.discount_amount || 0) > 0 && (
            <div className="flex justify-between text-green-600 text-xs">
              <span>Discount</span>
              <span>−{c(order.discount_amount)}</span>
            </div>
          )}
          {parseFloat(order.tip_amount || 0) > 0 && (
            <div className="flex justify-between text-gray-400 text-xs">
              <span>Tip</span>
              <span>{c(order.tip_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900">
            <span>Total</span>
            <span>{c(order.final_amount || order.total_amount)}</span>
          </div>
        </div>

        {/* Cancellation reason */}
        {order.status === 'cancelled' && order.cancellation_reason && (
          <div className="mt-2.5 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
            <p className="text-xs font-semibold text-red-700">Cancelled by café:</p>
            <p className="text-xs text-red-600 mt-0.5">{order.cancellation_reason}</p>
          </div>
        )}

        {/* Ready banner */}
        {isReady && (
          <div className="mt-2.5 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 text-xs text-teal-800 font-medium">
            {order.order_type === 'takeaway'
              ? '🔔 Ready! Please collect at the counter.'
              : '🔔 Food is ready — your waiter is on the way!'}
          </div>
        )}

        {/* Actions */}
        <div className="mt-3 flex gap-2 flex-wrap">
          {isPending && (
            <button
              onClick={() => onCancel(order)}
              className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
            >
              Cancel Order
            </button>
          )}
          {order.status === 'paid' && onReorder && (order.items || []).length > 0 && (
            <button
              onClick={() => onReorder(order)}
              className="flex-1 py-2 rounded-xl border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-50 transition-colors"
            >
              🔄 Re-order
            </button>
          )}
          {isTerminal && (
            <button
              onClick={() => onDismiss(order.id)}
              className="py-2 px-3 rounded-xl border border-gray-200 text-gray-400 text-xs font-medium hover:bg-gray-50 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>

        {/* Chat */}
        <CustomerChatInline
          order={order}
          slug={slug}
          socketRef={socketRef}
          open={chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
        />
      </div>
    </div>
  );
}

// ─── Reservation Card ─────────────────────────────────────────
function ReservationCard({ res, onDismiss }) {
  const cfg = RES_STATUS[res.status] || RES_STATUS.pending;
  const canDismiss = ['cancelled', 'completed', 'no_show'].includes(res.status);
  const dateStr = res.reserved_date
    ? new Date(res.reserved_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' })
    : '';
  const timeStr = res.reserved_time ? res.reserved_time.slice(0, 5) : '';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Status bar */}
      <div className={`flex items-center gap-2 px-4 py-2.5 ${cfg.color}`}>
        <span>{cfg.icon}</span>
        <span className="text-xs font-bold">{cfg.label}</span>
        {res.status === 'pending' && (
          <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-gray-900">{res.customer_name}</p>
            <p className="text-sm text-gray-600 mt-0.5">{dateStr} at {timeStr}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {res.party_size} {res.party_size === 1 ? 'person' : 'people'}
              {res.notes ? ` · ${res.notes}` : ''}
            </p>
          </div>
          <span className="text-2xl">📅</span>
        </div>

        {res.status === 'confirmed' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 font-medium">
            ✅ Your table is confirmed! See you then.
          </div>
        )}
        {res.status === 'pending' && (
          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-xl px-3 py-2">
            ⏳ Waiting for the café to confirm your booking…
          </p>
        )}
        {res.status === 'cancelled' && (
          <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
            ❌ This booking was cancelled. Please contact the café or book again.
          </p>
        )}

        {canDismiss && (
          <button
            onClick={() => onDismiss(res.id)}
            className="w-full py-2 rounded-xl border border-gray-200 text-gray-400 text-xs font-medium hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Customer Chat Inline ─────────────────────────────────────
function CustomerChatInline({ order, slug, socketRef, open, onToggle }) {
  const [messages, setMessages]   = useState([]);
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [unread, setUnread]       = useState(0);
  const loadedRef = useRef(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    getCustomerMessages(slug, order.id)
      .then(({ data }) => setMessages(data.messages || []))
      .catch(() => {});
  }, [open, slug, order.id]);

  useEffect(() => {
    if (!socketRef?.current) return;
    const handler = (msg) => {
      if (msg.order_id !== order.id) return;
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
      if (!open && msg.sender_type === 'owner') setUnread((n) => n + 1);
    };
    socketRef.current.on('order_message', handler);
    return () => socketRef.current?.off('order_message', handler);
  }, [order.id, socketRef, open]);

  useEffect(() => { if (open) setUnread(0); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await postCustomerMessage(slug, order.id, msg);
      setText('');
      // Do NOT append here — the backend broadcasts via socket and the
      // order_message handler (with dedup) adds it. Appending here too
      // causes the message to appear twice.
    } catch {}
    finally { setSending(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gray-100">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-brand-600 transition-colors w-full"
      >
        <span>💬 Chat with café</span>
        {unread > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unread}</span>
        )}
        <span className="ml-auto text-gray-300">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
          <div className="px-3 py-2 max-h-48 overflow-y-auto space-y-1.5">
            {messages.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">Ask the café anything about your order.</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender_type === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-snug ${
                  m.sender_type === 'customer'
                    ? 'bg-brand-500 text-white rounded-br-none'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                }`}>
                  {m.sender_type === 'owner' && (
                    <span className="block text-[10px] font-bold text-brand-500 mb-0.5">Café</span>
                  )}
                  {m.message}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 pb-3 pt-2 flex gap-2 border-t border-gray-100 bg-white">
            <input
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-200 transition"
              placeholder="Type a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-xs font-bold transition-colors"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────
function EmptyState({ icon, title, sub, action }) {
  return (
    <div className="text-center py-16">
      <p className="text-5xl mb-3">{icon}</p>
      <p className="font-semibold text-gray-700">{title}</p>
      <p className="text-sm text-gray-400 mt-1 mb-4">{sub}</p>
      {action && (
        <Link
          to={action.to}
          className="inline-block px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold transition-colors"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
