import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import PageHint from '../../components/PageHint';
import {
  getModifierGroups, createModifierGroup, updateModifierGroup, deleteModifierGroup,
  createModifierOption, updateModifierOption, deleteModifierOption,
} from '../../services/api';

const BLANK_GROUP = { name: '', selection_type: 'single', is_required: false, min_selections: 0, max_selections: 1 };
const BLANK_OPT   = { name: '', price: '0', is_available: true };

export default function ModifiersPage() {
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeGroup, setActiveGroup] = useState(null);
  const [groupModal, setGroupModal] = useState(null); // null | 'new' | group object
  const [optModal, setOptModal]     = useState(null); // null | 'new' | option object
  const [groupForm, setGroupForm]   = useState(BLANK_GROUP);
  const [optForm, setOptForm]       = useState(BLANK_OPT);
  const [saving, setSaving]         = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await getModifierGroups();
      const g = data.groups || [];
      setGroups(g);
      if (activeGroup) {
        const refreshed = g.find((x) => x.id === activeGroup.id);
        setActiveGroup(refreshed || g[0] || null);
      } else {
        setActiveGroup(g[0] || null);
      }
    } catch (e) {
      const status = e?.response?.status;
      if (status !== 404) toast.error('Could not reach the server — check your connection.');
      setGroups([]);
      setActiveGroup(null);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  // ── Group CRUD ─────────────────────────────────────────────
  const openNewGroup = () => { setGroupForm(BLANK_GROUP); setGroupModal('new'); };
  const openEditGroup = (g) => {
    setGroupForm({
      name: g.name,
      selection_type: g.selection_type,
      is_required: g.is_required,
      min_selections: g.min_selections ?? 1,
      max_selections: g.max_selections ?? 1,
    });
    setGroupModal(g);
  };

  const saveGroup = async () => {
    if (!groupForm.name.trim()) return toast.error('Group name is required');
    setSaving(true);
    try {
      const payload = {
        name: groupForm.name.trim(),
        selection_type: groupForm.selection_type,
        is_required: groupForm.is_required,
        min_selections: Math.max(0, parseInt(groupForm.min_selections, 10) || 0),
        max_selections: parseInt(groupForm.max_selections) || 1,
      };
      if (groupModal === 'new') {
        await createModifierGroup(payload);
        toast.success('Group created');
      } else {
        await updateModifierGroup(groupModal.id, payload);
        toast.success('Group updated');
      }
      setGroupModal(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDeleteGroup = async (g) => {
    if (!window.confirm(`Delete "${g.name}"? This will remove it from all menu items.`)) return;
    try {
      await deleteModifierGroup(g.id);
      toast.success('Group deleted');
      if (activeGroup?.id === g.id) setActiveGroup(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };

  // ── Option CRUD ────────────────────────────────────────────
  const openNewOpt = () => { setOptForm(BLANK_OPT); setOptModal('new'); };
  const openEditOpt = (o) => {
    setOptForm({ name: o.name, price: String(o.price ?? 0), is_available: o.is_available });
    setOptModal(o);
  };

  const saveOpt = async () => {
    if (!optForm.name.trim()) return toast.error('Option name is required');
    if (!activeGroup) return;
    setSaving(true);
    try {
      const payload = {
        name: optForm.name.trim(),
        price: parseFloat(optForm.price) || 0,
        is_available: optForm.is_available,
      };
      if (optModal === 'new') {
        await createModifierOption(activeGroup.id, payload);
        toast.success('Option added');
      } else {
        await updateModifierOption(activeGroup.id, optModal.id, payload);
        toast.success('Option updated');
      }
      setOptModal(null);
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDeleteOpt = async (o) => {
    if (!activeGroup) return;
    try {
      await deleteModifierOption(activeGroup.id, o.id);
      toast.success('Option removed');
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };

  if (loading) return <div className="p-6 text-center text-gray-400">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <PageHint
        storageKey="dv_hint_modifiers"
        title="Add-ons — let customers customise orders with sizes, extras, and options"
        items={[
          { icon: '➕', text: 'Create a Modifier Group first (e.g. "Size", "Add-ons", "Spice Level"), then add options inside it (e.g. Small / Medium / Large with prices).' },
          { icon: '💰', text: 'Each option can have an extra charge. Leave it at ₹0 for free choices like spice preference.' },
          { icon: '✅', text: '"Required" groups force the customer to choose before they can add to cart (e.g. must pick a size). Optional groups are shown but skippable.' },
          { icon: '🔗', text: 'After creating groups here, go to Menu → edit a menu item → Modifier Groups to attach them to specific items.' },
          { icon: '📱', text: 'Customers see the options when adding items to cart. Selected extras appear on the order card and KOT.' },
        ]}
        tip='Start simple: "Size" (Small +₹0 / Regular +₹20 / Large +₹40) and "Add-ons" (Extra Cheese +₹30, Extra Sauce +₹10). You can add more groups later.'
      />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Modifier Groups</h1>
          <p className="text-xs text-gray-400 mt-0.5">Add-ons, extras, and customizations for menu items</p>
        </div>
        <button onClick={openNewGroup}
          className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors">
          + New Group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: group list */}
        <div className="md:col-span-1 space-y-2">
          {groups.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              <p className="text-3xl mb-2">⚙️</p>
              <p>No modifier groups yet</p>
              <p className="text-xs mt-1">Create groups like "Size", "Add-ons", "Spice level"</p>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id}
              onClick={() => setActiveGroup(g)}
              className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                activeGroup?.id === g.id
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 text-sm truncate">{g.name}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      g.selection_type === 'single' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {g.selection_type === 'single' ? 'Single' : 'Multi'}
                    </span>
                    {g.is_required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-600">Required</span>
                    )}
                    <span className="text-[10px] text-gray-400">{g.options?.length || 0} options</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); openEditGroup(g); }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g); }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <polyline strokeLinecap="round" strokeLinejoin="round" points="3 6 5 6 21 6" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: options panel */}
        <div className="md:col-span-2">
          {!activeGroup ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-2xl">
              Select a group to manage options
            </div>
          ) : (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">{activeGroup.name}</p>
                  <p className="text-xs text-gray-400">
                    {activeGroup.selection_type === 'single' ? 'Customer picks one' : `Customer picks ${activeGroup.min_selections}–${activeGroup.max_selections}`}
                    {activeGroup.is_required ? ' · Required' : ' · Optional'}
                  </p>
                </div>
                <button onClick={openNewOpt}
                  className="px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors">
                  + Add Option
                </button>
              </div>

              {(!activeGroup.options || activeGroup.options.length === 0) ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No options yet — add choices like "Small / Medium / Large" or "Extra cheese +₹20"
                </div>
              ) : (
                <div className="space-y-2">
                  {activeGroup.options.map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${o.is_available ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{o.name}</p>
                          {parseFloat(o.price) > 0 && (
                            <p className="text-xs text-gray-500">+₹{parseFloat(o.price).toFixed(0)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEditOpt(o)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDeleteOpt(o)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <polyline strokeLinecap="round" strokeLinejoin="round" points="3 6 5 6 21 6" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Group modal */}
      {groupModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <p className="font-semibold text-gray-900">{groupModal === 'new' ? 'New Modifier Group' : 'Edit Group'}</p>

            <div>
              <label className="label">Group Name</label>
              <input type="text" placeholder="e.g. Size, Add-ons, Spice level" className="input"
                value={groupForm.name} onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div>
              <label className="label">Selection Type</label>
              <div className="flex gap-2">
                {[['single', 'Single choice'], ['multiple', 'Multiple choices']].map(([v, l]) => (
                  <button key={v} onClick={() => setGroupForm((f) => ({ ...f, selection_type: v }))}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      groupForm.selection_type === v
                        ? 'border-brand-400 bg-brand-50 text-brand-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>{l}</button>
                ))}
              </div>
            </div>

            {groupForm.selection_type === 'multiple' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Min selections</label>
                  <input type="number" min="0" step="1" className="input"
                    value={groupForm.min_selections} onChange={(e) => setGroupForm((f) => ({ ...f, min_selections: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Max selections</label>
                  <input type="number" min="1" step="1" className="input"
                    value={groupForm.max_selections} onChange={(e) => setGroupForm((f) => ({ ...f, max_selections: e.target.value }))} />
                </div>
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={groupForm.is_required}
                onChange={(e) => setGroupForm((f) => ({ ...f, is_required: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-brand-500" />
              <span className="text-sm text-gray-700">Required (customer must choose)</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setGroupModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveGroup} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Option modal */}
      {optModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <p className="font-semibold text-gray-900">{optModal === 'new' ? 'Add Option' : 'Edit Option'}</p>

            <div>
              <label className="label">Option Name</label>
              <input type="text" placeholder="e.g. Large, Extra cheese, No onion" className="input"
                value={optForm.name} onChange={(e) => setOptForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Extra price (₹)</label>
              <input type="number" min="0" step="1" placeholder="0 for free" className="input"
                value={optForm.price} onChange={(e) => setOptForm((f) => ({ ...f, price: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">Added on top of base item price</p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={optForm.is_available}
                onChange={(e) => setOptForm((f) => ({ ...f, is_available: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-brand-500" />
              <span className="text-sm text-gray-700">Available</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setOptModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveOpt} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
