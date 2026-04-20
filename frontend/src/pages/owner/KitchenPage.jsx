import { useState, useEffect, useCallback, useRef } from 'react';
import { getOrders, updateOrderStatus } from '../../services/api';
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
        <p>Red timer = order is <strong className="text-red-400">overdue (15+ min)</strong>. Customer notes are highlighted in amber.</p>
      </div>
      <button onClick={() => { localStorage.setItem('dv_hint_kitchen', '1'); setOpen(false); }} className="text-gray-500 hover:text-gray-300 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}

// ── Kitchen token print ────────────────────────────────────────
function printKitchenToken(order, cafeName) {
  const num = String(order.daily_order_number).padStart(2, '0');
  const isTakeaway = order.order_type === 'takeaway';
  const isDelivery = order.order_type === 'delivery';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const itemRows = (order.items || []).map((i) => `
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

  <div class="footer">— Kitchen Copy —</div>

  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  <\/script>
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
      // Print kitchen token when order becomes ready
      if (next === 'ready') {
        printKitchenToken(order, cafe?.name);
      }
      if (!KITCHEN_STATUSES.includes(next)) {
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } else {
        setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: next } : o));
      }
    } catch { toast.error('Failed to update order'); }
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

                        {/* Items — large, easy to read from distance */}
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

                        {order.notes && (
                          <p className="text-xs text-amber-400 mb-3 bg-amber-950/30 rounded-lg px-2 py-1">
                            📝 {order.notes}
                          </p>
                        )}

                        {/* Action button */}
                        {nextStatus && (
                          <button
                            onClick={() => handleAdvance(order)}
                            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${ACTION_COLORS[status]}`}
                          >
                            {actionLabel} →
                          </button>
                        )}
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
