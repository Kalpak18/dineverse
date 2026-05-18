import { useState, useEffect } from 'react';
import { adminGetDashboard } from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';

function StatCard({ label, value, sub, icon, color }) {
  const colors = {
    orange: 'bg-orange-500/10 text-orange-400',
    green:  'bg-green-500/10 text-green-400',
    blue:   'bg-blue-500/10 text-blue-400',
    yellow: 'bg-yellow-500/10 text-yellow-400',
    purple: 'bg-purple-500/10 text-purple-400',
    teal:   'bg-teal-500/10 text-teal-400',
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className={`w-10 h-10 rounded-xl ${colors[color]} flex items-center justify-center text-xl mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function fmt(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtMoney(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminDashboardPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [cafeSearch, setCafeSearch] = useState('');

  useEffect(() => {
    adminGetDashboard()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const { cafes, commission, orders, tickets, recent_signups, cafe_list = [] } = data;

  const filteredCafes = cafeSearch.trim()
    ? cafe_list.filter((c) =>
        c.name.toLowerCase().includes(cafeSearch.toLowerCase()) ||
        c.slug.toLowerCase().includes(cafeSearch.toLowerCase())
      )
    : cafe_list;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Developer Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Platform overview at a glance.</p>
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon="🏪" label="Total Cafes" value={fmt(cafes.total)}
          sub={`+${cafes.new_this_month} this month`} color="orange" />
        <StatCard icon="📦" label="Total Orders" value={fmt(orders.total)}
          sub={`${fmt(orders.paid)} paid`} color="blue" />
        <StatCard icon="💰" label="Platform Revenue"
          value={fmtMoney(orders.total_revenue)}
          sub={`Commission: ${fmtMoney(commission.total)}`} color="green" />
        <StatCard icon="👥" label="Unique Customers" value={fmt(orders.unique_customers)}
          sub="by phone number" color="purple" />
        <StatCard icon="🚶" label="Total Visits" value={fmt(orders.total_visits)}
          sub="sessions (1 customer/day = 1 visit)" color="teal" />
        <StatCard icon="🎫" label="Open Tickets" value={fmt(tickets.open)}
          sub={`${tickets.in_progress} in progress`} color="yellow" />
      </div>

      {/* Café list */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-white">All Cafés</h2>
          <input
            type="text"
            placeholder="Search by name or slug…"
            value={cafeSearch}
            onChange={(e) => setCafeSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 w-52"
          />
        </div>

        {filteredCafes.length === 0 ? (
          <p className="text-gray-500 text-sm px-5 py-8 text-center">No cafés found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3 font-medium">Café</th>
                  <th className="text-right px-4 py-3 font-medium">Visits</th>
                  <th className="text-right px-4 py-3 font-medium">Orders</th>
                  <th className="text-right px-4 py-3 font-medium">Paid</th>
                  <th className="text-right px-5 py-3 font-medium">Revenue</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {filteredCafes.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-white truncate max-w-[180px]">{c.name}</p>
                      <p className="text-xs text-gray-500">/{c.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-teal-400 font-semibold">{fmt(c.unique_visits)}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{fmt(c.total_orders)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{fmt(c.paid_orders)}</td>
                    <td className="px-5 py-3 text-right text-green-400 font-medium">{fmtMoney(c.total_revenue)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        c.is_active ? 'bg-green-900/60 text-green-400' : 'bg-gray-800 text-gray-500'
                      }`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Signups */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="font-semibold text-white mb-4">Recent Signups</h2>
        {recent_signups.length === 0 ? (
          <p className="text-gray-500 text-sm">No signups yet.</p>
        ) : (
          <div className="space-y-3">
            {recent_signups.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.email}</p>
                </div>
                <p className="text-xs text-gray-500 ml-2 flex-shrink-0">
                  {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
