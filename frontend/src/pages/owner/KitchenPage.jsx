import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const itemRows = items.map((i) => `
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
    body { font-family:'Courier New',monospace; width:80mm; margin:0 auto; padding:6mm 4mm 10mm; background:#fff; color:#000; }
    .cafe { text-align:center; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#555; margin-bottom:4px; }
    .kot-header { border:3px solid #000; border-radius:6px; text-align:center; padding:8px 4px 6px; margin:0 0 6px; }
    .kot-label { font-size:9px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:#777; margin-bottom:2px; }
    .kot-num { font-size:32px; font-weight:900; letter-spacing:2px; line-height:1; }
    .table-tag { display:inline-block; margin-top:4px; font-size:13px; font-weight:bold; letter-spacing:1px; border:1.5px solid #000; border-radius:20px; padding:2px 10px; }
    .sep { border:none; border-top:1px dashed #aaa; margin:5px 0; }
    .sep-solid { border:none; border-top:1.5px solid #000; margin:5px 0; }
    .meta { font-size:10px; color:#444; margin-bottom:4px; }
    table { width:100%; border-collapse:collapse; margin:4px 0; }
    .qty { width:28px; font-size:16px; font-weight:900; vertical-align:middle; padding:3px 4px 3px 0; }
    .item { font-size:14px; font-weight:bold; vertical-align:middle; padding:3px 0; }
    .footer { text-align:center; font-size:10px; color:#888; margin-top:6px; }
    @media print { @page { size:80mm auto; margin:0; } body { padding:4mm 3mm 10mm; } }
  </style>
</head>
<body>
  <div class="cafe">${cafeName || 'Kitchen'}</div>
  <div class="kot-header">
    <div class="kot-label">KOT — Slip #${kot.slip_number}</div>
    <div class="kot-num">${isTakeaway ? 'TAKEAWAY' : `TABLE ${kot.table_number}`}</div>
    ${kot.customer_name ? `<div class="table-tag">${kot.customer_name}</div>` : ''}
  </div>
  <div class="meta">${dateStr} ${timeStr}</div>
  <hr class="sep-solid"/>
  <table><tbody>${itemRows}</tbody></table>
  <hr class="sep"/>
  <div class="footer">— Serve these items —</div>
  <script>
    window.onload = function() { window.focus(); };
    function doPrint() { window.print(); window.onafterprint = function() { window.close(); }; }
  <\/script>
  <div style="text-align:center;margin-top:10px;">
    <button onclick="doPrint()" style="font-family:'Courier New',monospace;font-size:13px;font-weight:bold;padding:8px 28px;border:2px solid #000;border-radius:6px;background:#000;color:#fff;cursor:pointer;">🖨 PRINT KOT</button>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=380,height=500,toolbar=0,menubar=0,scrollbars=0');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('Pop-up blocked. Allow pop-ups to print KOT.');
}

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

// ─── Premium gate ──────────────────────────────────────────────
function PremiumGate() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-purple-900/50 flex items-center justify-center mx-auto mb-5 text-4xl">🍳</div>
        <h2 className="text-2xl font-bold text-white mb-2">Kitchen Display is Premium</h2>
        <p className="text-gray-400 text-sm mb-1">Per-item tracking, course sequencing, and KOT printing are available on the Premium plan.</p>
        <p className="text-gray-500 text-xs mb-6">Perfect for restaurants and hotels that serve starters, mains, and desserts.</p>
        <div className="bg-gray-900 rounded-2xl p-4 mb-6 text-left space-y-2">
          {['Kitchen Display Screen (KDS)', 'Per-item status: Preparing → Ready → Served', 'Course sequencing (starters before mains)', 'KOT auto-printing when items are ready', 'Item-level cancellation with customer notification', 'Customer sees live item progress'].map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm text-gray-300">
              <span className="text-purple-400">✓</span><span>{f}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => navigate('/owner/billing')}
          className="w-full py-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-base transition-colors"
        >
          Upgrade to Premium
        </button>
      </div>
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
        setOrders((prev) => [order, ...prev]);
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

  // Non-premium owners see the upgrade gate
  if (!isPremium && cafe?.plan_tier !== undefined) return <PremiumGate />;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading kitchen...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🍳</span>
          <h1 className="font-bold text-lg">Kitchen Display</h1>
          <span className="text-xs text-gray-500">{cafe?.name}</span>
          <span className="text-[10px] font-bold bg-purple-800 text-purple-300 px-2 py-0.5 rounded-full">PREMIUM</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{orders.length} active order{orders.length !== 1 ? 's' : ''}</span>
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

      {/* Columns */}
      <div className="flex-1 grid grid-cols-3 gap-0 divide-x divide-gray-800 overflow-hidden">
        {KITCHEN_STATUSES.map((status) => {
          const cfg = STATUS_CONFIG[status];
          const col = byStatus[status];
          return (
            <div key={status} className="flex flex-col overflow-hidden">
              <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
                <span className="font-bold text-sm uppercase tracking-wide text-gray-300">{cfg.label}</span>
                {col.length > 0 && <span className="w-6 h-6 rounded-full bg-gray-700 text-xs font-bold flex items-center justify-center text-white">{col.length}</span>}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {col.length === 0 ? (
                  <div className="text-center py-12 text-gray-700 text-sm">No orders</div>
                ) : (
                  col.map((order) => {
                    const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
                    const nextStatus = getNextStatus(order.status, order.order_type);
                    const actionLabel = getActionLabel(order.status, order.order_type);
                    const sortedItems = [...(order.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                    const activeItems = sortedItems.filter((i) => i.item_status !== 'cancelled');

                    return (
                      <div key={order.id} className={`rounded-xl border-l-4 p-4 ${STATUS_COLORS[status]} ${overdue ? 'animate-pulse border-red-500 bg-red-950/40' : ''}`}>
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-white text-xl">{fmtToken(order.daily_order_number, order.order_type)}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
                            {elapsed(order.created_at, now)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mb-1">
                          {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
                        </p>
                        <p className="text-xs text-gray-500 mb-3">{order.customer_name} · {fmtTime(order.created_at)}</p>

                        {/* Accept/reject whole order (pre-acceptance) */}
                        {order.kitchen_mode === 'individual' && !order.accepted && order.status === 'pending' && (
                          <div className="flex gap-2 mb-3">
                            <button onClick={() => handleAcceptOrder(order.id)} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-500 transition-colors">✅ Accept</button>
                            <button onClick={() => handleRejectOrder(order.id)} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors">❌ Reject</button>
                          </div>
                        )}

                        {/* Items */}
                        {order.kitchen_mode === 'individual' ? (
                          <div className="space-y-2 mb-4">
                            {sortedItems.map((item, idx) => {
                              const isCancelled = item.item_status === 'cancelled';
                              const isSelected = (selectedItems[order.id] || new Set()).has(item.id);
                              return (
                                <div key={item.id} className={`rounded-2xl border p-3 ${isCancelled ? 'border-gray-800 bg-gray-900/40 opacity-50' : 'bg-gray-900/80 border-gray-800'}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    {/* Left: sequence + name + status */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        {item.item_status === 'ready' && !isCancelled && (
                                          <input type="checkbox" checked={isSelected} onChange={() => toggleItemSelection(order.id, item.id)} className="w-4 h-4 text-emerald-600 bg-gray-800 border-gray-600 rounded" />
                                        )}
                                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-gray-800 text-sm font-bold text-white flex-shrink-0">{item.quantity}</span>
                                        <span className={`text-sm font-semibold truncate ${isCancelled ? 'line-through text-gray-500' : 'text-white'}`}>{item.item_name}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${ITEM_STATUS_STYLE[item.item_status] || 'bg-gray-700 text-gray-400'}`}>
                                          {ITEM_STATUS_LABEL[item.item_status] || item.item_status}
                                        </span>
                                        {isCancelled && item.cancellation_reason && (
                                          <span className="text-[10px] text-red-400 truncate">{item.cancellation_reason}</span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Right: sequence arrows + action buttons */}
                                    {!isCancelled && (
                                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                        {/* Course sequence arrows */}
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => handleMoveItem(order.id, item.id, 'up')}
                                            disabled={idx === 0}
                                            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center text-xs disabled:opacity-30"
                                            title="Move up (serve earlier)"
                                          >↑</button>
                                          <button
                                            onClick={() => handleMoveItem(order.id, item.id, 'down')}
                                            disabled={idx === sortedItems.filter(i => i.item_status !== 'cancelled').length - 1}
                                            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center text-xs disabled:opacity-30"
                                            title="Move down (serve later)"
                                          >↓</button>
                                        </div>

                                        {/* Status actions */}
                                        <div className="flex flex-wrap gap-1 justify-end">
                                          {!item.accepted && order.accepted && (
                                            <button onClick={() => handleAcceptItem(order.id, item.id)} className="text-[11px] px-2 py-1 rounded-lg bg-green-600 text-white hover:bg-green-500">Accept</button>
                                          )}
                                          {item.item_status === 'pending' && item.accepted && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'preparing')} className="text-[11px] px-2 py-1 rounded-xl bg-orange-600 text-white hover:bg-orange-500">Start</button>
                                          )}
                                          {item.item_status === 'preparing' && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'ready')} className="text-[11px] px-2 py-1 rounded-xl bg-teal-600 text-white hover:bg-teal-500">Ready</button>
                                          )}
                                          {item.item_status === 'ready' && (
                                            <button onClick={() => handleItemUpdate(order.id, item.id, 'served')} className="text-[11px] px-2 py-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">Serve</button>
                                          )}
                                          {/* Cancel item button */}
                                          {['pending', 'preparing'].includes(item.item_status) && (
                                            <button
                                              onClick={() => { setCancelModal({ orderId: order.id, itemId: item.id, itemName: item.item_name }); setCancelReason(''); }}
                                              className="text-[11px] px-2 py-1 rounded-xl bg-red-900/60 text-red-400 hover:bg-red-800 border border-red-800"
                                              title="Mark item unavailable"
                                            >✕</button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {/* Serve Selected */}
                            {(selectedItems[order.id]?.size > 0) && (
                              <button onClick={() => handleServeSelected(order.id)} className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors">
                                🍽️ Serve {selectedItems[order.id].size} Selected Item{selectedItems[order.id].size > 1 ? 's' : ''}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5 mb-4">
                            {(order.items || []).map((item) => (
                              <div key={item.id} className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">{item.quantity}</span>
                                <span className="text-sm text-gray-200 font-medium">{item.item_name}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {order.notes && (
                          <p className="text-xs text-amber-400 mb-3 bg-amber-950/30 rounded-lg px-2 py-1">📝 {order.notes}</p>
                        )}

                        {/* Advance + print buttons */}
                        {nextStatus && !(order.kitchen_mode === 'individual' && order.status === 'preparing') && (
                          <button onClick={() => handleAdvance(order)} className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${ACTION_COLORS[status]}`}>
                            {actionLabel} →
                          </button>
                        )}

                        <div className="flex gap-2 mt-1.5">
                          <button onClick={() => printKitchenToken(order, cafe?.name)} className="flex-1 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white/70 transition-colors">
                            🖨 Print Slip
                          </button>
                          {order.kitchen_mode === 'individual' && (
                            <button onClick={() => handleKotReprint(order.id)} className="flex-1 py-2 rounded-xl text-xs font-semibold bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 transition-colors">
                              📋 Reprint KOT
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
