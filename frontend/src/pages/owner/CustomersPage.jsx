import { useState, useEffect, useCallback } from 'react';
import { getCustomers, getCustomerOrders } from '../../services/api';
import { fmtCurrency, fmtToken } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const ORDER_TYPE_FILTER = [
  { key: 'all',      label: 'All Types' },
  { key: 'dine_in',  label: 'Dine-in' },
  { key: 'takeaway', label: 'Takeaway' },
  { key: 'delivery', label: 'Delivery' },
];

const SORT_OPTIONS = [
  { key: 'total_spend',  label: 'Top Spenders' },
  { key: 'total_orders', label: 'Most Orders' },
  { key: 'last_visit',   label: 'Recent Visitors' },
];

const STATUS_BADGE = {
  pending:   'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready:     'bg-teal-100 text-teal-700',
  served:    'bg-green-100 text-green-700',
  paid:      'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

const TYPE_BADGE = {
  'dine-in':  { label: 'Dine-in',  cls: 'bg-blue-50 text-blue-700' },
  'dine_in':  { label: 'Dine-in',  cls: 'bg-blue-50 text-blue-700' },
  'takeaway': { label: 'Takeaway', cls: 'bg-amber-50 text-amber-700' },
  'delivery': { label: 'Delivery', cls: 'bg-green-50 text-green-700' },
};

function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['bg-brand-100 text-brand-700', 'bg-teal-100 text-teal-700', 'bg-purple-100 text-purple-700',
                  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700'];
  const color = colors[(name || '').charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-12 h-12 text-base' : 'w-9 h-9 text-sm';
  return (
    <div className={`${sz} ${color} rounded-xl flex items-center justify-center font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ─── Customer Detail Drawer ────────────────────────────────────
function CustomerDrawer({ customer, onClose }) {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerOrders({ phone: customer.customer_phone, name: customer.customer_name })
      .then(({ data }) => setOrders(data.orders || []))
      .catch(() => toast.error('Failed to load order history'))
      .finally(() => setLoading(false));
  }, [customer.customer_phone, customer.customer_name]);

  const avgOrder = orders.length > 0
    ? orders.reduce((s, o) => s + parseFloat(o.final_amount || o.total_amount || 0), 0) / orders.length
    : 0;

  const preferred = TYPE_BADGE[customer.preferred_type];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-white flex-shrink-0">
          <Avatar name={customer.customer_name} size="lg" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-base truncate">{customer.customer_name || 'Unknown'}</h3>
            <p className="text-sm text-gray-500">{customer.customer_phone || '—'}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-px bg-gray-100 flex-shrink-0">
          {[
            { label: 'Total Orders', value: customer.total_orders, color: 'text-gray-900' },
            { label: 'Total Spent',  value: c(customer.total_spend), color: 'text-green-700' },
            { label: 'Avg Order',    value: c(avgOrder),             color: 'text-brand-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white px-4 py-3 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-shrink-0 flex-wrap">
          {preferred && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${preferred.cls}`}>
              {preferred.label}
            </span>
          )}
          {customer.first_visit && (
            <span className="text-xs text-gray-400">
              First visit: {new Date(customer.first_visit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {customer.last_visit && (
            <span className="text-xs text-gray-400">
              Last: {new Date(customer.last_visit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {customer.paid_orders > 0 && (
            <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              {customer.paid_orders} paid
            </span>
          )}
        </div>

        {/* Orders list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Order History</p>
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-gray-100" />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-3xl mb-2">🧾</p>
              <p className="text-sm">No orders found</p>
            </div>
          ) : orders.map((order) => (
            <div key={order.id} className="border border-gray-100 rounded-xl p-3.5 bg-white hover:border-gray-200 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-gray-700">
                    {fmtToken(order.daily_order_number, order.order_type)}
                  </span>
                  {order.table_number && order.table_number !== 'Takeaway' && order.table_number !== 'Delivery' && (
                    <span className="text-xs text-gray-400">{order.table_number}</span>
                  )}
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[order.status] || 'bg-gray-100 text-gray-600'}`}>
                  {order.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {new Date(order.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>
                <p className="text-sm font-bold text-gray-900">{c(order.final_amount || order.total_amount)}</p>
              </div>
              {order.items?.length > 0 && (
                <p className="text-xs text-gray-400 mt-1.5 truncate">
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

// ─── Main Page ─────────────────────────────────────────────────
export default function CustomersPage() {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState('total_spend');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected]   = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getCustomers();
      setCustomers(data.customers || []);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = customers
    .filter((cu) => {
      if (typeFilter !== 'all' && cu.preferred_type !== typeFilter && cu.preferred_type !== typeFilter.replace('_', '-')) return false;
      if (q && !(cu.customer_name || '').toLowerCase().includes(q) && !(cu.customer_phone || '').includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'total_orders') return parseInt(b.total_orders) - parseInt(a.total_orders);
      if (sortBy === 'last_visit')   return new Date(b.last_visit) - new Date(a.last_visit);
      return parseFloat(b.total_spend) - parseFloat(a.total_spend);
    });

  const totalSpend    = customers.reduce((s, cu) => s + parseFloat(cu.total_spend || 0), 0);
  const totalOrders   = customers.reduce((s, cu) => s + parseInt(cu.total_orders || 0), 0);
  const repeatCount   = customers.filter((cu) => cu.total_orders > 1).length;
  const repeatRate    = customers.length > 0 ? Math.round((repeatCount / customers.length) * 100) : 0;

  if (loading) return (
    <div className="space-y-3 animate-pulse max-w-5xl mx-auto">
      <div className="h-8 w-48 rounded-lg bg-gray-100" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-gray-100" />)}
      </div>
      {[...Array(8)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-100" />)}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Customers</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {customers.length} unique customer{customers.length !== 1 ? 's' : ''} tracked across all orders
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Customers',  value: customers.length,        icon: '👥', color: 'text-gray-900' },
          { label: 'Total Revenue',    value: c(totalSpend),           icon: '💰', color: 'text-green-700' },
          { label: 'Repeat Customers', value: `${repeatCount} (${repeatRate}%)`, icon: '🔄', color: 'text-brand-700' },
          { label: 'Total Orders',     value: totalOrders,             icon: '📋', color: 'text-purple-700' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{icon}</span>
              <p className="text-xs text-gray-400 font-medium">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 py-2"
          />
        </div>

        {/* Order type filter pills */}
        <div className="flex gap-1 flex-wrap">
          {ORDER_TYPE_FILTER.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                typeFilter === key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input py-2 text-sm"
        >
          {SORT_OPTIONS.map(({ key, label }) => (
            <option key={key} value={key}>Sort: {label}</option>
          ))}
        </select>
      </div>

      {/* Customer list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">👥</div>
          <p className="font-medium text-gray-500">No customers found</p>
          <p className="text-sm mt-1">
            {search ? 'Try a different search term' : 'Customers appear here after their first order'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
            <div className="col-span-5">Customer</div>
            <div className="col-span-2 text-center">Orders</div>
            <div className="col-span-2 text-center hidden sm:block">Total Spent</div>
            <div className="col-span-2 text-center hidden sm:block">Preferred</div>
            <div className="col-span-1 text-right">Last Visit</div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-gray-50">
            {filtered.map((cu) => {
              const isSelected = selected?.customer_phone === cu.customer_phone && selected?.customer_name === cu.customer_name;
              const pref = TYPE_BADGE[cu.preferred_type];
              const lastVisitDays = cu.last_visit
                ? Math.floor((Date.now() - new Date(cu.last_visit)) / 86400000)
                : null;

              return (
                <div
                  key={`${cu.customer_phone}-${cu.customer_name}`}
                  onClick={() => setSelected(isSelected ? null : cu)}
                  className={`grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer transition-colors items-center ${
                    isSelected ? 'bg-brand-50' : 'hover:bg-gray-50'
                  }`}
                >
                  {/* Name + phone */}
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <Avatar name={cu.customer_name} />
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{cu.customer_name || '—'}</p>
                      <p className="text-xs text-gray-400">{cu.customer_phone || '—'}</p>
                    </div>
                    {cu.total_orders > 1 && (
                      <span className="text-[10px] font-bold bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full hidden sm:inline">
                        Repeat
                      </span>
                    )}
                  </div>

                  {/* Orders count */}
                  <div className="col-span-2 text-center">
                    <span className="text-sm font-bold text-gray-800">{cu.total_orders}</span>
                  </div>

                  {/* Total spent */}
                  <div className="col-span-2 text-center hidden sm:block">
                    <span className="text-sm font-semibold text-green-700">{c(cu.total_spend)}</span>
                  </div>

                  {/* Preferred type */}
                  <div className="col-span-2 text-center hidden sm:block">
                    {pref ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pref.cls}`}>
                        {pref.label}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </div>

                  {/* Last visit */}
                  <div className="col-span-1 text-right">
                    <span className="text-xs text-gray-400">
                      {lastVisitDays === null ? '—'
                        : lastVisitDays === 0 ? 'Today'
                        : lastVisitDays === 1 ? 'Yesterday'
                        : lastVisitDays < 7 ? `${lastVisitDays}d ago`
                        : lastVisitDays < 30 ? `${Math.floor(lastVisitDays / 7)}w ago`
                        : new Date(cu.last_visit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-50 text-xs text-gray-400 flex items-center justify-between bg-gray-50">
            <span>{filtered.length} of {customers.length} customer{customers.length !== 1 ? 's' : ''}</span>
            <span>{totalOrders} total orders</span>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
