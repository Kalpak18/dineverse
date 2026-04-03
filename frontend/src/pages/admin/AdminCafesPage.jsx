import { useState, useEffect, useRef } from 'react';
import { adminGetCafes, adminUpdateCafe } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

const PLAN_STYLES = {
  free_trial: 'bg-amber-900/40 text-amber-400',
  yearly:     'bg-green-900/40 text-green-400',
};

export default function AdminCafesPage() {
  const [cafes, setCafes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
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
                      <div className="flex gap-2">
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
