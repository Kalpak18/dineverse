import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAreas, createArea, updateArea, deleteArea,
  createTable, updateTable, deleteTable,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';

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
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Areas & Tables</h1>
        <p className="text-gray-500 text-sm mt-1">
          Organise your seating into areas (Garden, AC Hall, Rooftop…). Customers will see dropdowns instead of free-text table entry.
        </p>
      </div>

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
    </div>
  );
}
