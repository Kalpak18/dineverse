import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfile, getOutlets, createOutlet, switchOutlet, deleteCafe, getRouteStatus, connectRoute } from '../../services/api';
import ImageUpload from '../../components/ImageUpload';
import MapPicker from '../../components/MapPicker';
import toast from 'react-hot-toast';

const toSlug = (str) => str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

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
  const stateName = GSTIN_STATE_CODES[g.slice(0, 2)];
  if (!stateName) return { status: 'invalid', msg: `Unknown state code: ${g.slice(0, 2)}` };
  return { status: 'valid', msg: `Format valid · ${stateName}` };
}

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu',
  'Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
];

const FONT_FAMILIES = [
  { value: 'inherit',          label: 'Default'   },
  { value: 'Georgia, serif',   label: 'Georgia'   },
  { value: 'serif',            label: 'Serif'     },
  { value: 'monospace',        label: 'Mono'      },
  { value: 'cursive',          label: 'Cursive'   },
  { value: 'fantasy',          label: 'Display'   },
];

function parseNameStyle(raw) {
  if (!raw || raw === 'normal') return { fontFamily: 'inherit', fontSize: 18, bold: false, italic: false };
  if (raw === 'bold')        return { fontFamily: 'inherit', fontSize: 18, bold: true,  italic: false };
  if (raw === 'italic')      return { fontFamily: 'inherit', fontSize: 18, bold: false, italic: true  };
  if (raw === 'bold-italic') return { fontFamily: 'inherit', fontSize: 18, bold: true,  italic: true  };
  try { return { fontFamily: 'inherit', fontSize: 18, bold: false, italic: false, ...JSON.parse(raw) }; }
  catch { return { fontFamily: 'inherit', fontSize: 18, bold: false, italic: false }; }
}

function nameStyleToCss(obj) {
  return {
    fontFamily: obj.fontFamily,
    fontSize: obj.fontSize + 'px',
    fontWeight: obj.bold ? 'bold' : 'normal',
    fontStyle: obj.italic ? 'italic' : 'normal',
  };
}

const BUSINESS_TYPES = [
  { value: 'restaurant',     label: 'Restaurant (Non-AC)',              rate: 5  },
  { value: 'restaurant_ac',  label: 'Restaurant (AC)',                  rate: 5  },
  { value: 'cafe',           label: 'Café / Coffee Shop',               rate: 5  },
  { value: 'bakery',         label: 'Bakery / Sweet Shop',              rate: 5  },
  { value: 'hotel_rest',     label: 'Hotel Restaurant (room ≥₹7500)',   rate: 18 },
  { value: 'bar',            label: 'Bar / Pub (with liquor)',           rate: 18 },
  { value: 'food_stall',     label: 'Food Stall / Cloud Kitchen',       rate: 5  },
  { value: 'composition',    label: 'Composition Scheme',               rate: 0  },
  { value: 'unregistered',   label: 'Not GST Registered (<₹20L turnover)', rate: 0 },
];

const TABS = [
  { key: 'branding',  label: 'Branding' },
  { key: 'contact',   label: 'Contact' },
  { key: 'tax',       label: 'Tax & Billing' },
  { key: 'delivery',  label: 'Delivery' },
  { key: 'account',   label: 'Account' },
];

function buildForm(cafe) {
  return {
    name:            cafe?.name            || '',
    description:     cafe?.description     || '',
    address:         cafe?.address         || '',
    address_line2:   cafe?.address_line2   || '',
    city:            cafe?.city            || '',
    state:           cafe?.state           || '',
    pincode:         cafe?.pincode         || '',
    phone:           cafe?.phone           || '',
    logo_url:        cafe?.logo_url        || '',
    cover_image_url: cafe?.cover_image_url || '',
    name_style:      cafe?.name_style      || '',
    latitude:        cafe?.latitude        || null,
    longitude:       cafe?.longitude       || null,
    gst_number:      cafe?.gst_number      || '',
    gst_rate:        cafe?.gst_rate        ?? 5,
    fssai_number:    cafe?.fssai_number    || '',
    upi_id:          cafe?.upi_id          || '',
    bill_prefix:     cafe?.bill_prefix     || 'INV',
    bill_footer:     cafe?.bill_footer     || '',
    pan_number:      cafe?.pan_number      || '',
    tax_inclusive:   cafe?.tax_inclusive   === true,
    business_type:   cafe?.business_type   || 'restaurant',
    country:         cafe?.country         || 'India',
    currency:        cafe?.currency        || 'INR',
    delivery_enabled:    cafe?.delivery_enabled    ?? false,
    delivery_radius_km:  cafe?.delivery_radius_km  ?? 5,
    delivery_fee_base:   cafe?.delivery_fee_base   ?? 0,
    delivery_fee_per_km: cafe?.delivery_fee_per_km ?? 0,
    delivery_min_order:  cafe?.delivery_min_order  ?? 0,
    delivery_est_mins:   cafe?.delivery_est_mins   ?? 30,
  };
}

