import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfile, getOutlets, createOutlet, switchOutlet } from '../../services/api';
import ImageUpload from '../../components/ImageUpload';
import MapPicker from '../../components/MapPicker';
import toast from 'react-hot-toast';

const toSlug = (str) => str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

// ── GSTIN validation (India) ──────────────────────────────────
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const GSTIN_STATE_CODES = {
  '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
  '24':'Gujarat','25':'Daman & Diu','26':'Dadra & Nagar Haveli','27':'Maharashtra',
  '28':'Andhra Pradesh (old)','29':'Karnataka','30':'Goa','31':'Lakshadweep',
  '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman & Nicobar',
  '36':'Telangana','37':'Andhra Pradesh','38':'Ladakh',
};

function validateGstin(gstin) {
  if (!gstin || !gstin.trim()) return { status: 'empty' };
  const g = gstin.toUpperCase().trim();
  if (g.length < 15) return { status: 'short', msg: `${g.length}/15 characters` };
  if (!GSTIN_REGEX.test(g)) return { status: 'invalid', msg: 'Format invalid — expected: 22AAAAA0000A1Z5' };
  const stateCode = g.slice(0, 2);
  const stateName = GSTIN_STATE_CODES[stateCode];
  if (!stateName) return { status: 'invalid', msg: `Unknown state code: ${stateCode}` };
  return { status: 'valid', msg: `Format valid · ${stateName}` };
}

const BUSINESS_TYPES = [
  { value: 'restaurant',     label: 'Restaurant (Non-AC)',         rate: 5  },
  { value: 'restaurant_ac',  label: 'Restaurant (AC)',             rate: 5  },
  { value: 'cafe',           label: 'Café / Coffee Shop',          rate: 5  },
  { value: 'bakery',         label: 'Bakery / Sweet Shop',         rate: 5  },
  { value: 'hotel_rest',     label: 'Hotel Restaurant (room ≥₹7500)', rate: 18 },
  { value: 'bar',            label: 'Bar / Pub (with liquor)',      rate: 18 },
  { value: 'food_stall',     label: 'Food Stall / Cloud Kitchen',  rate: 5  },
  { value: 'composition',    label: 'Composition Scheme',          rate: 0  },
  { value: 'unregistered',   label: 'Not GST Registered (<₹20L turnover)', rate: 0 },
];

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu',
  'Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
];

const NAME_STYLES = [
  { value: 'normal',      label: 'Normal',      style: {} },
  { value: 'bold',        label: 'Bold',        style: { fontWeight: 'bold' } },
  { value: 'italic',      label: 'Italic',      style: { fontStyle: 'italic' } },
  { value: 'bold-italic', label: 'Bold Italic', style: { fontWeight: 'bold', fontStyle: 'italic' } },
];

