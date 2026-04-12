import { useState, useEffect, useCallback } from 'react';
import { getCustomers, getCustomerOrders } from '../../services/api';
import { fmtCurrency, fmtToken } from '../../utils/formatters';
import toast from 'react-hot-toast';

function StatBadge({ label, value, color = 'gray' }) {
  const colors = {
    gray:   'bg-gray-100 text-gray-700',
    green:  'bg-green-100 text-green-700',
    blue:   'bg-blue-100 text-blue-700',
    amber:  'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

function CustomerRow({ customer, onSelect, selected }) {
  return (
    <tr
      onClick={() => onSelect(customer)}
      className={`cursor-pointer transition-colors ${selected ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{customer.customer_name || '—'}</div>
        <div className="text-xs text-gray-400">{customer.customer_phone}</div>
      </td>
      <td className="px-4 py-3 text-center text-sm font-semibold text-gray-700">{customer.total_orders}</td>
      <td className="px-4 py-3 text-center text-sm text-green-700 font-semibold">{fmtCurrency(customer.total_spend)}</td>
      <td className="px-4 py-3 text-center">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          customer.preferred_type === 'dine_in'
            ? 'bg-blue-100 text-blue-700'
            : customer.preferred_type === 'takeaway'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-500'
        }`}>
          {customer.preferred_type === 'dine_in' ? 'Dine-in'
           : customer.preferred_type === 'takeaway' ? 'Takeaway'
           : '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-center text-xs text-gray-500">
        {customer.last_visit
          ? new Date(customer.last_visit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          : '—'}
      </td>
    </tr>
  );
}

function CustomerDrawer({ customer, onClose }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerOrders({ phone: customer.customer_phone, name: customer.customer_name })
      .then(({ data }) => setOrders(data.orders))
      .catch(() => toast.error('Failed to load orders'))
      .finally(() => setLoading(false));
  }, [customer.customer_phone, customer.customer_name]);

  const statusColor = {
    pending:    'bg-yellow-100 text-yellow-700',
    confirmed:  'bg-blue-100 text-blue-700',
    preparing:  'bg-orange-100 text-orange-700',
    ready:      'bg-purple-100 text-purple-700',
    delivered:  'bg-green-100 text-green-700',
    completed:  'bg-green-100 text-green-700',
    cancelled:  'bg-red-100 text-red-700',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">{customer.customer_name || 'Unknown'}</h3>
            <p className="text-sm text-gray-500">{customer.customer_phone}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg mt-0.5">✕</button>
        </div>

        {/* Stats */}
        <div className="px-5 py-3 border-b border-gray-50 flex flex-wrap gap-2">
          <StatBadge label="Orders" value={customer.total_orders} color="blue" />
          <StatBadge label="Spent" value={fmtCurrency(customer.total_spend)} color="green" />
          <StatBadge label="Paid orders" value={customer.paid_orders} color="purple" />
          <StatBadge
            label="Preferred"
            value={customer.preferred_type === 'dine_in' ? 'Dine-in' : customer.preferred_type === 'takeaway' ? 'Takeaway' : '—'}
            color="amber"
          />
          <StatBadge
            label="First visit"
            value={customer.first_visit
              ? new Date(customer.first_visit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '—'}
          />
        </div>

        {/* Orders list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-100" />)}
            </div>
          ) : orders.length === 0 ? (
            <p className="text-center text-gray-400 py-10">No orders found.</p>
          ) : orders.map((order) => (
            <div key={order.id} className="border border-gray-100 rounded-xl px-4 py-3 bg-white">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono font-bold text-gray-700">
                  {fmtToken(order.daily_order_number, order.order_type)}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[order.status] || 'bg-gray-100 text-gray-600'}`}>
                  {order.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {new Date(order.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                  {order.table_number && ` · Table ${order.table_number}`}
                </p>
                <p className="text-sm font-semibold text-gray-900">{fmtCurrency(order.total_amount)}</p>
              </div>
              {order.items && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {order.items.slice(0, 3).map((it) => it.name).join(', ')}
                  {order.items.length > 3 && ` +${order.items.length - 3} more`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState('total_spend'); // total_spend | total_orders | last_visit
  const [selected, setSelected]     = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getCustomers();
      setCustomers(data.customers);
    } catch { toast.error('Failed to load customers'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = customers
    .filter((c) =>
      !q ||
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.customer_phone || '').includes(q)
    )
    .sort((a, b) => {
      if (sortBy === 'total_orders') return b.total_orders - a.total_orders;
      if (sortBy === 'last_visit')   return new Date(b.last_visit) - new Date(a.last_visit);
      return parseFloat(b.total_spend) - parseFloat(a.total_spend);
    });

  const totalSpend   = customers.reduce((s, c) => s + parseFloat(c.total_spend || 0), 0);
  const totalOrders  = customers.reduce((s, c) => s + parseInt(c.total_orders || 0), 0);
  const repeatCount  = customers.filter((c) => c.total_orders > 1).length;

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[...Array(8)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-gray-100" />)}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Customers</h1>
        <p className="text-sm text-gray-500 mt-0.5">{customers.length} unique customers</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{customers.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Customers</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-700">{fmtCurrency(totalSpend)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Revenue</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-brand-600">{repeatCount}</p>
          <p className="text-xs text-gray-500 mt-1">Repeat Customers</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 min-w-48 py-2"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input py-2"
        >
          <option value="total_spend">Sort: Top Spenders</option>
          <option value="total_orders">Sort: Most Orders</option>
          <option value="last_visit">Sort: Recent Visitors</option>
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-2">👥</div>
          <p>No customers found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-center px-4 py-3">Orders</th>
                <th className="text-center px-4 py-3">Total Spent</th>
                <th className="text-center px-4 py-3">Preferred</th>
                <th className="text-center px-4 py-3">Last Visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <CustomerRow
                  key={`${c.customer_phone}-${c.customer_name}`}
                  customer={c}
                  onSelect={setSelected}
                  selected={selected?.customer_phone === c.customer_phone && selected?.customer_name === c.customer_name}
                />
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-gray-50 text-xs text-gray-400">
            {filtered.length} customer{filtered.length !== 1 ? 's' : ''} · {totalOrders} total orders
          </div>
        </div>
      )}

      {/* Side drawer */}
      {selected && (
        <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
