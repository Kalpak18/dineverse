import { useState, useEffect, useCallback } from 'react';
import { getOrders, updateOrderStatus, updateItemStatus } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import PageHint from '../../components/PageHint';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';

const READY_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
const OVERDUE_MS = 25 * 60 * 1000;

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function WaiterPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const now = useTimer();

  const fetchOrders = useCallback(async () => {
    try {
      const { data } = await getOrders({ limit: 200 });
      setOrders((data.orders || []).filter((o) => READY_STATUSES.includes(o.status)));
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
      if (READY_STATUSES.includes(order.status)) {
        setOrders((prev) => {
          const exists = prev.find((o) => o.id === order.id);
          return exists ? prev.map((o) => o.id === order.id ? { ...o, ...order } : o) : [order, ...prev];
        });
        toast('New order!', { icon: '🔔' });
      }
    },
    (updated) => {
      setOrders((prev) => {
        if (!READY_STATUSES.includes(updated.status)) return prev.filter((o) => o.id !== updated.id);
        return prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o);
      });
    }
  );

  const handleItemServe = async (orderId, itemId) => {
    try {
      const { data } = await updateItemStatus(orderId, itemId, 'served');
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, ...data.order } : o));
    } catch {
      toast.error('Failed to mark item served');
    }
  };

  const handleOrderServe = async (order) => {
    try {
      await updateOrderStatus(order.id, 'served');
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: 'served' } : o));
    } catch {
      toast.error('Failed to mark order served');
    }
  };

  // Filter to only orders that have something ready for the waiter
  const waiterOrders = orders.filter((o) => {
    if (o.status === 'ready') return true;
    if (o.kitchen_mode === 'individual') {
      return (o.items || []).some((i) => i.item_status === 'ready');
    }
    return false;
  }).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (loading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col bg-gray-950 text-white -m-4 md:-m-6 min-h-screen">
      <PageHint
        storageKey="dv_hint_waiter"
        title="Waiter View — food ready at the pass, waiting to be delivered to tables"
        items={[
          { icon: '🛎️', text: 'Orders appear here the moment kitchen marks them ready. No need to shout across the kitchen.' },
          { icon: '🍽️', text: 'Tap "Serve" on each item once you\'ve placed it on the customer\'s table. The order clears automatically when everything is served.' },
          { icon: '⚡', text: '"Mark All Served" clears the whole order at once — use it when you deliver everything in one trip.' },
          { icon: '📝', text: 'Check the order notes (amber box) for special requests like "extra spice" or "allergy: nuts" before delivering.' },
          { icon: '🔴', text: 'Red border = order has been waiting over 25 minutes. Prioritise these.' },
        ]}
        tip="Keep this page open on your floor device. Ready orders appear in real time — you'll never miss a pickup."
      />

      <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🍽️</span>
          <h1 className="font-bold text-sm md:text-base">Waiter — Ready to Serve</h1>
          <span className="text-xs text-gray-500">{cafe?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {waiterOrders.length > 0 && (
            <span className="text-xs font-bold bg-teal-600 text-white px-2 py-0.5 rounded-full">
              {waiterOrders.length} ready
            </span>
          )}
          <button
            onClick={fetchOrders}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {waiterOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-24 text-gray-600">
          <span className="text-6xl mb-4 opacity-20">🍽️</span>
          <p className="text-lg font-medium text-gray-500">Nothing to serve yet</p>
          <p className="text-sm text-gray-600 mt-1">Ready orders appear here the moment kitchen marks them ready.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {waiterOrders.map((order) => {
              const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
              const readyItems = order.kitchen_mode === 'individual'
                ? (order.items || []).filter((i) => i.item_status === 'ready')
                : (order.items || []);
              const isWholeOrderReady = order.status === 'ready' && order.kitchen_mode !== 'individual';

              return (
                <div key={order.id} className={`rounded-xl border-l-4 p-3 bg-teal-950/40 ${overdue ? 'border-red-500' : 'border-teal-400'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-bold text-white text-xl">
                        {order.order_type === 'dine-in' ? `TABLE ${order.table_number}` : fmtToken(order.daily_order_number, order.order_type)}
                      </span>
                      {order.order_type === 'dine-in' && (
                        <span className="ml-2 text-xs text-teal-400 font-semibold">{fmtToken(order.daily_order_number, order.order_type)}</span>
                      )}
                    </div>
                    <span className="text-xs text-teal-300 bg-teal-900/60 px-2 py-0.5 rounded-full font-semibold">
                      🛎️ READY
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mb-0.5">{order.customer_name}</p>
                  <p className="text-xs text-gray-500 mb-3">{fmtTime(order.created_at)}</p>

                  <div className="space-y-1.5 mb-3">
                    {isWholeOrderReady ? (
                      (order.items || []).map((item) => (
                        <div key={item.id} className="flex items-center gap-2 bg-teal-900/30 rounded-lg px-2 py-1.5">
                          <span className="w-6 h-6 rounded bg-teal-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{item.quantity}</span>
                          <span className="flex-1 text-sm font-semibold text-teal-100">{item.item_name}</span>
                        </div>
                      ))
                    ) : (
                      readyItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 bg-teal-900/30 rounded-lg px-2 py-1.5">
                          <span className="w-6 h-6 rounded bg-teal-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{item.quantity}</span>
                          <span className="flex-1 text-sm font-semibold text-teal-100">{item.item_name}</span>
                          <button
                            onClick={() => handleItemServe(order.id, item.id)}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors flex-shrink-0"
                          >
                            Serve
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {order.notes && (
                    <p className="text-xs text-amber-400 mb-2 bg-amber-950/30 rounded px-2 py-1">📝 {order.notes}</p>
                  )}

                  {isWholeOrderReady ? (
                    <button
                      onClick={() => handleOrderServe(order)}
                      className="w-full py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      ✅ Mark All Served
                    </button>
                  ) : readyItems.length > 1 && (
                    <button
                      onClick={async () => {
                        for (const item of readyItems) {
                          await handleItemServe(order.id, item.id).catch(() => {});
                        }
                      }}
                      className="w-full py-2 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      ✅ Serve All {readyItems.length} Items
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
