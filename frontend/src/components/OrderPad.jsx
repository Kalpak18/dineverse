import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getCafeMenu, getCafeTables, getPublicItemModifiers, createStaffOrder, addItemsToOrder } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getApiError } from '../utils/apiError';
import { fmtCurrency, fmtToken } from '../utils/formatters';
import { tableName } from '../utils/tableName';

// Staff order pad (counter / POS): a new order for a walk-in, a phone order
// or a table — or more items for an existing order (a new round / KOT).
// Priced by the server exactly like a customer order.
//   addTo: the order to add items to (omit for a new order)
//   onPlaced(order, { pay }) — pay: staff chose "Place & take payment"
export default function OrderPad({ addTo = null, onClose, onPlaced }) {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [menu, setMenu] = useState(null);
  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState('all');
  const [lines, setLines] = useState([]); // { key, item, variant, mods, unitPrice, qty }
  const [optionsFor, setOptionsFor] = useState(null); // { item, groups, variants }
  const [orderType, setOrderType] = useState('takeaway');
  const [areas, setAreas] = useState(null);
  const [tableId, setTableId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  // One id per order on this pad: a retried tap returns the same order
  const clientOrderId = useRef(`pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    getCafeMenu(cafe.slug).then(({ data }) => setMenu(data.menu || [])).catch(() => toast.error('Could not load the menu'));
  }, [cafe.slug]);
  useEffect(() => {
    if (addTo || orderType !== 'dine-in' || areas) return;
    getCafeTables(cafe.slug).then(({ data }) => setAreas(data.areas || [])).catch(() => toast.error('Could not load tables'));
  }, [addTo, orderType, areas, cafe.slug]);

  const items = useMemo(() => {
    if (!menu) return [];
    const all = menu.flatMap((cat) => [
      ...cat.items.map((i) => ({ ...i, catId: cat.id })),
      ...(cat.subcategories || []).flatMap((sub) => sub.items.map((i) => ({ ...i, catId: cat.id }))),
    ]).filter((i) => i.is_available);
    const q = search.trim().toLowerCase();
    return all.filter((i) => (q ? i.name.toLowerCase().includes(q) : catId === 'all' || i.catId === catId));
  }, [menu, search, catId]);

  const qtyOf = (itemId) => lines.filter((l) => l.item.id === itemId).reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);

  const addLine = (item, variant = null, mods = []) => {
    const key = [item.id, variant?.id || '', ...mods.map((m) => m.option_id).sort()].join('|');
    const unitPrice = parseFloat(variant?.price ?? item.price) + mods.reduce((s, m) => s + parseFloat(m.price || 0), 0);
    setLines((prev) => (prev.some((l) => l.key === key)
      ? prev.map((l) => (l.key === key ? { ...l, qty: Math.min(l.qty + 1, 100) } : l))
      : [...prev, { key, item, variant, mods, unitPrice, qty: 1 }]));
  };
  const changeQty = (key, delta) => setLines((prev) => prev
    .map((l) => (l.key === key ? { ...l, qty: Math.min(l.qty + delta, 100) } : l))
    .filter((l) => l.qty > 0));

  const tapItem = async (item) => {
    if (item.has_options === false) return addLine(item);
    try {
      const { data } = await getPublicItemModifiers(cafe.slug, item.id);
      if (!data.groups?.length && !data.variants?.length) return addLine(item);
      setOptionsFor({ item, groups: data.groups || [], variants: data.variants || [] });
    } catch {
      toast.error('Could not load the options for this item');
    }
  };

  const place = async (pay) => {
    if (!lines.length) return;
    if (!addTo && orderType === 'dine-in' && !tableId) { toast.error('Choose a table'); return; }
    setPlacing(true);
    const body = {
      items: lines.map((l) => ({
        menu_item_id: l.item.id,
        quantity: l.qty,
        variant_id: l.variant?.id || null,
        selected_modifiers: l.mods.map((m) => ({ group_id: m.group_id, option_id: m.option_id })),
      })),
      notes: notes.trim() || undefined,
      client_order_id: clientOrderId.current,
      ...(!addTo && {
        order_type: orderType,
        table_id: orderType === 'dine-in' ? tableId : undefined,
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim() || undefined,
      }),
    };
    // Retried through network blips; the same client_order_id never makes a duplicate
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = addTo ? await addItemsToOrder(addTo.id, body) : await createStaffOrder(body);
        toast.success(addTo ? `Added to ${fmtToken(addTo.daily_order_number, addTo.order_type)} — sent to the kitchen` : 'Order placed — sent to the kitchen');
        onPlaced?.(data.order, { pay });
        return;
      } catch (err) {
        const status = err?.response?.status;
        if (status || attempt >= 20) {
          toast.error(getApiError(err));
          setPlacing(false);
          return;
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true"
      aria-label={addTo ? 'Add items' : 'New order'}>
      <div className="bg-white w-full sm:max-w-3xl h-[100dvh] sm:h-[90vh] sm:rounded-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">
              {addTo ? `Add items · ${fmtToken(addTo.daily_order_number, addTo.order_type)}` : 'New order'}
            </h2>
            {addTo && <p className="text-xs text-gray-500 truncate">{addTo.customer_name} · {addTo.order_type === 'takeaway' ? 'Takeaway' : tableName(addTo.table_number)} — goes to the kitchen as a new KOT</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] text-2xl text-gray-500">×</button>
        </div>

        {/* New order: type, table, customer */}
        {!addTo && (
          <div className="px-4 py-3 border-b border-gray-100 space-y-2">
            <div className="flex gap-2">
              {[['takeaway', '🥡 Takeaway'], ['dine-in', '🍽️ Dine-in']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setOrderType(v)} aria-pressed={orderType === v}
                  className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold border ${orderType === v ? 'bg-brand-500 text-white border-brand-500' : 'border-gray-200 text-gray-700'}`}>
                  {l}
                </button>
              ))}
            </div>
            {orderType === 'dine-in' && (
              <select aria-label="Table" value={tableId} onChange={(e) => setTableId(e.target.value)} className="input w-full">
                <option value="">{areas ? 'Choose table…' : 'Loading tables…'}</option>
                {(areas || []).map((a) => (
                  <optgroup key={a.id || a.name} label={a.name || 'Tables'}>
                    {(a.tables || []).map((t) => <option key={t.id} value={t.id}>{tableName(t.label)}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Customer name" className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input aria-label="Customer phone" className="input" inputMode="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        )}

        {/* Menu */}
        <div className="px-4 pt-3 space-y-2">
          <input aria-label="Search menu" className="input w-full" placeholder="🔍 Search dishes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {!search && menu && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {[{ id: 'all', name: 'All' }, ...menu].map((cat) => (
                <button key={cat.id} type="button" onClick={() => setCatId(cat.id)}
                  className={`flex-shrink-0 min-h-[36px] px-3 rounded-full text-xs font-semibold ${catId === cat.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
          {!menu ? <p className="py-10 text-center text-gray-400">Loading menu…</p> : (
            <ul className="divide-y divide-gray-100">
              {items.map((item) => {
                const q = qtyOf(item.id);
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${item.is_veg ? 'bg-green-600' : 'bg-red-600'}`} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">{c(item.price)}{item.has_options ? ' · options' : ''}</p>
                    </div>
                    <button type="button" onClick={() => tapItem(item)} aria-label={`Add ${item.name}`}
                      className="min-w-[72px] min-h-[44px] rounded-xl border-2 border-brand-500 text-brand-600 font-bold text-sm">
                      {q ? `+ (${q})` : 'ADD'}
                    </button>
                  </li>
                );
              })}
              {!items.length && <li className="py-10 text-center text-gray-400">No dishes match</li>}
            </ul>
          )}
        </div>

        {/* Cart + place */}
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-2" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          {lines.length > 0 && (
            <ul className="max-h-40 overflow-y-auto space-y-1" aria-label="Order lines">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {l.item.name}{l.variant ? ` (${l.variant.name})` : ''}{l.mods.length ? ` + ${l.mods.map((m) => m.option_name).join(', ')}` : ''}
                  </span>
                  <button type="button" onClick={() => changeQty(l.key, -1)} aria-label={`One less ${l.item.name}`} className="w-9 h-9 rounded-full bg-white border border-gray-300 font-bold">−</button>
                  <span className="w-6 text-center tabular-nums font-semibold">{l.qty}</span>
                  <button type="button" onClick={() => changeQty(l.key, 1)} aria-label={`One more ${l.item.name}`} className="w-9 h-9 rounded-full bg-white border border-gray-300 font-bold">+</button>
                  <span className="w-20 text-right tabular-nums">{c(l.unitPrice * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}
          {lines.length > 0 && (
            <input aria-label="Kitchen note" className="input w-full text-sm" placeholder="Note for the kitchen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{count} item{count === 1 ? '' : 's'} · {c(total)}</span>
            <span className="text-[11px] text-gray-400">Tax &amp; charges are added on the bill</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!lines.length || placing} onClick={() => place(false)}
              className="min-h-[48px] rounded-xl bg-gray-900 text-white font-bold disabled:opacity-40">
              {placing ? 'Placing…' : addTo ? 'Send to kitchen' : 'Place order'}
            </button>
            <button type="button" disabled={!lines.length || placing} onClick={() => place(true)}
              className="min-h-[48px] rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">
              {addTo ? 'Send & take payment' : 'Place & take payment'}
            </button>
          </div>
        </div>
      </div>

      {optionsFor && (
        <OptionSheet {...optionsFor} c={c}
          onClose={() => setOptionsFor(null)}
          onAdd={(variant, mods) => { addLine(optionsFor.item, variant, mods); setOptionsFor(null); }} />
      )}
    </div>
  );
}

