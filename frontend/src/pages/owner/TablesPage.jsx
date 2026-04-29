import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAreas, createArea, updateArea, deleteArea,
  createTable, updateTable, deleteTable,
  getLiveTables,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';
import { fmtCurrency } from '../../utils/formatters';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

function QRModal({ table, slug, onClose }) {
  const canvasRef = useRef(null);
  const url = `${window.location.origin}/cafe/${slug}?table=${encodeURIComponent(table.label)}`;

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 2 });
    }
  }, [url]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `qr-table-${table.label}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs text-center space-y-4">
        <h3 className="font-bold text-gray-900">QR Code — {table.label}</h3>
        <p className="text-xs text-gray-400 break-all">{url}</p>
        <div className="flex justify-center">
          <canvas ref={canvasRef} className="rounded-xl" />
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownload} className="btn-primary flex-1 text-sm">⬇ Download</button>
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function TablesPage() {
  const { cafe } = useAuth();
  const [tab, setTab]             = useState('live'); // 'live' | 'setup'
  const [areas, setAreas]         = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [qrTable, setQrTable]     = useState(null); // table object

  // UI state
  const [newAreaName, setNewAreaName]   = useState('');
  const [addingArea, setAddingArea]     = useState(false);
  const [editingArea, setEditingArea]   = useState(null); // {id, name}
  const [newTable, setNewTable]         = useState({ label: '', area_id: '' }); // area_id='' means unassigned
  const [addingTable, setAddingTable]   = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getAreas();
      setAreas(data.areas);
      setUnassigned(data.unassigned);
    } catch {
      toast.error('Failed to load areas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Area actions ──────────────────────────────────────────────
  const handleAddArea = async (e) => {
    e.preventDefault();
    if (!newAreaName.trim()) return;
    setAddingArea(true);
    try {
      const { data } = await createArea({ name: newAreaName.trim() });
      setAreas((prev) => [...prev, data.area]);
      setNewAreaName('');
    } catch { toast.error('Failed to add area'); }
    finally { setAddingArea(false); }
  };

  const handleRenameArea = async (id) => {
    if (!editingArea?.name.trim()) return;
    try {
      await updateArea(id, { name: editingArea.name.trim() });
      setAreas((prev) => prev.map((a) => a.id === id ? { ...a, name: editingArea.name.trim() } : a));
      setEditingArea(null);
    } catch { toast.error('Failed to rename area'); }
  };

  const handleToggleArea = async (area) => {
    try {
      await updateArea(area.id, { is_active: !area.is_active });
      setAreas((prev) => prev.map((a) => a.id === area.id ? { ...a, is_active: !a.is_active } : a));
    } catch { toast.error('Failed to update area'); }
  };

  const handleDeleteArea = async (id) => {
    if (!window.confirm('Delete this area? Its tables will become unassigned.')) return;
    try {
      await deleteArea(id);
      await load();
    } catch { toast.error('Failed to delete area'); }
  };

  // ── Table actions ─────────────────────────────────────────────
  const handleAddTable = async (e) => {
    e.preventDefault();
    if (!newTable.label.trim()) return;
    setAddingTable(true);
    try {
      const { data } = await createTable({
        label: newTable.label.trim(),
        area_id: newTable.area_id || undefined,
      });
      if (newTable.area_id) {
        setAreas((prev) => prev.map((a) =>
          a.id === newTable.area_id
            ? { ...a, tables: [...a.tables, data.table] }
            : a
        ));
      } else {
        setUnassigned((prev) => [...prev, data.table]);
      }
      setNewTable({ label: '', area_id: newTable.area_id });
    } catch { toast.error('Failed to add table'); }
    finally { setAddingTable(false); }
  };

  const handleToggleTable = async (table) => {
    try {
      await updateTable(table.id, { is_active: !table.is_active });
      const updater = (list) => list.map((t) => t.id === table.id ? { ...t, is_active: !t.is_active } : t);
      setAreas((prev) => prev.map((a) => ({ ...a, tables: updater(a.tables) })));
      setUnassigned(updater);
    } catch { toast.error('Failed to update table'); }
  };

  const handleDeleteTable = async (tableId, areaId) => {
    if (!window.confirm('Delete this table?')) return;
    try {
      await deleteTable(tableId);
      if (areaId) {
        setAreas((prev) => prev.map((a) =>
          a.id === areaId ? { ...a, tables: a.tables.filter((t) => t.id !== tableId) } : a
        ));
      } else {
        setUnassigned((prev) => prev.filter((t) => t.id !== tableId));
      }
    } catch { toast.error('Failed to delete table'); }
  };

  if (loading) return <LoadingSpinner />;

  const allAreas = [...areas, { id: '', name: 'No Area (unassigned)', tables: unassigned, is_active: true, _unassigned: true }];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Page header + tab switcher */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
          <p className="text-gray-500 text-sm mt-1">
            Live floor view and table setup.
          </p>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
          {[
            { key: 'live',  label: '🟢 Live View' },
            { key: 'setup', label: '⚙️ Setup' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 font-medium transition-colors ${
                tab === key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Live View tab ── */}
      {tab === 'live' && <LiveView cafeId={cafe?.id} cafeCurrency={cafe?.currency} />}

      {/* ── Setup tab ── */}
      {tab === 'setup' && (<>

      {/* ── Add new area ── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Add New Area</h2>
        <form onSubmit={handleAddArea} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="e.g. Garden, AC Hall, Rooftop, VIP Room"
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
          />
          <button type="submit" disabled={addingArea || !newAreaName.trim()} className="btn-primary whitespace-nowrap">
            {addingArea ? 'Adding…' : '+ Add Area'}
          </button>
        </form>
      </div>

      {/* ── Add new table ── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Add New Table</h2>
        <form onSubmit={handleAddTable} className="flex gap-2 flex-wrap">
          <input
            className="input flex-1 min-w-[120px]"
            placeholder="Table label e.g. T1, Window Seat"
            value={newTable.label}
            onChange={(e) => setNewTable((n) => ({ ...n, label: e.target.value }))}
          />
          <select
            className="input flex-1 min-w-[140px]"
            value={newTable.area_id}
            onChange={(e) => setNewTable((n) => ({ ...n, area_id: e.target.value }))}
          >
            <option value="">No area</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="submit" disabled={addingTable || !newTable.label.trim()} className="btn-primary whitespace-nowrap">
            {addingTable ? 'Adding…' : '+ Add Table'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          Tables without an area still appear in customer dropdowns as a flat list.
        </p>
      </div>

      {/* ── Areas + tables list ── */}
      {allAreas.map((area) => {
        const tableList = area._unassigned ? unassigned : area.tables;
        if (area._unassigned && tableList.length === 0) return null;

        return (
          <div key={area.id || 'unassigned'} className="card space-y-3">
            {/* Area header */}
            <div className="flex items-center justify-between gap-2">
              {editingArea?.id === area.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    className="input flex-1 py-1.5 text-sm"
                    value={editingArea.name}
                    onChange={(e) => setEditingArea((a) => ({ ...a, name: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameArea(area.id)}
                    autoFocus
                  />
                  <button onClick={() => handleRenameArea(area.id)} className="btn-primary text-xs px-3 py-1.5">Save</button>
                  <button onClick={() => setEditingArea(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <h3 className="font-semibold text-gray-900">{area.name}</h3>
                  {!area._unassigned && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      area.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {area.is_active ? 'Active' : 'Inactive'}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{tableList.length} table{tableList.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              {!area._unassigned && editingArea?.id !== area.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingArea({ id: area.id, name: area.name })}
                    className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100"
                  >
                    ✏️ Rename
                  </button>
                  <button
                    onClick={() => handleToggleArea(area)}
                    title={area.is_active ? 'Deactivate area' : 'Activate area'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                      area.is_active ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      area.is_active ? 'translate-x-[18px]' : 'translate-x-[2px]'
                    }`} />
                  </button>
                  <button
                    onClick={() => handleDeleteArea(area.id)}
                    className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-50"
                  >
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>

            {/* Tables */}
            {tableList.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No tables yet — add one above.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {tableList.map((table) => (
                  <div
                    key={table.id}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm ${
                      table.is_active
                        ? 'bg-white border-gray-200'
                        : 'bg-gray-50 border-gray-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{table.label}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        table.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {table.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <button
                        onClick={() => setQrTable(table)}
                        title="Show QR code"
                        className="text-gray-400 hover:text-brand-500 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 3h.01M5 8H3m2 0V6m0 2v2M5 20H3m2 0v-2m0 2h2M12 8h.01M5 12h.01" /></svg>
                      </button>
                      {/* Toggle switch */}
                      <button
                        onClick={() => handleToggleTable(table)}
                        title={table.is_active ? 'Click to deactivate' : 'Click to activate'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                          table.is_active ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          table.is_active ? 'translate-x-[18px]' : 'translate-x-[2px]'
                        }`} />
                      </button>
                      <button
                        onClick={() => handleDeleteTable(table.id, area._unassigned ? null : area.id)}
                        title="Delete"
                        className="text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {areas.length === 0 && unassigned.length === 0 && (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🪑</p>
          <p className="font-medium">No areas or tables configured yet.</p>
          <p className="text-xs mt-1">
            Add areas like "Garden" or "AC Hall", then add tables inside them.
            Customers will see dropdowns on your ordering page.
          </p>
        </div>
      )}

      {qrTable && (
        <QRModal table={qrTable} slug={cafe?.slug} onClose={() => setQrTable(null)} />
      )}
      </>)}
    </div>
  );
}

// ── STATUS helpers ────────────────────────────────────────────
const ORDER_STATUS_COLOR = {
  pending:   'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100   text-blue-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready:     'bg-teal-100   text-teal-700',
  served:    'bg-green-100  text-green-700',
};

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── TableDetailPanel ─────────────────────────────────────────
function TableDetailPanel({ table, currency, onClose }) {
  const c = (n) => fmtCurrency(n, currency);
  if (!table) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-3 pb-3 sm:pb-0 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${table.is_occupied ? 'bg-orange-400' : 'bg-green-400'}`} />
            <h2 className="font-bold text-gray-900 text-lg">{table.label}</h2>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              table.is_occupied ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
            }`}>
              {table.is_occupied ? 'Occupied' : 'Available'}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
          {/* Active Orders */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Active Orders ({table.active_orders?.length || 0})
            </p>
            {!table.active_orders?.length ? (
              <p className="text-sm text-gray-400">No active orders on this table.</p>
            ) : (
              <div className="space-y-3">
                {table.active_orders.map((o) => (
                  <div key={o.id} className="bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">
                          #{o.daily_order_number || o.order_number}
                        </span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ORDER_STATUS_COLOR[o.status] || 'bg-gray-100 text-gray-600'}`}>
                          {o.status}
                        </span>
                      </div>
                      <span className="font-semibold text-gray-900 text-sm">{c(o.final_amount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{o.customer_name} · {o.item_count} item{o.item_count !== 1 ? 's' : ''}</span>
                      <span>{fmtTime(o.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reservations */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Upcoming Reservations ({table.reservations?.length || 0})
            </p>
            {!table.reservations?.length ? (
              <p className="text-sm text-gray-400">No reservations linked to this table.</p>
            ) : (
              <div className="space-y-3">
                {table.reservations.map((r) => (
                  <div key={r.id} className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-gray-900 text-sm">{r.customer_name}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.status === 'seated'    ? 'bg-purple-100 text-purple-700' :
                        r.status === 'confirmed' ? 'bg-green-100 text-green-700'  :
                                                   'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status === 'seated' ? '✓ Seated' : r.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>👥 Party of {r.party_size}{r.customer_phone ? ` · ${r.customer_phone}` : ''}</span>
                      <span>{fmtDate(r.reserved_date)} at {r.reserved_time?.slice(0, 5)}</span>
                    </div>
                    {r.notes && <p className="text-xs text-gray-400 mt-1 italic">"{r.notes}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LiveView ─────────────────────────────────────────────────
function LiveView({ cafeId, cafeCurrency }) {
  const [data, setData]             = useState(null); // { areas, unassigned, occupied_count, total_tables }
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null); // table object
  const [lastRefresh, setLastRefresh] = useState(null);
  const socketRef                   = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await getLiveTables();
      setData(d);
      setLastRefresh(new Date());
      // Refresh selected table details from new data
      setSelected((prev) => {
        if (!prev) return null;
        const all = [...(d.areas?.flatMap((a) => a.tables) || []), ...(d.unassigned || [])];
        return all.find((t) => t.id === prev.id) || null;
      });
    } catch {
      toast.error('Failed to load live table data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s + socket-triggered refresh on order changes
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!cafeId) return;
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('join_cafe', cafeId));
    if (socket.connected) socket.emit('join_cafe', cafeId);
    // Refresh on any order event
    socket.on('order_update',    load);
    socket.on('new_order',       load);
    socket.on('waitlist_update', load);
    return () => socket.disconnect();
  }, [cafeId, load]);

  if (loading) return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 animate-pulse">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-gray-100" />
      ))}
    </div>
  );

  if (!data) return null;

  const allGroups = [
    ...(data.areas || []),
    ...(data.unassigned?.length ? [{ id: 'unassigned', name: 'Unassigned', tables: data.unassigned }] : []),
  ];

  const occupied = data.occupied_count || 0;
  const total    = data.total_tables   || 0;
  const free     = total - occupied;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-orange-800">{occupied} Occupied</span>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-green-800">{free} Available</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2">
          <span className="text-sm font-medium text-gray-600">{total} Total Tables</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              Updated {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            className="text-xs font-medium text-brand-600 hover:text-brand-800 border border-brand-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table grid by area */}
      {allGroups.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🪑</p>
          <p className="font-medium">No tables configured yet.</p>
          <p className="text-xs mt-1">Switch to the Setup tab to add your tables.</p>
        </div>
      ) : (
        allGroups.map((group) => (
          <div key={group.id}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{group.name}</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {group.tables.map((table) => {
                const hasResv = table.reservations?.length > 0;
                const orderCount = table.active_orders?.length || 0;
                // Derive dominant order status for the table badge
                const statusPriority = ['preparing', 'ready', 'pending', 'confirmed', 'served'];
                const topStatus = statusPriority.find((s) =>
                  table.active_orders?.some((o) => o.status === s)
                );

                return (
                  <button
                    key={table.id}
                    onClick={() => setSelected(table)}
                    className={`relative rounded-2xl p-3 flex flex-col items-center gap-1.5 text-center transition-all hover:scale-105 hover:shadow-md border-2 ${
                      table.is_occupied
                        ? 'bg-orange-50 border-orange-300 shadow-sm'
                        : hasResv
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Reservation dot */}
                    {hasResv && !table.is_occupied && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-400" title="Has reservation" />
                    )}

                    {/* Table icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                      table.is_occupied ? 'bg-orange-200' : hasResv ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      🪑
                    </div>

                    {/* Label */}
                    <p className={`text-xs font-bold truncate w-full ${
                      table.is_occupied ? 'text-orange-900' : 'text-gray-700'
                    }`}>
                      {table.label}
                    </p>

                    {/* Status line */}
                    {table.is_occupied ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-full text-center truncate ${
                          ORDER_STATUS_COLOR[topStatus] || 'bg-orange-100 text-orange-700'
                        }`}>
                          {topStatus || 'active'}
                        </span>
                        <span className="text-[10px] text-orange-600 font-medium">
                          {orderCount} order{orderCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ) : hasResv ? (
                      <span className="text-[10px] text-blue-600 font-medium">Reserved</span>
                    ) : (
                      <span className="text-[10px] text-gray-400">Available</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 pt-2 border-t border-gray-100 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-200 border border-orange-300 inline-block" /> Occupied</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-200 inline-block" /> Has Reservation</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white border border-gray-200 inline-block" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Reservation today</span>
      </div>

      {selected && (
        <TableDetailPanel
          table={selected}
          currency={cafeCurrency}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
