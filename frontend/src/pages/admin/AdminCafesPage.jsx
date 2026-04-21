import { useState, useEffect, useRef } from 'react';
import { adminGetCafes, adminUpdateCafe, adminGetCafeStats, adminNotifyCafe } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

const PLAN_STYLES = {
  free_trial: 'bg-amber-900/40 text-amber-400',
  yearly:     'bg-green-900/40 text-green-400',
};

function StatBox({ label, value, sub }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-3">
      <span className="text-xs text-gray-500 w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-200 break-all">{value}</span>
    </div>
  );
}

function CafeDetailModal({ cafe, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('details'); // 'details' | 'stats' | 'notify'
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMsg, setNotifMsg] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    adminGetCafeStats(cafe.id)
      .then(({ data }) => setStats(data))
      .catch(() => toast.error('Failed to load café details'))
      .finally(() => setLoading(false));
  }, [cafe.id]);

  const expired = cafe.plan_expiry_date && new Date(cafe.plan_expiry_date) < new Date();
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  const handleSendNotif = async () => {
    if (!notifTitle.trim() || !notifMsg.trim()) {
      toast.error('Title and message are required');
      return;
    }
    setSending(true);
    try {
      await adminNotifyCafe(cafe.id, { title: notifTitle.trim(), message: notifMsg.trim(), send_email: sendEmail });
      toast.success(sendEmail ? 'Notification + email sent' : 'In-app notification sent');
      setNotifTitle('');
      setNotifMsg('');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSending(false);
    }
  };

  const d = stats?.cafe; // full cafe details from backend

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-800">
          <div className="flex gap-4 items-start">
            {d?.logo_url ? (
              <img src={d.logo_url} alt={cafe.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-gray-700" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-brand-900/40 flex items-center justify-center text-brand-400 font-bold text-2xl flex-shrink-0">
                {cafe.name?.charAt(0)}
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold text-white">{cafe.name}</h2>
              <p className="text-sm text-gray-400">{cafe.email}</p>
              <p className="text-xs text-gray-600 mt-0.5">/{cafe.slug}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PLAN_STYLES[cafe.plan_type] || 'bg-gray-700 text-gray-300'}`}>
                  {cafe.plan_type === 'free_trial' ? 'Free Trial' : 'Yearly'}
                </span>
                {cafe.plan_expiry_date && (
                  <span className={`text-xs ${expired ? 'text-red-400' : 'text-gray-400'}`}>
                    {expired ? '⚠️ Expired ' : 'Expires '}
                    {new Date(cafe.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
                <span className={`text-xs ${cafe.is_active ? 'text-green-400' : 'text-red-400'}`}>
                  {cafe.is_active ? '● Active' : '● Inactive'}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none p-1 ml-2">×</button>
        </div>

        {/* Cover image */}
        {!loading && d?.cover_image_url && (
          <div className="h-36 overflow-hidden">
            <img src={d.cover_image_url} alt="cover" className="w-full h-full object-cover opacity-80" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {[['details', 'Details'], ['stats', 'Stats'], ['notify', 'Send Message']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === key ? 'text-brand-400 border-b-2 border-brand-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
        ) : (
          <div className="p-6">

            {/* ── Details tab ── */}
            {tab === 'details' && d && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Business Info</h3>
                  <div className="space-y-2">
                    <DetailRow label="Name" value={d.name} />
                    <DetailRow label="Email" value={d.email} />
                    <DetailRow label="Phone" value={d.phone} />
                    <DetailRow label="Business Type" value={d.business_type} />
                    <DetailRow label="Description" value={d.description} />
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Location</h3>
                  <div className="space-y-2">
                    <DetailRow label="Address" value={d.address} />
                    <DetailRow label="City" value={d.city} />
                    <DetailRow label="Country" value={d.country} />
                    <DetailRow label="Timezone" value={d.timezone} />
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Tax & Legal</h3>
                  <div className="space-y-2">
                    <DetailRow label="GST Number" value={d.gst_number} />
                    <DetailRow label="GST Rate" value={d.gst_rate != null ? `${d.gst_rate}%` : null} />
                    <DetailRow label="Tax Inclusive" value={d.tax_inclusive != null ? (d.tax_inclusive ? 'Yes' : 'No') : null} />
                    <DetailRow label="FSSAI Number" value={d.fssai_number} />
                  </div>
                </div>

                {d.opening_hours && Object.keys(d.opening_hours).length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Opening Hours</h3>
                    <div className="space-y-1">
                      {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((day) => {
                        const h = d.opening_hours[day];
                        if (!h) return null;
                        return (
                          <div key={day} className="flex gap-3">
                            <span className="text-xs text-gray-500 w-24 capitalize">{day}</span>
                            <span className="text-xs text-gray-300">
                              {h.closed ? 'Closed' : `${h.open || '—'} – ${h.close || '—'}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-600">
                  Registered {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
            )}

            {/* ── Stats tab ── */}
            {tab === 'stats' && stats && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Orders</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatBox label="Total Orders" value={stats.orders.total} />
                    <StatBox label="Pending" value={stats.orders.pending} />
                    <StatBox label="Preparing" value={stats.orders.preparing} />
                    <StatBox label="Cancelled" value={stats.orders.cancelled} />
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Revenue</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <StatBox label="Total Revenue" value={fmt(stats.revenue.total)} />
                    <StatBox label="Paid Revenue" value={fmt(stats.revenue.paid)} sub={`${stats.revenue.completed_orders} completed`} />
                    <StatBox label="Pending Revenue" value={fmt(stats.revenue.pending)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Menu</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox label="Total Items" value={stats.menu.total_items} />
                      <StatBox label="Available" value={stats.menu.available_items} sub={`${stats.menu.total_categories} categories`} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Ratings</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox label="Avg Rating" value={`${stats.ratings.avg_rating}★`} />
                      <StatBox label="Total Reviews" value={stats.ratings.total_ratings} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Notify tab ── */}
            {tab === 'notify' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Send a message to <span className="text-white font-medium">{cafe.name}</span>.
                  It appears in their notification bell instantly. Optionally also send an email.
                </p>

                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1.5">Title</label>
                  <input
                    type="text"
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    placeholder="e.g. Action required: update your menu"
                    maxLength={80}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1.5">Message</label>
                  <textarea
                    value={notifMsg}
                    onChange={(e) => setNotifMsg(e.target.value)}
                    placeholder="Describe the issue or action needed..."
                    rows={5}
                    maxLength={1000}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  />
                  <p className="text-xs text-gray-600 mt-1 text-right">{notifMsg.length}/1000</p>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-brand-500"
                  />
                  <span className="text-sm text-gray-300">
                    Also send as email to <span className="text-gray-400">{cafe.email}</span>
                  </span>
                </label>

                <button
                  onClick={handleSendNotif}
                  disabled={sending || !notifTitle.trim() || !notifMsg.trim()}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {sending ? 'Sending…' : sendEmail ? 'Send Notification + Email' : 'Send In-App Notification'}
                </button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminCafesPage() {
  const [cafes, setCafes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [selectedCafe, setSelectedCafe] = useState(null);
  const searchTimer = useRef(null);

  const load = (q = search, p = plan) => {
    setLoading(true);
    adminGetCafes({ search: q, plan: p })
      .then((res) => { setCafes(res.data.cafes); setTotal(res.data.total); })
      .catch(() => toast.error('Failed to load cafes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(val, plan), 400);
  };

  const handleExtend = async (cafe) => {
    const months = prompt(`Extend subscription for "${cafe.name}" by how many months?`, '12');
    if (!months || isNaN(parseInt(months))) return;
    try {
      const { data } = await adminUpdateCafe(cafe.id, { extend_months: parseInt(months) });
      setCafes(cafes.map((c) => c.id === cafe.id ? { ...c, ...data.cafe } : c));
      toast.success(`Subscription extended by ${months} months`);
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleToggleActive = async (cafe) => {
    if (!confirm(`${cafe.is_active ? 'Deactivate' : 'Activate'} "${cafe.name}"?`)) return;
    try {
      const { data } = await adminUpdateCafe(cafe.id, { is_active: !cafe.is_active });
      setCafes(cafes.map((c) => c.id === cafe.id ? { ...c, ...data.cafe } : c));
      toast.success(`Café ${data.cafe.is_active ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  return (
    <div className="space-y-5">
      {selectedCafe && <CafeDetailModal cafe={selectedCafe} onClose={() => setSelectedCafe(null)} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cafes</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} total registered</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search name, email, slug..."
            className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <select
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={plan}
            onChange={(e) => { setPlan(e.target.value); load(search, e.target.value); }}
          >
            <option value="">All plans</option>
            <option value="free_trial">Free Trial</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Cafe', 'Plan', 'Expiry', 'Orders', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {cafes.map((cafe) => {
                const expired = cafe.plan_expiry_date && new Date(cafe.plan_expiry_date) < new Date();
                return (
                  <tr key={cafe.id} className="hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{cafe.name}</p>
                      <p className="text-xs text-gray-500">{cafe.email}</p>
                      <p className="text-xs text-gray-600">/{cafe.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${PLAN_STYLES[cafe.plan_type] || 'bg-gray-700 text-gray-300'}`}>
                        {cafe.plan_type === 'free_trial' ? 'Trial' : 'Yearly'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {cafe.plan_expiry_date ? (
                        <span className={`text-xs ${expired ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
                          {expired ? '⚠️ ' : ''}{new Date(cafe.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      ) : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{cafe.total_orders}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => setSelectedCafe(cafe)}
                          className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2.5 py-1 rounded-lg transition-colors"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => handleExtend(cafe)}
                          className="text-xs bg-brand-700 hover:bg-brand-600 text-white px-2.5 py-1 rounded-lg transition-colors"
                        >
                          Extend
                        </button>
                        <button
                          onClick={() => handleToggleActive(cafe)}
                          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                            cafe.is_active
                              ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400'
                              : 'bg-green-900/40 hover:bg-green-900/60 text-green-400'
                          }`}
                        >
                          {cafe.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cafes.length === 0 && (
            <p className="text-center text-gray-500 py-10">No cafes found.</p>
          )}
        </div>
      )}
    </div>
  );
}
