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
    red:    'bg-red-500/10 text-red-400',
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

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetDashboard()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const { cafes, commission, tickets, recent_signups } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Developer Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Platform overview at a glance.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon="🏪" label="Total Cafes" value={cafes.total} sub={`+${cafes.new_this_month} this month`} color="orange" />
        <StatCard icon="💰" label="Commission Earned" value={`₹${Number(commission.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`₹${Number(commission.this_month).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} this month`} color="green" />
        <StatCard icon="📦" label="Total Orders" value={Number(commission.paid_orders).toLocaleString('en-IN')} sub="paid orders" color="blue" />
        <StatCard icon="🎫" label="Open Tickets" value={tickets.open} sub={`${tickets.in_progress} in progress`} color="yellow" />
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
                <p className="text-xs text-gray-500 ml-2">
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