// Size and add-on picker — same rules the server checks
function OptionSheet({ item, groups, variants, c, onClose, onAdd }) {
  const [variantId, setVariantId] = useState(variants[0]?.id || null);
  const [picked, setPicked] = useState({}); // groupId → [optionId]

  const toggle = (g, optId) => setPicked((p) => {
    const cur = p[g.id] || [];
    if (g.selection_type === 'single') return { ...p, [g.id]: [optId] };
    if (cur.includes(optId)) return { ...p, [g.id]: cur.filter((x) => x !== optId) };
    if (g.max_selections && cur.length >= g.max_selections) return p;
    return { ...p, [g.id]: [...cur, optId] };
  });
  const missing = groups.find((g) => {
    const n = (picked[g.id] || []).length;
    return (g.is_required && n === 0) || (n > 0 && n < (g.min_selections || 0));
  });
  const mods = groups.flatMap((g) => (picked[g.id] || []).map((optId) => {
    const o = (g.options || []).find((x) => x.id === optId);
    return { group_id: g.id, option_id: optId, option_name: o?.name, price: o?.price || 0 };
  }));

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={`${item.name} options`}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-bold">{item.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] text-2xl text-gray-500">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {variants.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold mb-1">Size</legend>
              {variants.map((v) => (
                <label key={v.id} className="flex items-center justify-between min-h-[44px]">
                  <span className="flex items-center gap-2"><input type="radio" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />{v.name}</span>
                  <span className="text-sm text-gray-600">{c(v.price)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {groups.map((g) => (
            <fieldset key={g.id}>
              <legend className="text-sm font-semibold mb-1">{g.name}{g.is_required ? ' *' : ''}</legend>
              {(g.options || []).filter((o) => o.is_available !== false).map((o) => (
                <label key={o.id} className="flex items-center justify-between min-h-[44px]">
                  <span className="flex items-center gap-2">
                    <input type={g.selection_type === 'single' ? 'radio' : 'checkbox'} checked={(picked[g.id] || []).includes(o.id)} onChange={() => toggle(g, o.id)} />
                    {o.name}
                  </span>
                  {parseFloat(o.price) > 0 && <span className="text-sm text-gray-600">+{c(o.price)}</span>}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="p-3 border-t border-gray-100">
          <button type="button" disabled={!!missing} onClick={() => onAdd(variants.find((v) => v.id === variantId) || null, mods)}
            className="w-full min-h-[48px] rounded-xl bg-brand-500 text-white font-bold disabled:opacity-40">
            {missing ? `Choose ${missing.name}` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
