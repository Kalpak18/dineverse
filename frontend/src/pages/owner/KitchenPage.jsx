import { useState, useEffect, useCallback, useRef } from 'react';
import { getOrders, updateOrderStatus, updateItemStatus, acceptOrder, rejectOrder, acceptItem, rejectItem } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
import toast from 'react-hot-toast';

function KitchenHint() {
  const [open, setOpen] = useState(() => !localStorage.getItem('dv_hint_kitchen'));
  if (!open) return null;
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-start gap-3 text-sm text-gray-300">
      <span className="text-yellow-400 flex-shrink-0 mt-0.5">💡</span>
      <div className="flex-1 space-y-1">
        <p><strong className="text-white">Kitchen Display</strong> — keep this open on the kitchen screen throughout service.</p>
        <p>Orders arrive in <strong className="text-yellow-400">Pending</strong> → tap the button to move them to <strong className="text-blue-400">Confirmed</strong> → <strong className="text-orange-400">Preparing</strong> → <strong className="text-green-400">Ready</strong>.</p>
        <p>Individual KOT mode shows every item separately. Start each item, move it to ready, then serve it when complete.</p>
        <p>Red timer = order is <strong className="text-red-400">overdue (15+ min)</strong>. Customer notes are highlighted in amber.</p>
      </div>
      <button onClick={() => { localStorage.setItem('dv_hint_kitchen', '1'); setOpen(false); }} className="text-gray-500 hover:text-gray-300 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}

// ── Kitchen token print ────────────────────────────────────────
function printKitchenToken(order, cafeName, servedItems = null) {
  const num = String(order.daily_order_number).padStart(2, '0');
  const isTakeaway = order.order_type === 'takeaway';
  const isDelivery = order.order_type === 'delivery';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  // For individual mode, only print served items if specified, otherwise all items
  let itemsToPrint = order.items || [];
  if (order.kitchen_mode === 'individual' && servedItems) {
    itemsToPrint = itemsToPrint.filter(item => servedItems.includes(item.id));
  }

  const itemRows = itemsToPrint.map((i) => `
    <tr>
      <td class="qty">${i.quantity}</td>
      <td class="item">${i.item_name}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Courier New', monospace;
      width: 80mm;
      margin: 0 auto;
      padding: 6mm 4mm 10mm;
      background: #fff;
      color: #000;
    }
    .cafe-name {
      text-align: center;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #555;
      margin-bottom: 4px;
    }
    .token-box {
      border: 3px solid #000;
      border-radius: 6px;
      text-align: center;
      padding: 8px 4px 6px;
      margin: 0 0 6px;
    }
    .token-label {
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #777;
      margin-bottom: 2px;
    }
    .token-num {
      font-size: 52px;
      font-weight: 900;
      letter-spacing: 3px;
      line-height: 1;
    }
    .type-badge {
      display: inline-block;
      margin-top: 4px;
      font-size: 12px;
      font-weight: bold;
      letter-spacing: 1px;
      border: 1.5px solid #000;
      border-radius: 20px;
      padding: 2px 10px;
    }
    .sep { border: none; border-top: 1px dashed #aaa; margin: 5px 0; }
    .sep-solid { border: none; border-top: 1.5px solid #000; margin: 5px 0; }
    .meta { font-size: 10px; color: #444; margin-bottom: 4px; }
    table { width:100%; border-collapse:collapse; margin: 4px 0; }
    .qty {
      width: 28px;
      font-size: 16px;
      font-weight: 900;
      vertical-align: middle;
      padding: 3px 4px 3px 0;
    }
    .item {
      font-size: 14px;
      font-weight: bold;
      vertical-align: middle;
      padding: 3px 0;
    }
    .notes {
      font-size: 11px;
      color: #c00;
      font-weight: bold;
      margin-top: 4px;
      padding: 3px 5px;
      border: 1px dashed #c00;
      border-radius: 4px;
    }
    .footer {
      text-align: center;
      font-size: 10px;
      color: #888;
      margin-top: 6px;
    }
    @media print {
      @page { size: 80mm auto; margin: 0; }
      body { padding: 4mm 3mm 10mm; }
    }
  </style>
</head>
<body>
  <div class="cafe-name">${cafeName || 'Kitchen'}</div>

  <div class="token-box">
    <div class="token-label">Order Token</div>
    <div class="token-num">${isTakeaway ? `TK ${num}` : isDelivery ? `D ${num}` : `#${num}`}</div>
    <div class="type-badge">${isTakeaway ? '🥡 TAKEAWAY' : isDelivery ? '🚚 DELIVERY' : `🍽️ TABLE ${order.table_number}`}</div>
  </div>

  <div class="meta">${order.customer_name} &nbsp;·&nbsp; ${dateStr} ${timeStr}</div>
  <hr class="sep-solid"/>

  <table>
    <tbody>${itemRows}</tbody>
  </table>

  <hr class="sep"/>

  ${order.notes ? `<div class="notes">📝 ${order.notes}</div>` : ''}

  <script>
    window.onload = function() {
      window.focus();
    };
    function doPrint() {
      window.print();
      window.onafterprint = function() { window.close(); };
    }
  <\/script>
  <div style="text-align:center;margin-top:10px;">
    <button onclick="doPrint()" style="font-family:'Courier New',monospace;font-size:13px;font-weight:bold;padding:8px 28px;border:2px solid #000;border-radius:6px;background:#000;color:#fff;cursor:pointer;letter-spacing:1px;">
      🖨 PRINT
    </button>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=380,height=580,toolbar=0,menubar=0,scrollbars=0');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Pop-up blocked. Allow pop-ups to print kitchen tokens.');
}

// How long (ms) before an order flashes red as overdue
const OVERDUE_MS = 15 * 60 * 1000; // 15 minutes

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000); // refresh every 30s
    return () => clearInterval(id);
  }, []);
  return now;
}

