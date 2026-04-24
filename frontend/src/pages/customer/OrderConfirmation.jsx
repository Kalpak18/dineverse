import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { fmtToken, fmtPrice, fmtTime, fmtCurrency } from '../../utils/formatters';
import { getOrderStatus, cancelOrder, getCafeBySlug, submitRating, createOrderPayment, verifyOrderPayment, getCustomerMessages, postCustomerMessage, getTableBill } from '../../services/api';
import { loadRazorpayScript } from '../../utils/razorpayLoader';

const STATUS_LABELS = {
  pending:   { label: 'Order Received', color: 'text-yellow-600 bg-yellow-50', icon: '⏳' },
  confirmed: { label: 'Accepted',       color: 'text-blue-600 bg-blue-50',    icon: '✅' },
  preparing: { label: 'Preparing',      color: 'text-orange-600 bg-orange-50', icon: '👨‍🍳' },
  ready:     { label: 'Ready!',         color: 'text-teal-600 bg-teal-50',    icon: '🔔' },
  served:    { label: 'Served',         color: 'text-green-600 bg-green-50',  icon: '🍽️' },
  paid:      { label: 'Paid',           color: 'text-purple-600 bg-purple-50', icon: '💜' },
  cancelled: { label: 'Cancelled',      color: 'text-red-600 bg-red-50',      icon: '❌' },
};

const POLL_MS      = 10000;               // fallback poll every 10s (socket handles real-time)
const POLL_MAX_MS  = 2 * 60 * 60 * 1000; // stop polling after 2 hours regardless

