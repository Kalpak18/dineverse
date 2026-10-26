import { useEffect, useMemo, useState } from 'react';
import { fmtToken } from '../../utils/formatters';

// ─── Kitchen "Lanes" view ────────────────────────────────────────────────────
// NEW → COOKING → READY. Tablet/desktop/TV: each lane is a row of fixed-width
// tickets, oldest on the left, so slots never reflow. Phone: one lane at a
// time behind tabs, tickets full width. Colour means one thing only: age.

const LANES = [
  { key: 'new',     label: 'New',     statuses: ['pending', 'confirmed'], dot: 'bg-sky-400' },
  { key: 'cooking', label: 'Cooking', statuses: ['preparing'],            dot: 'bg-orange-400' },
  { key: 'ready',   label: 'Ready',   statuses: ['ready'],                dot: 'bg-emerald-400' },
];

// Age thresholds (minutes since the order was placed)
const AMBER_AT = 8;
const RED_AT = 15;

const minsSince = (ts, now) => Math.max(0, Math.floor((now - new Date(ts).getTime()) / 60000));

function ageStyle(mins) {
  if (mins >= RED_AT) return { header: 'bg-red-700 text-white', timer: 'animate-pulse' };
  if (mins >= AMBER_AT) return { header: 'bg-amber-500 text-gray-950', timer: '' };
  return { header: 'bg-emerald-700 text-white', timer: '' };
}

const itemKey = (i) => `${i.item_name}${i.variant_name ? ` (${i.variant_name})` : ''}`;
const isActive = (i) => i.item_status !== 'cancelled';

function bumpHint(order, getNext) {
  const next = getNext(order.status === 'pending' ? 'confirmed' : order.status, order.order_type);
  if (!next) return order.order_type === 'takeaway' ? 'Waiting for pickup' : null;
  return { preparing: 'Tap to start cooking', ready: 'Tap when ready', served: 'Tap when served' }[next] || `Tap → ${next}`;
}

