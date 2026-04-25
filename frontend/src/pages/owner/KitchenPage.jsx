import { useState, useEffect, useCallback, useRef } from 'react';
import { getOrders, updateOrderStatus, updateItemStatus, acceptOrder, rejectOrder, acceptItem, rejectItem, cancelOrderItem, reorderOrderItems, generateOrderKot, getKotHistory } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
import toast from 'react-hot-toast';

// ─── KOT print ────────────────────────────────────────────────
function printKot(kot, cafeName) {
  const items = Array.isArray(kot.items) ? kot.items : [];
  const isTakeaway = !kot.table_number;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const itemRows = items.map((i, idx) => `
    <tr class="${idx % 2 === 1 ? 'alt' : ''}">
      <td class="sno">${idx + 1}</td>
      <td class="qty">${i.quantity}</td>
      <td class="item">${esc(i.item_name)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>KOT #${kot.slip_number}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',Courier,monospace; font-size:12px; width:80mm; margin:0 auto;
           padding:4mm 3mm 12mm; background:#fff; color:#000; }

    /* ── Header ── */
    .cafe-name { text-align:center; font-size:13px; font-weight:900; text-transform:uppercase;
                 letter-spacing:2px; border-bottom:2px solid #000; padding-bottom:4px; margin-bottom:4px; }
    .cafe-sub  { text-align:center; font-size:9px; color:#555; letter-spacing:1px;
                 text-transform:uppercase; margin-bottom:6px; }

    /* ── KOT title bar ── */
    .kot-title { background:#000; color:#fff; text-align:center; font-size:11px; font-weight:900;
                 letter-spacing:3px; text-transform:uppercase; padding:3px 0; margin-bottom:6px; }

    /* ── Table / order info ── */
    .info-row  { display:flex; justify-content:space-between; font-size:10px; margin-bottom:2px; }
    .info-row .label { color:#555; }
    .info-row .value { font-weight:700; }
    .order-id  { font-size:28px; font-weight:900; text-align:center; letter-spacing:2px;
                 border:2px solid #000; border-radius:4px; padding:4px 0; margin:6px 0; }
    .order-type { text-align:center; font-size:10px; font-weight:700; text-transform:uppercase;
                  letter-spacing:2px; margin-bottom:4px; }

    /* ── Separator ── */
    .sep  { border:none; border-top:1px dashed #888; margin:5px 0; }
    .sep2 { border:none; border-top:2px solid #000; margin:5px 0; }

    /* ── Items ── */
    table { width:100%; border-collapse:collapse; }
    thead th { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1px;
               border-bottom:1px solid #000; padding:2px 2px 3px; }
    th.sno, td.sno { text-align:center; width:10%; }
    th.qty, td.qty { text-align:center; width:12%; font-weight:900; font-size:13px; }
    th.item        { text-align:left; }
    td.item        { font-size:13px; font-weight:700; padding:4px 2px; line-height:1.3; }
    tr.alt td      { background:#f8f8f8; }

    /* ── Footer ── */
    .footer { text-align:center; font-size:10px; color:#444; border-top:1px dashed #888;
              padding-top:5px; margin-top:6px; letter-spacing:1px; }
    .print-btn { text-align:center; margin-top:10px; }

    @media print {
      @page { size:80mm auto; margin:0; }
      body  { padding:3mm 2mm 10mm; }
      .print-btn { display:none; }
    }
  </style>
</head>
<body>
  <div class="cafe-name">${esc(cafeName || 'KITCHEN')}</div>
  <div class="cafe-sub">Kitchen Order Ticket</div>

  <div class="kot-title">KOT — SLIP #${kot.slip_number}</div>

  <div class="order-id">${isTakeaway ? 'TAKEAWAY' : `TABLE ${esc(String(kot.table_number))}`}</div>
  ${kot.customer_name ? `<div class="order-type">${esc(kot.customer_name)}</div>` : ''}

  <div class="info-row">
    <span class="label">Date</span><span class="value">${dateStr}</span>
  </div>
  <div class="info-row">
    <span class="label">Time</span><span class="value">${timeStr}</span>
  </div>

  <hr class="sep2"/>

  <table>
    <thead>
      <tr><th class="sno">#</th><th class="qty">Qty</th><th class="item">Item</th></tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="footer">
    ${items.length} item${items.length !== 1 ? 's' : ''}
  </div>

  <div class="print-btn">
    <button onclick="window.print();window.onafterprint=function(){window.close()};"
      style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;
             padding:7px 24px;border:2px solid #000;border-radius:4px;
             background:#000;color:#fff;cursor:pointer;letter-spacing:1px;">
      PRINT KOT
    </button>
  </div>
  <script>window.onload=function(){window.focus();};<\/script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=380,height=520,toolbar=0,menubar=0,scrollbars=1');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Pop-up blocked. Allow pop-ups to print KOT.');
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function printKitchenToken(order, cafeName, servedItems = null) {
  const num = String(order.daily_order_number).padStart(2, '0');
  const isTakeaway = order.order_type === 'takeaway';
  const isDelivery = order.order_type === 'delivery';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  let itemsToPrint = order.items || [];
  if (order.kitchen_mode === 'individual' && servedItems) {
    itemsToPrint = itemsToPrint.filter(item => servedItems.includes(item.id));
  }

  const itemRows = itemsToPrint.map((i) => `<tr><td class="qty">${i.quantity}</td><td class="item">${i.item_name}</td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; width:80mm; margin:0 auto; padding:6mm 4mm 10mm; background:#fff; color:#000; }
  .cafe-name { text-align:center; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#555; margin-bottom:4px; }
  .token-box { border:3px solid #000; border-radius:6px; text-align:center; padding:8px 4px 6px; margin:0 0 6px; }
  .token-label { font-size:9px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:#777; margin-bottom:2px; }
  .token-num { font-size:52px; font-weight:900; letter-spacing:3px; line-height:1; }
  .type-badge { display:inline-block; margin-top:4px; font-size:12px; font-weight:bold; letter-spacing:1px; border:1.5px solid #000; border-radius:20px; padding:2px 10px; }
  .sep { border:none; border-top:1px dashed #aaa; margin:5px 0; }
  .sep-solid { border:none; border-top:1.5px solid #000; margin:5px 0; }
  .meta { font-size:10px; color:#444; margin-bottom:4px; }
  table { width:100%; border-collapse:collapse; margin:4px 0; }
  .qty { width:28px; font-size:16px; font-weight:900; vertical-align:middle; padding:3px 4px 3px 0; }
  .item { font-size:14px; font-weight:bold; vertical-align:middle; padding:3px 0; }
  .notes { font-size:11px; color:#c00; font-weight:bold; margin-top:4px; padding:3px 5px; border:1px dashed #c00; border-radius:4px; }
  @media print { @page { size:80mm auto; margin:0; } body { padding:4mm 3mm 10mm; } }
</style>
</head>
<body>
  <div class="cafe-name">${cafeName || 'Kitchen'}</div>
  <div class="token-box">
    <div class="token-label">Order Token</div>
    <div class="token-num">${isTakeaway ? `TK ${num}` : isDelivery ? `D ${num}` : `#${num}`}</div>
    <div class="type-badge">${isTakeaway ? '🥡 TAKEAWAY' : isDelivery ? '🚚 DELIVERY' : `🍽️ TABLE ${order.table_number}`}</div>
  </div>
  <div class="meta">${order.customer_name} · ${dateStr} ${timeStr}</div>
  <hr class="sep-solid"/>
  <table><tbody>${itemRows}</tbody></table>
  <hr class="sep"/>
  ${order.notes ? `<div class="notes">📝 ${order.notes}</div>` : ''}
  <script>window.onload=function(){window.focus();}; function doPrint(){window.print();window.onafterprint=function(){window.close();};};<\/script>
  <div style="text-align:center;margin-top:10px;">
    <button onclick="doPrint()" style="font-family:'Courier New',monospace;font-size:13px;font-weight:bold;padding:8px 28px;border:2px solid #000;border-radius:6px;background:#000;color:#fff;cursor:pointer;">🖨 PRINT</button>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width:380,height=580,toolbar=0,menubar=0,scrollbars=0');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Pop-up blocked. Allow pop-ups to print kitchen tokens.');
}

const OVERDUE_MS = 15 * 60 * 1000;

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
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

const ITEM_STATUS_STYLE = {
  pending:   'bg-gray-100 text-gray-600',
  preparing: 'bg-orange-100 text-orange-700',
  ready:     'bg-teal-100 text-teal-700',
  served:    'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-500 line-through',
};

const ITEM_STATUS_LABEL = {
  pending: 'Pending', preparing: 'Cooking', ready: 'Ready', served: 'Served', cancelled: 'Cancelled',
};

const KITCHEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];
const TAB_LABELS = { pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready' };
const TAB_COLORS = {
  pending:   'border-yellow-400 text-yellow-300',
  confirmed: 'border-blue-400  text-blue-300',
  preparing: 'border-orange-400 text-orange-300',
  ready:     'border-teal-400  text-teal-300',
};
const TAB_BADGE_BG = {
  pending:   'bg-yellow-500',
  confirmed: 'bg-blue-500',
  preparing: 'bg-orange-500',
  ready:     'bg-teal-500',
};

const STATUS_COLORS = {
  pending:   'border-yellow-400 bg-yellow-950/30',
  confirmed: 'border-blue-400  bg-blue-950/30',
  preparing: 'border-orange-400 bg-orange-950/30',
  ready:     'border-teal-400  bg-teal-950/30',
};

const ACTION_COLORS = {
  pending:   'bg-blue-600 hover:bg-blue-500',
  confirmed: 'bg-orange-600 hover:bg-orange-500',
  preparing: 'bg-green-600 hover:bg-green-500',
  ready:     'bg-teal-600 hover:bg-teal-500',
};

// ─── Combined Table Card ──────────────────────────────────────
function CombinedTableCard({ group, status, now, onAdvance, onAdvanceAll, onKotPrint }) {
  const { tableKey, orders } = group;
  const orderCount = orders.length;
  const earliestTs = orders.reduce((min, o) => Math.min(min, new Date(o.created_at).getTime()), Infinity);
  const allOverdue = orders.every((o) => now - new Date(o.created_at).getTime() > OVERDUE_MS);

  const cardCls = `rounded-xl border-l-4 p-3 ${
    allOverdue ? 'border-red-500 bg-red-950/40 animate-pulse' : STATUS_COLORS[status]
  }`;

  return (
    <div className={cardCls}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white text-base">
            {tableKey ? `🍽️ ${tableKey}` : (orders[0]?.order_type === 'takeaway' ? '🥡 Takeaway' : '🛵 Delivery')}
          </span>
          {orderCount > 1 && (
            <span className="text-[10px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full font-semibold">
              {orderCount} orders
            </span>
          )}
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${allOverdue ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
          {elapsed(new Date(earliestTs).toISOString(), now)}
        </span>
      </div>

      {/* Per-order items */}
      {orders.map((order, idx) => (
        <div key={order.id}>
          {orderCount > 1 && (
            <p className="text-[11px] text-gray-500 mt-2 mb-1">
              {fmtToken(order.daily_order_number, order.order_type)} · {order.customer_name} · {fmtTime(order.created_at)}
            </p>
          )}
          {orderCount === 1 && (
            <p className="text-xs text-gray-500 mb-2">{order.customer_name} · {fmtTime(order.created_at)}</p>
          )}

          <div className="space-y-1">
            {(order.items || []).map((item) => (
              <div key={item.id} className="flex items-center gap-1.5">
                <span className="w-6 h-6 rounded bg-gray-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {item.quantity}
                </span>
                <span className="text-sm text-gray-200 font-medium">{item.item_name}</span>
              </div>
            ))}
          </div>

          {order.notes && (
            <p className="text-xs text-amber-400 mt-1.5 bg-amber-950/30 rounded px-2 py-1">📝 {order.notes}</p>
          )}

          {idx < orders.length - 1 && <hr className="border-dashed border-gray-700 mt-2" />}
        </div>
      ))}

      {/* Actions */}
      <div className="mt-3 space-y-1.5">
        {orderCount === 1 ? (
          <>
            {getNextStatus(status, orders[0].order_type) && (
              <button
                onClick={() => onAdvance(orders[0])}
                className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${ACTION_COLORS[status]}`}
              >
                {getActionLabel(status, orders[0].order_type)} →
              </button>
            )}
            <button
              onClick={() => onKotPrint(orders[0].id)}
              className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            >
              📋 Print KOT
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onAdvanceAll(orders)}
              className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${ACTION_COLORS[status]}`}
            >
              ⚡ Advance All ({orderCount}) →
            </button>
            <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${Math.min(orderCount, 3)}, 1fr)` }}>
              {orders.map((order) => (
                getNextStatus(order.status, order.order_type) ? (
                  <button
                    key={order.id}
                    onClick={() => onAdvance(order)}
                    className="py-1.5 rounded-lg text-[10px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                  >
                    {fmtToken(order.daily_order_number, order.order_type)} →
                  </button>
                ) : null
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KitchenHint() {
  const [open, setOpen] = useState(() => !localStorage.getItem('dv_hint_kitchen'));
  if (!open) return null;
  return (
    <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-start gap-3 text-sm text-gray-300">
      <span className="text-yellow-400 flex-shrink-0 mt-0.5">💡</span>
      <div className="flex-1 space-y-1">
        <p><strong className="text-white">Kitchen Display</strong> — keep this open on your kitchen screen during service.</p>
        <p>Use ↑↓ arrows to reorder items by course (starters first). Start → Ready → Serve each item. KOT prints automatically when items are marked ready.</p>
        <p>Cancel unavailable items with a reason — the customer is notified instantly.</p>
      </div>
      <button onClick={() => { localStorage.setItem('dv_hint_kitchen', '1'); setOpen(false); }} className="text-gray-500 hover:text-gray-300 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}


export default function KitchenPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState('individual'); // 'individual' | 'combined'
  const [selectedItems, setSelectedItems] = useState({});
  const [cancelModal, setCancelModal] = useState(null); // { orderId, itemId, itemName }
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [kotHistory, setKotHistory] = useState({}); // orderId → slips[]
  const now = useTimer();

  const isPremium = cafe?.plan_tier === 'premium';

  const playChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
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
    } catch { /* audio unavailable */ }
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
        setOrders((prev) => {
          // deduplicate: replace if exists, prepend if new
          const exists = prev.find((o) => o.id === order.id);
          return exists ? prev.map((o) => o.id === order.id ? { ...o, ...order } : o) : [order, ...prev];
        });
        playChime();
        toast('New order!', { icon: '🔔', style: { background: '#1f2937', color: '#fff' } });
      }
    },
    (updated) => {
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(updated.status)) return prev.filter((o) => o.id !== updated.id);
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
        if (!KITCHEN_STATUSES.includes(data.order.status)) return prev.filter((o) => o.id !== orderId);
        return prev.map((o) => (o.id === orderId ? data.order : o));
      });

      // Auto-generate and print KOT when item is marked ready
      if (status === 'ready') {
        try {
          const { data: kotData } = await generateOrderKot(orderId);
          printKot(kotData.kot, cafe?.name);
          // Update KOT history cache
          setKotHistory((prev) => ({
            ...prev,
            [orderId]: [...(prev[orderId] || []), kotData.kot],
          }));
        } catch {
          // KOT may already exist for this batch — silent fail, can reprint manually
        }
      }

      if (status === 'served' && data.order.kitchen_mode === 'individual') {
        printKitchenToken(data.order, cafe?.name, [itemId]);
      }
    } catch {
      toast.error('Failed to update item status');
    }
  };

  const handleCancelItemSubmit = async () => {
    if (!cancelReason.trim() || !cancelModal) return;
    setCancelling(true);
    try {
      const { data } = await cancelOrderItem(cancelModal.orderId, cancelModal.itemId, cancelReason.trim());
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(data.order.status)) return prev.filter((o) => o.id !== cancelModal.orderId);
        return prev.map((o) => (o.id === cancelModal.orderId ? data.order : o));
      });
      toast.success(`"${cancelModal.itemName}" cancelled — customer notified`);
      setCancelModal(null);
      setCancelReason('');
    } catch {
      toast.error('Failed to cancel item');
    } finally {
      setCancelling(false);
    }
  };

  const handleMoveItem = async (orderId, itemId, direction) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const sorted = [...(order.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = sorted.findIndex((i) => i.id === itemId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    // Swap sort_order values between the two items
    const reordered = sorted.map((item, i) => {
      if (i === idx)     return { id: item.id, sort_order: sorted[swapIdx].sort_order ?? swapIdx };
      if (i === swapIdx) return { id: item.id, sort_order: sorted[idx].sort_order ?? idx };
      return { id: item.id, sort_order: item.sort_order ?? i };
    });

    try {
      const { data } = await reorderOrderItems(orderId, reordered);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
    } catch {
      toast.error('Failed to reorder items');
    }
  };

  const handleAdvanceAll = async (groupOrders) => {
    const toAdvance = groupOrders.filter((o) => getNextStatus(o.status, o.order_type));
    if (!toAdvance.length) return;
    try {
      await Promise.all(toAdvance.map(async (order) => {
        const next = getNextStatus(order.status, order.order_type);
        await updateOrderStatus(order.id, next);
        setOrders((prev) =>
          KITCHEN_STATUSES.includes(next)
            ? prev.map((o) => (o.id === order.id ? { ...o, status: next } : o))
            : prev.filter((o) => o.id !== order.id)
        );
      }));
    } catch { toast.error('Failed to advance some orders'); }
  };

  const handleAcceptOrder = async (orderId) => {
    try {
      const { data } = await acceptOrder(orderId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      toast.success('Order accepted');
    } catch { toast.error('Failed to accept order'); }
  };

  const handleRejectOrder = async (orderId) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason?.trim()) return;
    try {
      const { data } = await rejectOrder(orderId, reason.trim());
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      toast.success('Order rejected');
    } catch { toast.error('Failed to reject order'); }
  };

  const handleAcceptItem = async (orderId, itemId) => {
    try {
      const { data } = await acceptItem(orderId, itemId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
    } catch { toast.error('Failed to accept item'); }
  };

  const toggleItemSelection = (orderId, itemId) => {
    setSelectedItems((prev) => {
      const s = new Set(prev[orderId] || []);
      s.has(itemId) ? s.delete(itemId) : s.add(itemId);
      return { ...prev, [orderId]: s };
    });
  };

  const handleServeSelected = async (orderId) => {
    const selected = selectedItems[orderId] || new Set();
    if (selected.size === 0) return;
    try {
      const results = await Promise.all(
        Array.from(selected).map((itemId) => updateItemStatus(orderId, itemId, 'served'))
      );
      const last = results[results.length - 1];
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(last.data.order.status)) return prev.filter((o) => o.id !== orderId);
        return prev.map((o) => (o.id === orderId ? last.data.order : o));
      });
      printKitchenToken(last.data.order, cafe?.name, Array.from(selected));
      setSelectedItems((prev) => ({ ...prev, [orderId]: new Set() }));
      toast.success(`${selected.size} item${selected.size > 1 ? 's' : ''} served`);
    } catch { toast.error('Failed to serve selected items'); }
  };

  const handleKotPrint = async (orderId) => {
    try {
      const { data } = await generateOrderKot(orderId);
      printKot(data.kot, cafe?.name);
      setKotHistory((prev) => ({ ...prev, [orderId]: [...(prev[orderId] || []), data.kot] }));
    } catch {
      toast.error('Could not generate KOT');
    }
  };

  const handleKotReprint = async (orderId) => {
    try {
      let slips = kotHistory[orderId];
      if (!slips) {
        const { data } = await getKotHistory(orderId);
        slips = data.slips;
        setKotHistory((prev) => ({ ...prev, [orderId]: slips }));
      }
      if (!slips || slips.length === 0) { toast('No KOT slips yet for this order', { icon: 'ℹ️' }); return; }
      const last = slips[slips.length - 1];
      printKot(last, cafe?.name);
    } catch { toast.error('Could not load KOT history'); }
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

  const byStatus = KITCHEN_STATUSES.reduce((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return acc;
  }, {});

  // Combined view: group dine-in orders by table_number; takeaway/delivery stay solo
  const groupByTable = (colOrders) => {
    const result = [];
    const tableMap = new Map();
    for (const order of colOrders) {
      if (order.order_type === 'dine-in' && order.table_number) {
        if (!tableMap.has(order.table_number)) {
          const group = { tableKey: order.table_number, orders: [] };
          tableMap.set(order.table_number, group);
          result.push(group);
        }
        tableMap.get(order.table_number).orders.push(order);
      } else {
        result.push({ tableKey: null, orders: [order] });
      }
    }
    return result;
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading kitchen...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🍳</span>
          <h1 className="font-bold text-lg">Kitchen Display</h1>
          <span className="text-xs text-gray-500">{cafe?.name}</span>
          {isPremium && <span className="text-[10px] font-bold bg-purple-800 text-purple-300 px-2 py-0.5 rounded-full">PREMIUM</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{orders.length} active order{orders.length !== 1 ? 's' : ''}</span>

          {/* View mode toggle */}
          <div className="flex gap-0.5 bg-gray-800 rounded-lg p-0.5">
            {[
              { key: 'individual', label: '☰ Individual' },
              { key: 'combined',   label: '⊞ By Table'   },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  viewMode === key ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button onClick={() => setSoundEnabled((s) => !s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${soundEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
            {soundEnabled ? '🔔 Sound On' : '🔕 Muted'}
          </button>
          <button onClick={() => fetchOrders(true)} disabled={refreshing} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1">
            <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={toggleFullscreen} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
            {fullscreen ? '⛶ Exit' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      <KitchenHint />

      {/* 4-column KDS board */}
      <div className="flex-1 flex gap-0 overflow-hidden min-h-0">
        {KITCHEN_STATUSES.map((status) => {
          const colOrders = byStatus[status];
          const colIcons = { pending: '🕐', confirmed: '✅', preparing: '🍳', ready: '🛎️' };
          const colHeaderBg = {
            pending:   'bg-yellow-950/60 border-yellow-800/50',
            confirmed: 'bg-blue-950/60 border-blue-800/50',
            preparing: 'bg-orange-950/60 border-orange-800/50',
            ready:     'bg-teal-950/60 border-teal-800/50',
          };
          const colCountBg = {
            pending:   'bg-yellow-500',
            confirmed: 'bg-blue-500',
            preparing: 'bg-orange-500',
            ready:     'bg-teal-500',
          };
          const colTitleColor = {
            pending:   'text-yellow-300',
            confirmed: 'text-blue-300',
            preparing: 'text-orange-300',
            ready:     'text-teal-300',
          };

          return (
            <div key={status} className="flex-1 min-w-0 flex flex-col border-r border-gray-800 last:border-r-0">
              {/* Column header */}
              <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b ${colHeaderBg[status]}`}>
                <span className="text-base">{colIcons[status]}</span>
                <span className={`text-sm font-bold uppercase tracking-wide ${colTitleColor[status]}`}>{TAB_LABELS[status]}</span>
                {colOrders.length > 0 && (
                  <span className={`ml-auto min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${colCountBg[status]}`}>
                    {colOrders.length}
                  </span>
                )}
              </div>

              {/* Column body — independently scrollable */}
              <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {colOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-700">
                    <span className="text-4xl mb-3 opacity-20">{colIcons[status]}</span>
                    <p className="text-xs text-gray-600">No {TAB_LABELS[status].toLowerCase()} orders</p>
                  </div>
                ) : viewMode === 'combined' ? (
                  groupByTable(colOrders).map((group) => (
                    <CombinedTableCard
                      key={group.tableKey || group.orders[0].id}
                      group={group}
                      status={status}
                      now={now}
                      onAdvance={handleAdvance}
                      onAdvanceAll={handleAdvanceAll}
                      onKotPrint={handleKotPrint}
                    />
                  ))
                ) : (
                  colOrders.map((order) => {
                    const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
                    const nextStatus = getNextStatus(status, order.order_type);
                    const actionLabel = getActionLabel(status, order.order_type);
                    const sortedItems = [...(order.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

                    return (
                      <div key={order.id} className={`rounded-xl border-l-4 p-3 ${STATUS_COLORS[status]} ${overdue ? 'animate-pulse border-red-500 bg-red-950/40' : ''}`}>
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-white text-lg">{fmtToken(order.daily_order_number, order.order_type)}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
                            {elapsed(order.created_at, now)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mb-0.5">
                          {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
                        </p>
                        <p className="text-xs text-gray-500 mb-2">{order.customer_name} · {fmtTime(order.created_at)}</p>

                        {/* Accept/reject (premium individual mode) */}
                        {order.kitchen_mode === 'individual' && !order.accepted && status === 'pending' && (
                          <div className="flex gap-2 mb-2">
                            <button onClick={() => handleAcceptOrder(order.id)} className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition-colors">✅ Accept</button>
                            <button onClick={() => handleRejectOrder(order.id)} className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors">❌ Reject</button>
                          </div>
                        )}

                        {/* Items */}
                        {order.kitchen_mode === 'individual' ? (
                          <div className="space-y-1.5 mb-3">
                            {sortedItems.map((item, idx) => {
                              const isCancelled = item.item_status === 'cancelled';
                              const isSelected = (selectedItems[order.id] || new Set()).has(item.id);
                              return (
                                <div key={item.id} className={`rounded-lg border p-2 ${isCancelled ? 'border-gray-800 bg-gray-900/40 opacity-50' : 'bg-gray-900/80 border-gray-800'}`}>
                                  <div className="flex items-start justify-between gap-1.5">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        {item.item_status === 'ready' && !isCancelled && (
                                          <input type="checkbox" checked={isSelected} onChange={() => toggleItemSelection(order.id, item.id)} className="w-3.5 h-3.5 text-emerald-600 bg-gray-800 border-gray-600 rounded" />
                                        )}
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-gray-800 text-xs font-bold text-white flex-shrink-0">{item.quantity}</span>
                                        <span className={`text-xs font-semibold truncate ${isCancelled ? 'line-through text-gray-500' : 'text-white'}`}>{item.item_name}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${ITEM_STATUS_STYLE[item.item_status] || 'bg-gray-700 text-gray-400'}`}>
                                          {ITEM_STATUS_LABEL[item.item_status] || item.item_status}
                                        </span>
                                        {isCancelled && item.cancellation_reason && (
                                          <span className="text-[10px] text-red-400 truncate">{item.cancellation_reason}</span>
                                        )}
                                      </div>
                                    </div>

                                    {!isCancelled && (
                                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                        <div className="flex gap-0.5">
                                          <button onClick={() => handleMoveItem(order.id, item.id, 'up')} disabled={idx === 0}
                                            className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center text-xs disabled:opacity-30">↑</button>
                                          <button onClick={() => handleMoveItem(order.id, item.id, 'down')} disabled={idx === sortedItems.filter(i => i.item_status !== 'cancelled').length - 1}
                                            className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center text-xs disabled:opacity-30">↓</button>
                                        </div>
                                        <div className="flex flex-wrap gap-0.5 justify-end">
                                          {!item.accepted && order.accepted && (
                                            <button onClick={() => handleAcceptItem(order.id, item.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-500">Accept</button>
                                          )}
                                          {item.item_status === 'pending' && item.accepted && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'preparing')} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-500">Start</button>
                                          )}
                                          {item.item_status === 'preparing' && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'ready')} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-600 text-white hover:bg-teal-500">Ready</button>
                                          )}
                                          {item.item_status === 'ready' && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'served')} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500">Serve</button>
                                          )}
                                          {['pending', 'preparing'].includes(item.item_status) && (
                                            <button onClick={() => { setCancelModal({ orderId: order.id, itemId: item.id, itemName: item.item_name }); setCancelReason(''); }}
                                              className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 hover:bg-red-800 border border-red-800">✕</button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {(selectedItems[order.id]?.size > 0) && (
                              <button onClick={() => handleServeSelected(order.id)} className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors">
                                🍽️ Serve {selectedItems[order.id].size} Item{selectedItems[order.id].size > 1 ? 's' : ''}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1 mb-3">
                            {(order.items || []).map((item) => (
                              <div key={item.id} className="flex items-center gap-1.5">
                                <span className="w-6 h-6 rounded bg-gray-800 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{item.quantity}</span>
                                <span className="text-sm text-gray-200 font-medium">{item.item_name}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {order.notes && (
                          <p className="text-xs text-amber-400 mb-2 bg-amber-950/30 rounded px-2 py-1">📝 {order.notes}</p>
                        )}

                        {/* Advance button */}
                        {nextStatus && !(order.kitchen_mode === 'individual' && status === 'preparing') && (
                          <button onClick={() => handleAdvance(order)} className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${ACTION_COLORS[status]}`}>
                            {actionLabel} →
                          </button>
                        )}

                        {/* KOT only */}
                        <div className="mt-1">
                          {order.kitchen_mode === 'individual' ? (
                            <button onClick={() => handleKotReprint(order.id)} className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 transition-colors">
                              📋 Reprint KOT
                            </button>
                          ) : (
                            <button onClick={() => handleKotPrint(order.id)} className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                              📋 Print KOT
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancel Item Modal */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700">
            <h3 className="font-bold text-white text-lg mb-1">Cancel Item</h3>
            <p className="text-gray-400 text-sm mb-4">
              Mark <strong className="text-white">"{cancelModal.itemName}"</strong> as unavailable? The customer will be notified with your reason.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason (e.g. Out of stock, Sold out today…)"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-red-500 mb-4"
              rows={3}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setCancelModal(null); setCancelReason(''); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-400 hover:bg-gray-800 text-sm font-medium transition-colors"
              >
                Keep Item
              </button>
              <button
                onClick={handleCancelItemSubmit}
                disabled={!cancelReason.trim() || cancelling}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold transition-colors"
              >
                {cancelling ? 'Cancelling…' : 'Cancel Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
