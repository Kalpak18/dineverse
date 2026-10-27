import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtToken } from '../../utils/formatters';
import { TableStatusBadge } from '../TableConfirm';
import { tableName } from '../../utils/tableName';

// ─── Kitchen "Lanes" view ────────────────────────────────────────────────────
// NEW → COOKING → READY. Tablet/desktop/TV: each lane is a row of fixed-width
// tickets, oldest on the left, so slots never reflow. Phone: one lane at a
// time behind tabs, tickets full width. Colour means one thing only: age.
//
// station: null = whole order. 'main' or a station name (e.g. 'bar') = a
// station screen — tickets are placed by that station's own lines, other
// stations' lines are dimmed, and a header tap moves only this station's items.
// density: 'comfortable' | 'compact' (compact never hides content).
// tv: wall-screen paging — lanes don't scroll; they page every few seconds,
// page 1 always holding the oldest tickets.

const LANES = [
  { key: 'new',     label: 'New',     statuses: ['pending', 'confirmed'], dot: 'bg-sky-400' },
  { key: 'cooking', label: 'Cooking', statuses: ['preparing'],            dot: 'bg-orange-400' },
  { key: 'ready',   label: 'Ready',   statuses: ['ready'],                dot: 'bg-emerald-400' },
];

// Age thresholds (minutes since the order was placed)
const AMBER_AT = 8;
const RED_AT = 15;
const TV_PAGE_MS = 8000;

const minsSince = (ts, now) => Math.max(0, Math.floor((now - new Date(ts).getTime()) / 60000));

function ageStyle(mins) {
  if (mins >= RED_AT) return { header: 'bg-red-700 text-white', timer: 'animate-pulse' };
  if (mins >= AMBER_AT) return { header: 'bg-amber-500 text-gray-950', timer: '' };
  return { header: 'bg-emerald-700 text-white', timer: '' };
}

const itemKey = (i) => `${i.item_name}${i.variant_name ? ` (${i.variant_name})` : ''}`;
const isActive = (i) => i.item_status !== 'cancelled';
const isDone = (i) => ['ready', 'served'].includes(i.item_status);

// Does this item belong to the station screen being shown?
export function itemOnStation(item, station) {
  if (!station) return true;
  if (station === 'main') return !item.station;
  return (item.station || '').toLowerCase() === station;
}

// Lane for an order — on a station screen, by that station's own items
function laneOf(order, station) {
  if (!station) return LANES.find((l) => l.statuses.includes(order.status))?.key;
  const mine = (order.items || []).filter((i) => isActive(i) && itemOnStation(i, station));
  if (!mine.length) return null;
  if (mine.every(isDone)) return 'ready';
  if (mine.some((i) => i.item_status !== 'pending')) return 'cooking';
  return 'new';
}

function bumpHint(order, lane, station, getNext) {
  if (station) {
    return { new: 'Tap to start cooking', cooking: 'Tap when ready', ready: null }[lane];
  }
  const next = getNext(order.status === 'pending' ? 'confirmed' : order.status, order.order_type);
  if (!next) return order.order_type === 'takeaway' ? 'Waiting for pickup' : null;
  return { preparing: 'Tap to start cooking', ready: 'Tap when ready', served: 'Tap when served' }[next] || `Tap → ${next}`;
}