function Ticket({ order, now, selected, dimmed, getNext, onBump, onItemTap }) {
  const mins = minsSince(order.created_at, now);
  const age = ageStyle(mins);
  const hint = bumpHint(order, getNext);
  const items = (order.items || []).filter(isActive);
  const typeLabel = order.order_type === 'takeaway' ? 'Takeaway'
    : order.order_type === 'delivery' ? 'Delivery'
    : `Table ${order.table_number ?? '—'}`;

  return (
    <article
      className={`w-full md:w-[290px] md:flex-shrink-0 rounded-2xl bg-gray-900 border overflow-hidden flex flex-col transition-opacity ${
        selected ? 'border-white ring-2 ring-white/70' : 'border-gray-800'
      } ${dimmed ? 'opacity-35' : ''}`}
    >
      {/* Header = bump target */}
      <button
        type="button"
        onClick={() => hint && onBump(order)}
        disabled={!hint || hint === 'Waiting for pickup'}
        className={`w-full text-left px-3 pt-2.5 pb-2 select-none touch-manipulation active:brightness-110 disabled:cursor-default ${age.header}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-4xl font-black leading-none tracking-wide">
            {fmtToken(order.daily_order_number, order.order_type)}
          </span>
          <span className={`font-mono text-xl font-bold leading-none tabular-nums ${age.timer}`}>{mins}m</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 min-w-0">
          <span className="text-sm font-black uppercase tracking-wide whitespace-nowrap">{typeLabel}</span>
          {order.customer_name && (
            <span className="text-sm font-semibold opacity-90 truncate">· {order.customer_name}</span>
          )}
        </div>
        {hint && <div className="mt-1 text-[11px] font-bold uppercase tracking-wider opacity-80">{hint} →</div>}
      </button>

      {/* Items — tap a line to tick it done (tap again to undo) */}
      <ul className="divide-y divide-gray-800">
        {items.map((item) => {
          const done = ['ready', 'served'].includes(item.item_status);
          const mods = Array.isArray(item.selected_modifiers) ? item.selected_modifiers.map((m) => m.option_name).filter(Boolean) : [];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => item.item_status !== 'served' && onItemTap(order, item)}
                className="w-full min-h-[48px] px-3 py-2 flex items-start gap-2.5 text-left select-none touch-manipulation active:bg-gray-800"
              >
                <span className={`mt-0.5 w-6 h-6 flex-shrink-0 rounded-md border-2 flex items-center justify-center text-sm font-black ${
                  done ? 'bg-emerald-500 border-emerald-500 text-gray-950' : 'border-gray-600 text-transparent'
                }`}>✓</span>
                <span className="text-lg font-black text-white tabular-nums w-7 flex-shrink-0">{item.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-base font-semibold leading-snug ${done ? 'text-gray-500 line-through' : 'text-gray-100'}`}>
                    {item.is_veg === true && <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 mr-1.5 align-middle" title="Veg" />}
                    {item.is_veg === false && <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 mr-1.5 align-middle" title="Non-veg" />}
                    {item.item_name}
                    {item.variant_name && <span className="text-gray-400"> ({item.variant_name})</span>}
                  </span>
                  {mods.length > 0 && (
                    <span className="block pl-3 mt-0.5 text-sm text-gray-400 leading-snug">+ {mods.join(', ')}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Notes are never truncated */}
      {order.notes && (
        <div className="m-2 mt-auto px-3 py-2 rounded-xl bg-yellow-300 text-gray-950 text-sm font-bold whitespace-pre-wrap break-words">
          📝 {order.notes}
        </div>
      )}
    </article>
  );
}

export default function TicketRail({ orders, now, getNext, onBump, onItemTap, onRecall, recallCount }) {
  const [activeLane, setActiveLane] = useState('new');
  const [highlight, setHighlight] = useState(null); // all-day item key
  const [selectedId, setSelectedId] = useState(null);

  const lanes = useMemo(() => LANES.map((lane) => ({
    ...lane,
    orders: orders
      .filter((o) => lane.statuses.includes(o.status))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  })), [orders]);

  // All-day totals: what still has to be cooked across NEW + COOKING
  const allDay = useMemo(() => {
    const totals = new Map();
    for (const lane of lanes.slice(0, 2)) {
      for (const o of lane.orders) {
        for (const i of o.items || []) {
          if (!isActive(i) || ['ready', 'served'].includes(i.item_status)) continue;
          totals.set(itemKey(i), (totals.get(itemKey(i)) || 0) + (i.quantity || 1));
        }
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [lanes]);

  // Keyboard / bump bar: 1–9 select the nth ticket (lane order), Enter bumps, R recalls
  const flat = useMemo(() => lanes.flatMap((l) => l.orders), [lanes]);
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (/^[1-9]$/.test(e.key)) {
        const o = flat[Number(e.key) - 1];
        if (o) setSelectedId(o.id);
      } else if (e.key === 'Enter' && selectedId) {
        const o = flat.find((x) => x.id === selectedId);
        if (o) { e.preventDefault(); onBump(o); }
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        onRecall();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, selectedId, onBump, onRecall]);

  const hasItem = (order) => (order.items || []).some((i) => isActive(i) && itemKey(i) === highlight);

  return (
    <div className="flex flex-col min-h-0">
      {/* All-day bar + recall */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950">
        <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto scrollbar-none">
          {allDay.length === 0 && <span className="text-xs text-gray-600 py-2">Nothing waiting to be cooked</span>}
          {allDay.map(([name, qty]) => (
            <button
              key={name}
              type="button"
              onClick={() => setHighlight((h) => (h === name ? null : name))}
              className={`flex-shrink-0 min-h-[40px] px-3 rounded-xl text-sm font-bold whitespace-nowrap select-none touch-manipulation ${
                highlight === name ? 'bg-white text-gray-950' : 'bg-gray-800 text-gray-200'
              }`}
            >
              <span className="tabular-nums">{qty}×</span> {name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRecall}
          disabled={!recallCount}
          title="Undo the last bump (R)"
          className="flex-shrink-0 min-h-[40px] min-w-[44px] px-3 rounded-xl text-sm font-bold bg-gray-800 text-gray-200 disabled:opacity-30 select-none touch-manipulation"
        >
          ↶ <span className="hidden sm:inline">Recall</span>
        </button>
      </div>

      {/* Phone: lane tabs */}
      <div className="md:hidden sticky top-0 z-10 grid grid-cols-3 gap-1 p-2 bg-gray-950 border-b border-gray-800">
        {lanes.map((lane) => (
          <button
            key={lane.key}
            type="button"
            onClick={() => setActiveLane(lane.key)}
            className={`min-h-[44px] rounded-xl text-sm font-black uppercase tracking-wide flex items-center justify-center gap-1.5 select-none touch-manipulation ${
              activeLane === lane.key ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${lane.dot}`} />
            {lane.label}
            <span className="tabular-nums">{lane.orders.length}</span>
          </button>
        ))}
      </div>

      {/* Lanes */}
      <div className="flex-1 overflow-y-auto">
        {lanes.map((lane) => (
          <section
            key={lane.key}
            className={`${activeLane === lane.key ? 'block' : 'hidden'} md:block border-b border-gray-800/80`}
            aria-label={`${lane.label} orders`}
          >
            <h2 className="hidden md:flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-black uppercase tracking-widest text-gray-400">
              <span className={`w-2 h-2 rounded-full ${lane.dot}`} />
              {lane.label}
              <span className="text-gray-600 tabular-nums">{lane.orders.length}</span>
            </h2>
            {lane.orders.length === 0 ? (
              <p className="px-3 py-6 md:py-4 text-sm text-gray-600 text-center md:text-left">No tickets</p>
            ) : (
              <div className="flex flex-col gap-3 p-3 md:flex-row md:items-start md:overflow-x-auto md:pb-4">
                {lane.orders.map((order) => (
                  <Ticket
                    key={order.id}
                    order={order}
                    now={now}
                    selected={order.id === selectedId}
                    dimmed={!!highlight && !hasItem(order)}
                    getNext={getNext}
                    onBump={onBump}
                    onItemTap={onItemTap}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
