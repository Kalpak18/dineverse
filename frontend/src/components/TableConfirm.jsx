import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getCafeTables, setOrderTable } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getApiError } from '../utils/apiError';

// Dine-in orders only count toward a table's bill once the table is verified:
// placed by scanning that table's QR, or confirmed here by staff. These
// pieces show that state and let waiters / cashiers confirm or move a party.

const MOVE_BADGE_MS = 15 * 60 * 1000;
const isDineIn = (o) => o.order_type !== 'takeaway' && o.order_type !== 'delivery';

export function TableStatusBadge({ order, dark = false }) {
  if (!isDineIn(order)) return null;
  if (order.table_verified === false) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        dark ? 'bg-amber-400 text-gray-950' : 'bg-amber-100 text-amber-800'
      }`}>
        ⚠ Table not confirmed
      </span>
    );
  }
  if (order.moved_from_table && order.moved_at && Date.now() - new Date(order.moved_at).getTime() < MOVE_BADGE_MS) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        dark ? 'bg-sky-400 text-gray-950' : 'bg-sky-100 text-sky-800'
      }`}>
        Moved from {order.moved_from_table}
      </span>
    );
  }
  return null;
}

// "Confirm table" (unverified) or "Move table" — opens a table picker.
// onDone(update) receives { order_ids, table_number } so the caller can patch state.
export function TableConfirmButton({ order, onDone, className = '' }) {
  const { cafe } = useAuth();
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState(null);
  const [saving, setSaving] = useState(null);
  const unverified = order.table_verified === false;

  useEffect(() => {
    if (!open || areas || !cafe?.slug) return;
    getCafeTables(cafe.slug)
      .then(({ data }) => setAreas(data.areas || []))
      .catch(() => { toast.error('Could not load tables'); setOpen(false); });
  }, [open, areas, cafe?.slug]);

  if (!isDineIn(order) || ['paid', 'cancelled'].includes(order.status)) return null;

  const choose = async (table) => {
    setSaving(table.id);
    try {
      const { data } = await setOrderTable(order.id, table.id);
      toast.success(`${data.order_ids.length > 1 ? `${data.order_ids.length} orders` : 'Order'} at ${data.table_number}`);
      onDone?.(data);
      setOpen(false);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-[44px] px-3 rounded-xl text-xs font-bold ${
          unverified ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700'
        } ${className}`}
      >
        {unverified ? 'Confirm table' : 'Move table'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          role="dialog" aria-modal="true" aria-labelledby="table-picker-title"
        >
          <div className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="table-picker-title" className="text-base font-bold text-gray-900">
                  {unverified ? 'Which table is this customer at?' : 'Move to which table?'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {order.customer_name} · typed “{order.table_number}”. All open orders from their phone move together.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="min-w-[44px] min-h-[44px] text-gray-400" aria-label="Close">✕</button>
            </div>

            {!areas ? (
              <p className="py-8 text-center text-sm text-gray-400">Loading tables…</p>
            ) : areas.every((a) => !a.tables?.length) ? (
              <p className="py-8 text-center text-sm text-gray-500">No tables set up yet — add them under Tables.</p>
            ) : (
              areas.filter((a) => a.tables?.length).map((area) => (
                <div key={area.id ?? 'general'} className="mb-3">
                  {areas.length > 1 && <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">{area.name}</p>}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {area.tables.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!!saving}
                        onClick={() => choose(t)}
                        className="min-h-[48px] rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 hover:border-brand-400 active:bg-gray-50 disabled:opacity-50"
                      >
                        {saving === t.id ? '…' : t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