function Ticket({ order, lane, now, station, compact, selected, dimmed, getNext, onBump, onItemTap }) {
  const mins = minsSince(order.created_at, now);
  const age = ageStyle(mins);
  const hint = bumpHint(order, lane, station, getNext);
  const canBump = !!hint && hint !== 'Waiting for pickup';
  const items = (order.items || []).filter(isActive);
  const typeLabel = order.order_type === 'takeaway' ? 'Takeaway'
    : order.order_type === 'delivery' ? 'Delivery'
    : tableName(order.table_number);

  return (
    <article
      className={`w-full ${compact ? 'md:w-[230px]' : 'md:w-[290px]'} md:flex-shrink-0 rounded-2xl bg-gray-900 border overflow-hidden flex flex-col transition-opacity ${
        selected ? 'border-white ring-2 ring-white/70' : 'border-gray-800'
      } ${dimmed ? 'opacity-35' : ''}`}
    >
      {/* Header = bump target */}
      <button
        type="button"
        onClick={() => canBump && onBump(order, lane)}
        disabled={!canBump}
        className={`w-full text-left select-none touch-manipulation active:brightness-110 disabled:cursor-default ${
          compact ? 'px-2.5 pt-2 pb-1.5' : 'px-3 pt-2.5 pb-2'
        } ${age.header}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className={`${compact ? 'text-2xl' : 'text-4xl'} font-black leading-none tracking-wide`}>
            {fmtToken(order.daily_order_number, order.order_type)}
          </span>
          <span className={`font-mono ${compact ? 'text-base' : 'text-xl'} font-bold leading-none tabular-nums ${age.timer}`}>{mins}m</span>
        </div>
        <div className={`${compact ? 'mt-1' : 'mt-1.5'} flex items-center gap-2 min-w-0`}>
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-black uppercase tracking-wide whitespace-nowrap`}>{typeLabel}</span>
          {order.customer_name && (
            <span className={`${compact ? 'text-xs' : 'text-sm'} font-semibold opacity-90 truncate`}>· {order.customer_name}</span>
          )}
        </div>
        <div className="mt-1 empty:hidden"><TableStatusBadge order={order} dark /></div>
        {hint && <div className="mt-1 text-[11px] font-bold uppercase tracking-wider opacity-80">{hint} →</div>}
        {station && lane === 'ready' && <div className="mt-1 text-[11px] font-bold uppercase tracking-wider opacity-80">Done here ✓</div>}
      </button>

      {/* Items — tap a line to tick it done (tap again to undo) */}
      <ul className="divide-y divide-gray-800">
        {items.map((item) => {
          const done = isDone(item);
          const mine = itemOnStation(item, station);
          const mods = Array.isArray(item.selected_modifiers) ? item.selected_modifiers.map((m) => m.option_name).filter(Boolean) : [];
          return (
            <li key={item.id} className={mine ? '' : 'opacity-40'}>
              <button
                type="button"
                disabled={!mine}
                onClick={() => mine && item.item_status !== 'served' && onItemTap(order, item)}
                className={`w-full ${compact ? 'min-h-[40px] px-2.5 py-1.5 gap-2' : 'min-h-[48px] px-3 py-2 gap-2.5'} flex items-start text-left select-none touch-manipulation active:bg-gray-800 disabled:cursor-default`}
              >
                <span className={`mt-0.5 ${compact ? 'w-5 h-5 text-xs' : 'w-6 h-6 text-sm'} flex-shrink-0 rounded-md border-2 flex items-center justify-center font-black ${
                  done ? 'bg-emerald-500 border-emerald-500 text-gray-950' : 'border-gray-600 text-transparent'
                }`}>✓</span>
                <span className={`${compact ? 'text-base w-6' : 'text-lg w-7'} font-black text-white tabular-nums flex-shrink-0`}>{item.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className={`block ${compact ? 'text-sm' : 'text-base'} font-semibold leading-snug ${done ? 'text-gray-500 line-through' : 'text-gray-100'}`}>
                    {item.is_veg === true && <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 mr-1.5 align-middle" title="Veg" />}
                    {item.is_veg === false && <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 mr-1.5 align-middle" title="Non-veg" />}
                    {item.item_name}
                    {item.variant_name && <span className="text-gray-400"> ({item.variant_name})</span>}
                    {!mine && item.station && <span className="ml-1.5 text-[10px] font-bold uppercase text-gray-500">{item.station}</span>}
                  </span>
                  {mods.length > 0 && (
                    <span className={`block pl-3 mt-0.5 ${compact ? 'text-xs' : 'text-sm'} text-gray-400 leading-snug`}>+ {mods.join(', ')}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Notes are never truncated */}
      {order.notes && (
        <div className={`m-2 mt-auto ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'} rounded-xl bg-yellow-300 text-gray-950 font-bold whitespace-pre-wrap break-words`}>
          📝 {order.notes}
        </div>
      )}
    </article>
  );
}

// TV paging: how many tickets fit across a lane, and which page is showing.
// One shared page clock; each lane wraps it to its own page count.
function useTvPaging(enabled, ticketWidth) {
  const ref = useRef(null);
  const [perPage, setPerPage] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const measure = () => {
      const gap = 12;
      const w = ref.current.clientWidth - 24; // lane padding
      setPerPage(Math.max(1, Math.floor((w + gap) / (ticketWidth + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    const id = setInterval(() => setTick((t) => t + 1), TV_PAGE_MS);
    return () => { ro.disconnect(); clearInterval(id); };
  }, [enabled, ticketWidth]);
  return { ref, perPage: enabled ? perPage : 0, tick };
}

export default function TicketRail({
  orders, now, getNext, onBump, onItemTap, onRecall, recallCount,
  station = null, density = 'comfortable', tv = false,
}) {
  const [activeLane, setActiveLane] = useState('new');
  const [highlight, setHighlight] = useState(null); // all-day item key
  const [selectedId, setSelectedId] = useState(null);
  const compact = density === 'compact';
  const { ref: railRef, perPage, tick } = useTvPaging(tv, compact ? 230 : 290);

  const lanes = useMemo(() => LANES.map((lane) => ({
    ...lane,
    orders: orders
      .filter((o) => laneOf(o, station) === lane.key)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  })), [orders, station]);

  // All-day totals: what this screen still has to cook across NEW + COOKING
  const allDay = useMemo(() => {
    const totals = new Map();
    for (const lane of lanes.slice(0, 2)) {
      for (const o of lane.orders) {
        for (const i of o.items || []) {
          if (!isActive(i) || isDone(i) || !itemOnStation(i, station)) continue;
          totals.set(itemKey(i), (totals.get(itemKey(i)) || 0) + (i.quantity || 1));
        }
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [lanes, station]);

  // Keyboard / bump bar: 1–9 select the nth ticket (lane order), Enter bumps, R recalls
  const flat = useMemo(() => lanes.flatMap((l) => l.orders.map((o) => ({ o, lane: l.key }))), [lanes]);
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (/^[1-9]$/.test(e.key)) {
        const hit = flat[Number(e.key) - 1];
        if (hit) setSelectedId(hit.o.id);
      } else if (e.key === 'Enter' && selectedId) {
        const hit = flat.find((x) => x.o.id === selectedId);
        if (hit) { e.preventDefault(); onBump(hit.o, hit.lane); }
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && onRecall) {
        onRecall();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, selectedId, onBump, onRecall]);

  const hasItem = (order) => (order.items || []).some((i) => isActive(i) && itemKey(i) === highlight);

  return (
    <div ref={railRef} className="flex flex-col min-h-0 h-full">
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
        {onRecall && (
          <button
            type="button"
            onClick={onRecall}
            disabled={!recallCount}
            title="Undo the last bump (R)"
            aria-label="Recall"
            className="flex-shrink-0 min-h-[40px] min-w-[44px] px-3 rounded-xl text-sm font-bold bg-gray-800 text-gray-200 disabled:opacity-30 select-none touch-manipulation"
          >
            ↶ <span className="hidden sm:inline">Recall</span>
          </button>
        )}
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
        {lanes.map((lane) => {
          // TV paging (md+): show one page of the lane; page 1 = oldest
          const pages = perPage ? Math.max(1, Math.ceil(lane.orders.length / perPage)) : 1;
          const page = perPage ? tick % pages : 0;
          const shown = perPage ? lane.orders.slice(page * perPage, (page + 1) * perPage) : lane.orders;
          return (
            <section
              key={lane.key}
              className={`${activeLane === lane.key ? 'block' : 'hidden'} md:block border-b border-gray-800/80`}
              aria-label={`${lane.label} orders`}
            >
              <h2 className="hidden md:flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-black uppercase tracking-widest text-gray-400">
                <span className={`w-2 h-2 rounded-full ${lane.dot}`} />
                {lane.label}
                <span className="text-gray-600 tabular-nums">{lane.orders.length}</span>
                {pages > 1 && (
                  <span className="ml-2 normal-case tracking-normal font-bold text-gray-500">page {page + 1}/{pages}</span>
                )}
              </h2>
              {lane.orders.length === 0 ? (
                <p className="px-3 py-6 md:py-4 text-sm text-gray-600 text-center md:text-left">No tickets</p>
              ) : (
                <div className={`flex flex-col gap-3 p-3 md:flex-row md:items-start md:pb-4 ${perPage ? 'md:overflow-hidden' : 'md:overflow-x-auto'}`}>
                  {/* Phones always get the full stacked list */}
                  {(perPage ? lane.orders : shown).map((order) => (
                    <div key={order.id} className={perPage && !shown.includes(order) ? 'md:hidden' : 'contents'}>
                      <Ticket
                        order={order}
                        lane={lane.key}
                        now={now}
                        station={station}
                        compact={compact}
                        selected={order.id === selectedId}
                        dimmed={!!highlight && !hasItem(order)}
                        getNext={getNext}
                        onBump={onBump}
                        onItemTap={onItemTap}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
