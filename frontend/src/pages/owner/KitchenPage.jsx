import { useState, useEffect, useCallback, useRef } from 'react';
import { getOrders, updateOrderStatus, updateItemStatus, setKitchenMode, acceptOrder, rejectOrder, acceptItem, rejectItem, cancelOrderItem, reorderOrderItems } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import { fmtToken, fmtTime } from '../../utils/formatters';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
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
  onAcceptOrder, onRejectOrder, onServeSelected, onCancelItem, onToggleItem }) {
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

  return (
    <div className={`rounded-xl border-l-4 p-2.5 ${cardBg}`}>
      {/* Header row — token + location + timer */}
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-black text-white text-base leading-none flex-shrink-0">
            {fmtToken(order.daily_order_number, order.order_type)}
          </span>
          <span className="text-xs text-gray-400 truncate">
            {order.order_type === 'takeaway' ? '🥡' : order.order_type === 'delivery' ? '🚚 Delivery' : `🍽️ ${order.table_number}`}
          </span>
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

      {/* Item list — compact tap-to-cycle rows. items-start so multi-line names stay top-aligned */}
      <div className="space-y-0.5 mb-1.5">
        {sortedItems.map((item) => {
          const ist = item.item_status || 'pending';
          const nextIst = NEXT_ITEM_STATUS[ist];
          const isCancelled = ist === 'cancelled';
          return (
            <div
              key={item.id}
              onClick={() => !isCancelled && nextIst && onItemUpdate(order.id, item.id, nextIst)}
              className={`flex items-start gap-1.5 rounded border-l-[3px] px-2 py-1.5 transition-all select-none group
                ${!isCancelled && nextIst ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'}
                ${ITEM_ROW_STYLE[ist]}`}
            >
              {/* Qty badge — fixed width, aligned to top */}
              <span className="w-5 h-5 mt-0.5 rounded bg-gray-800/80 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                {item.quantity}
              </span>
              {/* Item name — wraps naturally, never truncates */}
              <span className={`flex-1 text-xs font-medium leading-snug ${isCancelled ? 'line-through text-gray-500' : 'text-gray-100'}`}>
                {item.item_name}
                {itemDetails(item) && (
                  <span className="block text-[10px] leading-snug text-gray-400 font-normal mt-0.5">{itemDetails(item)}</span>
                )}
                {isCancelled && item.cancellation_reason && (
                  <span className="block text-[9px] text-red-400 mt-0.5">{item.cancellation_reason}</span>
                )}
              </span>
              {/* Right side — status badge + cancel + advance arrow, top-aligned */}
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0 mt-0.5">
                <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded whitespace-nowrap ${ITEM_BADGE_STYLE[ist]}`}>
                  {ITEM_STATUS_LABEL[ist]}
                </span>
                <div className="flex items-center gap-0.5">
                  {/* Cancel — always visible as tiny red button (not hover-only — touchscreens don't hover) */}
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


export default function KitchenPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState('combined'); // 'individual' | 'combined' | 'rush'
  const [selectedItems, setSelectedItems] = useState({});
  const [cancelModal, setCancelModal] = useState(null); // { orderId, itemId, itemName }
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [mobileTab, setMobileTab] = useState('pending');
  const [showHelp, setShowHelp] = useState(false);
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
    const next = kitchenNext(order.status, order.order_type);
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

      // Print serving slip when item is marked ready — placed with food at counter
      // so waiter knows which table/customer to deliver to without asking kitchen
      if (status === 'ready' && data.order.kitchen_mode === 'individual') {
        printKitchenToken(data.order, cafe?.name, [itemId]);
      }
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      toast.error('Failed to reorder items');
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
    } catch (err) {
      toast.error('Failed to accept item');
    }
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

  const byStatus = KITCHEN_STATUSES.reduce((acc, s) => {
    acc[s] = orders.filter((o) => o.status === s).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return acc;
  }, {});

  // Combined view: group dine-in orders from the same table within TABLE_GROUP_WINDOW_MS.
  // Orders from a table placed >30 min apart are treated as separate seatings.
  const groupByTable = (colOrders) => {
    const result = [];
    // Map: tableKey → array of groups (each group is a time window)
    const tableGroups = new Map();

    for (const order of colOrders) {
      if (order.order_type === 'dine-in' && order.table_number) {
        const key = order.table_number;
        const orderTs = new Date(order.created_at).getTime();

        if (!tableGroups.has(key)) tableGroups.set(key, []);
        const groups = tableGroups.get(key);

        // Try to join the most recent group within the time window
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

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading kitchen...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header — desktop: full row / mobile: compact */}
      <div className="flex items-center justify-between px-3 md:px-6 py-2.5 md:py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <span className="text-lg md:text-xl">🍳</span>
          <h1 className="font-bold text-sm md:text-lg truncate">Kitchen</h1>
          <span className="hidden md:inline text-xs text-gray-500">{cafe?.name}</span>
          <span className="text-xs text-gray-500 ml-1">{orders.length} active</span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0">
          {/* View mode toggle — desktop */}
          <div className="hidden md:flex gap-0.5 bg-gray-800 rounded-lg p-0.5">
            {[
              { key: 'combined',   label: '⊞ By Table'   },
              { key: 'individual', label: '☰ Individual' },
              { key: 'rush',       label: '⚡ Rush'       },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setViewMode(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === key ? (key === 'rush' ? 'bg-orange-600 text-white' : 'bg-gray-600 text-white') : 'text-gray-400 hover:text-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Mobile view toggle cycles through modes */}
          <button
            onClick={() => setViewMode((v) => v === 'combined' ? 'individual' : v === 'individual' ? 'rush' : 'combined')}
            className="md:hidden px-2 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300"
          >
            {viewMode === 'combined' ? '⊞' : viewMode === 'individual' ? '☰' : '⚡'}
          </button>

          <button
            onClick={() => setSoundEnabled((s) => !s)}
            title={soundEnabled ? 'Mute' : 'Unmute'}
            className={`px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${soundEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500'}`}
          >
            {soundEnabled ? '🔔' : '🔕'}
            <span className="hidden md:inline ml-1">{soundEnabled ? 'Sound On' : 'Muted'}</span>
          </button>
          <button
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            title="Refresh"
            className="px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
            <span className="hidden md:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="How it works"
            className="px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >
            ?
          </button>
          <button
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="hidden md:block px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >
            {fullscreen ? '⛶ Exit' : '⛶ Full'}
          </button>
        </div>
      </div>

      {showHelp && <HowItWorksModal onClose={() => setShowHelp(false)} />}

      {/* ── Mobile: horizontal status tabs + single column ── */}
      <div className="md:hidden flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Status tabs */}
        <div className="flex-shrink-0 flex border-b border-gray-800 bg-gray-900 overflow-x-auto">
          {KITCHEN_STATUSES.map((status) => {
            const colIcons = { pending: '🕐', confirmed: '✅', preparing: '🍳', ready: '🛎️' };
            const count = byStatus[status].length;
            const isActive = mobileTab === status;
            const activeCls = {
              pending:   'border-yellow-400 text-yellow-300',
              confirmed: 'border-blue-400 text-blue-300',
              preparing: 'border-orange-400 text-orange-300',
              ready:     'border-teal-400 text-teal-300',
            };
            const badgeBg = {
              pending: 'bg-yellow-500', confirmed: 'bg-blue-500',
              preparing: 'bg-orange-500', ready: 'bg-teal-500',
            };
            return (
              <button
                key={status}
                onClick={() => setMobileTab(status)}
                className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-3 px-2 border-b-2 text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap ${
                  isActive ? activeCls[status] : 'border-transparent text-gray-500'
                }`}
              >
                <span>{colIcons[status]}</span>
                <span>{TAB_LABELS[status]}</span>
                {count > 0 && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${badgeBg[status]}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Single active column — scrollable */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {(() => {
            const colOrders = byStatus[mobileTab];
            const colIcons = { pending: '🕐', confirmed: '✅', preparing: '🍳', ready: '🛎️' };
            if (colOrders.length === 0) return (
              <div className="flex flex-col items-center justify-center py-24 text-gray-700">
                <span className="text-5xl mb-3 opacity-20">{colIcons[mobileTab]}</span>
                <p className="text-sm text-gray-600">No {TAB_LABELS[mobileTab].toLowerCase()} orders</p>
              </div>
            );
            if (viewMode === 'combined') return groupByTable(colOrders).map((group) => (
              <CombinedTableCard
                key={group.tableKey || group.orders[0].id}
                group={group}
                status={mobileTab}
                now={now}
                onAdvance={handleAdvance}
                onAdvanceAll={handleAdvanceAll}
                onItemUpdate={handleItemUpdate}
              />
            ));
            return colOrders.map((order) => (
              <KDSOrderCard key={order.id} order={order} status={mobileTab} now={now}
                selectedItems={selectedItems} onAdvance={handleAdvance}
                onItemUpdate={handleItemUpdate} onAcceptOrder={handleAcceptOrder}
                onRejectOrder={handleRejectOrder} onServeSelected={handleServeSelected}
                onCancelItem={(orderId, itemId, itemName) => { setCancelModal({ orderId, itemId, itemName }); setCancelReason(''); }}
                onToggleItem={toggleItemSelection} />
            ));
          })()}
        </div>
      </div>

      {/* ── Desktop: Rush view — all active orders flat, sorted by urgency ── */}
      {viewMode === 'rush' && (
        <div className="flex-1 overflow-hidden min-h-0 hidden md:flex flex-col">
          <div className="flex-shrink-0 px-4 py-2 bg-orange-950/40 border-b border-orange-900/50 flex items-center gap-3">
            <span className="text-orange-300 font-bold text-sm">⚡ Rush Mode</span>
            <span className="text-gray-400 text-xs">All active orders sorted oldest first — tap items to advance</span>
            <span className="ml-auto text-orange-300 font-bold text-sm">{orders.length} orders</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-700">
                <span className="text-5xl mb-3 opacity-20">⚡</span>
                <p className="text-sm text-gray-600">No active orders — all clear!</p>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                {[...orders]
                  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                  .map((order) => (
                    <RushCard
                      key={order.id}
                      order={order}
                      now={now}
                      onAdvance={handleAdvance}
                      onItemUpdate={handleItemUpdate}
                    />
                  ))
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Desktop: 4-column KDS board ── */}
      <div className={`flex-1 gap-0 overflow-hidden min-h-0 ${viewMode === 'rush' ? 'hidden' : 'hidden md:flex'}`}>
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

          // Find the oldest order in this column for the header alert
          const oldestOrder = colOrders.length > 0
            ? colOrders.reduce((oldest, o) => new Date(o.created_at) < new Date(oldest.created_at) ? o : oldest)
            : null;
          const oldestMins = oldestOrder ? elapsedMins(oldestOrder.created_at, now) : 0;

          return (
            <div key={status} className="flex-1 min-w-0 flex flex-col border-r border-gray-800 last:border-r-0">
              {/* Column header */}
              <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b ${colHeaderBg[status]}`}>
                <span className="text-base">{colIcons[status]}</span>
                <span className={`text-sm font-bold uppercase tracking-wide ${colTitleColor[status]}`}>{TAB_LABELS[status]}</span>
                {colOrders.length > 0 && (
                  <span className={`min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${colCountBg[status]}`}>
                    {colOrders.length}
                  </span>
                )}
                {/* Oldest order age — critical signal for kitchen manager */}
                {oldestOrder && oldestMins >= 5 && (
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${timerCls(oldestOrder.created_at, now)}`}>
                    oldest {oldestMins}m
                  </span>
                )}
              </div>

              {/* Column body — independently scrollable */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
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
                      onItemUpdate={handleItemUpdate}
                    />
                  ))
                ) : (
                  colOrders.map((order) => (
                    <KDSOrderCard
                      key={order.id}
                      order={order}
                      status={status}
                      now={now}
                      selectedItems={selectedItems}
                      onAdvance={handleAdvance}
                      onItemUpdate={handleItemUpdate}
                      onAcceptOrder={handleAcceptOrder}
                      onRejectOrder={handleRejectOrder}
                      onServeSelected={handleServeSelected}
                      onCancelItem={(orderId, itemId, itemName) => { setCancelModal({ orderId, itemId, itemName }); setCancelReason(''); }}
                      onToggleItem={toggleItemSelection}
                    />
                  ))
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
