import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getOrders, updateOrderStatus, updateItemStatus, setKitchenMode, acceptOrder, rejectOrder, cancelOrderItem, reorderOrderItems, setItemPrepTime } from '../../services/api';
import { itemRemainingMins, orderEtaMins, orderHasPrepTime, fmtMins } from '../../utils/prepTime';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function itemDetails(item) {
  const parts = [];
  if (item?.variant_name) parts.push(`Variant: ${item.variant_name}`);
  const mods = Array.isArray(item?.selected_modifiers)
    ? item.selected_modifiers.map((m) => m.option_name).filter(Boolean)
    : [];
  if (mods.length) parts.push(`Add-ons: ${mods.join(', ')}`);
  return parts.join(' | ');
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

  const itemRows = itemsToPrint.map((i) => {
    const details = itemDetails(i);
    return `<tr><td class="qty">${i.quantity}</td><td class="item">${esc(i.item_name)}${details ? `<div class="mods">${esc(details)}</div>` : ''}</td></tr>`;
  }).join('');

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
  .mods { font-size:10px; font-weight:bold; color:#333; line-height:1.35; margin-top:1px; }
  .notes { font-size:11px; color:#c00; font-weight:bold; margin-top:4px; padding:3px 5px; border:1px dashed #c00; border-radius:4px; }
  @media print { @page { size:80mm auto; margin:0; } body { padding:4mm 3mm 10mm; } }
</style>
</head>
<body>
  <div class="cafe-name">${cafeName || 'Kitchen'}</div>
  <div class="token-box">
    <div class="token-label">Serving Slip · Ready for Service</div>
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
  else alert('Pop-up blocked. Allow pop-ups to print serving slips.');
}

const OVERDUE_MS = 20 * 60 * 1000; // 20 min = overdue (was 25)

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000); // refresh every 15s (was 30s)
    return () => clearInterval(id);
  }, []);
  return now;
}

function elapsedMins(createdAt, now) {
  return Math.floor((now - new Date(createdAt).getTime()) / 60000);
}