function elapsed(createdAt, now) {
  const diff = now - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

const ITEM_STATUS_PRIORITY = {
  pending: 0,
  preparing: 1,
  ready: 2,
  served: 3,
};

const ITEM_STATUS_LABEL = {
  pending: 'Pending',
  preparing: 'Cooking',
  ready: 'Ready',
  served: 'Served',
};

const ITEM_STATUS_STYLE = {
  pending: 'bg-gray-100 text-gray-600',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-teal-100 text-teal-700',
  served: 'bg-green-100 text-green-700',
};

const KITCHEN_STATUSES = ['pending', 'confirmed', 'preparing'];

const STATUS_COLORS = {
  pending:   'border-yellow-400 bg-yellow-950/30',
  confirmed: 'border-blue-400  bg-blue-950/30',
  preparing: 'border-orange-400 bg-orange-950/30',
};

const ACTION_COLORS = {
  pending:   'bg-blue-600 hover:bg-blue-500',
  confirmed: 'bg-orange-600 hover:bg-orange-500',
  preparing: 'bg-green-600 hover:bg-green-500',
};

export default function KitchenPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedItems, setSelectedItems] = useState({}); // orderId -> Set of itemIds
  const now = useTimer();
  const audioRef = useRef(null);

  const playChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      // Simple beep via Web Audio API — no file needed
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 150, 300].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + delay / 1000);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay / 1000 + 0.3);
        osc.start(ctx.currentTime + delay / 1000);
        osc.stop(ctx.currentTime + delay / 1000 + 0.3);
      });
    } catch { /* audio not available */ }
  }, [soundEnabled]);

  const fetchOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await getOrders({ limit: 100 });
      setOrders(data.orders.filter((o) => KITCHEN_STATUSES.includes(o.status)));
      if (isRefresh) toast('Orders refreshed', { icon: '✓', style: { background: '#1f2937', color: '#fff' } });
    } catch { toast.error('Failed to load orders'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useSocketIO(
    cafe?.id,
    (order) => {
      if (KITCHEN_STATUSES.includes(order.status)) {
        setOrders((prev) => [order, ...prev]);
        playChime();
        toast('New order!', { icon: '🔔', style: { background: '#1f2937', color: '#fff' } });
      }
    },
    (updated) => {
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(updated.status)) {
          return prev.filter((o) => o.id !== updated.id);
        }
        return prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o);
      });
    }
  );

  const handleAdvance = async (order) => {
    const next = getNextStatus(order.status, order.order_type);
    if (!next) return;
    try {
      await updateOrderStatus(order.id, next);
      if (!KITCHEN_STATUSES.includes(next)) {
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } else {
        setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: next } : o));
      }
    } catch { toast.error('Failed to update order'); }
  };

  const handleItemUpdate = async (orderId, itemId, status) => {
    try {
      const { data } = await updateItemStatus(orderId, itemId, status);
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(data.order.status)) {
          return prev.filter((o) => o.id !== orderId);
        }
        return prev.map((o) => (o.id === orderId ? data.order : o));
      });

      // Print token when item is served in individual mode
      if (status === 'served' && data.order.kitchen_mode === 'individual') {
        printKitchenToken(data.order, cafe?.name, [itemId]);
      }
    } catch {
      toast.error('Failed to update item status');
    }
  };

  const handleAcceptOrder = async (orderId) => {
    try {
      const { data } = await acceptOrder(orderId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      toast.success('Order accepted');
    } catch {
      toast.error('Failed to accept order');
    }
  };

  const handleRejectOrder = async (orderId) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason || !reason.trim()) return;
    try {
      const { data } = await rejectOrder(orderId, reason.trim());
      setOrders((prev) => prev.filter((o) => o.id !== orderId)); // Remove cancelled order
      toast.success('Order rejected');
    } catch {
      toast.error('Failed to reject order');
    }
  };

  const handleAcceptItem = async (orderId, itemId) => {
    try {
      const { data } = await acceptItem(orderId, itemId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      toast.success('Item accepted');
    } catch {
      toast.error('Failed to accept item');
    }
  };

  const handleRejectItem = async (orderId, itemId) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason || !reason.trim()) return;
    try {
      const { data } = await rejectItem(orderId, itemId, reason.trim());
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      toast.success('Item rejected');
    } catch {
      toast.error('Failed to reject item');
    }
  };

  const toggleItemSelection = (orderId, itemId) => {
    setSelectedItems((prev) => {
      const orderSelections = prev[orderId] || new Set();
      const newSelections = new Set(orderSelections);
      if (newSelections.has(itemId)) {
        newSelections.delete(itemId);
      } else {
        newSelections.add(itemId);
      }
      return { ...prev, [orderId]: newSelections };
    });
  };

  const handleServeSelected = async (orderId) => {
    const selected = selectedItems[orderId] || new Set();
    if (selected.size === 0) return;

    try {
      // Update all selected items to served
      const promises = Array.from(selected).map(itemId => updateItemStatus(orderId, itemId, 'served'));
      const results = await Promise.all(promises);

      // Update orders state with the last result
      const lastResult = results[results.length - 1];
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(lastResult.data.order.status)) {
          return prev.filter((o) => o.id !== orderId);
        }
        return prev.map((o) => (o.id === orderId ? lastResult.data.order : o));
      });

      // Print token with served items
      printKitchenToken(lastResult.data.order, cafe?.name, Array.from(selected));

      // Clear selection
      setSelectedItems((prev) => ({ ...prev, [orderId]: new Set() }));

      toast.success(`${selected.size} item${selected.size > 1 ? 's' : ''} served`);
    } catch {
      toast.error('Failed to serve selected items');
    }
  };

  const sortItems = (items) => {
    return [...(items || [])].sort((a, b) => {
      const aPriority = ITEM_STATUS_PRIORITY[a.item_status || 'pending'] ?? 0;
      const bPriority = ITEM_STATUS_PRIORITY[b.item_status || 'pending'] ?? 0;
      return aPriority - bPriority;
    });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  };

  // Group orders by status column
  const byStatus = KITCHEN_STATUSES.reduce((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading kitchen...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🍳</span>
          <h1 className="font-bold text-lg">Kitchen Display</h1>
          <span className="text-xs text-gray-500">{cafe?.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{orders.length} active order{orders.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setSoundEnabled((s) => !s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${soundEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500'}`}
            title="Toggle sound alerts"
          >
            {soundEnabled ? '🔔 Sound On' : '🔕 Muted'}
          </button>
          <button
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >
            {fullscreen ? '⛶ Exit' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      <KitchenHint />

      {/* ── Columns ── */}
      <div className="flex-1 grid grid-cols-3 gap-0 divide-x divide-gray-800 overflow-hidden">
        {KITCHEN_STATUSES.map((status) => {
          const cfg = STATUS_CONFIG[status];
          const col = byStatus[status];
          return (
            <div key={status} className="flex flex-col overflow-hidden">
              {/* Column header */}
              <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
                <span className="font-bold text-sm uppercase tracking-wide text-gray-300">{cfg.label}</span>
                {col.length > 0 && (
                  <span className="w-6 h-6 rounded-full bg-gray-700 text-xs font-bold flex items-center justify-center text-white">
                    {col.length}
                  </span>
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {col.length === 0 ? (
                  <div className="text-center py-12 text-gray-700 text-sm">No orders</div>
                ) : (
                  col.map((order) => {
                    const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
                    const nextStatus = getNextStatus(order.status, order.order_type);
                    const actionLabel = getActionLabel(order.status, order.order_type);
                    return (
                      <div
                        key={order.id}
                        className={`rounded-xl border-l-4 p-4 ${STATUS_COLORS[status]} ${overdue ? 'animate-pulse border-red-500 bg-red-950/40' : ''}`}
                      >
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-bold text-white text-xl">
                              {fmtToken(order.daily_order_number, order.order_type)}
                            </span>
                            <span className="text-gray-600 text-xs ml-1.5">today</span>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
                            {elapsed(order.created_at, now)}
                          </span>
                        </div>

                        {/* Table + type */}
                        <p className="text-sm text-gray-300 mb-1">
                          {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
                        </p>
                        <p className="text-xs text-gray-500 mb-3">{order.customer_name} · {fmtTime(order.created_at)}</p>

                        {/* Kitchen mode + progress */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="text-[11px] uppercase tracking-wide text-gray-400">
                            {order.kitchen_mode === 'individual' ? 'Individual KOT' : 'Combined'}
                          </span>
                          <span className="text-[11px] uppercase tracking-wide text-gray-400">
                            {order.items?.length || 0} items
                            {order.kitchen_mode === 'individual' && (
                              <> · {(order.items || []).filter((i) => i.item_status === 'ready' || i.item_status === 'served').length} ready</>
                            )}
                          </span>
                        </div>

                        {/* Order acceptance/rejection for individual mode */}
                        {order.kitchen_mode === 'individual' && !order.accepted && order.status === 'pending' && (
                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={() => handleAcceptOrder(order.id)}
                              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-500 transition-colors"
                            >
                              ✅ Accept Order
                            </button>
                            <button
                              onClick={() => handleRejectOrder(order.id)}
                              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors"
                            >
                              ❌ Reject Order
                            </button>
                          </div>
                        )}

                        {(order.kitchen_mode === 'individual') ? (
                          <div className="space-y-2 mb-4">
                            {sortItems(order.items).map((item) => {
                              const isSelected = (selectedItems[order.id] || new Set()).has(item.id);
                              const hasReadyItems = (order.items || []).some(i => i.item_status === 'ready');
                              return (
                                <div key={item.id} className="rounded-2xl bg-gray-900/80 border border-gray-800 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        {item.item_status === 'ready' && (
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleItemSelection(order.id, item.id)}
                                            className="w-4 h-4 text-emerald-600 bg-gray-800 border-gray-600 rounded focus:ring-emerald-500"
                                          />
                                        )}
                                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gray-800 text-sm font-bold text-white">{item.quantity}</span>
                                        <span className="text-sm font-semibold text-white">{item.item_name}</span>
                                      </div>
                                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${ITEM_STATUS_STYLE[item.item_status] || 'bg-gray-100 text-gray-600'}`}>
                                        {ITEM_STATUS_LABEL[item.item_status] || item.item_status}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {!item.accepted && order.accepted && (
                                        <>
                                          <button
                                            onClick={() => handleAcceptItem(order.id, item.id)}
                                            className="text-[11px] px-2 py-1 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors"
                                          >
                                            Accept
                                          </button>
                                          <button
                                            onClick={() => handleRejectItem(order.id, item.id)}
                                            className="text-[11px] px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
                                          >
                                            Reject
                                          </button>
                                        </>
                                      )}
                                      {item.item_status === 'pending' && item.accepted && (
                                        <button
                                          onClick={() => handleItemUpdate(order.id, item.id, 'preparing')}
                                          className="text-[11px] px-3 py-1 rounded-xl bg-orange-600 text-white hover:bg-orange-500 transition-colors"
                                        >
                                          Start
                                        </button>
                                      )}
                                      {item.item_status === 'preparing' && (
                                        <button
                                          onClick={() => handleItemUpdate(order.id, item.id, 'ready')}
                                          className="text-[11px] px-3 py-1 rounded-xl bg-teal-600 text-white hover:bg-teal-500 transition-colors"
                                        >
                                          Ready
                                        </button>
                                      )}
                                      {item.item_status === 'ready' && (
                                        <button
                                          onClick={() => handleItemUpdate(order.id, item.id, 'served')}
                                          className="text-[11px] px-3 py-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                                        >
                                          Serve
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {/* Serve Selected button */}
                            {(selectedItems[order.id]?.size > 0) && (
                              <button
                                onClick={() => handleServeSelected(order.id)}
                                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
                              >
                                🍽️ Serve {selectedItems[order.id].size} Selected Item{selectedItems[order.id].size > 1 ? 's' : ''}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5 mb-4">
                            {(order.items || []).map((item) => (
                              <div key={item.id} className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                                  {item.quantity}
                                </span>
                                <span className="text-sm text-gray-200 font-medium">{item.item_name}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {order.notes && (
                          <p className="text-xs text-amber-400 mb-3 bg-amber-950/30 rounded-lg px-2 py-1">
                            📝 {order.notes}
                          </p>
                        )}

                        {/* Action button */}
                        {nextStatus && !(order.kitchen_mode === 'individual' && order.status === 'preparing') && (
                          <button
                            onClick={() => handleAdvance(order)}
                            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${ACTION_COLORS[status]}`}
                          >
                            {actionLabel} →
                          </button>
                        )}

                        {/* Manual print slip — waiter confirms table, customer verifies items */}
                        <button
                          onClick={() => printKitchenToken(order, cafe?.name)}
                          className="w-full mt-1.5 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
                        >
                          🖨 Print Slip
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
