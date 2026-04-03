import { useState, useEffect } from 'react';
import { adminGetRevenue } from '../../services/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminRevenuePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    setLoading(true);
    adminGetRevenue({ from: from || undefined, to: to || undefined })
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load revenue'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const totalRevenue = data?.payments?.reduce((s, p) => s + p.amount_rupees, 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Revenue</h1>
        <p className="text-gray-400 text-sm mt-1">All completed subscription payments.</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button onClick={load} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          Apply
        </button>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); setTimeout(load, 50); }}
            className="text-sm text-gray-400 hover:text-white">
            Clear
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-green-400">₹{totalRevenue.toLocaleString('en-IN')}</p>
              <p className="text-sm text-gray-400 mt-1">Total Revenue (filtered)</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-white">{data.payments.length}</p>
              <p className="text-sm text-gray-400 mt-1">Payments</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-white">{data.monthly_breakdown.length}</p>
              <p className="text-sm text-gray-400 mt-1">Active Months</p>
            </div>
          </div>

          {/* Monthly breakdown */}
          {data.monthly_breakdown.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h2 className="font-semibold text-white mb-4">Monthly Breakdown</h2>
              <div className="space-y-2">
                {data.monthly_breakdown.map((m) => (
                  <div key={m.month} className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">
                      {new Date(m.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500">{m.count} payment{m.count !== 1 ? 's' : ''}</span>
                      <span className="font-bold text-green-400">₹{m.total_rupees.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transactions */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">Transactions</h2>
            </div>
            {data.payments.length === 0 ? (
              <p className="text-center text-gray-500 py-10">No payments found.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Cafe', 'Plan', 'Amount', 'Payment ID', 'Date'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {data.payments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{p.cafe_name}</p>
                        <p className="text-xs text-gray-500">{p.cafe_email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-400 capitalize">{p.plan_type}</td>
                      <td className="px-4 py-3 font-bold text-green-400">₹{p.amount_rupees.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{p.razorpay_payment_id || '—'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
