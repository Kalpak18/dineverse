import { useState, useEffect, useCallback } from 'react';
import {
  getAreas, createArea, updateArea, deleteArea,
  createTable, updateTable, deleteTable,
} from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';

export default function TablesPage() {
  const [areas, setAreas]         = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [loading, setLoading]     = useState(true);

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
                  <h3 className="font-semibold text-gray-900">
                    {area.name}
                    {!area._unassigned && !area.is_active && (
                      <span className="ml-2 text-xs text-gray-400 font-normal">(inactive)</span>
                    )}
                  </h3>
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
                    className={`text-xs px-2 py-1 rounded-lg ${area.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}
                  >
                    {area.is_active ? 'Deactivate' : 'Activate'}
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
                    className={`flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${
                      table.is_active
                        ? 'bg-white border-gray-200'
                        : 'bg-gray-50 border-gray-100 text-gray-400'
                    }`}
                  >
                    <span className="font-medium truncate">{table.label}</span>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggleTable(table)}
                        title={table.is_active ? 'Deactivate' : 'Activate'}
                        className="text-xs text-gray-400 hover:text-amber-500"
                      >
                        {table.is_active ? '●' : '○'}
                      </button>
                      <button
                        onClick={() => handleDeleteTable(table.id, area._unassigned ? null : area.id)}
                        title="Delete"
                        className="text-xs text-gray-300 hover:text-red-500"
                      >
                        ✕
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
    </div>
  );
}
