import { useState, useEffect } from 'react';
import { getOffers, createOffer, updateOffer, deleteOffer } from '../../services/api';
import { fmtCurrency, currencySymbol } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY_FORM = {
  name: '', description: '', offer_type: 'percentage', discount_value: '',
  min_order_amount: '', active_from: '', active_until: '',
  active_days: [], combo_price: '', coupon_code: '',
  is_active: true,
};

function OfferForm({ initial, onSave, onCancel }) {
  const { cafe: _of } = useAuth();
  const sym = currencySymbol(_of?.currency);
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleDay = (d) =>
    setForm((f) => ({
      ...f,
      active_days: f.active_days.includes(d)
        ? f.active_days.filter((x) => x !== d)
        : [...f.active_days, d],
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Offer name is required');
    if (form.offer_type !== 'combo' && !form.discount_value) return toast.error('Discount value is required');
    if (form.offer_type === 'combo' && !form.combo_price) return toast.error('Combo price is required');
    setSaving(true);
    try {
      const payload = {
        ...form,
        discount_value:   parseFloat(form.discount_value) || 0,
        min_order_amount: parseFloat(form.min_order_amount) || 0,
        combo_price:      form.combo_price ? parseFloat(form.combo_price) : null,
        active_from:      form.active_from || null,
        active_until:     form.active_until || null,
        active_days:      form.active_days.length ? form.active_days : null,
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 border-2 border-brand-200">
      <h3 className="font-bold text-gray-900">{initial?.id ? 'Edit Offer' : 'New Offer'}</h3>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Offer Name *</label>
          <input className="input" placeholder="e.g. Happy Hour, Weekend Deal" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label">Type *</label>
          <select className="input" value={form.offer_type} onChange={set('offer_type')}>
            <option value="percentage">% Percentage Discount</option>
            <option value="fixed">{sym} Fixed Amount Off</option>
            <option value="combo">Combo Deal</option>
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {form.offer_type !== 'combo' ? (
          <div>
            <label className="label">
              {form.offer_type === 'percentage' ? 'Discount %' : `Discount Amount (${sym})`} *
            </label>
            <input className="input" type="number" min="1" max={form.offer_type === 'percentage' ? 100 : undefined}
              placeholder={form.offer_type === 'percentage' ? 'e.g. 20' : 'e.g. 50'}
              value={form.discount_value} onChange={set('discount_value')} />
          </div>
        ) : (
          <div>
            <label className="label">Combo Price ({sym}) *</label>
            <input className="input" type="number" min="1" placeholder="e.g. 250"
              value={form.combo_price} onChange={set('combo_price')} />
          </div>
        )}
        <div>
          <label className="label">Min. Order Amount ({sym})</label>
          <input className="input" type="number" min="0" placeholder="0 = no minimum"
            value={form.min_order_amount} onChange={set('min_order_amount')} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Description (shown to customers)</label>
          <input className="input" placeholder="e.g. 20% off between 3 PM and 6 PM every day!"
            value={form.description} onChange={set('description')} />
        </div>
        <div>
          <label className="label">Coupon Code (optional)</label>
          <input className="input uppercase" placeholder="e.g. SUMMER20"
            value={form.coupon_code}
            onChange={(e) => setForm((f) => ({ ...f, coupon_code: e.target.value.toUpperCase() }))}
          />
          <p className="text-xs text-gray-400 mt-1">Leave blank to auto-apply; set a code for manual redemption.</p>
        </div>
      </div>

      {/* Time restriction */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Active From (optional)</label>
          <input className="input" type="time" value={form.active_from} onChange={set('active_from')} />
        </div>
        <div>
          <label className="label">Active Until (optional)</label>
          <input className="input" type="time" value={form.active_until} onChange={set('active_until')} />
        </div>
      </div>

      {/* Day restriction */}
      <div>
        <label className="label">Active Days (leave empty for every day)</label>
        <div className="flex gap-2 flex-wrap mt-1">
          {DAYS.map((day, i) => (
            <button key={day} type="button"
              onClick={() => toggleDay(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                form.active_days.includes(i)
                  ? 'bg-brand-500 border-brand-500 text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="is_active" checked={form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          className="w-4 h-4 rounded" />
        <label htmlFor="is_active" className="text-sm font-medium text-gray-700">Active (visible to customers)</label>
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={saving} className="btn-primary px-6">
          {saving ? 'Saving...' : 'Save Offer'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-6">Cancel</button>
      </div>
    </form>
  );
}

function OfferBadge({ offer }) {
  const { cafe: _ob } = useAuth();
  const sym = currencySymbol(_ob?.currency);
  const label = offer.offer_type === 'percentage'
    ? `${offer.discount_value}% OFF`
    : offer.offer_type === 'fixed'
      ? `${sym}${offer.discount_value} OFF`
      : `Combo ${sym}${offer.combo_price}`;

  const timeLabel = offer.active_from && offer.active_until
    ? ` · ${offer.active_from.slice(0,5)}–${offer.active_until.slice(0,5)}`
    : '';
  const dayLabel = offer.active_days?.length
    ? ` · ${offer.active_days.map((d) => DAYS[d]).join(', ')}`
    : '';
  const minLabel = offer.min_order_amount > 0 ? ` · Min ${sym}${offer.min_order_amount}` : '';

  return (
    <div className={`card p-4 flex items-start justify-between gap-4 ${!offer.is_active ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-xl flex-shrink-0">
          {offer.offer_type === 'percentage' ? '🏷️' : offer.offer_type === 'fixed' ? '💰' : '🎁'}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-900 text-sm">{offer.name}</p>
            <span className="text-xs bg-brand-100 text-brand-700 font-bold px-2 py-0.5 rounded-full">{label}</span>
            {!offer.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Paused</span>}
          </div>
          {offer.description && <p className="text-xs text-gray-500 mt-0.5">{offer.description}</p>}
          <p className="text-xs text-gray-400 mt-1">{timeLabel}{dayLabel}{minLabel}</p>
          {offer.coupon_code && (
            <p className="text-xs font-mono font-bold text-brand-700 bg-brand-50 border border-brand-200 rounded px-2 py-0.5 mt-1.5 inline-block tracking-widest">
              {offer.coupon_code}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => offer._onEdit(offer)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors text-sm"
          title="Edit"
        >✏️</button>
        <button
          onClick={() => offer._onDelete(offer.id)}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors text-sm"
          title="Delete"
        >🗑️</button>
      </div>
    </div>
  );
}

export default function OffersPage() {
  const { cafe } = useAuth();
  const sym = currencySymbol(cafe?.currency);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await getOffers();
      setOffers(data.offers);
    } catch { toast.error('Failed to load offers'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (payload) => {
    try {
      const { data } = await createOffer(payload);
      setOffers((prev) => [data.offer, ...prev]);
      setShowForm(false);
      toast.success('Offer created!');
    } catch { toast.error('Failed to create offer'); }
  };

  const handleUpdate = async (payload) => {
    try {
      const { data } = await updateOffer(editing.id, payload);
      setOffers((prev) => prev.map((o) => o.id === editing.id ? data.offer : o));
      setEditing(null);
      toast.success('Offer updated!');
    } catch { toast.error('Failed to update offer'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this offer?')) return;
    try {
      await deleteOffer(id);
      setOffers((prev) => prev.filter((o) => o.id !== id));
      toast.success('Offer deleted');
    } catch { toast.error('Failed to delete offer'); }
  };

  if (loading) return <div className="card text-center py-16 text-gray-400">Loading offers...</div>;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Offers & Combos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create discounts and combo deals that apply automatically at checkout</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditing(null); }} className="btn-primary">
          + New Offer
        </button>
      </div>

      {(showForm && !editing) && (
        <OfferForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {editing && (
        <OfferForm
          initial={{ ...editing, active_days: editing.active_days || [] }}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      )}

      {offers.length === 0 && !showForm ? (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🏷️</p>
          <p className="font-medium text-gray-700">No offers yet</p>
          <p className="text-sm mt-1">Create your first discount or combo deal to attract more customers</p>
          <button onClick={() => setShowForm(true)} className="btn-primary mt-4">Create First Offer</button>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => (
            <OfferBadge
              key={offer.id}
              offer={{ ...offer, _onEdit: setEditing, _onDelete: handleDelete }}
            />
          ))}
        </div>
      )}

      <div className="card bg-blue-50 border-blue-200 p-4">
        <p className="text-xs font-semibold text-blue-800 mb-1">How offers work</p>
        <ul className="text-xs text-blue-700 space-y-1">
          <li>• <strong>Percentage:</strong> e.g. 20% off all orders above {sym}200</li>
          <li>• <strong>Fixed:</strong> e.g. {sym}50 off every order</li>
          <li>• <strong>Combo:</strong> Bundle price when specific items are ordered together</li>
          <li>• The best applicable offer is auto-applied at checkout — customers always get the best deal</li>
          <li>• Time & day restrictions let you run happy hours and weekend specials</li>
        </ul>
      </div>
    </div>
  );
}
