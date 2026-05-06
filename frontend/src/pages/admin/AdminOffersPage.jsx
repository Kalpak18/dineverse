import { useState, useEffect } from 'react';
import {
  adminGetPlatformOffers, adminCreatePlatformOffer,
  adminUpdatePlatformOffer, adminDeletePlatformOffer,
  adminGetPlatformOfferStats, adminGetCafes,
} from '../../services/api';
import toast from 'react-hot-toast';

const TYPE_LABELS = { percentage: '% Off', fixed: '₹ Off', first_order: 'First Order' };
const TARGET_LABELS = { all: 'All Cafes', specific: 'Specific Cafes' };

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = {
  name: '', description: '', offer_type: 'percentage', discount_value: '',
  max_discount_amount: '', coupon_code: '', min_order_amount: '',
  target_type: 'all', cafe_ids: [],
  active_days: [], active_from: '', active_until: '',
  start_date: '', end_date: '', max_uses: '', is_active: true,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AdminOffersPage() {
  const [offers, setOffers]       = useState([]);
  const [cafes, setCafes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [stats, setStats]         = useState(null);
  const [statsId, setStatsId]     = useState(null);

  const load = async () => {
    try {
      const [offRes, cafeRes] = await Promise.all([
        adminGetPlatformOffers(),
        adminGetCafes({ limit: 200 }),
      ]);
      setOffers(offRes.data.offers || []);
      setCafes(cafeRes.data.cafes || []);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit   = (o) => {
    setEditing(o.id);
    setForm({
      name: o.name || '', description: o.description || '',
      offer_type: o.offer_type || 'percentage',
      discount_value: o.discount_value || '',
      max_discount_amount: o.max_discount_amount || '',
      coupon_code: o.coupon_code || '',
      min_order_amount: o.min_order_amount || '',
      target_type: o.target_type || 'all',
      cafe_ids: [],
      active_days: o.active_days || [],
      active_from: o.active_from ? String(o.active_from).slice(0, 5) : '',
      active_until: o.active_until ? String(o.active_until).slice(0, 5) : '',
      start_date: o.start_date || '', end_date: o.end_date || '',
      max_uses: o.max_uses || '', is_active: o.is_active ?? true,
    });
    setShowForm(true);
  };

  const toggleDay = (d) => {
    setForm((f) => ({
      ...f,
      active_days: f.active_days.includes(d)
        ? f.active_days.filter((x) => x !== d)
        : [...f.active_days, d],
    }));
  };

  const toggleCafe = (id) => {
    setForm((f) => ({
      ...f,
      cafe_ids: f.cafe_ids.includes(id)
        ? f.cafe_ids.filter((x) => x !== id)
        : [...f.cafe_ids, id],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Offer name is required');
    if (!form.discount_value) return toast.error('Discount value is required');
    setSaving(true);
    try {
      const payload = {
        ...form,
        discount_value:      parseFloat(form.discount_value) || 0,
        max_discount_amount: form.max_discount_amount ? parseFloat(form.max_discount_amount) : undefined,
        min_order_amount:    parseFloat(form.min_order_amount) || 0,
        max_uses:            form.max_uses ? parseInt(form.max_uses) : undefined,
        active_days:         form.active_days.length ? form.active_days : undefined,
        active_from:         form.active_from || undefined,
        active_until:        form.active_until || undefined,
        start_date:          form.start_date || undefined,
        end_date:            form.end_date || undefined,
        coupon_code:         form.coupon_code.trim().toUpperCase() || undefined,
        cafe_ids:            form.target_type === 'specific' ? form.cafe_ids : [],
      };
      if (editing) {
        await adminUpdatePlatformOffer(editing, payload);
        toast.success('Offer updated');
      } else {
        await adminCreatePlatformOffer(payload);
        toast.success('Offer created');
      }
      setShowForm(false);
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this platform offer?')) return;
    try {
      await adminDeletePlatformOffer(id);
      toast.success('Offer deleted');
      setOffers((prev) => prev.filter((o) => o.id !== id));
    } catch { toast.error('Delete failed'); }
  };

  const viewStats = async (id) => {
    if (statsId === id) { setStats(null); setStatsId(null); return; }
    try {
      const res = await adminGetPlatformOfferStats(id);
      setStats(res.data);
      setStatsId(id);
    } catch { toast.error('Failed to load stats'); }
  };

  const toggleActive = async (o) => {
    try {
      await adminUpdatePlatformOffer(o.id, { is_active: !o.is_active });
      setOffers((prev) => prev.map((x) => x.id === o.id ? { ...x, is_active: !o.is_active } : x));
    } catch { toast.error('Update failed'); }
  };

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Offers</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create DineVerse-funded campaigns. Discounts are absorbed by platform, netted against café commission.</p>
        </div>
        <button onClick={openCreate}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition-colors">
          + New Campaign
        </button>
      </div>

      {/* Offer list */}
      <div className="space-y-3">
        {offers.length === 0 && (
          <div className="text-center py-16 text-gray-500">No platform offers yet. Create your first campaign.</div>
        )}
        {offers.map((o) => (
          <div key={o.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-bold">{o.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-300 font-medium">
                    {TYPE_LABELS[o.offer_type] || o.offer_type}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.is_active ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                    {o.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                    {TARGET_LABELS[o.target_type]}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                  <span className="text-orange-400 font-semibold">
                    {o.offer_type === 'percentage' ? `${o.discount_value}% off` : `₹${o.discount_value} off`}
                    {o.max_discount_amount ? ` (max ₹${fmt(o.max_discount_amount)})` : ''}
                  </span>
                  {o.min_order_amount > 0 && <span>Min ₹{fmt(o.min_order_amount)}</span>}
                  {o.coupon_code && <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">{o.coupon_code}</span>}
                  {o.start_date && <span>From {o.start_date}</span>}
                  {o.end_date && <span>Until {o.end_date}</span>}
                  {o.max_uses && <span>{o.uses_count}/{o.max_uses} uses</span>}
                </div>
                {o.description && <p className="text-xs text-gray-500 mt-1">{o.description}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => viewStats(o.id)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  📊 Stats
                </button>
                <button onClick={() => toggleActive(o)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${o.is_active ? 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800' : 'bg-green-900 text-green-300 hover:bg-green-800'}`}>
                  {o.is_active ? 'Pause' : 'Activate'}
                </button>
                <button onClick={() => openEdit(o)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  Edit
                </button>
                <button onClick={() => remove(o.id)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-900 text-red-300 hover:bg-red-800 transition-colors">
                  Delete
                </button>
              </div>
            </div>

            {/* Stats panel */}
            {statsId === o.id && stats && (
              <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{stats.total_redemptions}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total redemptions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-400">₹{fmt(stats.total_discount)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total discount given</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-400">{stats.daily_breakdown?.length || 0}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Active days</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create / Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{editing ? 'Edit Campaign' : 'New Platform Campaign'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-300 text-xl">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Name */}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Campaign Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Weekend Flash Sale"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2} placeholder="Shown to customers"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm resize-none focus:outline-none focus:border-orange-500" />
              </div>

              {/* Offer type */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Offer Type *</label>
                <select value={form.offer_type} onChange={(e) => setForm({ ...form, offer_type: e.target.value })}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500">
                  <option value="percentage">Percentage (% off)</option>
                  <option value="fixed">Fixed (₹ off)</option>
                  <option value="first_order">First Order Discount</option>
                </select>
              </div>

              {/* Discount value */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  {form.offer_type === 'fixed' ? 'Discount Amount (₹) *' : 'Discount (%) *'}
                </label>
                <input type="number" min="0" value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  placeholder={form.offer_type === 'fixed' ? '50' : '20'}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Max discount cap */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Max Discount Cap (₹)</label>
                <input type="number" min="0" value={form.max_discount_amount}
                  onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                  placeholder="e.g. 100 (optional)"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Min order */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Min Order (₹)</label>
                <input type="number" min="0" value={form.min_order_amount}
                  onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })}
                  placeholder="0 = no minimum"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Coupon code */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Coupon Code (optional)</label>
                <input value={form.coupon_code}
                  onChange={(e) => setForm({ ...form, coupon_code: e.target.value.toUpperCase() })}
                  placeholder="e.g. DINE20 (blank = auto-apply)"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-orange-500" />
              </div>

              {/* Max uses */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Max Total Uses</label>
                <input type="number" min="1" value={form.max_uses}
                  onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                  placeholder="Unlimited if blank"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Date range */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Start Date</label>
                <input type="date" value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">End Date</label>
                <input type="date" value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Time window */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active From</label>
                <input type="time" value={form.active_from}
                  onChange={(e) => setForm({ ...form, active_from: e.target.value })}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active Until</label>
                <input type="time" value={form.active_until}
                  onChange={(e) => setForm({ ...form, active_until: e.target.value })}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
              </div>

              {/* Active days */}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active Days (blank = all days)</label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => toggleDay(i)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        form.active_days.includes(i)
                          ? 'bg-orange-500 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>{d}</button>
                  ))}
                </div>
              </div>

              {/* Target */}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Target</label>
                <div className="flex gap-3 mt-2">
                  {[['all', 'All Cafes'], ['specific', 'Specific Cafes']].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setForm({ ...form, target_type: v })}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        form.target_type === v
                          ? 'bg-orange-500 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Cafe selector */}
              {form.target_type === 'specific' && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Select Cafes ({form.cafe_ids.length} selected)
                  </label>
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-1 border border-gray-700 rounded-xl p-3">
                    {cafes.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 rounded-lg px-2 py-1">
                        <input type="checkbox" checked={form.cafe_ids.includes(c.id)} onChange={() => toggleCafe(c.id)}
                          className="rounded accent-orange-500" />
                        <span className="text-sm text-white">{c.name}</span>
                        <span className="text-xs text-gray-500">{c.city}</span>
                      </label>
                    ))}
                    {cafes.length === 0 && <p className="text-xs text-gray-500 text-center py-2">No cafes found</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={save} disabled={saving}
                className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : editing ? 'Update Campaign' : 'Launch Campaign'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