export default function ProfilePage() {
  const { cafe, updateCafe, refreshCafe } = useAuth();
  const [form, setForm]     = useState(() => buildForm(cafe));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('branding');

  useEffect(() => {
    if (cafe?.id) setForm(buildForm(cafe));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe?.id]);

  // Outlets
  const [outlets, setOutlets]               = useState([]);
  const [showOutletForm, setShowOutletForm] = useState(false);
  const [outletForm, setOutletForm]         = useState({ name: '', slug: '', address: '', address_line2: '', city: '', state: '', pincode: '', phone: '' });
  const [savingOutlet, setSavingOutlet]     = useState(false);
  const [switchingId, setSwitchingId]       = useState(null);

  useEffect(() => {
    getOutlets().then(({ data }) => setOutlets(data.outlets || [])).catch(() => {});
  }, []);

  // Payout
  const [routeStatus, setRouteStatus]         = useState(null);
  const [routeForm, setRouteForm]             = useState({ legal_business_name: '', contact_name: '' });
  const [connectingRoute, setConnectingRoute] = useState(false);

  useEffect(() => {
    getRouteStatus()
      .then(({ data }) => setRouteStatus(data))
      .catch(() => setRouteStatus({ status: 'not_connected' }));
  }, []);

  const handleConnectRoute = async (e) => {
    e.preventDefault();
    if (!routeForm.legal_business_name.trim()) return toast.error('Legal business name is required');
    if (!routeForm.contact_name.trim()) return toast.error('Contact name is required');
    setConnectingRoute(true);
    try {
      await connectRoute(routeForm);
      setRouteStatus({ status: 'pending' });
      toast.success('Payout account submitted! Verification in progress.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to connect payout account');
    } finally {
      setConnectingRoute(false);
    }
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
      window.location.href = '/owner/dashboard';
    } catch {
      toast.error('Could not switch outlet');
    } finally {
      setSwitchingId(null);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveTab = async (requirePhone = false) => {
    if (requirePhone && !form.phone.trim()) { toast.error('Phone number is required'); return; }
    setSaving(true);
    try {
      await updateProfile(form);
      await refreshCafe();
      toast.success('Saved!');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const nameStyleObj = parseNameStyle(form.name_style);
  const gCheck = validateGstin(form.gst_number);

  const setNameStyle = (changes) =>
    setForm((f) => ({ ...f, name_style: JSON.stringify({ ...parseNameStyle(f.name_style), ...changes }) }));

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Café Profile</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── BRANDING TAB ── */}
      {activeTab === 'branding' && (
        <div className="card space-y-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Branding</h2>

          <div>
            <label className="label">Café Name</label>
            <input className="input" value={form.name} onChange={set('name')} style={nameStyleToCss(nameStyleObj)} required />
            {/* Rich text toolbar */}
            <div className="flex items-center gap-2 mt-2 p-1.5 bg-gray-50 border border-gray-200 rounded-lg flex-wrap">
              <select
                value={nameStyleObj.fontFamily}
                onChange={(e) => setNameStyle({ fontFamily: e.target.value })}
                className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
                style={{ fontFamily: nameStyleObj.fontFamily }}
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <button type="button"
                  onClick={() => setNameStyle({ fontSize: Math.max(12, nameStyleObj.fontSize - 2) })}
                  className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded bg-white text-sm font-bold text-gray-600 hover:bg-gray-100">−</button>
                <span className="text-xs w-8 text-center text-gray-600">{nameStyleObj.fontSize}px</span>
                <button type="button"
                  onClick={() => setNameStyle({ fontSize: Math.min(64, nameStyleObj.fontSize + 2) })}
                  className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded bg-white text-sm font-bold text-gray-600 hover:bg-gray-100">+</button>
              </div>
              <button type="button"
                onClick={() => setNameStyle({ bold: !nameStyleObj.bold })}
                className={`w-7 h-7 font-bold border rounded text-sm transition-colors ${nameStyleObj.bold ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'}`}
              >B</button>
              <button type="button"
                onClick={() => setNameStyle({ italic: !nameStyleObj.italic })}
                className={`w-7 h-7 italic border rounded text-sm transition-colors ${nameStyleObj.italic ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'}`}
              >I</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Café Logo</label>
              <ImageUpload value={form.logo_url} onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))} uploadType="logo" label="" aspectClass="aspect-square" />
            </div>
            <div>
              <label className="label">Cover Image</label>
              <ImageUpload value={form.cover_image_url} onChange={(url) => setForm((f) => ({ ...f, cover_image_url: url }))} uploadType="cover" label="" aspectClass="aspect-video" />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={set('description')} placeholder="Tell customers about your café…" />
          </div>

          <div>
            <label className="label">Your Public URL</label>
            <div className="input bg-gray-50 text-gray-500 select-all text-sm">
              {window.location.origin}/cafe/{cafe?.slug}
            </div>
          </div>

          <button type="button" disabled={saving} onClick={() => saveTab()} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Save Branding'}
          </button>
        </div>
      )}

      {/* ── CONTACT TAB ── */}
      {activeTab === 'contact' && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Contact &amp; Address</h2>

          <div>
            <label className="label">Phone <span className="text-red-500">*</span></label>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="+91 xxxxx xxxxx" required />
          </div>

          <div className="space-y-3">
            <div>
              <label className="label">Address Line 1</label>
              <input className="input" value={form.address} onChange={set('address')} placeholder="Shop 4, Sunrise Complex, MG Road" />
            </div>
            <div>
              <label className="label">Address Line 2 <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
              <input className="input" value={form.address_line2} onChange={set('address_line2')} placeholder="Near Kotak Bank, Andheri West" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={form.city} onChange={set('city')} placeholder="Mumbai" />
              </div>
              <div>
                <label className="label">Pincode</label>
                <input className="input" value={form.pincode} onChange={set('pincode')} placeholder="400001" maxLength={10} />
              </div>
              <div>
                <label className="label">State</label>
                <select className="input" value={form.state} onChange={set('state')}>
                  <option value="">Select…</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <MapPicker
              lat={form.latitude} lng={form.longitude}
              address={[form.address, form.address_line2, form.city, form.state, form.pincode].filter(Boolean).join(', ')}
              onChange={({ lat, lng }) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
            />
          </div>

          <button type="button" disabled={saving} onClick={() => saveTab(true)} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Save Contact Info'}
          </button>
        </div>
      )}

      {/* ── TAX & BILLING TAB ── */}
      {activeTab === 'tax' && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tax &amp; Billing</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Business Type</label>
              <select className="input" value={form.business_type}
                onChange={(e) => {
                  const btype = BUSINESS_TYPES.find((b) => b.value === e.target.value);
                  setForm((f) => ({ ...f, business_type: e.target.value, gst_rate: btype?.rate ?? f.gst_rate }));
                }}>
                {BUSINESS_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.currency} onChange={set('currency')}>
                <option value="INR">INR — ₹</option>
                <option value="USD">USD — $</option>
                <option value="EUR">EUR — €</option>
                <option value="GBP">GBP — £</option>
                <option value="AUD">AUD — A$</option>
                <option value="CAD">CAD — C$</option>
                <option value="SGD">SGD — S$</option>
                <option value="AED">AED — د.إ</option>
              </select>
            </div>
          </div>

          {/* Tax & Compliance */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-0.5">Tax &amp; Compliance</p>
            <p className="text-xs text-gray-400 mb-4">
              These details appear on customer bills and tax invoices. Leave GSTIN blank if you are not GST-registered — GST will be hidden from customer bills.
            </p>
          </div>

          <div>
            <label className="label">
              GSTIN
              <span className="ml-1 text-[10px] text-gray-400 font-normal">(GST Identification Number)</span>
              {gCheck.status === 'valid' && <span className="ml-2 text-xs text-green-600 font-semibold bg-green-50 px-2 py-0.5 rounded-full">✓ Valid</span>}
            </label>
            <input
              className={`input uppercase font-mono tracking-wider ${gCheck.status === 'valid' ? 'border-green-400' : gCheck.status === 'invalid' ? 'border-red-400' : ''}`}
              value={form.gst_number}
              onChange={(e) => setForm((f) => ({ ...f, gst_number: e.target.value.toUpperCase().replace(/\s/g, '') }))}
              placeholder="22AAAAA0000A1Z5" maxLength={15}
            />
            {gCheck.status === 'valid'   && <p className="text-xs text-green-600 mt-1">✓ {gCheck.msg}</p>}
            {gCheck.status === 'invalid' && <p className="text-xs text-red-500 mt-1">✕ {gCheck.msg}</p>}
            {gCheck.status === 'short'   && form.gst_number && <p className="text-xs text-amber-600 mt-1">{gCheck.msg}</p>}
            {!form.gst_number && <p className="text-xs text-gray-400 mt-1">No GSTIN? Leave blank — GST will not appear on customer bills.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">PAN Number</label>
              <input className="input uppercase font-mono tracking-wider" value={form.pan_number}
                onChange={(e) => setForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                placeholder="AAAAA0000A" maxLength={10} />
              {form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan_number)
                ? <p className="text-xs text-red-500 mt-1">✕ Format: ABCDE1234F</p>
                : form.pan_number ? <p className="text-xs text-green-600 mt-1">✓ Format valid</p> : null}
            </div>
            <div>
              <label className="label">FSSAI License No.</label>
              <input className="input font-mono" value={form.fssai_number} onChange={set('fssai_number')} placeholder="10020012345678" maxLength={20} />
              {form.fssai_number && form.fssai_number.length !== 14
                ? <p className="text-xs text-amber-600 mt-1">FSSAI is 14 digits</p>
                : form.fssai_number ? <p className="text-xs text-green-600 mt-1">✓ Length valid</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">GST Rate (%)</label>
              <select className="input" value={form.gst_rate} onChange={(e) => setForm((f) => ({ ...f, gst_rate: parseInt(e.target.value) }))}>
                <option value={0}>0% — Not registered</option>
                <option value={5}>5% — Food &amp; beverages (standard)</option>
                <option value={12}>12% — Packaged / special items</option>
                <option value={18}>18% — AC restaurant / alcohol</option>
                <option value={28}>28% — Luxury / 5-star</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Split equally as CGST + SGST on every bill (e.g. 5% = 2.5% CGST + 2.5% SGST).
              </p>
            </div>
            <div>
              <label className="label">Tax Treatment</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden mt-0.5">
                {[{ v: true, l: 'Tax Inclusive' }, { v: false, l: 'Tax Exclusive' }].map(({ v, l }) => (
                  <button key={l} type="button" onClick={() => setForm((f) => ({ ...f, tax_inclusive: v }))}
                    className={`flex-1 py-2.5 text-xs font-medium transition-colors ${form.tax_inclusive === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {l}
                  </button>
                ))}
              </div>
              {form.gst_rate > 0 && (
                <div className={`mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${form.tax_inclusive ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                  {form.tax_inclusive ? (
                    <>
                      <p className="font-semibold mb-0.5">✓ GST is already inside your menu prices</p>
                      <p>Example: You set item price ₹100 → customer pays <strong>₹100</strong>. GST ({form.gst_rate}%) is extracted from that ₹100 for your returns.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold mb-0.5">+ GST is added on top of your menu prices</p>
                      <p>Example: You set item price ₹100 → customer pays <strong>₹{(100 * (1 + form.gst_rate / 100)).toFixed(0)}</strong> (₹100 + {form.gst_rate}% GST added at checkout).</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Billing Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">UPI ID</label>
                <input className="input" value={form.upi_id} onChange={set('upi_id')} placeholder="yourcafe@upi" />
              </div>
              <div>
                <label className="label">Invoice Prefix</label>
                <input className="input uppercase" value={form.bill_prefix} onChange={set('bill_prefix')} placeholder="INV" maxLength={10} />
                <p className="text-xs text-gray-400 mt-1">e.g. INV → INV-0001</p>
              </div>
            </div>

            <div>
              <label className="label">Bill Footer Message</label>
              <textarea className="input resize-none" rows={2} value={form.bill_footer} onChange={set('bill_footer')}
                placeholder="Thank you for visiting! Come back soon." maxLength={200} />
            </div>
          </div>

          <button type="button" disabled={saving} onClick={() => saveTab()} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Save Tax & Billing'}
          </button>
        </div>
      )}

      {/* ── DELIVERY TAB ── */}
      {activeTab === 'delivery' && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Delivery Settings</h2>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">Accept delivery orders</p>
              <p className="text-xs text-gray-400 mt-0.5">Customers can choose Delivery at checkout</p>
            </div>
            <button type="button" onClick={() => setForm((f) => ({ ...f, delivery_enabled: !f.delivery_enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.delivery_enabled ? 'bg-brand-500' : 'bg-gray-200'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.delivery_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {form.delivery_enabled && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Radius (km)</label>
                  <input type="number" min="0.5" step="0.5" className="input" value={form.delivery_radius_km}
                    onChange={(e) => setForm((f) => ({ ...f, delivery_radius_km: parseFloat(e.target.value) || 5 }))} />
                </div>
                <div>
                  <label className="label">Est. Time (min)</label>
                  <input type="number" min="5" step="5" className="input" value={form.delivery_est_mins}
                    onChange={(e) => setForm((f) => ({ ...f, delivery_est_mins: parseInt(e.target.value) || 30 }))} />
                </div>
                <div>
                  <label className="label">Base Fee (₹)</label>
                  <input type="number" min="0" step="1" className="input" value={form.delivery_fee_base}
                    onChange={(e) => setForm((f) => ({ ...f, delivery_fee_base: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label className="label">Per-km Fee (₹)</label>
                  <input type="number" min="0" step="0.5" className="input" value={form.delivery_fee_per_km}
                    onChange={(e) => setForm((f) => ({ ...f, delivery_fee_per_km: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div>
                <label className="label">Min. Order for Delivery (₹)</label>
                <input type="number" min="0" step="10" className="input" value={form.delivery_min_order}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_min_order: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          )}

          <button type="button" disabled={saving} onClick={() => saveTab()} className="btn-primary w-full">
            {saving ? 'Saving…' : 'Save Delivery Settings'}
          </button>
        </div>
      )}

      {/* ── ACCOUNT TAB ── */}
      {activeTab === 'account' && (
        <div className="space-y-6">

          {/* Payout Account */}
          <div className="card space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Payout Account</h2>
              <p className="text-xs text-gray-400 mt-0.5">Connect your bank so customer payments go directly to you. DineVerse retains 1% as platform fee.</p>
            </div>

            {routeStatus === null && <p className="text-sm text-gray-400">Loading…</p>}

            {routeStatus?.status === 'active' && (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-800">Payouts active</p>
                  <p className="text-xs text-green-600 mt-0.5">Customer payments split automatically: 99% to your bank, 1% to DineVerse.</p>
                </div>
              </div>
            )}

            {routeStatus?.status === 'pending' && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Verification in progress</p>
                  <p className="text-xs text-amber-600 mt-0.5">Razorpay is reviewing your details (usually 1–2 business days).</p>
                </div>
              </div>
            )}

            {routeStatus?.status === 'not_connected' && (
              <form onSubmit={handleConnectRoute} className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">How it works</p>
                  <p>1. Fill in your business name &amp; contact.</p>
                  <p>2. Razorpay emails you a secure link to add your bank details &amp; complete KYC.</p>
                  <p>3. Once verified, every payment splits: 99% to your bank, 1% to DineVerse.</p>
                </div>

                <div>
                  <label className="label">Legal Business Name <span className="text-red-500">*</span></label>
                  <input className="input" value={routeForm.legal_business_name}
                    onChange={(e) => setRouteForm((f) => ({ ...f, legal_business_name: e.target.value }))}
                    placeholder="As registered (e.g. Sunrise Café Pvt. Ltd.)" />
                </div>

                <div>
                  <label className="label">Contact Person Name <span className="text-red-500">*</span></label>
                  <input className="input" value={routeForm.contact_name}
                    onChange={(e) => setRouteForm((f) => ({ ...f, contact_name: e.target.value }))}
                    placeholder="Owner / Director" />
                </div>

                <button type="submit" disabled={connectingRoute} className="btn-primary w-full">
                  {connectingRoute ? 'Setting up…' : 'Set Up Payouts'}
                </button>

                <p className="text-xs text-gray-400 text-center">
                  Razorpay will email <strong>{cafe?.email}</strong> with a secure link to complete KYC. We never see your bank details.
                </p>
              </form>
            )}
          </div>

          {/* Outlets / Branches */}
          {!cafe?.parent_cafe_id && (
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Outlets / Branches</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Multiple locations under the same brand</p>
                </div>
                <button onClick={() => setShowOutletForm((v) => !v)} className="btn-primary text-sm px-4">
                  {showOutletForm ? 'Cancel' : '+ Add Outlet'}
                </button>
              </div>

              {showOutletForm && (
                <form onSubmit={handleCreateOutlet} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600">New Outlet</p>
                  <div>
                    <label className="label">Name *</label>
                    <input className="input" placeholder="e.g. The Coffee House — Bandra"
                      value={outletForm.name} onChange={(e) => setOutletForm((f) => ({ ...f, name: e.target.value, slug: toSlug(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="label">Slug *</label>
                    <div className="flex">
                      <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg px-3 flex items-center text-xs text-gray-500">/cafe/</span>
                      <input className="input rounded-l-none text-sm" placeholder="coffee-house-bandra"
                        value={outletForm.slug} onChange={(e) => setOutletForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Address</label>
                      <input className="input" value={outletForm.address} onChange={(e) => setOutletForm((f) => ({ ...f, address: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">City</label>
                      <input className="input" value={outletForm.city} onChange={(e) => setOutletForm((f) => ({ ...f, city: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Phone</label>
                      <input className="input" value={outletForm.phone} onChange={(e) => setOutletForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">State</label>
                      <select className="input" value={outletForm.state} onChange={(e) => setOutletForm((f) => ({ ...f, state: e.target.value }))}>
                        <option value="">Select…</option>
                        {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                    Outlet shares your subscription and inherits your menu. Gets its own orders, tables, staff and reservations.
                  </div>
                  <button type="submit" disabled={savingOutlet} className="btn-primary text-sm w-full">
                    {savingOutlet ? 'Creating…' : 'Create Outlet'}
                  </button>
                </form>
              )}

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
                            {isMain    && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Main</span>}
                            {isCurrent && <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">Active</span>}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">/{o.slug}{o.city ? ` · ${o.city}` : ''}</p>
                        </div>
                        {!isCurrent && (
                          <button onClick={() => handleSwitch(o.id)} disabled={!!switchingId}
                            className="text-xs font-semibold text-brand-600 hover:text-brand-800 px-3 py-1.5 rounded-lg border border-brand-200 hover:bg-brand-50 transition-colors disabled:opacity-50">
                            {switchingId === o.id ? 'Switching…' : 'Switch'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No outlets yet.</p>
              )}
            </div>
          )}

          {/* Danger Zone */}
          <DangerZone cafe={cafe} />
        </div>
      )}
    </div>
  );
}

function DangerZone({ cafe }) {
  const { logout } = useAuth();
  const [open, setOpen]               = useState(false);
  const [action, setAction]           = useState('deactivate');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy]               = useState(false);

  const handleConfirm = async () => {
    if (!confirmName.trim()) return;
    setBusy(true);
    try {
      await deleteCafe({ action, confirm_name: confirmName.trim() });
      toast.success(
        action === 'deactivate'
          ? 'Café deactivated. Contact support to reactivate.'
          : 'Café permanently deleted.',
        { duration: 6000 }
      );
      logout();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card border border-red-200 bg-red-50">
        <h2 className="font-bold text-red-700 mb-1">Danger Zone</h2>
        <p className="text-sm text-red-600 mb-4">These actions are irreversible. Please be certain before proceeding.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => { setAction('deactivate'); setConfirmName(''); setOpen(true); }}
            className="px-4 py-2 rounded-xl border-2 border-red-300 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors">
            Deactivate Café
          </button>
          <button onClick={() => { setAction('delete'); setConfirmName(''); setOpen(true); }}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            Delete Permanently
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <p className="text-2xl mb-2 text-center">{action === 'delete' ? '⚠️' : '🔒'}</p>
            <h3 className="font-bold text-gray-900 text-lg text-center mb-1">
              {action === 'delete' ? 'Delete Café Permanently' : 'Deactivate Café'}
            </h3>
            <p className="text-sm text-gray-500 text-center mb-4">
              {action === 'delete'
                ? 'All data will be permanently erased. This cannot be undone.'
                : 'Your café will be hidden from customers.'}
            </p>
            <p className="text-xs text-gray-600 mb-1 font-medium">
              Type your café name to confirm: <span className="font-bold text-gray-900">"{cafe?.name}"</span>
            </p>
            <input type="text" className="input w-full mb-4" placeholder={cafe?.name}
              value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleConfirm}
                disabled={busy || confirmName.trim().toLowerCase() !== cafe?.name?.trim().toLowerCase()}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 ${
                  action === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
                }`}>
                {busy ? 'Processing…' : action === 'delete' ? 'Yes, Delete' : 'Yes, Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