function elapsed(createdAt, now) {
  const mins = elapsedMins(createdAt, now);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

// Returns Tailwind classes for timer badge based on urgency
function timerCls(createdAt, now) {
  const mins = elapsedMins(createdAt, now);
  if (mins < 8)  return 'bg-gray-800 text-gray-400';
  if (mins < 15) return 'bg-amber-900/70 text-amber-300 font-bold';
  if (mins < 20) return 'bg-orange-900/70 text-orange-300 font-bold';
  return 'bg-red-900/70 text-red-300 font-bold animate-pulse';
}

// Returns urgency emoji
function urgencyIcon(createdAt, now) {
  const mins = elapsedMins(createdAt, now);
  if (mins >= 20) return '🔥';
  if (mins >= 12) return '⚠️';
  return '';
}

const ITEM_STATUS_LABEL = {
  pending: 'Pending', preparing: 'Cooking', ready: 'Ready', served: 'Served', cancelled: 'Cancelled',
};

const KITCHEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];
const TAB_LABELS = { pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready' };

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

// Item-level tap-to-cycle constants
const NEXT_ITEM_STATUS = { pending: 'preparing', preparing: 'ready', ready: 'served' };

// Kitchen flow rules:
//  - Dine-in ready → served  (waiter brings food to table; cashier bills after)
//  - Takeaway ready → null   (food is packed, kitchen's job is done;
//                             cashier handles pickup + payment in Bills tab)
//  - Kitchen never marks any order as paid
function kitchenNext(status, orderType) {
  if (status === 'ready' && orderType === 'takeaway') return null;
  const next = getNextStatus(status, orderType);
  return next === 'paid' ? 'served' : next;
}
function kitchenLabel(status, orderType) {
  if (status === 'ready') return 'Mark as Served';
  return getActionLabel(status, orderType);
}

const ITEM_ROW_STYLE = {
  pending:   'border-red-500    bg-red-950/25    hover:bg-red-950/40',
  preparing: 'border-yellow-400 bg-yellow-950/25 hover:bg-yellow-950/40',
  ready:     'border-green-500  bg-green-950/25  hover:bg-green-950/40',
  served:    'border-gray-700   bg-gray-900/20   opacity-50',
  cancelled: 'border-gray-800   bg-transparent   opacity-30',
};

const ITEM_BADGE_STYLE = {
  pending:   'bg-red-600/80 text-white',
  preparing: 'bg-yellow-500/80 text-black',
  ready:     'bg-green-600/80 text-white',
  served:    'bg-gray-700 text-gray-400',
  cancelled: 'bg-gray-800 text-gray-500',
};

// Orders placed within this window from the same table are combined in "By Table" view
const TABLE_GROUP_WINDOW_MS = 30 * 60 * 1000;

// ─── Combined Table Card ──────────────────────────────────────
function CombinedTableCard({ group, status, now, onAdvance, onAdvanceAll, onItemUpdate }) {
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
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${allOverdue ? 'bg-red-900/70 text-red-300 font-bold animate-pulse' : timerCls(new Date(earliestTs).toISOString(), now)}`}>
          {urgencyIcon(new Date(earliestTs).toISOString(), now)}{elapsed(new Date(earliestTs).toISOString(), now)}
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
            {(order.items || []).map((item) => {
              const ist = item.item_status || 'pending';
              const nextIst = NEXT_ITEM_STATUS[ist];
              const isCancelled = ist === 'cancelled';
              return (
                <div
                  key={item.id}
                  onClick={() => !isCancelled && nextIst && onItemUpdate(order.id, item.id, nextIst)}
                  className={`flex items-start gap-2 rounded-lg border-l-[3px] px-2 py-1.5 transition-all select-none
                    ${!isCancelled && nextIst ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'}
                    ${ITEM_ROW_STYLE[ist]}`}
                >
                  <span className="w-6 h-6 mt-0.5 rounded bg-gray-800/80 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {item.quantity}
                  </span>
                  <span className={`flex-1 text-sm font-medium leading-snug ${isCancelled ? 'line-through text-gray-500' : 'text-gray-100'}`}>
                    {item.item_name}
                    {itemDetails(item) && <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{itemDetails(item)}</span>}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${ITEM_BADGE_STYLE[ist]}`}>
                      {ITEM_STATUS_LABEL[ist] || ist}
                    </span>
                    {!isCancelled && nextIst && (
                      <span className="text-gray-600 text-xs">›</span>
                    )}
                  </div>
                </div>
              );
            })}
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
            {kitchenNext(status, orders[0].order_type) && (
              <button
                onClick={() => onAdvance(orders[0])}
                className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${ACTION_COLORS[status]}`}
              >
                {kitchenLabel(status, orders[0].order_type)} →
              </button>
            )}
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
                kitchenNext(order.status, order.order_type) ? (
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

// Rush mode card — ultra-compact for high-volume peak service.
// Shows just enough to identify order + items + one action. No item-level controls.
function RushCard({ order, now, onAdvance, onItemUpdate }) {
  const mins = elapsedMins(order.created_at, now);
  const tc = timerCls(order.created_at, now);
  const icon = urgencyIcon(order.created_at, now);
  const nextStatus = kitchenNext(order.status, order.order_type);
  const actionLabel = kitchenLabel(order.status, order.order_type);
  const activeItems = (order.items || []).filter((i) => i.item_status !== 'cancelled');
  const allItemsDone = activeItems.every((i) => ['ready','served'].includes(i.item_status));

  const borderColor = {
    pending:   'border-yellow-500',
    confirmed: 'border-blue-500',
    preparing: 'border-orange-500',
    ready:     'border-teal-500',
  }[order.status] || 'border-gray-600';

  return (
    <div className={`rounded-lg border-l-4 ${borderColor} bg-gray-900/80 p-2`}>
      <div className="flex items-center justify-between mb-1 gap-1">
        <span className="font-black text-white text-sm leading-none">
          {fmtToken(order.daily_order_number, order.order_type)}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[9px] text-gray-500">
            {order.order_type === 'takeaway' ? '🥡' : order.order_type === 'delivery' ? '🚚' : `T${order.table_number}`}
          </span>
          <span className={`text-[9px] px-1 py-0.5 rounded ${tc}`}>{icon}{mins < 1 ? 'now' : `${mins}m`}</span>
        </div>
      </div>
      <div className="space-y-0.5 mb-1.5">
        {activeItems.slice(0, 6).map((item) => {
          const ist = item.item_status || 'pending';
          const nextIst = NEXT_ITEM_STATUS[ist];
          const dot = { pending:'bg-red-500', preparing:'bg-orange-400', ready:'bg-teal-400', served:'bg-gray-600' }[ist] || 'bg-gray-600';
          return (
            <div
              key={item.id}
              onClick={() => nextIst && onItemUpdate(order.id, item.id, nextIst)}
              className={`flex items-center gap-1 ${nextIst ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1`} style={{ backgroundColor: { pending:'#ef4444', preparing:'#fb923c', ready:'#2dd4bf', served:'#4b5563' }[ist] || '#4b5563' }} />
              <span className="text-[10px] text-gray-300 leading-snug flex-1">
                <span className="font-bold text-white">{item.quantity}×</span> {item.item_name}
              </span>
            </div>
          );
        })}
        {activeItems.length > 6 && (
          <p className="text-[9px] text-gray-500 pl-2.5">+{activeItems.length - 6} more items</p>
        )}
      </div>
      {order.notes && (
        <p className="text-[9px] text-amber-400 mb-1 truncate">📝 {order.notes}</p>
      )}
      {nextStatus && (
        <button
          onClick={() => onAdvance(order)}
          className={`w-full py-1 rounded text-[10px] font-bold transition-colors ${ACTION_COLORS[order.status]}`}
        >
          {actionLabel} →
        </button>
      )}
    </div>
  );
}

// How it works modal — opens via ? button in header, can always be reopened.
function HowItWorksModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 rounded-t-2xl">
          <h2 className="font-bold text-white text-base">How the Kitchen Display works</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-5 text-sm text-gray-300">

          {/* Views */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">3 View modes</h3>
            <div className="space-y-2">
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0">⊞</span>
                <div>
                  <p className="font-semibold text-white">By Table <span className="text-gray-500 font-normal text-xs">(default)</span></p>
                  <p className="text-xs text-gray-400">Groups all orders from the same table into one card. Best for dine-in — one card = one table, no matter how many rounds they order.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0">☰</span>
                <div>
                  <p className="font-semibold text-white">Individual</p>
                  <p className="text-xs text-gray-400">Each order is a separate card. Use when every order needs independent item-level tracking (e.g. different chefs handling different orders).</p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0">⚡</span>
                <div>
                  <p className="font-semibold text-white">Rush mode</p>
                  <p className="text-xs text-gray-400">All active orders on one screen sorted oldest-first. Switch to this during peak service (15+ orders) so nothing gets missed. Tap any dot to advance that item.</p>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-gray-800" />

          {/* Advancing status */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">Updating order status</h3>
            <div className="space-y-1.5 text-xs text-gray-400">
              <p>• <span className="text-gray-200">Tap any item row</span> to advance it one step: <span className="text-red-400">Pending</span> → <span className="text-orange-400">Cooking</span> → <span className="text-teal-400">Ready</span> → <span className="text-green-400">Served</span></p>
              <p>• Use <span className="text-orange-300 font-semibold">🍳 All Start</span> to move every pending item to Cooking at once</p>
              <p>• Use <span className="text-teal-300 font-semibold">✓ All Ready</span> to mark every cooking item as ready</p>
              <p>• Use <span className="text-emerald-300 font-semibold">🍽️ Serve All</span> to mark every ready item as served</p>
              <p>• The <span className="text-white font-semibold">bottom action button</span> advances the whole order (e.g. "Mark Ready →")</p>
            </div>
          </section>

          <hr className="border-gray-800" />

          {/* Timer urgency */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">Timer colors — order age</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-[10px] font-bold">5m</span>
                <span className="text-gray-400">Fresh — no action needed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-amber-900/70 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold">⚠️ 12m</span>
                <span className="text-gray-400">Needs attention — check status</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-orange-900/70 text-orange-300 px-2 py-0.5 rounded text-[10px] font-bold">⚠️ 17m</span>
                <span className="text-gray-400">Urgent — prioritise this order</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-red-900/70 text-red-300 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">🔥 22m</span>
                <span className="text-gray-400">Critical — customer waiting too long</span>
              </div>
            </div>
          </section>

          <hr className="border-gray-800" />

          {/* Cancel */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">Cancelling an item</h3>
            <div className="text-xs text-gray-400 space-y-1">
              <p>Tap the small <span className="text-red-400 font-bold">✕</span> button on the right side of any pending or cooking item.</p>
              <p>Enter a reason (e.g. "Out of stock", "Sold out today"). The customer is notified instantly with your reason so they know before asking the waiter.</p>
            </div>
          </section>

          <hr className="border-gray-800" />

          {/* Printing */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">Serving slips</h3>
            <div className="text-xs text-gray-400 space-y-1">
              <p>In <strong className="text-white">Individual</strong> mode, a serving slip prints automatically when you mark an item as Ready.</p>
              <p>Attach the slip to the food at the pass so the waiter knows which table or customer to deliver it to — no shouting across the kitchen.</p>
            </div>
          </section>

          <hr className="border-gray-800" />

          {/* New orders */}
          <section>
            <h3 className="text-white font-semibold mb-2 text-xs uppercase tracking-wide text-gray-500">New orders</h3>
            <div className="text-xs text-gray-400 space-y-1">
              <p>A <span className="text-white">chime sounds</span> when a new order arrives (use the 🔔 button in the header to toggle sound on/off).</p>
              <p>The new order appears at the top of the <span className="text-yellow-300">Pending</span> column immediately via live update — no need to refresh.</p>
              <p>Column headers show <span className="text-amber-300 font-semibold">oldest Xm</span> when the oldest order in that column is ≥ 5 min old — useful for the kitchen manager to spot bottlenecks.</p>
            </div>
          </section>

        </div>

        <div className="px-5 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}



// Compact KDS card — designed for 25+ simultaneous orders.
// Items are tap-to-cycle rows (no per-item buttons visible by default).
// Cancel button appears on hover/long-press. No reorder arrows (use Orders page for that).
function KDSOrderCard({ order, status, now, selectedItems, onAdvance, onItemUpdate,
  onAcceptOrder, onRejectOrder, onServeSelected, onCancelItem, onToggleItem,
  prepInput, onSetPrepTime }) {
  const overdue = (now - new Date(order.created_at).getTime()) > OVERDUE_MS;
  const nextStatus = kitchenNext(status, order.order_type);
  const actionLabel = kitchenLabel(status, order.order_type);
  const sortedItems = [...(order.items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const activeItems = sortedItems.filter((i) => i.item_status !== 'cancelled');
  const hasPending   = activeItems.some((i) => i.item_status === 'pending');
  const hasPreparing = activeItems.some((i) => i.item_status === 'preparing');
  const hasReady     = activeItems.some((i) => i.item_status === 'ready');

  const cardBg = overdue ? 'border-l-red-500 bg-red-950/25' : STATUS_COLORS[status];
  const tc = timerCls(order.created_at, now);
  const icon = urgencyIcon(order.created_at, now);
  const etaMins = orderEtaMins(order.items, now);

  return (
    <div className={`rounded-xl border-l-4 p-2.5 ${cardBg}`}>
      {/* Header row — token + location + timer + ETA */}
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-black text-white text-base leading-none flex-shrink-0">
            {fmtToken(order.daily_order_number, order.order_type)}
          </span>
          <span className="text-xs text-gray-400 truncate">
            {order.order_type === 'takeaway' ? '🥡' : order.order_type === 'delivery' ? '🚚 Delivery' : `🍽️ ${order.table_number}`}
          </span>
          {etaMins !== null && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${etaMins <= 0 ? 'bg-teal-600/80 text-white' : etaMins <= 3 ? 'bg-red-600/80 text-white animate-pulse' : 'bg-orange-600/60 text-orange-100'}`}>
              ETA {etaMins <= 0 ? 'Ready' : `${etaMins}m`}
            </span>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${tc}`}>
          {icon}{elapsed(order.created_at, now)}
        </span>
      </div>

      {/* Accept / Reject (individual mode, unaccepted) */}
      {order.kitchen_mode === 'individual' && !order.accepted && (
        <div className="flex gap-1.5 mb-1.5">
          <button onClick={() => onAcceptOrder(order.id)}
            className="flex-1 py-1 rounded text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition-colors">
            ✅ Accept
          </button>
          <button onClick={() => onRejectOrder(order.id)}
            className="flex-1 py-1 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors">
            ✕ Reject
          </button>
        </div>
      )}

      {/* Bulk action row — only in individual mode */}
      {order.kitchen_mode === 'individual' && (hasPending || hasPreparing || hasReady) && (
        <div className="flex gap-1 mb-1.5">
          {hasPending && (
            <button
              onClick={() => activeItems.filter((i) => i.item_status === 'pending').forEach((i) => onItemUpdate(order.id, i.id, 'preparing'))}
              className="flex-1 py-1 rounded text-[10px] font-bold bg-orange-700 hover:bg-orange-600 text-white transition-colors">
              🍳 All Start
            </button>
          )}
          {hasPreparing && (
            <button
              onClick={() => activeItems.filter((i) => i.item_status === 'preparing').forEach((i) => onItemUpdate(order.id, i.id, 'ready'))}
              className="flex-1 py-1 rounded text-[10px] font-bold bg-teal-700 hover:bg-teal-600 text-white transition-colors">
              ✓ All Ready
            </button>
          )}
          {hasReady && (
            <button
              onClick={() => activeItems.filter((i) => i.item_status === 'ready').forEach((i) => onItemUpdate(order.id, i.id, 'served'))}
              className="flex-1 py-1 rounded text-[10px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors">
              🍽️ Serve All
            </button>
          )}
        </div>
      )}

      {/* Item list — compact tap-to-cycle rows */}
      <div className="space-y-0.5 mb-1.5">
        {sortedItems.map((item) => {
          const ist = item.item_status || 'pending';
          const nextIst = NEXT_ITEM_STATUS[ist];
          const isCancelled = ist === 'cancelled';
          const itemRemaining = itemRemainingMins(item, now);
          const isPrepInput = prepInput?.orderId === order.id && prepInput?.itemId === item.id;
          return (
            <div key={item.id}>
              <div
                onClick={() => !isCancelled && nextIst && onItemUpdate(order.id, item.id, nextIst)}
                className={`flex items-start gap-1.5 rounded border-l-[3px] px-2 py-1.5 transition-all select-none group
                  ${!isCancelled && nextIst ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'}
                  ${ITEM_ROW_STYLE[ist]}`}
              >
                <span className="w-5 h-5 mt-0.5 rounded bg-gray-800/80 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                  {item.quantity}
                </span>
                <span className={`flex-1 text-xs font-medium leading-snug ${isCancelled ? 'line-through text-gray-500' : 'text-gray-100'}`}>
                  {item.item_name}
                  {itemDetails(item) && (
                    <span className="block text-[10px] leading-snug text-gray-400 font-normal mt-0.5">{itemDetails(item)}</span>
                  )}
                  {isCancelled && item.cancellation_reason && (
                    <span className="block text-[9px] text-red-400 mt-0.5">{item.cancellation_reason}</span>
                  )}
                </span>
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0 mt-0.5">
                  <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded whitespace-nowrap ${ITEM_BADGE_STYLE[ist]}`}>
                    {ITEM_STATUS_LABEL[ist]}
                  </span>
                  {itemRemaining !== null && <EtaPill mins={itemRemaining} compact />}
                  <div className="flex items-center gap-0.5">
                    {!isCancelled && ['pending', 'preparing'].includes(ist) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCancelItem(order.id, item.id, item.item_name); }}
                        className="w-4 h-4 rounded text-[9px] bg-red-900/50 text-red-400 hover:bg-red-800 flex items-center justify-center"
                        title="Cancel item"
                      >✕</button>
                    )}
                    {!isCancelled && nextIst && (
                      <span className="text-gray-600 text-[10px]">›</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Inline prep time input — appears after item moves to preparing */}
              {isPrepInput && (
                <PrepTimeInput
                  itemId={item.id}
                  defaultMins={prepInput.defaultMins}
                  onSubmit={(mins) => onSetPrepTime(order.id, item.id, mins)}
                  onSkip={() => onSetPrepTime(order.id, item.id, null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Serve selected (ready items with checkbox) */}
      {order.kitchen_mode === 'individual' && (selectedItems[order.id]?.size > 0) && (
        <button onClick={() => onServeSelected(order.id)}
          className="w-full py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] mb-1 transition-colors">
          🍽️ Serve {selectedItems[order.id].size} selected
        </button>
      )}

      {order.notes && (
        <p className="text-[10px] text-amber-400 mb-1.5 bg-amber-950/30 rounded px-1.5 py-0.5">📝 {order.notes}</p>
      )}

      {nextStatus && (
        <button
          onClick={() => onAdvance(order)}
          className={`w-full py-2 rounded text-xs font-bold transition-colors ${ACTION_COLORS[status]}`}
        >
          {actionLabel} →
        </button>
      )}
    </div>
  );
}


function CancelItemModal({ cancelModal, cancelReason, setCancelReason, cancelling, onSubmit, onClose, TB }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 px-4 pb-4 sm:pb-0">
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700 shadow-2xl">
        <h3 className="font-bold text-white text-lg mb-1">Cancel Item</h3>
        <p className="text-gray-400 text-sm mb-4">
          Mark <strong className="text-white">"{cancelModal.itemName}"</strong> as unavailable? The customer will be notified.
        </p>
        <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Reason (e.g. Out of stock, Sold out today…)"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-red-500 mb-4"
          rows={3} autoFocus />
        <div className="flex gap-3">
          <button onClick={onClose} className={`${TB} flex-1 min-h-[48px] py-3 rounded-xl border border-gray-700 text-gray-300 text-sm font-semibold`}>Keep Item</button>
          <button onClick={onSubmit} disabled={!cancelReason.trim() || cancelling}
            className={`${TB} flex-1 min-h-[48px] py-3 rounded-xl bg-red-600 disabled:opacity-50 text-white text-sm font-bold`}>
            {cancelling ? 'Cancelling…' : 'Cancel Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectOrderModal({ rejectReason, setRejectReason, rejecting, onSubmit, onClose, TB }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 px-4 pb-4 sm:pb-0">
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700 shadow-2xl">
        <h3 className="font-bold text-white text-lg mb-1">Reject Order</h3>
        <p className="text-gray-400 text-sm mb-4">Give a reason — the customer will be notified immediately.</p>
        <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason (e.g. Kitchen closed, Out of ingredients…)"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-red-500 mb-4"
          rows={3} autoFocus />
        <div className="flex gap-3">
          <button onClick={onClose} className={`${TB} flex-1 min-h-[48px] py-3 rounded-xl border border-gray-700 text-gray-300 text-sm font-semibold`}>Keep Order</button>
          <button onClick={onSubmit} disabled={!rejectReason.trim() || rejecting}
            className={`${TB} flex-1 min-h-[48px] py-3 rounded-xl bg-red-600 disabled:opacity-50 text-white text-sm font-bold`}>
            {rejecting ? 'Rejecting…' : 'Reject Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline prep-time input that slides open when kitchen starts cooking an item.
function PrepTimeInput({ itemId, defaultMins, onSubmit, onSkip }) {
  const [val, setVal] = useState(defaultMins ? String(defaultMins) : '');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = (e) => {
    e.preventDefault();
    const n = parseInt(val, 10);
    if (!n || n < 1) { onSkip(); return; }
    onSubmit(n);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5 mt-1 bg-gray-800/60 rounded-lg px-2 py-1.5">
      <span className="text-[10px] text-gray-400 whitespace-nowrap">⏱ mins to cook:</span>
      <input
        ref={ref}
        type="number" min="1" max="300" inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="15"
        className="w-14 bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:border-orange-400"
      />
      <button type="submit"
        className="px-2 py-0.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold">
        Start
      </button>
      <button type="button" onClick={onSkip}
        className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-400 text-[10px]">
        Skip
      </button>
    </form>
  );
}

// Small ETA pill shown on item rows and order card headers.
function EtaPill({ mins, compact = false }) {
  if (mins === null || mins === undefined) return null;
  const done = mins <= 0;
  const urgent = mins > 0 && mins <= 3;
  const cls = done
    ? 'bg-teal-600/80 text-white'
    : urgent
      ? 'bg-red-600/80 text-white animate-pulse'
      : 'bg-orange-600/60 text-orange-100';
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {done ? '✓ Ready' : `${mins}m`}
    </span>
  );
}

// Persist a preference to localStorage and read it back
function usePersisted(key, defaultVal) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : defaultVal; }
    catch { return defaultVal; }
  });
  const set = (v) => { setVal(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
  return [val, set];
}

export default function KitchenPage() {
  const { cafe } = useAuth();
  const [searchParams] = useSearchParams();
  // ?station=veg  → locked to veg-only screen
  // ?station=nonveg → locked to non-veg-only screen
  // (no param) → normal unified/split UI
  const stationLock = searchParams.get('station'); // 'veg' | 'nonveg' | null

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled]   = usePersisted('kds_sound', true);
  const [fullscreen, setFullscreen]       = useState(false);
  const [viewMode, setViewMode]           = usePersisted('kds_viewmode', 'combined');
  const [kitchenView, setKitchenView]     = usePersisted('kds_kitchen_view', 'unified');
  const [selectedItems, setSelectedItems] = useState({});
  const [cancelModal, setCancelModal]     = useState(null); // { orderId, itemId, itemName }
  const [cancelReason, setCancelReason]   = useState('');
  const [cancelling, setCancelling]       = useState(false);
  const [rejectModal, setRejectModal]     = useState(null); // { orderId }
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);
  // prepInput: { orderId, itemId, defaultMins } — shows inline time input when item moves to preparing
  const [prepInput, setPrepInput]         = useState(null);
  const [statusFilter, setStatusFilter]   = usePersisted('kds_status_filter', 'all');
  const [vegFilter, setVegFilter]         = usePersisted('kds_veg_filter', 'all');
  const [showHelp, setShowHelp]           = useState(false);
  const now = useTimer();

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
    } catch (err) { toast.error(`Couldn't load orders: ${getApiError(err)}`); }
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
    const next = kitchenNext(order.status, order.order_type);
    if (!next) return;
    try {
      await updateOrderStatus(order.id, next);
      if (!KITCHEN_STATUSES.includes(next)) {
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } else {
        setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: next } : o));
      }
    } catch (err) { toast.error(`Couldn't update order: ${getApiError(err)}`); }
  };

  const handleItemUpdate = async (orderId, itemId, status) => {
    try {
      // Orders default to 'combined' mode; switch to individual on first item tap
      const order = orders.find((o) => o.id === orderId);
      if (order?.kitchen_mode !== 'individual') {
        const { data: modeData } = await setKitchenMode(orderId, 'individual');
        setOrders((prev) => prev.map((o) => o.id === orderId ? modeData.order : o));
      }
      const { data } = await updateItemStatus(orderId, itemId, status);
      setOrders((prev) => {
        if (!KITCHEN_STATUSES.includes(data.order.status)) return prev.filter((o) => o.id !== orderId);
        return prev.map((o) => (o.id === orderId ? data.order : o));
      });

      // When item starts cooking, prompt kitchen for prep time
      if (status === 'preparing') {
        const item = (data.order.items || []).find((i) => i.id === itemId);
        const defaultMins = item?.default_prep_mins || null;
        setPrepInput({ orderId, itemId, defaultMins });
      }

      // Print serving slip when item is marked ready
      if (status === 'ready' && data.order.kitchen_mode === 'individual') {
        printKitchenToken(data.order, cafe?.name, [itemId]);
      }
    } catch (err) {
      toast.error('Failed to update item status');
    }
  };

  const handleSetPrepTime = async (orderId, itemId, mins) => {
    setPrepInput(null);
    if (!mins) return; // skipped
    try {
      const { data } = await setItemPrepTime(orderId, itemId, mins);
      setOrders((prev) => prev.map((o) => o.id === orderId ? data.order : o));
    } catch (err) {
      toast.error('Failed to set prep time');
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
    } catch (err) {
      toast.error('Failed to cancel item');
    } finally {
      setCancelling(false);
    }
  };

  const handleAdvanceAll = async (groupOrders) => {
    const toAdvance = groupOrders.filter((o) => kitchenNext(o.status, o.order_type));
    if (!toAdvance.length) return;
    try {
      await Promise.all(toAdvance.map(async (order) => {
        const next = kitchenNext(order.status, order.order_type);
        await updateOrderStatus(order.id, next);
        setOrders((prev) =>
          KITCHEN_STATUSES.includes(next)
            ? prev.map((o) => (o.id === order.id ? { ...o, status: next } : o))
            : prev.filter((o) => o.id !== order.id)
        );
      }));
    } catch (err) { toast.error(`Couldn't advance some orders: ${getApiError(err)}`); }
  };

  const handleAcceptOrder = async (orderId) => {
    try {
      const { data } = await acceptOrder(orderId);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
      toast.success('Order accepted');
    } catch (err) { toast.error(`Couldn't accept order: ${getApiError(err)}`); }
  };

  const handleRejectOrder = async () => {
    if (!rejectReason.trim() || !rejectModal) return;
    setRejecting(true);
    try {
      await rejectOrder(rejectModal.orderId, rejectReason.trim());
      setOrders((prev) => prev.filter((o) => o.id !== rejectModal.orderId));
      toast.success('Order rejected');
      setRejectModal(null);
      setRejectReason('');
    } catch (err) { toast.error(`Couldn't reject order: ${getApiError(err)}`); }
    finally { setRejecting(false); }
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
    } catch (err) {
      toast.error('Failed to serve selected items');
    }
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

  // Group dine-in orders from the same table within TABLE_GROUP_WINDOW_MS.
  const groupByTable = (colOrders) => {
    const result = [];
    const tableGroups = new Map();
    for (const order of colOrders) {
      if (order.order_type === 'dine-in' && order.table_number) {
        const key = order.table_number;
        const orderTs = new Date(order.created_at).getTime();
        if (!tableGroups.has(key)) tableGroups.set(key, []);
        const groups = tableGroups.get(key);
        const last = groups[groups.length - 1];
        const lastTs = last ? Math.max(...last.orders.map((o) => new Date(o.created_at).getTime())) : -Infinity;
        if (last && orderTs - lastTs <= TABLE_GROUP_WINDOW_MS) {
          last.orders.push(order);
        } else {
          const group = { tableKey: key, orders: [order] };
          groups.push(group);
          result.push(group);
        }
      } else {
        result.push({ tableKey: null, orders: [order] });
      }
    }
    return result;
  };

  const itemIsVeg    = (item) => item.is_veg === true;
  const itemIsNonVeg = (item) => item.is_veg === false;

  // For unified mode veg filter
  const orderMatchesVeg = (order) => {
    if (vegFilter === 'all') return true;
    const active = (order.items || []).filter((i) => i.item_status !== 'cancelled');
    if (!active.length) return true;
    const hasKnown = active.some((i) => i.is_veg !== undefined && i.is_veg !== null);
    if (!hasKnown) return true; // no is_veg data — show in all filters
    return vegFilter === 'veg' ? active.some(itemIsVeg) : active.some(itemIsNonVeg);
  };

  // Filtered + sorted orders for unified mode
  const baseOrders = orders
    .filter((o) => statusFilter === 'all' || o.status === statusFilter)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const filteredOrders = baseOrders.filter(orderMatchesVeg);

  // For split kitchen mode — clone order but keep only relevant items visible
  // (items of the other type are still shown but dimmed; this keeps the card actionable)
  const vegOrders    = baseOrders.filter((o) => {
    const active = (o.items || []).filter(i => i.item_status !== 'cancelled');
    if (!active.length) return true;
    const hasKnown = active.some(i => i.is_veg !== undefined && i.is_veg !== null);
    return !hasKnown || active.some(itemIsVeg);
  });
  const nonVegOrders = baseOrders.filter((o) => {
    const active = (o.items || []).filter(i => i.item_status !== 'cancelled');
    if (!active.length) return true;
    const hasKnown = active.some(i => i.is_veg !== undefined && i.is_veg !== null);
    return !hasKnown || active.some(itemIsNonVeg);
  });

  const byStatus = KITCHEN_STATUSES.reduce((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).length;
    return acc;
  }, {});

  const STATUS_FILTER_CONFIG = [
    { key: 'all',       label: 'All',       icon: '📋', activeBg: 'bg-gray-600/40 border-gray-500 text-white' },
    { key: 'pending',   label: 'Pending',   icon: '🕐', activeBg: 'bg-yellow-500/20 border-yellow-500 text-yellow-300' },
    { key: 'confirmed', label: 'Confirmed', icon: '✅', activeBg: 'bg-blue-500/20 border-blue-500 text-blue-300'   },
    { key: 'preparing', label: 'Preparing', icon: '🍳', activeBg: 'bg-orange-500/20 border-orange-500 text-orange-300' },
    { key: 'ready',     label: 'Ready',     icon: '🛎️', activeBg: 'bg-teal-500/20 border-teal-500 text-teal-300'   },
  ];
  const STATUS_BADGE_BG = { pending:'bg-yellow-500', confirmed:'bg-blue-500', preparing:'bg-orange-500', ready:'bg-teal-500' };

  // Shared card renderer — used by both unified and split panels
  const renderCardFeed = (feedOrders, highlightVeg = null) => {
    if (feedOrders.length === 0) return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-700">
        <span className="text-5xl mb-3 opacity-20">🍳</span>
        <p className="text-sm text-gray-600">
          {orders.length === 0 ? 'All clear!' : 'No orders here'}
        </p>
      </div>
    );
    if (viewMode === 'rush') return (
      <div className="p-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {feedOrders.map((order) => (
          <RushCard key={order.id} order={order} now={now}
            onAdvance={handleAdvance} onItemUpdate={handleItemUpdate} />
        ))}
      </div>
    );

    const cardList = viewMode === 'combined'
      ? groupByTable(feedOrders).map((group) => ({
          key: group.tableKey || group.orders[0].id,
          status: group.orders[0].status,
          node: <CombinedTableCard group={group} status={group.orders[0].status} now={now}
                  onAdvance={handleAdvance} onAdvanceAll={handleAdvanceAll} onItemUpdate={handleItemUpdate} />,
        }))
      : feedOrders.map((order) => ({
          key: order.id,
          status: order.status,
          node: <KDSOrderCard order={order} status={order.status} now={now}
                  selectedItems={selectedItems} onAdvance={handleAdvance}
                  onItemUpdate={handleItemUpdate} onAcceptOrder={handleAcceptOrder}
                  onRejectOrder={(oid) => { setRejectModal({ orderId: oid }); setRejectReason(''); }} onServeSelected={handleServeSelected}
                  onCancelItem={(oid, iid, name) => { setCancelModal({ orderId: oid, itemId: iid, itemName: name }); setCancelReason(''); }}
                  onToggleItem={toggleItemSelection}
                  prepInput={prepInput} onSetPrepTime={handleSetPrepTime} />,
        }));

    return (
      <div className="p-3 columns-1 sm:columns-2 xl:columns-3 gap-3">
        {cardList.map(({ key, status, node }) => (
          <div key={key} className="break-inside-avoid mb-3">
            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white ${STATUS_BADGE_BG[status] || 'bg-gray-600'}`}>
                {STATUS_FILTER_CONFIG.find(c => c.key === status)?.icon} {STATUS_FILTER_CONFIG.find(c => c.key === status)?.label || status}
              </span>
            </div>
            {node}
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading kitchen...</p>
      </div>
    );
  }

  // Touch-friendly button base classes — min 44px tap target, no double-tap zoom
  const TB = 'select-none touch-manipulation active:scale-95 transition-transform';

  // ── STATION-LOCKED MODE (/owner/kitchen?station=veg or ?station=nonveg) ──
  // This mode is for a dedicated physical screen: full screen, single-purpose,
  // no UI clutter, auto-fullscreen prompt. Bookmark the URL on the touch display.
  if (stationLock === 'veg' || stationLock === 'nonveg') {
    const isVeg      = stationLock === 'veg';
    const stationOrders = isVeg ? vegOrders : nonVegOrders;
    const headerBg   = isVeg ? 'bg-green-950'         : 'bg-red-950';
    const borderCol  = isVeg ? 'border-green-800'      : 'border-red-900';
    const dotBg      = isVeg ? 'bg-green-500'          : 'bg-red-500';
    const labelColor = isVeg ? 'text-green-200'        : 'text-red-200';
    const countBg    = isVeg ? 'bg-green-800 text-green-100' : 'bg-red-900 text-red-100';
    const stationLabel = isVeg ? '🟢 Veg Kitchen' : '🔴 Non-Veg Kitchen';

    return (
      <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
        {/* Station header */}
        <div className={`flex-shrink-0 flex items-center gap-3 px-4 py-3 ${headerBg} border-b ${borderCol}`}>
          <span className={`w-4 h-4 rounded ${dotBg} flex-shrink-0`} />
          <span className={`font-black text-lg uppercase tracking-wider ${labelColor}`}>{stationLabel}</span>
          <span className={`ml-2 text-sm font-bold px-2.5 py-1 rounded-full ${countBg}`}>{stationOrders.length} orders</span>
          <span className="hidden md:inline text-xs text-gray-600 ml-1">— {cafe?.name}</span>

          {/* Status filter chips */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none ml-auto">
            {STATUS_FILTER_CONFIG.map(({ key, icon, label }) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`${TB} min-w-[44px] min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold flex-shrink-0 transition-colors flex items-center gap-1.5 ${
                  statusFilter === key
                    ? isVeg ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
                    : 'bg-gray-800/60 text-gray-400'
                }`}>
                <span>{icon}</span>
                <span className="hidden sm:inline">{label}</span>
                <span className={`text-[10px] px-1 rounded-full ${STATUS_BADGE_BG[key] ? STATUS_BADGE_BG[key] + ' text-white' : ''}`}>
                  {key !== 'all' ? (byStatus[key] || '') : ''}
                </span>
              </button>
            ))}
          </div>

          <button onClick={() => setSoundEnabled((s) => !s)}
            className={`${TB} min-w-[44px] min-h-[40px] px-3 py-2 rounded-xl text-sm flex-shrink-0 ${soundEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
            {soundEnabled ? '🔔' : '🔕'}
          </button>
          <button onClick={toggleFullscreen}
            className={`${TB} min-w-[44px] min-h-[40px] px-3 py-2 rounded-xl text-sm bg-gray-800 text-gray-400 flex-shrink-0`}>
            ⛶
          </button>
        </div>

        {/* Rush banner */}
        {viewMode === 'rush' && (
          <div className="flex-shrink-0 px-4 py-1.5 bg-orange-950/40 border-b border-orange-900/50 flex items-center gap-3">
            <span className="text-orange-300 font-bold text-xs">⚡ Rush Mode</span>
            <span className="ml-auto text-orange-300 font-bold text-xs">{stationOrders.length} orders</span>
          </div>
        )}

        {/* Card feed */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {renderCardFeed(stationOrders)}
        </div>

        {cancelModal && <CancelItemModal cancelModal={cancelModal} cancelReason={cancelReason} setCancelReason={setCancelReason} cancelling={cancelling} onSubmit={handleCancelItemSubmit} onClose={() => { setCancelModal(null); setCancelReason(''); }} TB={TB} />}
        {rejectModal && <RejectOrderModal rejectModal={rejectModal} rejectReason={rejectReason} setRejectReason={setRejectReason} rejecting={rejecting} onSubmit={handleRejectOrder} onClose={() => { setRejectModal(null); setRejectReason(''); }} TB={TB} />}
      </div>
    );
  }

  // ── NORMAL UNIFIED / SPLIT VIEW ──
  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 md:px-5 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🍳</span>
          <h1 className="font-bold text-base md:text-lg truncate">Kitchen</h1>
          <span className="hidden md:inline text-xs text-gray-500">{cafe?.name}</span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full font-semibold">{orders.length}</span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {/* View mode — touch-sized buttons */}
          <div className="flex gap-0.5 bg-gray-800 rounded-xl p-1">
            {[
              { key: 'combined',   icon: '⊞', label: 'By Table'   },
              { key: 'individual', icon: '☰', label: 'Individual' },
              { key: 'rush',       icon: '⚡', label: 'Rush'       },
            ].map(({ key, icon, label }) => (
              <button key={key} onClick={() => setViewMode(key)}
                className={`${TB} min-w-[44px] min-h-[36px] px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                  viewMode === key
                    ? key === 'rush' ? 'bg-orange-600 text-white' : 'bg-gray-600 text-white'
                    : 'text-gray-400'
                }`}>
                <span className="lg:hidden">{icon}</span>
                <span className="hidden lg:inline">{icon} {label}</span>
              </button>
            ))}
          </div>

          {/* Split kitchen toggle */}
          <button
            onClick={() => setKitchenView((v) => v === 'unified' ? 'split' : 'unified')}
            className={`${TB} min-w-[44px] min-h-[36px] px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
              kitchenView === 'split'
                ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                : 'bg-gray-800 border-transparent text-gray-400'
            }`}
            title="Split Veg / Non-veg kitchen view">
            🟢🔴
          </button>

          <button onClick={() => setSoundEnabled((s) => !s)}
            className={`${TB} min-w-[44px] min-h-[36px] px-3 py-2 rounded-xl text-sm font-medium transition-colors ${soundEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
            {soundEnabled ? '🔔' : '🔕'}
          </button>
          <button onClick={() => fetchOrders(true)} disabled={refreshing}
            className={`${TB} min-w-[44px] min-h-[36px] px-3 py-2 rounded-xl text-sm bg-gray-800 text-gray-400 disabled:opacity-50`}>
            <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
          </button>
          <button onClick={() => setShowHelp(true)}
            className={`${TB} min-w-[44px] min-h-[36px] px-3 py-2 rounded-xl text-sm bg-gray-800 text-gray-400`}>
            ?
          </button>
          <button onClick={toggleFullscreen}
            className={`${TB} hidden md:flex min-w-[44px] min-h-[36px] px-3 py-2 rounded-xl text-sm bg-gray-800 text-gray-400 items-center justify-center`}>
            ⛶
          </button>
        </div>
      </div>

      {showHelp && <HowItWorksModal onClose={() => setShowHelp(false)} />}

      {/* ── Filter bar — hidden in split mode (split has its own panel headers) ── */}
      {kitchenView === 'unified' && (
        <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none">
          {STATUS_FILTER_CONFIG.map(({ key, label, icon, activeBg }) => {
            const count = key === 'all' ? orders.length : byStatus[key] || 0;
            const isActive = statusFilter === key;
            return (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`${TB} flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl border text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                  isActive ? activeBg : 'border-transparent text-gray-500 active:bg-gray-800'
                }`}>
                <span className="text-sm">{icon}</span>
                <span className="hidden sm:inline">{label}</span>
                {count > 0 && (
                  <span className={`min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${STATUS_BADGE_BG[key] || 'bg-gray-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          <div className="w-px h-7 bg-gray-700 flex-shrink-0 mx-1" />

          {[
            { key: 'all',    label: 'All',        cls: 'bg-gray-600/40 border-gray-500 text-white' },
            { key: 'veg',    label: '🟢 Veg',     cls: 'bg-green-500/20 border-green-500 text-green-300' },
            { key: 'nonveg', label: '🔴 Non-veg', cls: 'bg-red-500/20 border-red-500 text-red-300' },
          ].map(({ key, label, cls }) => (
            <button key={key} onClick={() => setVegFilter(key)}
              className={`${TB} min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap border flex-shrink-0 transition-all ${
                vegFilter === key ? cls : 'border-transparent text-gray-500 active:bg-gray-800'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Rush mode banner ── */}
      {viewMode === 'rush' && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-orange-950/40 border-b border-orange-900/50 flex items-center gap-3">
          <span className="text-orange-300 font-bold text-xs">⚡ Rush Mode — oldest first</span>
          <span className="ml-auto text-orange-300 font-bold text-xs">{(kitchenView === 'unified' ? filteredOrders : baseOrders).length} shown</span>
        </div>
      )}

      {/* ── SPLIT KITCHEN VIEW ── */}
      {kitchenView === 'split' ? (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Veg panel */}
          <div className="flex-1 flex flex-col min-w-0 border-r-2 border-green-900/60">
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-green-950/50 border-b border-green-900/40">
              <span className="w-3 h-3 rounded-sm bg-green-500 flex-shrink-0" />
              <span className="font-black text-green-300 text-sm uppercase tracking-wider">Veg Kitchen</span>
              <span className="ml-auto bg-green-800 text-green-200 text-xs font-bold px-2 py-0.5 rounded-full">{vegOrders.length}</span>
              <div className="flex gap-1 overflow-x-auto scrollbar-none ml-2">
                {STATUS_FILTER_CONFIG.map(({ key, icon }) => (
                  <button key={key} onClick={() => setStatusFilter(key)}
                    className={`${TB} min-w-[36px] min-h-[36px] px-2 py-2 rounded-lg text-xs font-bold flex-shrink-0 transition-colors ${
                      statusFilter === key ? key === 'all' ? 'bg-green-700 text-white' : `${STATUS_BADGE_BG[key]} text-white` : 'bg-gray-800/60 text-gray-500'
                    }`}>{icon}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {renderCardFeed(vegOrders)}
            </div>
          </div>

          {/* Non-veg panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-red-950/40 border-b border-red-900/40">
              <span className="w-3 h-3 rounded-sm bg-red-500 flex-shrink-0" />
              <span className="font-black text-red-300 text-sm uppercase tracking-wider">Non-Veg Kitchen</span>
              <span className="ml-auto bg-red-900 text-red-200 text-xs font-bold px-2 py-0.5 rounded-full">{nonVegOrders.length}</span>
              <div className="flex gap-1 overflow-x-auto scrollbar-none ml-2">
                {STATUS_FILTER_CONFIG.map(({ key, icon }) => (
                  <button key={key} onClick={() => setStatusFilter(key)}
                    className={`${TB} min-w-[36px] min-h-[36px] px-2 py-2 rounded-lg text-xs font-bold flex-shrink-0 transition-colors ${
                      statusFilter === key ? key === 'all' ? 'bg-red-700 text-white' : `${STATUS_BADGE_BG[key]} text-white` : 'bg-gray-800/60 text-gray-500'
                    }`}>{icon}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {renderCardFeed(nonVegOrders)}
            </div>
          </div>
        </div>

      ) : (
        /* ── UNIFIED VIEW ── */
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-700 py-20">
              <span className="text-5xl mb-3 opacity-20">🍳</span>
              <p className="text-sm text-gray-600">
                {orders.length === 0 ? 'No active orders — all clear!' : 'No orders match the current filters'}
              </p>
            </div>
          ) : renderCardFeed(filteredOrders)}
        </div>
      )}

      {cancelModal && <CancelItemModal cancelModal={cancelModal} cancelReason={cancelReason} setCancelReason={setCancelReason} cancelling={cancelling} onSubmit={handleCancelItemSubmit} onClose={() => { setCancelModal(null); setCancelReason(''); }} TB={TB} />}
      {rejectModal && <RejectOrderModal rejectModal={rejectModal} rejectReason={rejectReason} setRejectReason={setRejectReason} rejecting={rejecting} onSubmit={handleRejectOrder} onClose={() => { setRejectModal(null); setRejectReason(''); }} TB={TB} />}
    </div>
  );
}
