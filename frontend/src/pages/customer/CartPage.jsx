import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { useCart } from '../../context/CartContext';
import { placeOrder, previewOffer } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import { upsertOrder, loadOrders } from '../../utils/cafeOrderStorage';
import toast from 'react-hot-toast';
import QuantityControl from '../../components/QuantityControl';

export default function CartPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, total, itemCount, updateQty, clearCart } = useCart();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [tip, setTip] = useState(0);
  const [offerPreview, setOfferPreview] = useState(null); // { applied, offer_name, discount_amount, final_amount }
  const offerDebounce = useRef(null);

  const TIP_OPTIONS = [0, 10, 20, 50];

  const session = JSON.parse(sessionStorage.getItem(`session_${slug}`) || 'null');
  const [cafeOpen, setCafeOpen] = useState(session?.is_open !== false);

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
  const hasGst      = !!(session?.gst_number) && gstRate > 0;
  const taxInclusive = session?.tax_inclusive !== false; // default true

  let taxableAmt, totalTax, grandTotal;
  const discountAmt = offerPreview?.applied ? parseFloat(offerPreview.discount_amount || 0) : 0;

  if (hasGst) {
    if (taxInclusive) {
      // Prices include GST — extract tax: tax = total × rate / (100 + rate)
      taxableAmt = total / (1 + gstRate / 100);
      totalTax   = total - taxableAmt;
      grandTotal = total - discountAmt + tip;
    } else {
      // Prices are pre-tax — add GST on top
      taxableAmt = total - discountAmt; // base after discount
      totalTax   = taxableAmt * gstRate / 100;
      grandTotal = taxableAmt + totalTax + tip;
    }
  } else {
    taxableAmt = total;
    totalTax   = 0;
    grandTotal = total - discountAmt + tip;
  }
  const activeOrders = loadOrders(slug).filter((o) => !['paid', 'cancelled'].includes(o.status));

  // Debounced offer preview: refetch when cart total changes
  useEffect(() => {
    if (!items.length) { setOfferPreview(null); return; }
    clearTimeout(offerDebounce.current);
    offerDebounce.current = setTimeout(async () => {
      try {
        const payload = {
          items: items.map((i) => ({ menu_item_id: i.id, quantity: i.quantity })),
          total,
        };
        const { data } = await previewOffer(slug, payload);
        setOfferPreview(data);
      } catch {
        setOfferPreview(null);
      }
    }, 500);
    return () => clearTimeout(offerDebounce.current);
  }, [slug, total, items]);

  if (!session) {
    navigate(`/cafe/${slug}`);
    return null;
  }

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
    if (loading) return; // prevent double submission
    setLoading(true);
    setShowConfirm(false);
    try {
      const orderPayload = {
        customer_name:  session.customer_name,
        customer_phone: session.customer_phone || undefined,
        table_number:   session.table_number,
        order_type:     session.order_type || 'dine-in',
        notes:          notes.trim() || undefined,
        tip_amount:     tip || undefined,
        // Idempotency key: same key = same order, prevents double-submit on network retry
        client_order_id: crypto.randomUUID(),
        items: items.map((i) => ({ menu_item_id: i.id, quantity: i.quantity })),
      };

      const { data } = await placeOrder(slug, orderPayload);
      clearCart();
      // Save to device so order persists on refresh (session kept for future orders)
      upsertOrder(slug, data.order);
      navigate(`/cafe/${slug}/confirmation`, { state: { order: data.order } });
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white min-h-screen pb-32">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
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
        {activeOrders.length === 0 && (
          <span className="text-sm text-gray-400">{session.table_number}</span>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-3">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">₹{parseFloat(item.price).toFixed(2)} each</p>
            </div>
            <QuantityControl
              qty={item.quantity}
              onDecrement={() => updateQty(item.id, item.quantity - 1)}
              onIncrement={() => updateQty(item.id, item.quantity + 1)}
            />
            <span className="font-bold text-sm w-16 text-right">
              ₹{(parseFloat(item.price) * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="px-4">
        <label className="label">Special Instructions (optional)</label>
        <textarea
          className="input resize-none"
          rows={2}
          placeholder="e.g. No sugar, extra spicy..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {offerPreview?.applied && (
        <div className="mx-4 mt-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
          <span className="text-green-500 text-lg">🎉</span>
          <div>
            <p className="text-xs font-semibold text-green-800">{offerPreview.offer_name} applied!</p>
            <p className="text-xs text-green-600">You save ₹{discountAmt.toFixed(2)} on this order</p>
          </div>
        </div>
      )}

      <div className="mx-4 mt-4 bg-gray-50 rounded-xl p-4">
        <h3 className="font-semibold text-gray-800 mb-3">Bill Summary</h3>
        <div className="space-y-1 text-sm">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-gray-600">
              <span>{item.name} × {item.quantity}</span>
              <span>₹{(parseFloat(item.price) * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 mt-3 pt-3 space-y-1.5 text-sm">
          {hasGst ? (
            taxInclusive ? (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Base amount</span>
                  <span>₹{taxableAmt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>CGST ({(gstRate / 2).toFixed(1)}%)</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>SGST ({(gstRate / 2).toFixed(1)}%)</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600 font-medium border-t border-gray-100 pt-1">
                  <span>Subtotal (GST {gstRate}% incl.)</span>
                  <span>₹{total.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>₹{total.toFixed(2)}</span>
                </div>
                {discountAmt > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Discount</span>
                    <span>−₹{discountAmt.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>CGST ({(gstRate / 2).toFixed(1)}%)</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>SGST ({(gstRate / 2).toFixed(1)}%)</span>
                  <span>₹{(totalTax / 2).toFixed(2)}</span>
                </div>
              </>
            )
          ) : (
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>₹{total.toFixed(2)}</span>
            </div>
          )}
          {offerPreview?.applied && taxInclusive && (
            <div className="flex justify-between text-green-600 font-medium">
              <span>🎉 {offerPreview.offer_name || 'Offer applied'}</span>
              <span>−₹{discountAmt.toFixed(2)}</span>
            </div>
          )}
          {tip > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Tip</span>
              <span>₹{tip.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
            <span>Total</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Tip selector */}
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
              {t === 0 ? 'No tip' : `₹${t}`}
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

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-2">
          {!cafeOpen && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
              🔴 This café is currently closed — orders cannot be placed right now.
            </div>
          )}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={loading || !cafeOpen}
            className="btn-primary w-full flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{loading ? 'Placing order...' : 'Place Order'}</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </button>
        </div>
      </div>

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

              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <div className="flex justify-between text-sm text-gray-500 mb-1">
                  <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                  <span>{session.table_number}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900">
                  <span>Total</span>
                  <span>₹{total.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={handlePlaceOrder}
                  disabled={loading}
                  className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Placing...' : 'Yes, Place Order'}
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
