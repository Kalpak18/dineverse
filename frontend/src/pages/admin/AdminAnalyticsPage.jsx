import { useState, useEffect } from 'react';
import { adminGetAnalytics } from '../../services/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetAnalytics()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Analytics</h1>
        <p className="text-gray-400 text-sm mt-1">User growth, plan distribution & top cafes.</p>
      </div>

      {/* Plan distribution */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-white mb-4">Plan Distribution</h2>
          <div className="space-y-3">
            {data.plan_distribution.map((p) => (
              <div key={p.plan_type} className="flex items-center justify-between text-sm">
                <span className="text-gray-300 capitalize">{p.plan_type === 'free_trial' ? 'Free Trial' : 'Yearly'}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{p.active} active</span>
                  <span className="font-bold text-white">{p.count} total</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Signups by month */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold text-white mb-4">New Signups (Last 12 Months)</h2>
          <div className="space-y-2">
            {data.signups_by_month.map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="text-gray-400 text-xs w-28">
                  {new Date(m.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-brand-500 rounded-full"
                    style={{ width: `${Math.min(100, (m.count / Math.max(...data.signups_by_month.map(x => x.count))) * 100)}%` }}
                  />
                </div>
                <span className="text-white text-xs font-bold w-6 text-right">{m.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Expiring soon */}
      {data.expiring_soon.length > 0 && (
        <div className="bg-red-900/20 border border-red-800 rounded-2xl p-5">
          <h2 className="font-semibold text-red-400 mb-3">⚠️ Expiring in Next 7 Days ({data.expiring_soon.length})</h2>
          <div className="space-y-2">
            {data.expiring_soon.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-white font-medium">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.email}</p>
                </div>
                <span className="text-red-400 text-xs font-semibold">
                  {new Date(c.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top cafes */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Top Cafes by Orders</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              {['#', 'Cafe', 'Plan', 'Orders', 'Revenue (GMV)'].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {data.top_cafes.map((c, i) => (
              <tr key={c.id} className="hover:bg-gray-800/30">
                <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <p className="text-white font-medium">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    c.plan_type === 'yearly' ? 'bg-green-900/40 text-green-400' : 'bg-amber-900/40 text-amber-400'
                  }`}>
                    {c.plan_type === 'yearly' ? 'Yearly' : 'Trial'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{c.total_orders}</td>
                <td className="px-4 py-3 font-semibold text-gray-300">
                  ₹{parseFloat(c.total_revenue).toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.top_cafes.length === 0 && (
          <p className="text-center text-gray-500 py-10">No data yet.</p>
        )}
      </div>
    </div>
  );
}