export default function ProfilePage() {
  const { cafe, updateCafe } = useAuth();
  const [form, setForm] = useState({
    name:            cafe?.name || '',
    description:     cafe?.description || '',
    address:         cafe?.address || '',
    address_line2:   cafe?.address_line2 || '',
    city:            cafe?.city || '',
    state:           cafe?.state || '',
    pincode:         cafe?.pincode || '',
    phone:           cafe?.phone || '',
    logo_url:        cafe?.logo_url || '',
    cover_image_url: cafe?.cover_image_url || '',
    name_style:      cafe?.name_style || 'normal',
    latitude:        cafe?.latitude  || null,
    longitude:       cafe?.longitude || null,
    gst_number:      cafe?.gst_number  || '',
    gst_rate:        cafe?.gst_rate ?? 5,
    fssai_number:    cafe?.fssai_number || '',
    upi_id:          cafe?.upi_id    || '',
    bill_prefix:     cafe?.bill_prefix || 'INV',
    bill_footer:     cafe?.bill_footer || '',
    pan_number:      cafe?.pan_number  || '',
    tax_inclusive:   cafe?.tax_inclusive !== false,
    business_type:   cafe?.business_type || 'restaurant',
    country:         cafe?.country || 'India',
    // Delivery config
    delivery_enabled:    cafe?.delivery_enabled ?? false,
    delivery_radius_km:  cafe?.delivery_radius_km ?? 5,
    delivery_fee_base:   cafe?.delivery_fee_base ?? 0,
    delivery_fee_per_km: cafe?.delivery_fee_per_km ?? 0,
    delivery_min_order:  cafe?.delivery_min_order ?? 0,
    delivery_est_mins:   cafe?.delivery_est_mins ?? 30,
  });
  const [saving, setSaving] = useState(false);

  // Outlets
  const [outlets, setOutlets]         = useState([]);
  const [showOutletForm, setShowOutletForm] = useState(false);
  const [outletForm, setOutletForm]   = useState({ name: '', slug: '', address: '', address_line2: '', city: '', state: '', pincode: '', phone: '' });
  const [savingOutlet, setSavingOutlet] = useState(false);
  const [switchingId, setSwitchingId] = useState(null);

  useEffect(() => {
    getOutlets().then(({ data }) => setOutlets(data.outlets || [])).catch(() => {});
  }, []);

  const handleOutletSlugSuggest = (name) => {
    setOutletForm((f) => ({ ...f, name, slug: toSlug(name) }));
  };

  const handleCreateOutlet = async (e) => {
    e.preventDefault();
    if (!outletForm.name.trim()) return toast.error('Outlet name is required');
    if (!outletForm.slug.trim()) return toast.error('Slug is required');
    setSavingOutlet(true);
    try {
      const { data } = await createOutlet(outletForm);
      setOutlets((prev) => [...prev, data.outlet]);
      setShowOutletForm(false);
      setOutletForm({ name: '', slug: '', address: '', address_line2: '', city: '', state: '', pincode: '', phone: '' });
      toast.success('Outlet created!');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create outlet');
    } finally {
      setSavingOutlet(false);
    }
  };

  const handleSwitch = async (id) => {
    setSwitchingId(id);
    try {
      const { data } = await switchOutlet(id);
      localStorage.setItem('dineverse_token', data.token);
      updateCafe({ id: data.cafe_id, slug: data.slug, name: data.name });
      window.location.href = '/owner/dashboard'; // full reload to re-init with new token
    } catch {
      toast.error('Could not switch outlet');
    } finally {
      setSwitchingId(null);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleMapChange = ({ lat, lng, address }) => {
    setForm((f) => ({ ...f, latitude: lat, longitude: lng, address }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone.trim()) { toast.error('Phone number is required'); return; }
    setSaving(true);
    try {
      const { data } = await updateProfile(form);
      updateCafe(data.cafe);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const activeStyle = NAME_STYLES.find((s) => s.value === form.name_style) || NAME_STYLES[0];

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Café Profile</h1>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Basic Info ── */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Basic Info</h2>

          {/* Café Name + style toggles */}
          <div>
            <label className="label">Café Name</label>
            <input
              className="input"
              value={form.name}
              onChange={set('name')}
              style={activeStyle.style}
              required
            />
            {/* Style toggles */}
            <div className="flex gap-2 mt-2">
              {NAME_STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, name_style: s.value }))}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
                    form.name_style === s.value
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
                  }`}
                  style={s.style}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {/* Live name preview */}
            <p
              className="mt-2 text-base text-gray-800 px-3 py-2 bg-gray-50 rounded-lg"
              style={activeStyle.style}
            >
              {form.name || 'Your Café Name'}
            </p>
          </div>

          {/* URL slug (read-only) */}
          <div>
            <label className="label">Your URL Slug</label>
            <div className="input bg-gray-50 text-gray-500 select-all">
              {window.location.origin}/cafe/{cafe?.slug}
            </div>
            <p className="text-xs text-gray-400 mt-1">Slug cannot be changed after registration.</p>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.description}
              onChange={set('description')}
              placeholder="Tell customers about your café..."
            />
          </div>

          {/* Phone — mandatory */}
          <div>
            <label className="label">Phone <span className="text-red-500">*</span></label>
            <input
              className="input"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+91 98765 43210"
              required
            />
            <p className="text-xs text-gray-400 mt-1">Can be used to login instead of email.</p>
          </div>

          {/* Structured address */}
          <div className="space-y-3">
            <div>
              <label className="label">Address Line 1 <span className="text-gray-400 font-normal">(Shop/Building, Street)</span></label>
              <input className="input" value={form.address} onChange={set('address')}
                placeholder="e.g. Shop 4, Sunrise Complex, MG Road" />
            </div>
            <div>
              <label className="label">Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className="input" value={form.address_line2} onChange={set('address_line2')}
                placeholder="e.g. Near Kotak Bank, Andheri West" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={form.city} onChange={set('city')} placeholder="Mumbai" />
              </div>
              <div>
                <label className="label">Pincode</label>
                <input className="input" value={form.pincode} onChange={set('pincode')} placeholder="400001" maxLength={10} />
              </div>
            </div>
            <div>
              <label className="label">State</label>
              <select className="input" value={form.state} onChange={set('state')}>
                <option value="">Select state...</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <MapPicker
              lat={form.latitude}
              lng={form.longitude}
              address={[form.address, form.city].filter(Boolean).join(', ')}
              onChange={handleMapChange}
            />
          </div>

          {/* Logo only (cover image in separate section) */}
          <div>
            <label className="label">Café Logo</label>
            <ImageUpload
              value={form.logo_url}
              onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
              uploadType="logo"
              label=""
              aspectClass="aspect-square"
            />
          </div>

          <div>
            <label className="label">Cover Image</label>
            <ImageUpload
              value={form.cover_image_url}
              onChange={(url) => setForm((f) => ({ ...f, cover_image_url: url }))}
              uploadType="cover"
              label=""
              aspectClass="aspect-video"
            />
          </div>
        </div>

        {/* ── Tax & Legal ── */}
        <div className="card space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tax & Legal</h2>
            <p className="text-xs text-gray-400 mt-0.5">These details appear on every printed bill/receipt and are used to calculate tax on orders.</p>
          </div>

          {/* Business Type + Country */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Business Type</label>
              <select
                className="input"
                value={form.business_type}
                onChange={(e) => {
                  const btype = BUSINESS_TYPES.find((b) => b.value === e.target.value);
                  setForm((f) => ({
                    ...f,
                    business_type: e.target.value,
                    gst_rate: btype?.rate ?? f.gst_rate,
                  }));
                }}
              >
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Auto-suggests correct GST rate.</p>
            </div>
            <div>
              <label className="label">Country</label>
              <select
                className="input"
                value={form.country}
                onChange={set('country')}
              >
                <option value="India">India</option>
                <option value="Other">Other (manual rate)</option>
              </select>
            </div>
          </div>

          {/* GSTIN with live format validation */}
          {(() => {
            const gCheck = validateGstin(form.gst_number);
            return (
              <div>
                <label className="label">
                  GSTIN (GST Identification Number)
                  {gCheck.status === 'valid' && (
                    <span className="ml-2 text-xs text-green-600 font-semibold bg-green-50 px-2 py-0.5 rounded-full">
                      ✓ Format Valid
                    </span>
                  )}
                </label>
                <input
                  className={`input uppercase font-mono tracking-wider ${
                    gCheck.status === 'valid' ? 'border-green-400 ring-1 ring-green-400' :
                    gCheck.status === 'invalid' ? 'border-red-400 ring-1 ring-red-400' : ''
                  }`}
                  value={form.gst_number}
                  onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                  placeholder="22AAAAA0000A1Z5"
                  maxLength={15}
                />
                {gCheck.status === 'valid' && (
                  <p className="text-xs text-green-600 mt-1">✓ {gCheck.msg}</p>
                )}
                {gCheck.status === 'invalid' && (
                  <p className="text-xs text-red-500 mt-1">✕ {gCheck.msg}</p>
                )}
                {gCheck.status === 'short' && form.gst_number && (
                  <p className="text-xs text-amber-600 mt-1">{gCheck.msg}</p>
                )}
                {gCheck.status === 'empty' && (
                  <p className="text-xs text-gray-400 mt-1">Leave blank if not GST registered. GSTIN is 15 characters.</p>
                )}
              </div>
            );
          })()}

          {/* PAN Number */}
          <div>
            <label className="label">PAN Number</label>
            <input
              className="input uppercase font-mono tracking-wider"
              value={form.pan_number}
              onChange={(e) => setForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase().replace(/\s/g, '') }))}
              placeholder="AAAAA0000A"
              maxLength={10}
            />
            {form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number) ? (
              <p className="text-xs text-red-500 mt-1">✕ PAN format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)</p>
            ) : form.pan_number ? (
              <p className="text-xs text-green-600 mt-1">✓ Format valid</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">10-character PAN of the business owner / firm.</p>
            )}
          </div>

          {/* GST Rate + Tax Inclusive toggle */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">GST Rate (%)</label>
              <select
                className="input"
                value={form.gst_rate}
                onChange={(e) => setForm((f) => ({ ...f, gst_rate: parseInt(e.target.value) }))}
              >
                <option value={0}>0% — Not registered / Composition</option>
                <option value={5}>5% — Standard (CGST 2.5% + SGST 2.5%)</option>
                <option value={12}>12% — Special items</option>
                <option value={18}>18% — Hotel / Liquor (CGST 9% + SGST 9%)</option>
                <option value={28}>28% — Luxury</option>
              </select>
            </div>
            <div>
              <label className="label">Tax Treatment</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden mt-0.5">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, tax_inclusive: true }))}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    form.tax_inclusive ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tax Inclusive
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, tax_inclusive: false }))}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    !form.tax_inclusive ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tax Exclusive
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {form.tax_inclusive
                  ? 'Menu prices already include GST — tax extracted from total.'
                  : 'GST added on top of menu prices at checkout.'}
              </p>
            </div>
          </div>

          {/* Tax example preview */}
          {form.gst_rate > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold mb-1">How this affects a ₹100 item:</p>
              {form.tax_inclusive ? (
                <>
                  <p>• Menu price shown: <strong>₹100.00</strong> (includes GST)</p>
                  <p>• Base value: <strong>₹{(100 / (1 + form.gst_rate / 100)).toFixed(2)}</strong></p>
                  <p>• CGST {form.gst_rate / 2}%: <strong>₹{((100 - 100 / (1 + form.gst_rate / 100)) / 2).toFixed(2)}</strong> + SGST {form.gst_rate / 2}%: same</p>
                  <p className="text-blue-600">Customer pays ₹100.00 — tax is already inside the price.</p>
                </>
              ) : (
                <>
                  <p>• Menu price shown: <strong>₹100.00</strong> (pre-tax)</p>
                  <p>• GST {form.gst_rate}% added at checkout: <strong>₹{(100 * form.gst_rate / 100).toFixed(2)}</strong></p>
                  <p>• CGST {form.gst_rate / 2}%: <strong>₹{(100 * form.gst_rate / 100 / 2).toFixed(2)}</strong> + SGST: same</p>
                  <p className="text-blue-600">Customer pays ₹{(100 + 100 * form.gst_rate / 100).toFixed(2)} — tax added on top.</p>
                </>
              )}
            </div>
          )}

          {/* FSSAI */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">FSSAI License No.</label>
              <input
                className="input font-mono"
                value={form.fssai_number}
                onChange={set('fssai_number')}
                placeholder="10020012345678"
                maxLength={20}
              />
              {form.fssai_number && (form.fssai_number.length < 14 || form.fssai_number.length > 14) ? (
                <p className="text-xs text-amber-600 mt-1">FSSAI license is 14 digits</p>
              ) : form.fssai_number ? (
                <p className="text-xs text-green-600 mt-1">✓ Length valid</p>
              ) : (
                <p className="text-xs text-gray-400 mt-1">Mandatory for food businesses. Printed on bill.</p>
              )}
            </div>
            <div>
              <label className="label">UPI ID</label>
              <input
                className="input"
                value={form.upi_id}
                onChange={set('upi_id')}
                placeholder="yourcafe@upi"
              />
            </div>
          </div>

          {/* Invoice */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Invoice Prefix</label>
              <input
                className="input uppercase"
                value={form.bill_prefix}
                onChange={set('bill_prefix')}
                placeholder="INV"
                maxLength={10}
              />
              <p className="text-xs text-gray-400 mt-1">e.g. INV → INV-0001</p>
            </div>
          </div>

          <div>
            <label className="label">Bill Footer / Thank-you Message</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={form.bill_footer}
              onChange={set('bill_footer')}
              placeholder="Thank you for visiting! Come back soon."
              maxLength={200}
            />
          </div>

          {/* Live bill header preview */}
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl px-4 py-3 text-xs text-gray-500 space-y-0.5">
            <p className="font-semibold text-gray-700 mb-1">Bill header preview</p>
            <p className="text-sm text-center text-gray-900 uppercase tracking-wide" style={activeStyle.style}>
              {form.name || 'Your Café Name'}
            </p>
            {form.address      && <p className="text-center">{form.address}</p>}
            {form.address_line2 && <p className="text-center">{form.address_line2}</p>}
            {(form.city || form.state || form.pincode) && (
              <p className="text-center">{[form.city, form.state, form.pincode].filter(Boolean).join(', ')}</p>
            )}
            {form.phone && <p className="text-center">Ph: {form.phone}</p>}
            {form.gst_number && (
              <p className="text-center font-mono">
                GSTIN: {form.gst_number.toUpperCase()}
                {validateGstin(form.gst_number).status === 'valid' && (
                  <span className="ml-1 text-green-600">✓</span>
                )}
              </p>
            )}
            {form.pan_number && <p className="text-center font-mono">PAN: {form.pan_number.toUpperCase()}</p>}
            {form.gst_rate > 0 && (
              <p className="text-center">
                GST {form.gst_rate}% — CGST {form.gst_rate / 2}% + SGST {form.gst_rate / 2}%
                {form.tax_inclusive ? ' (Inclusive)' : ' (Exclusive)'}
              </p>
            )}
            {form.fssai_number && <p className="text-center">FSSAI: {form.fssai_number}</p>}
            {form.upi_id && <p className="text-center">UPI: {form.upi_id}</p>}
            <p className="mt-1 text-center text-gray-400 italic">{form.bill_footer || '(footer message)'}</p>
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      {/* ── Delivery Settings ── */}
      <div className="card space-y-5 mt-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Delivery Settings</h2>
          <p className="text-xs text-gray-400 mt-0.5">Enable delivery orders and configure fees &amp; radius</p>
        </div>

        {/* Enable / Disable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-800">Accept delivery orders</p>
            <p className="text-xs text-gray-400 mt-0.5">When enabled, customers can choose Delivery at checkout</p>
          </div>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, delivery_enabled: !f.delivery_enabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              form.delivery_enabled ? 'bg-brand-500' : 'bg-gray-200'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              form.delivery_enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {form.delivery_enabled && (
          <div className="space-y-4 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Delivery Radius (km)</label>
                <input
                  type="number" min="0.5" step="0.5" className="input"
                  value={form.delivery_radius_km}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_radius_km: parseFloat(e.target.value) || 5 }))}
                />
              </div>
              <div>
                <label className="label">Est. Delivery Time (min)</label>
                <input
                  type="number" min="5" step="5" className="input"
                  value={form.delivery_est_mins}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_est_mins: parseInt(e.target.value) || 30 }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Base Delivery Fee (₹)</label>
                <input
                  type="number" min="0" step="1" className="input"
                  value={form.delivery_fee_base}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_fee_base: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="label">Per-km Fee (₹)</label>
                <input
                  type="number" min="0" step="0.5" className="input"
                  value={form.delivery_fee_per_km}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_fee_per_km: parseFloat(e.target.value) || 0 }))}
                />
                <p className="text-xs text-gray-400 mt-1">Added on top of base fee based on distance</p>
              </div>
            </div>

            <div>
              <label className="label">Minimum Order Amount for Delivery (₹)</label>
              <input
                type="number" min="0" step="10" className="input"
                value={form.delivery_min_order}
                onChange={(e) => setForm((f) => ({ ...f, delivery_min_order: parseFloat(e.target.value) || 0 }))}
              />
              <p className="text-xs text-gray-400 mt-1">Set to 0 for no minimum</p>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Preview for customers:</p>
              <p>🛵 Delivery fee: {form.delivery_fee_base > 0 ? `₹${form.delivery_fee_base}` : 'Free'}{form.delivery_fee_per_km > 0 ? ` + ₹${form.delivery_fee_per_km}/km` : ''}</p>
              <p>⏱️ Estimated time: ~{form.delivery_est_mins} min</p>
              <p>📍 Radius: {form.delivery_radius_km} km</p>
              {form.delivery_min_order > 0 && <p>💰 Min order: ₹{form.delivery_min_order}</p>}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const { data } = await updateProfile(form);
                  updateCafe(data.cafe);
                  toast.success('Delivery settings saved!');
                } catch {
                  toast.error('Failed to save');
                } finally {
                  setSaving(false);
                }
              }}
              className="btn-primary"
            >
              {saving ? 'Saving...' : 'Save Delivery Settings'}
            </button>
          </div>
        )}

        {!form.delivery_enabled && (
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const { data } = await updateProfile({ ...form, delivery_enabled: false });
                updateCafe(data.cafe);
                toast.success('Delivery disabled');
              } catch {
                toast.error('Failed to save');
              } finally {
                setSaving(false);
              }
            }}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            {saving ? 'Saving...' : 'Save (delivery off)'}
          </button>
        )}
      </div>

      {/* ── Outlets Section ── */}
      {!cafe?.parent_cafe_id && (
        <div className="card space-y-4 mt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Outlets / Branches</h2>
              <p className="text-xs text-gray-400 mt-0.5">Add multiple locations under the same brand account</p>
            </div>
            <button
              onClick={() => setShowOutletForm((v) => !v)}
              className="btn-primary text-sm px-4"
            >
              {showOutletForm ? 'Cancel' : '+ Add Outlet'}
            </button>
          </div>

          {showOutletForm && (
            <form onSubmit={handleCreateOutlet} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
              <p className="text-xs font-semibold text-gray-600">New Outlet Details</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Outlet Name *</label>
                  <input className="input" placeholder="e.g. The Coffee House — Bandra"
                    value={outletForm.name}
                    onChange={(e) => handleOutletSlugSuggest(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="label">Slug *</label>
                  <div className="flex">
                    <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg px-3 flex items-center text-xs text-gray-500 whitespace-nowrap">/cafe/</span>
                    <input className="input rounded-l-none text-sm" placeholder="coffee-house-bandra"
                      value={outletForm.slug}
                      onChange={(e) => setOutletForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="label">Address Line 1</label>
                  <input className="input" placeholder="Shop no., Street" value={outletForm.address}
                    onChange={(e) => setOutletForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="label">Address Line 2 (optional)</label>
                  <input className="input" placeholder="Landmark, Area" value={outletForm.address_line2}
                    onChange={(e) => setOutletForm((f) => ({ ...f, address_line2: e.target.value }))} />
                </div>
                <div>
                  <label className="label">City</label>
                  <input className="input" placeholder="Mumbai" value={outletForm.city}
                    onChange={(e) => setOutletForm((f) => ({ ...f, city: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Pincode</label>
                  <input className="input" placeholder="400001" value={outletForm.pincode}
                    onChange={(e) => setOutletForm((f) => ({ ...f, pincode: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="label">State</label>
                  <select className="input" value={outletForm.state}
                    onChange={(e) => setOutletForm((f) => ({ ...f, state: e.target.value }))}>
                    <option value="">Select state...</option>
                    {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Outlet Phone</label>
                  <input className="input" placeholder="+91 98765 43210" value={outletForm.phone}
                    onChange={(e) => setOutletForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <p className="text-xs text-blue-700">
                  The outlet will share your current subscription and inherit your menu automatically.
                  Each outlet gets its own orders, tables, staff, and reservations.
                </p>
              </div>

              <button type="submit" disabled={savingOutlet} className="btn-primary text-sm w-full">
                {savingOutlet ? 'Creating...' : 'Create Outlet'}
              </button>
            </form>
          )}

          {/* Outlets list */}
          {outlets.length > 0 ? (
            <div className="space-y-2">
              {outlets.map((o) => {
                const isCurrent = o.id === cafe?.id;
                const isMain    = !o.parent_cafe_id;
                return (
                  <div key={o.id} className={`flex items-center justify-between p-3 rounded-xl border ${isCurrent ? 'bg-brand-50 border-brand-200' : 'bg-white border-gray-200'}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900">{o.name}</p>
                        {isMain  && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Main</span>}
                        {isCurrent && <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">Active</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">/{o.slug}{o.city ? ` · ${o.city}` : ''}</p>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={() => handleSwitch(o.id)}
                        disabled={!!switchingId}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-800 px-3 py-1.5 rounded-lg border border-brand-200 hover:bg-brand-50 transition-colors disabled:opacity-50"
                      >
                        {switchingId === o.id ? 'Switching...' : 'Switch'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">
              No outlets yet. Add your first branch above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