export default function OrderConfirmation() {
  const { slug } = useParams();
  const navigate  = useNavigate();
  const location  = useLocation();
  const sessionCurrency = (() => { try { return JSON.parse(localStorage.getItem(`session_${slug}`) || '{}').currency || 'INR'; } catch { return 'INR'; } })();
  const [orders, setOrders] = useState([]);
  const [cancelling, setCancelling] = useState(null);
  const [paying, setPaying] = useState(null);          // order ID currently in payment flow
  const [cafeInfo, setCafeInfo] = useState(null);
  const c = (n) => fmtCurrency(n, cafeInfo?.currency || sessionCurrency);
  const [ratingOrder, setRatingOrder] = useState(null); // order being rated
  const [tableBill, setTableBill] = useState(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null); // digital receipt modal
  const [lostConnection, setLostConnection] = useState(false); // socket gave up reconnecting
  const [rated, setRated] = useState(() => {           // set of order IDs already rated
    try { return new Set(JSON.parse(localStorage.getItem('dv_rated') || '[]')); }
    catch { return new Set(); }
  });
  const socketRef   = useRef(null);
  const pollRef     = useRef(null);
  const pollStartTs = useRef(null);     // timestamp when polling began
  const trackedIds  = useRef(new Set()); // order IDs we've already joined rooms for

  // ─── Refresh state from localStorage ───────────────────────────
  const refresh = useCallback(() => {
    setOrders(loadOrders(slug));
  }, [slug]);

  // ─── Poll one order's status from the API ──────────────────────
  const pollOrder = useCallback(async (order) => {
    try {
      const { data } = await getOrderStatus(slug, order.id);
      upsertOrder(slug, data.order);
      refresh();
    } catch (err) {
      if (import.meta.env.DEV) console.error('[OrderConfirmation] status poll failed for', order.id, err?.response?.status);
    }
  }, [slug, refresh]);

  // ─── Join socket room for a single order ID ────────────────────
  const trackOrder = useCallback((orderId) => {
    if (!socketRef.current || trackedIds.current.has(orderId)) return;
    socketRef.current.emit('track_order', orderId);
    trackedIds.current.add(orderId);
  }, []);

  // ─── Main setup effect ─────────────────────────────────────────
  useEffect(() => {
    // 1. Save newly placed order from navigation state (from CartPage)
    const newOrder = location.state?.order;
    if (newOrder) upsertOrder(slug, newOrder);

    // 2. Load all stored orders for this café
    const stored = loadOrders(slug);
    if (stored.length === 0) {
      navigate(`/cafe/${slug}`, { replace: true });
      return;
    }
    setOrders(stored);

    // 2b. Load cafe info (for bill printing)
    getCafeBySlug(slug).then(({ data }) => setCafeInfo(data.cafe)).catch(() => {});

    // 3. Connect socket.io
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    // 4. On connect / reconnect — re-join all tracked rooms
    const onConnect = () => {
      setLostConnection(false);
      trackedIds.current.forEach((id) => socket.emit('track_order', id));
    };
    socket.on('connect', onConnect);

    // If socket exhausts all reconnection attempts, show stale-data warning
    socket.on('reconnect_failed', () => setLostConnection(true));

    // 5. Real-time status update from owner's action
    const onOrderUpdated = (updated) => {
      upsertOrder(slug, updated);
      setOrders(loadOrders(slug));
      // Auto-open rating prompt when order is marked paid
      if (updated.status === 'paid') {
        setRatingOrder((prev) => prev || updated);
      }
    };
    socket.on('order_updated', onOrderUpdated);

    // 5b. Delivery partner status updates
    const onDeliveryUpdated = (update) => {
      // Merge delivery fields into the cached order
      const current = loadOrders(slug);
      const target = current.find((o) => o.id === update.order_id);
      if (target) {
        upsertOrder(slug, {
          ...target,
          delivery_status: update.delivery_status,
          driver_name:     update.driver_name,
          driver_phone:    update.driver_phone,
          delivered_at:    update.delivered_at,
        });
        setOrders(loadOrders(slug));
      }
      if (update.delivery_status === 'delivered') {
        toast.success('Your order has been delivered! 🛵');
      } else if (update.delivery_status === 'out_for_delivery') {
        toast('Your order is on the way! 🛵', { icon: '🛵' });
      } else if (update.delivery_status === 'assigned') {
        toast('Driver assigned — getting ready to pick up your order', { icon: '🏍️' });
      }
    };
    socket.on('delivery_updated', onDeliveryUpdated);

    // 6. Join a room for every currently active order
    const liveOrders = stored.filter((o) => !['paid', 'cancelled'].includes(o.status));
    liveOrders.forEach((o) => {
      socket.emit('track_order', o.id);
      trackedIds.current.add(o.id);
    });

    // 7. Immediate poll on mount so we don't start stale
    pollStartTs.current = Date.now();

    const pollAll = async () => {
      // Stop if we've been polling for longer than POLL_MAX_MS (2 hours)
      if (Date.now() - pollStartTs.current > POLL_MAX_MS) {
        clearInterval(pollRef.current);
        return;
      }
      const current = loadOrders(slug);
      const live = current.filter((o) => !['paid', 'cancelled'].includes(o.status));
      // All orders reached terminal state — no more polling needed
      if (live.length === 0) {
        clearInterval(pollRef.current);
        return;
      }
      await Promise.all(live.map(pollOrder));
    };

    pollAll(); // fire immediately, don't wait for first interval tick

    // 8. Fallback polling every 10s (in case socket misses an event)
    pollRef.current = setInterval(pollAll, POLL_MS);

    return () => {
      clearInterval(pollRef.current);
      socket.off('connect', onConnect);
      socket.off('order_updated', onOrderUpdated);
      socket.off('delivery_updated', onDeliveryUpdated);
      socket.disconnect();
      socketRef.current = null;
      trackedIds.current.clear();
    };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new order is placed (e.g. second round from same session),
  // join its socket room immediately without remounting the whole effect
  useEffect(() => {
    orders.forEach((o) => {
      if (!['paid', 'cancelled'].includes(o.status)) {
        trackOrder(o.id);
      }
    });
  }, [orders, trackOrder]);

  // ─── Cancel order ───────────────────────────────────────────────
  const handleCancel = async (order) => {
    setCancelling(order.id);
    try {
      const { data } = await cancelOrder(slug, order.id);
      upsertOrder(slug, data.order);
      refresh();
      toast.success('Order cancelled');
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
        err.response?.data?.error ||
        'Cannot cancel — order may already be accepted'
      );
    } finally {
      setCancelling(null);
    }
  };

  // ─── Dismiss terminal order from device history ─────────────────
  const handleDismiss = (orderId) => {
    removeOrder(slug, orderId);
    const remaining = loadOrders(slug);
    setOrders(remaining);
    if (remaining.length === 0) navigate(`/cafe/${slug}`);
  };

  // ─── Pay via Razorpay ────────────────────────────────────────────
  const handlePay = async (order) => {
    setPaying(order.id);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast.error('Payment service unavailable. Please try again.'); return; }

      const { data } = await createOrderPayment(slug, order.id);

      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key:          data.key_id,
          amount:       data.amount,
          currency:     data.currency,
          order_id:     data.razorpay_order_id,
          name:         data.cafe_name,
          description:  `Order #${data.daily_order_number}`,
          prefill: { name: order.customer_name, contact: order.customer_phone || '' },
          theme:        { color: '#f97316' },
          handler: async (response) => {
            try {
              const verifyRes = await verifyOrderPayment(slug, order.id, {
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              });
              upsertOrder(slug, verifyRes.data.order);
              setOrders(loadOrders(slug));
              toast.success('Payment successful! 🎉');
              resolve();
            } catch {
              toast.error('Payment verification failed. Contact staff if amount was deducted.');
              reject();
            }
          },
          modal: {
            ondismiss: () => reject(new Error('dismissed')),
          },
        });
        rzp.open();
      });
    } catch (err) {
      if (err?.message !== 'dismissed') {
        toast.error(err?.response?.data?.message || 'Payment failed. Please try again.');
      }
    } finally {
      setPaying(null);
    }
  };

  const handleShowTableBill = async () => {
    const dineInOrder = orders.find((o) => o.order_type === 'dine-in' && o.table_number);
    if (!dineInOrder) return;
    setLoadingBill(true);
    try {
      const { data } = await getTableBill(slug, dineInOrder.table_number);
      setTableBill(data);
    } catch {
      toast.error('Could not load table bill');
    } finally {
      setLoadingBill(false);
    }
  };

  if (orders.length === 0) return null;

  const activeCount = orders.filter((o) => !['paid', 'cancelled'].includes(o.status)).length;
  const allDone     = activeCount === 0 && orders.length > 0;
  const hasDineIn   = orders.some((o) => o.order_type === 'dine-in' && o.table_number);

  const startNewOrder = () => {
    localStorage.removeItem(`session_${slug}`);
    navigate(`/cafe/${slug}`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 px-4 py-8">
      <div className="max-w-sm mx-auto space-y-4">

        {/* Lost-connection warning — shown when socket exhausted all reconnect attempts */}
        {lostConnection && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-amber-500 text-lg flex-shrink-0">⚠️</span>
            <div>
              <p className="text-amber-800 text-sm font-medium">Live updates paused</p>
              <p className="text-amber-600 text-xs mt-0.5">
                Connection lost. Your order status may be out of date.{' '}
                <button
                  className="underline font-medium"
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </button>{' '}
                to get the latest.
              </p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-2">
          {allDone ? (
            <>
              <div className="text-5xl mb-2">🙏</div>
              <h1 className="text-xl font-bold text-gray-900">Thank You!</h1>
              <p className="text-gray-500 text-sm mt-1">All orders are complete. Hope you enjoyed your meal!</p>
              <button
                onClick={startNewOrder}
                className="mt-4 w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors"
              >
                + New Order
              </button>
            </>
          ) : (
            <>
              <div className="text-5xl mb-2">🎉</div>
              <h1 className="text-xl font-bold text-gray-900">Your Orders</h1>
              <p className="text-gray-500 text-sm mt-1">
                {activeCount} active order{activeCount !== 1 ? 's' : ''} — live updates on
              </p>
              {hasDineIn && (
                <button
                  onClick={handleShowTableBill}
                  disabled={loadingBill}
                  className="mt-3 px-4 py-1.5 rounded-xl bg-white border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  {loadingBill ? 'Loading…' : '🧾 View Table Bill'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Order cards */}
        {orders.map((order) => {
          // Takeaway "served" = kitchen passed to counter → show as "Ready for Pickup"
          const displayStatus =
            order.order_type === 'takeaway' && order.status === 'served'
              ? 'ready'
              : order.status;
          const statusInfo = STATUS_LABELS[displayStatus] || STATUS_LABELS.pending;
          const isPending    = order.status === 'pending';
          const isAccepted   = ['confirmed', 'preparing', 'ready', 'served'].includes(order.status);
          const isTerminal   = ['paid', 'cancelled'].includes(order.status);
          const isReady      = order.status === 'ready' ||
            (order.order_type === 'takeaway' && order.status === 'served');
          // Customer can pay online when food is served (dine-in) or ready (takeaway)
          const canPayOnline = (order.status === 'served' && order.order_type === 'dine-in') ||
            (order.status === 'ready' && order.order_type === 'takeaway') ||
            order.status === 'ready';
          const isPaying     = paying === order.id;

          return (
            <div key={order.id} className="card shadow-md">
              {/* Status + order number */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-400 font-medium tracking-wide">TOKEN</p>
                  <p className="font-black text-gray-900 text-3xl leading-none">{fmtToken(order.daily_order_number, order.order_type)}</p>
                </div>
                <span className={`badge ${statusInfo.color} px-3 py-1.5 text-sm`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
              </div>

              {/* Meta */}
              <div className="flex gap-4 text-xs text-gray-600 mb-3 pb-3 border-b border-dashed border-gray-200">
                <div>
                  <span className="text-gray-400">Name</span>
                  <p className="font-medium">{order.customer_name}</p>
                </div>
                <div>
                  <span className="text-gray-400">Table</span>
                  <p className="font-medium">{order.table_number}</p>
                </div>
                <div>
                  <span className="text-gray-400">Time</span>
                  <p className="font-medium">{fmtTime(order.created_at)}</p>
                </div>
              </div>

              {/* Items */}
              {order.items?.length > 0 && (
                <div className="space-y-0.5 mb-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className={`text-gray-700 ${order.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                        {item.item_name} × {item.quantity}
                      </span>
                      <span className={`font-medium ${order.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                        {c(item.subtotal)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Total */}
              <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900 text-sm">
                <span>Total</span>
                <span className={order.status === 'cancelled' ? 'line-through text-gray-400' : ''}>
                  {c(order.total_amount)}
                </span>
              </div>

              {/* Cancellation reason */}
              {order.status === 'cancelled' && order.cancellation_reason && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <p className="text-xs font-semibold text-red-700 mb-0.5">Reason for cancellation:</p>
                  <p className="text-sm text-red-700">{order.cancellation_reason}</p>
                </div>
              )}

              {/* Delivery status bar — only for delivery orders */}
              {order.order_type === 'delivery' && (
                <DeliveryStatusBar
                  deliveryStatus={order.delivery_status}
                  driverName={order.driver_name}
                  driverPhone={order.driver_phone}
                  deliveredAt={order.delivered_at}
                  deliveryFailedReason={order.delivery_failed_reason}
                  deliveryAddress={order.delivery_address}
                />
              )}

              {/* Ready banners — only for non-delivery orders */}
              {isReady && order.order_type !== 'delivery' && (
                <div className="mt-3 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 text-xs text-teal-800 font-medium">
                  {order.order_type === 'takeaway'
                    ? '🔔 Your order is ready! Please collect at the counter.'
                    : '🔔 Food is ready — your waiter is on the way!'}
                </div>
              )}

              {/* Actions */}
              <div className="mt-3 flex gap-2 flex-col">
                {/* Cancel — only for pending; disabled but visible when accepted */}
                {(isPending || isAccepted) && (
                  <button
                    onClick={() => isPending && handleCancel(order)}
                    disabled={isAccepted || cancelling === order.id}
                    title={isAccepted ? 'Order already accepted — cannot cancel' : ''}
                    className={`w-full py-2 rounded-xl border text-xs font-medium transition-colors
                      ${isAccepted
                        ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                        : 'border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50'
                      }`}
                  >
                    {cancelling === order.id
                      ? 'Cancelling…'
                      : isAccepted
                        ? '🔒 Cannot cancel — order is being prepared'
                        : 'Cancel Order'}
                  </button>
                )}

                {/* Pay Now — shown when food is ready/served and not yet paid */}
                {canPayOnline && !order.payment_verified && (
                  <button
                    onClick={() => handlePay(order)}
                    disabled={isPaying}
                    className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    {isPaying ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        Processing…
                      </>
                    ) : `💳 Pay Now — ${c(order.final_amount || order.total_amount)}`}
                  </button>
                )}

                {/* Digital receipt — only after payment */}
                {order.status === 'paid' && (
                  <button
                    onClick={() => setReceiptOrder(order)}
                    className="w-full py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold transition-colors"
                  >
                    🧾 View Receipt
                  </button>
                )}

                {isTerminal && (
                  <button
                    onClick={() => handleDismiss(order.id)}
                    className="py-2 px-3 rounded-xl border border-gray-200 text-gray-400 text-xs font-medium bg-white hover:bg-gray-50 transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>

              {/* Customer chat */}
              <CustomerChatWidget order={order} slug={slug} socketRef={socketRef} />
            </div>
          );
        })}

        {/* Order more */}
        <button
          onClick={() => navigate(`/cafe/${slug}/menu`)}
          className="btn-primary w-full"
        >
          + Order More Items
        </button>

        <p className="text-center text-xs text-gray-400">
          Orders are saved on this device. Status updates in real time.
        </p>
        <p className="text-center text-xs text-gray-300 pb-4">
          Powered by <span className="text-brand-400">DineVerse</span>
        </p>
      </div>

      {/* Rating prompt — auto-shown when any order is paid */}
      {ratingOrder && !rated.has(ratingOrder.id) && (
        <RatingModal
          order={ratingOrder}
          slug={slug}
          onDone={(orderId) => {
            const next = new Set([...rated, orderId]);
            setRated(next);
            localStorage.setItem('dv_rated', JSON.stringify([...next]));
            setRatingOrder(null);
          }}
          onSkip={() => setRatingOrder(null)}
        />
      )}

      {/* Digital receipt modal */}
      {receiptOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4"
          onClick={(e) => { if (e.target === e.currentTarget) setReceiptOrder(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden max-h-[90vh] flex flex-col">
            {/* Café header */}
            <div className="bg-brand-600 text-white text-center px-5 pt-5 pb-4 flex-shrink-0">
              {cafeInfo?.logo_url && (
                <img src={cafeInfo.logo_url} alt={cafeInfo.name} className="w-12 h-12 rounded-xl mx-auto mb-2 object-cover" />
              )}
              <p className="font-bold text-base">{cafeInfo?.name || 'Café'}</p>
              {cafeInfo?.address && <p className="text-xs text-brand-200 mt-0.5">{cafeInfo.address}</p>}
              {cafeInfo?.gst_number && <p className="text-xs text-brand-200 mt-0.5">GSTIN: {cafeInfo.gst_number}</p>}
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {/* Order meta */}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Token {fmtToken(receiptOrder.daily_order_number, receiptOrder.order_type)}</span>
                <span>{new Date(receiptOrder.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{receiptOrder.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${receiptOrder.table_number}`}</span>
                <span>Customer: {receiptOrder.customer_name}</span>
              </div>

              {/* Items */}
              <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
                {(receiptOrder.items || []).map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700">{item.item_name} × {item.quantity}</span>
                    <span className="font-medium text-gray-900">{c(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
                {parseFloat(receiptOrder.tax_amount || 0) > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>GST {receiptOrder.tax_rate}% (CGST {receiptOrder.tax_rate / 2}% + SGST {receiptOrder.tax_rate / 2}%)</span>
                    <span>{c(receiptOrder.tax_amount)}</span>
                  </div>
                )}
                {parseFloat(receiptOrder.discount_amount || 0) > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>−{c(receiptOrder.discount_amount)}</span>
                  </div>
                )}
                {parseFloat(receiptOrder.tip_amount || 0) > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Tip</span>
                    <span>{c(receiptOrder.tip_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 text-base pt-1">
                  <span>Total Paid</span>
                  <span>{c(receiptOrder.final_amount || receiptOrder.total_amount)}</span>
                </div>
              </div>

              <div className="text-center pt-2">
                <div className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-4 py-1.5">
                  <span className="text-green-600 font-bold text-xs">✓ PAID</span>
                </div>
                <p className="text-xs text-gray-400 mt-3">Thank you for dining with us!</p>
              </div>
            </div>

            <div className="px-5 pb-4 flex-shrink-0">
              <button onClick={() => setReceiptOrder(null)} className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table bill modal */}
      {tableBill && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4"
          onClick={(e) => { if (e.target === e.currentTarget) setTableBill(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden max-h-[85vh] flex flex-col">
            <div className="h-1 bg-brand-500 rounded-t-2xl flex-shrink-0" />
            <div className="px-5 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-bold text-gray-900">Table Bill</h3>
                <p className="text-xs text-gray-400">{tableBill.table_number} · {tableBill.cafe_name}</p>
              </div>
              <button onClick={() => setTableBill(null)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-3">
              {(tableBill.orders || []).map((order, i) => (
                <div key={order.id} className="border border-gray-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">
                    Order {fmtToken(order.daily_order_number, order.order_type)} · {fmtTime(order.created_at)}
                  </p>
                  {(order.items || []).map((item, j) => (
                    <div key={j} className="flex justify-between text-sm text-gray-700 py-0.5">
                      <span>{item.item_name} × {item.quantity}</span>
                      <span>{c(item.subtotal)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs text-gray-500 mt-1.5 pt-1.5 border-t border-dashed border-gray-100">
                    <span>Order subtotal</span>
                    <span>{c(order.final_amount || order.total_amount)}</span>
                  </div>
                </div>
              ))}
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
                {tableBill.combined_tip > 0 && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Tips</span>
                    <span>{c(tableBill.combined_tip)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 text-base">
                  <span>Total ({(tableBill.orders || []).length} order{(tableBill.orders || []).length !== 1 ? 's' : ''})</span>
                  <span>{c(tableBill.combined_total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Customer Chat Widget ─────────────────────────────────────
function CustomerChatWidget({ order, slug, socketRef }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef(null);
  const loadedRef = useRef(false);

  // Load messages when chat is opened
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    getCustomerMessages(slug, order.id)
      .then(({ data }) => setMessages(data.messages || []))
      .catch(() => {});
  }, [open, slug, order.id]);

  // Listen for new messages via socket
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

  // Reset unread when opened
  useEffect(() => { if (open) setUnread(0); }, [open]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await postCustomerMessage(slug, order.id, msg);
      setText('');
      // Do NOT append here — backend broadcasts via socket to order:<id>
      // and the socket handler (with dedup) adds it. Appending from the API
      // response too causes the message to appear twice.
    } catch { /* silent */ }
    finally { setSending(false); }
  };

  return (
    <div className="mt-3 border-t border-dashed border-gray-200 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-brand-600 transition-colors"
      >
        <span>💬 Chat with café</span>
        {unread > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {unread}
          </span>
        )}
        <span className="text-gray-300">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
          <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">
                Have a question about your order? Send a message to the café.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender_type === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-snug ${
                  m.sender_type === 'customer'
                    ? 'bg-brand-500 text-white rounded-br-none'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                }`}>
                  {m.sender_type === 'owner' && (
                    <span className="block text-[10px] font-bold text-brand-600 mb-0.5">Café</span>
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
              placeholder="Ask a question about your order…"
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

// ─── Delivery Status Bar ───────────────────────────────────────
const DELIVERY_STEPS = [
  { key: 'pending',          icon: '⏳', label: 'Order received'    },
  { key: 'assigned',         icon: '🏍️', label: 'Driver assigned'   },
  { key: 'picked_up',        icon: '📦', label: 'Picked up'         },
  { key: 'out_for_delivery', icon: '🛵', label: 'On the way'        },
  { key: 'delivered',        icon: '✅', label: 'Delivered'         },
];

function DeliveryStatusBar({ deliveryStatus, driverName, driverPhone, deliveredAt, deliveryFailedReason, deliveryAddress }) {
  if (!deliveryStatus) {
    return (
      <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700">
        🛵 Delivery order · {deliveryAddress || 'Address on file'}
      </div>
    );
  }

  if (deliveryStatus === 'failed') {
    return (
      <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
        <p className="font-semibold">❌ Delivery could not be completed</p>
        {deliveryFailedReason && <p className="mt-0.5">{deliveryFailedReason}</p>}
      </div>
    );
  }

  const currentIdx = DELIVERY_STEPS.findIndex((s) => s.key === deliveryStatus);

  return (
    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-3">
      {/* Step dots */}
      <div className="flex items-center justify-between mb-3">
        {DELIVERY_STEPS.map((step, i) => (
          <div key={step.key} className="flex flex-col items-center gap-0.5 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
              i <= currentIdx ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-400'
            }`}>
              {step.icon}
            </div>
            <span className={`text-[9px] text-center leading-tight ${i <= currentIdx ? 'text-brand-700 font-semibold' : 'text-gray-400'}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Current status message */}
      <p className="text-xs text-blue-800 font-medium text-center">
        {deliveryStatus === 'delivered'
          ? `Delivered${deliveredAt ? ` at ${new Date(deliveredAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}!`
          : DELIVERY_STEPS[currentIdx]?.label || deliveryStatus}
      </p>

      {/* Driver info — show once assigned */}
      {driverName && (
        <div className="mt-2 flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs">
          <span className="text-gray-600">🏍️ <span className="font-medium">{driverName}</span></span>
          {driverPhone && (
            <a href={`tel:${driverPhone}`} className="text-brand-600 font-semibold hover:underline">
              {driverPhone}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Rating Modal ─────────────────────────────────────────────
function RatingModal({ order, slug, onDone, onSkip }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await submitRating(slug, order.id, { rating, comment: comment.trim() });
      toast.success('Thank you for your feedback!');
      onDone(order.id);
    } catch {
      toast.error('Could not submit rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-t-2xl" />
        <div className="p-6 space-y-4">
          <div className="text-center">
            <p className="text-3xl mb-2">⭐</p>
            <h3 className="font-bold text-gray-900 text-lg">How was your experience?</h3>
            <p className="text-sm text-gray-500 mt-1">Rate your order {fmtToken(order.daily_order_number, order.order_type)}</p>
          </div>

          {/* Stars */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(star)}
                className="text-4xl transition-transform hover:scale-110 active:scale-95"
              >
                <span className={(hovered || rating) >= star ? 'text-yellow-400' : 'text-gray-200'}>★</span>
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-center text-sm font-medium text-gray-600">
              {['', 'Poor 😞', 'Fair 😐', 'Good 🙂', 'Great 😄', 'Excellent! 🤩'][rating]}
            </p>
          )}

          {/* Comment */}
          <textarea
            className="input resize-none text-sm"
            rows={2}
            placeholder="Tell us more (optional)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!rating || submitting}
              className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-bold text-sm transition-colors"
            >
              {submitting ? 'Sending...' : 'Submit Rating'}
            </button>
            <button
              onClick={onSkip}
              className="px-4 py-3 rounded-xl border border-gray-200 text-gray-400 text-sm hover:bg-gray-50 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
