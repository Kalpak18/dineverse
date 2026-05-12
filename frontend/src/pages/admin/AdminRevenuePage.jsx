import { useState, useEffect, useCallback } from 'react';
import { adminGetCommissionReport, adminGetSettlements, adminCollectCommission } from '../../services/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminRevenuePage() {
  const [data, setData]         = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collecting, setCollecting] = useState(null); // cafe_id being settled
  const [tab, setTab]           = useState('cafes');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminGetCommissionReport({ from: from || undefined, to: to || undefined, status: statusFilter !== 'all' ? statusFilter : undefined }),
      adminGetSettlements(),
    ])
      .then(([r1, r2]) => {
        setData(r1.data);
        setSettlements(r2.data.settlements || []);
      })
      .catch(() => toast.error('Failed to load commission data'))
      .finally(() => setLoading(false));
  }, [from, to, statusFilter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const handleCollect = async (cafe) => {
    if (!window.confirm(`Mark all outstanding cash commission from "${cafe.name}" as collected?\n\nAmount: ₹${fmt(cafe.cash_commission_owed)}`)) return;
    setCollecting(cafe.id);
    try {
      const res = await adminCollectCommission({ cafe_id: cafe.id });
      toast.success(res.data.message || 'Commission marked as collected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to collect commission');
    } finally {
      setCollecting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Income</h1>
        <p className="text-gray-400 text-sm mt-1">Commission earned from all café orders.</p>
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
        <div>
          <label className="block text-xs text-gray-400 mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="all">All cafés</option>
            <option value="cash_due">Cash due only</option>
            <option value="auto_deducted">Online only</option>
          </select>
        </div>
        <button onClick={load}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          Apply
        </button>
        {(from || to || statusFilter !== 'all') && (
          <button onClick={() => { setFrom(''); setTo(''); setStatusFilter('all'); setTimeout(load, 50); }}
            className="text-sm text-gray-400 hover:text-white">
            Clear
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner /> : !data ? null : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-green-400">₹{fmt(data.totals.total_commission)}</p>
              <p className="text-sm text-gray-400 mt-1">Total Commission</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-blue-400">₹{fmt(data.totals.online_commission_collected)}</p>
              <p className="text-sm text-gray-400 mt-1">Auto-collected (Online)</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-orange-400">₹{fmt(data.totals.cash_commission_owed)}</p>
              <p className="text-sm text-gray-400 mt-1">Cash Due (Pending)</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-2xl font-bold text-white">₹{fmt(data.totals.total_gmv)}</p>
              <p className="text-sm text-gray-400 mt-1">Total GMV</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-800 rounded-xl p-1 w-fit">
            {[['cafes', 'Per Café'], ['settlements', 'Settlements']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'cafes' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-semibold text-white">Commission by Café</h2>
              </div>
              {data.cafes.length === 0 ? (
                <p className="text-center text-gray-500 py-10">No data found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Café', 'Rate', 'GMV', 'Online (auto)', 'Cash due', 'Collected', ''].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {data.cafes.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <p className="text-white font-medium">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.email}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{c.commission_rate}%</td>
                        <td className="px-4 py-3 text-gray-300">₹{fmt(c.total_gmv)}</td>
                        <td className="px-4 py-3 text-blue-400">₹{fmt(c.online_commission_collected)}</td>
                        <td className="px-4 py-3">
                          {c.cash_commission_owed > 0 ? (
                            <span className="text-orange-400 font-semibold">₹{fmt(c.cash_commission_owed)}</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-green-400">
                          {c.cash_commission_collected > 0 ? `₹${fmt(c.cash_commission_collected)}` : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.cash_commission_owed > 0 && (
                            <button
                              onClick={() => handleCollect(c)}
                              disabled={collecting === c.id}
                              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                              {collecting === c.id ? 'Processing…' : 'Mark Collected'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'settlements' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-semibold text-white">Settlement History</h2>
              </div>
              {settlements.length === 0 ? (
                <p className="text-center text-gray-500 py-10">No settlements yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Café', 'Orders', 'GMV', 'Commission', 'Reference', 'Date'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {settlements.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <p className="text-white font-medium">{s.cafe_name}</p>
                          <p className="text-xs text-gray-500">{s.cafe_email}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{s.orders_count}</td>
                        <td className="px-4 py-3 text-gray-300">₹{fmt(s.total_gmv)}</td>
                        <td className="px-4 py-3 text-green-400 font-semibold">₹{fmt(s.total_commission)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{s.payment_reference || '—'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {new Date(s.settled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
