import { useState, useEffect, useCallback } from 'react';
import { getInventory, updateStock } from '../../services/api';
import PageHint from '../../components/PageHint';
import toast from 'react-hot-toast';

const LOW = 5;

export default function InventoryPage() {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter]     = useState('all'); // all | low | out | untracked
  const [search, setSearch]     = useState('');
  const [restock, setRestock]   = useState(null); // { id, name, qty }
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const { data } = await getInventory();
      setItems(data.items || []);
    } catch (err) {
      // subscription_expired is handled globally by the interceptor — don't double-toast
      if (err?.response?.data?.error !== 'subscription_expired') {
        setLoadError(true);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRestock = async (e) => {
    e.preventDefault();
    if (restock.qty === '' || restock.qty < 0) return toast.error('Enter a valid quantity');
    setSaving(true);
    try {
      const { data } = await updateStock(restock.id, {
        stock_quantity: parseInt(restock.qty),
        track_stock: true,
      });
      setItems((prev) => prev.map((i) => i.id === restock.id ? {
        ...i,
        stock_quantity: data.item.stock_quantity,
        track_stock: true,
        is_available: data.item.is_available,
        low_stock: data.item.stock_quantity <= LOW,
        out_of_stock: data.item.stock_quantity <= 0,
      } : i));
      toast.success(`${restock.name} restocked to ${restock.qty}`);
      setRestock(null);
    } catch { toast.error('Failed to update stock'); }
    finally { setSaving(false); }
  };

  const handleDisableTracking = async (item) => {
    try {
      await updateStock(item.id, { stock_quantity: null, track_stock: false });
      setItems((prev) => prev.map((i) => i.id === item.id
        ? { ...i, track_stock: false, stock_quantity: null, low_stock: false, out_of_stock: false }
        : i));
      toast.success('Stock tracking disabled');
    } catch { toast.error('Failed'); }
  };

  const q = search.toLowerCase();
  const filtered = items.filter((i) => {
    if (q && !i.name.toLowerCase().includes(q) && !(i.category || '').toLowerCase().includes(q)) return false;
    if (filter === 'low')       return i.track_stock && i.low_stock && !i.out_of_stock;
    if (filter === 'out')       return i.track_stock && i.out_of_stock;
    if (filter === 'untracked') return !i.track_stock;
    return true;
  });

  const counts = {
    low:       items.filter((i) => i.track_stock && i.low_stock && !i.out_of_stock).length,
    out:       items.filter((i) => i.track_stock && i.out_of_stock).length,
    untracked: items.filter((i) => !i.track_stock).length,
  };

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-100" />)}
    </div>
  );

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <p className="text-4xl mb-3">⚠️</p>
      <p className="font-semibold text-gray-700 mb-1">Could not load inventory</p>
      <p className="text-sm text-gray-400 mb-5">Check your connection and try again.</p>
      <button onClick={load} className="btn-primary px-6">Retry</button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHint
        storageKey="dv_hint_inventory"
        title="Inventory — track stock so items auto-hide when sold out"
        items={[
          { icon: '📦', text: 'Enable stock tracking per item in Menu → Edit item → Stock tracking toggle' },
          { icon: '🔴', text: 'When quantity hits 0, the item is hidden from your menu automatically and you get a notification' },
          { icon: '↑', text: 'Click Restock on any item here to add quantity — it re-appears on the menu instantly' },
          { icon: '🔎', text: 'Use filters: Out of Stock shows items to restock; Low Stock shows items with ≤5 units left' },
        ]}
        tip="Check this page at the end of each day to restock items before the next service."
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">{items.filter((i) => i.track_stock).length} items tracked</p>
        </div>
      </div>

      {/* Alert cards */}
      {(counts.out > 0 || counts.low > 0) && (
        <div className="flex gap-3 flex-wrap">
          {counts.out > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 font-medium">
              🚫 {counts.out} item{counts.out !== 1 ? 's' : ''} out of stock
            </div>
          )}
          {counts.low > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 font-medium">
              ⚠️ {counts.low} item{counts.low !== 1 ? 's' : ''} running low (≤{LOW})
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text" placeholder="Search items…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 min-w-48 py-2"
        />
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
          {[
            { key: 'all', label: 'All' },
            { key: 'out', label: `Out (${counts.out})` },
            { key: 'low', label: `Low (${counts.low})` },
            { key: 'untracked', label: `Untracked (${counts.untracked})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-2 font-medium transition-colors ${
                filter === key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📦</div>
          <p className="font-medium text-gray-500">No menu items yet</p>
          <p className="text-sm mt-1">Add items in the Menu page — they'll appear here for stock tracking.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">🔍</div>
          <p>No items match this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Category</th>
                <th className="text-center px-4 py-3">Stock</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((item) => (
                <tr key={item.id} className={`${item.out_of_stock ? 'bg-red-50/40' : item.low_stock ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{item.category || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {item.track_stock
                      ? <span className={`font-bold text-base ${item.out_of_stock ? 'text-red-600' : item.low_stock ? 'text-amber-600' : 'text-gray-900'}`}>
                          {item.stock_quantity ?? '—'}
                        </span>
                      : <span className="text-gray-300 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-center">
                    {!item.track_stock ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : item.out_of_stock ? (
                      <span className="badge bg-red-100 text-red-700 text-xs">Out</span>
                    ) : item.low_stock ? (
                      <span className="badge bg-amber-100 text-amber-700 text-xs">Low</span>
                    ) : (
                      <span className="badge bg-green-100 text-green-700 text-xs">OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setRestock({ id: item.id, name: item.name, qty: item.stock_quantity ?? 0 })}
                        className="text-xs font-medium text-brand-600 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {item.track_stock ? 'Restock' : 'Enable'}
                      </button>
                      {item.track_stock && (
                        <button
                          onClick={() => handleDisableTracking(item)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                          title="Disable stock tracking"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Restock modal */}
      {restock && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setRestock(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-6">
            <h3 className="font-bold text-gray-900 mb-1">Update Stock</h3>
            <p className="text-sm text-gray-500 mb-4">{restock.name}</p>
            <form onSubmit={handleRestock} className="space-y-4">
              <div>
                <label className="label">New quantity</label>
                <input
                  type="number" min="0" autoFocus
                  className="input"
                  value={restock.qty}
                  onChange={(e) => setRestock((r) => ({ ...r, qty: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setRestock(null)} className="btn-secondary flex-1">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
