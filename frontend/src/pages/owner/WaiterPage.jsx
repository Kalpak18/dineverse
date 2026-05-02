import { useState, useEffect, useCallback } from 'react';
import { getOrders, updateOrderStatus, updateItemStatus } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import PageHint from '../../components/PageHint';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];
const OVERDUE_MS = 25 * 60 * 1000;

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const STATUS_LABEL = {
  pending:   { text: 'Waiting',   color: 'text-yellow-400 bg-yellow-900/40' },
  confirmed: { text: 'Accepted',  color: 'text-blue-400   bg-blue-900/40'   },
  preparing: { text: 'Cooking',   color: 'text-orange-400 bg-orange-900/40' },
  ready:     { text: '🛎️ READY',   color: 'text-teal-300  bg-teal-900/60 font-bold' },
};

export default function WaiterPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [serving, setServing] = useState({});
  const now = useTimer();

  const fetchOrders = useCallback(async () => {
    try {
      const { data } = await getOrders({ limit: 200 });
      setOrders((data.orders || []).filter((o) => ACTIVE_STATUSES.includes(o.status)));
    } catch {
      toast.error('Could not load orders — check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useSocketIO(
    cafe?.id,
    (order) => {
      if (ACTIVE_STATUSES.includes(order.status)) {
        setOrders((prev) => {
          const exists = prev.find((o) => o.id === order.id);
          if (!exists) toast('New order!', { icon: '🔔' });
          return exists
            ? prev.map((o) => o.id === order.id ? { ...o, ...order } : o)
            : [order, ...prev];
        });
      }
    },
    (updated) => {
      setOrders((prev) => {
        if (!ACTIVE_STATUSES.includes(updated.status))
          return prev.filter((o) => o.id !== updated.id);
        return prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o);
      });
    }
  );

  const handleOrderServe = async (orderId) => {
    setServing((s) => ({ ...s, [orderId]: true }));
    try {
      await updateOrderStatus(orderId, 'served');
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      toast.success('Order marked as served');
    } catch {
      toast.error('Failed — try again');
    } finally {
      setServing((s) => ({ ...s, [orderId]: false }));
    }
  };

  const handleItemServe = async (orderId, itemId) => {
    try {
      const { data } = await updateItemStatus(orderId, itemId, 'served');
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, ...data.order } : o));
    } catch (e) {
      const msg = e?.response?.data?.message || '';
      if (msg.toLowerCase().includes('premium')) {
        toast.error('Per-item serving requires Kitchen Pro. Use "Mark All Served" instead.');
      } else {
        toast.error('Failed to mark item served');
      }
    }
  };

  const readyOrders   = orders.filter((o) => o.status === 'ready').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const activeOrders  = orders.filter((o) => o.status !== 'ready').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (loading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col bg-gray-950 text-white -m-4 md:-m-6 min-h-screen">
      <PageHint
        storageKey="dv_hint_waiter"
        title="Waiter View — track all live orders and mark ready dishes as served"
        items={[
          { icon: '🛎️', text: 'Ready orders glow teal at the top — these need to be delivered now. Tap "✅ Mark All Served" once you\'ve placed everything on the table.' },
          { icon: '🍳', text: 'In-progress orders (Accepted / Cooking) are shown below so you know what\'s coming and can plan your trips.' },
          { icon: '🍽️', text: 'Kitchen Pro: tap "Serve" on individual items if only part of an order is ready. The order closes automatically when everything is served.' },
          { icon: '📝', text: 'Check the amber notes box for special requests (extra spice, allergies) before delivering.' },
          { icon: '🔴', text: 'Red border = order waiting over 25 minutes. Prioritise these.' },
        ]}
        tip="Keep this page open on your floor device. Orders update in real time — you\'ll see them the moment kitchen marks them ready."
      />

      {/* Header */}
      <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🍽️</span>
          <h1 className="font-bold text-sm md:text-base">Waiter</h1>
          <span className="text-xs text-gray-500">{cafe?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {readyOrders.length > 0 && (
            <span className="text-xs font-bold bg-teal-600 text-white px-2 py-0.5 rounded-full animate-pulse">
              {readyOrders.length} ready
            </span>
          )}
          {activeOrders.length > 0 && (
            <span className="text-xs font-medium bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
              {activeOrders.length} in kitchen
            </span>
          )}
          <button onClick={fetchOrders} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
            ↻
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-24 text-gray-600">
          <span className="text-6xl mb-4 opacity-20">🍽️</span>
          <p className="text-lg font-medium text-gray-500">All clear — no active orders</p>
          <p className="text-sm text-gray-600 mt-1">Orders appear here as soon as they come in.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-5">

          {/* ── Ready to serve ── */}
          {readyOrders.length > 0 && (
            <section>
              <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-2 px-1">🛎️ Ready to Serve ({readyOrders.length})</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {readyOrders.map((order) => {
                  const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
                  const isIndividual = order.kitchen_mode === 'individual';
                  const readyItems = isIndividual
                    ? (order.items || []).filter((i) => i.item_status === 'ready')
                    : (order.items || []);
                  const isServingThis = serving[order.id];

                  return (
                    <div key={order.id} className={`rounded-xl border-l-4 p-3 bg-teal-950/40 ${overdue ? 'border-red-500' : 'border-teal-400'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-white text-xl">
                          {order.order_type === 'dine-in' ? `TABLE ${order.table_number}` : fmtToken(order.daily_order_number, order.order_type)}
                        </span>
                        <span className="text-[10px] text-teal-300 bg-teal-900/60 px-2 py-0.5 rounded-full font-bold">
                          🛎️ READY
                        </span>
                      </div>
                      {order.customer_name && <p className="text-sm text-gray-300 mb-0.5">{order.customer_name}</p>}
                      <p className="text-xs text-gray-500 mb-3">{fmtTime(order.created_at)}</p>

                      <div className="space-y-1.5 mb-3">
                        {readyItems.map((item) => (
                          <div key={item.id} className="flex items-center gap-2 bg-teal-900/30 rounded-lg px-2 py-1.5">
                            <span className="w-6 h-6 rounded bg-teal-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{item.quantity}</span>
                            <span className="flex-1 text-sm font-semibold text-teal-100">{item.item_name}</span>
                            {isIndividual && (
                              <button
                                onClick={() => handleItemServe(order.id, item.id)}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white font-bold transition-colors flex-shrink-0"
                              >
                                Serve
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {order.notes && (
                        <p className="text-xs text-amber-400 mb-2 bg-amber-950/30 rounded px-2 py-1">📝 {order.notes}</p>
                      )}

                      {/* Mark All Served — always shown for ready orders regardless of kitchen mode */}
                      <button
                        onClick={() => handleOrderServe(order.id)}
                        disabled={isServingThis}
                        className="w-full py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white transition-colors"
                      >
                        {isServingThis ? '…' : '✅ Mark All Served'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── In kitchen ── */}
          {activeOrders.length > 0 && (
            <section>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">🍳 In Kitchen ({activeOrders.length})</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {activeOrders.map((order) => {
                  const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
                  const cfg = STATUS_LABEL[order.status] || {};
                  return (
                    <div key={order.id} className={`rounded-xl border-l-4 p-3 bg-gray-900/60 ${overdue ? 'border-red-700' : 'border-gray-700'} opacity-80`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-gray-200 text-xl">
                          {order.order_type === 'dine-in' ? `TABLE ${order.table_number}` : fmtToken(order.daily_order_number, order.order_type)}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.text}</span>
                      </div>
                      {order.customer_name && <p className="text-sm text-gray-400 mb-0.5">{order.customer_name}</p>}
                      <p className="text-xs text-gray-600 mb-2">{fmtTime(order.created_at)}</p>
                      <div className="space-y-1">
                        {(order.items || []).map((item) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-5 text-right flex-shrink-0">{item.quantity}×</span>
                            <span className="text-xs text-gray-400">{item.item_name}</span>
                          </div>
                        ))}
                      </div>
                      {order.notes && (
                        <p className="text-xs text-amber-500 mt-2 bg-amber-950/20 rounded px-2 py-1">📝 {order.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
