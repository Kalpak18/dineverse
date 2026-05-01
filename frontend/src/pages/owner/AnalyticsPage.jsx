import { useState, useEffect, useCallback } from 'react';
import { getAnalytics, createExpense, deleteExpense, exportOrdersCSV } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import { fmtCurrency } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import PageHint from '../../components/PageHint';
import toast from 'react-hot-toast';

const PERIODS = [
  { key: 'daily',   label: 'Today' },
  { key: 'weekly',  label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
  { key: 'yearly',  label: 'This Year' },
];

function getPeriodRange(period) {
  const now = new Date();
  const fmt  = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmts = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  if (period === 'daily')   return fmt(now);
  if (period === 'weekly')  {
    const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    return `${fmts(start)} – ${fmts(now)}, ${now.getFullYear()}`;
  }
  if (period === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return `${fmts(start)} – ${fmts(now)}, ${now.getFullYear()}`;
  }
  if (period === 'yearly')  {
    const start = new Date(now.getFullYear(), 0, 1);
    return `${fmts(start)} – ${fmts(now)}, ${now.getFullYear()}`;
  }
  return '';
}

function SummaryCard({ label, value, icon, color, sub }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    red:    'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="card">
      <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center text-xl mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function AddExpenseForm({ onAdded }) {
  const { cafe } = useAuth();
  const sym = cafe?.currency === 'INR' || !cafe?.currency ? '₹' : cafe.currency;
  const [form, setForm] = useState({ name: '', amount: '', category: '', expense_date: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    setSaving(true);
    try {
      await createExpense({
        name: form.name.trim(),
        amount: parseFloat(form.amount),
        category: form.category.trim() || undefined,
        expense_date: form.expense_date || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ name: '', amount: '', category: '', expense_date: '', notes: '' });
      toast.success('Expense added');
      onAdded();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <h3 className="font-semibold text-gray-800">Add Expense</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Name *</label>
          <input
            className="input"
            placeholder="e.g. Milk, Gas, Salary"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Amount ({sym}) *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="input"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Category</label>
          <input
            className="input"
            placeholder="e.g. Ingredients"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={form.expense_date}
            onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={saving || !form.name.trim() || !form.amount}
        className="btn-primary disabled:opacity-50"
      >
        {saving ? 'Saving…' : '+ Add Expense'}
      </button>
    </form>
  );
}

export default function AnalyticsPage() {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [period, setPeriod] = useState('monthly');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await getAnalytics({ period });
      setData(res);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const now = new Date();
      const toDate = now.toLocaleDateString('en-CA'); // YYYY-MM-DD local
      let fromDate;
      if (period === 'daily') {
        fromDate = toDate;
      } else if (period === 'weekly') {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        fromDate = d.toLocaleDateString('en-CA');
      } else if (period === 'monthly') {
        fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      } else { // yearly
        fromDate = `${now.getFullYear()}-01-01`;
      }
      const res = await exportOrdersCSV({ from: fromDate, to: toDate });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${period}-${toDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch { toast.error('Export failed'); }
    finally { setExporting(false); }
  };

  const handleDeleteExpense = async (id) => {
    try {
      await deleteExpense(id);
      toast.success('Expense removed');
      load();
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  // Simple inline bar charts using CSS widths
  const maxRevenue  = data?.dailyBreakdown?.length
    ? Math.max(...data.dailyBreakdown.map((d) => parseFloat(d.revenue)), 1)
    : 1;
  const maxCatRev   = data?.categoryBreakdown?.length
    ? Math.max(...data.categoryBreakdown.map((c) => parseFloat(c.revenue)), 1)
    : 1;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHint
        storageKey="dv_hint_analytics"
        title="Analytics — understand your revenue, costs, and best-sellers"
        items={[
          { icon: '📊', text: 'Switch periods: Today / This Week / This Month / This Year to compare performance' },
          { icon: '💰', text: 'Revenue shows only paid orders. Profit = Revenue − Expenses you log here.' },
          { icon: '🧾', text: 'Add expenses (rent, salaries, ingredients) using the form below — this gives you real profit numbers' },
          { icon: '🥇', text: 'Top Items table shows what\'s selling — use it to decide what to promote or remove' },
          { icon: '⬇', text: 'Export CSV sends order data to a spreadsheet — useful for monthly tax filing' },
        ]}
        tip="Log expenses regularly (weekly) to keep your profit calculation accurate."
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary text-sm">
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
          <button onClick={load} className="btn-secondary text-sm">↻ Refresh</button>
        </div>
      </div>

      {/* Period selector */}
      <div className="space-y-1.5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 pl-1">{getPeriodRange(period)}</p>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-gray-400">Loading analytics…</div>
      ) : data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Orders Received"
              value={data.summary.total_orders}
              icon="📋"
              color="blue"
              sub={data.summary.cancelled_orders > 0
                ? `${data.summary.cancelled_orders} cancelled · ${data.summary.paid_orders} paid`
                : `${data.summary.paid_orders} paid`}
            />
            <SummaryCard
              label="Revenue Collected"
              value={c(data.summary.total_revenue)}
              icon="💰"
              color="green"
              sub={[
                `Food: ${c(data.summary.food_revenue ?? data.summary.total_revenue)}`,
                data.summary.total_tips > 0 ? `Tips: ${c(data.summary.total_tips)}` : null,
                data.summary.total_delivery_fees > 0 ? `Delivery: ${c(data.summary.total_delivery_fees)}` : null,
              ].filter(Boolean).join(' · ') || 'From paid orders only'}
            />
            <SummaryCard
              label="Expenses"
              value={c(data.summary.total_expenses)}
              icon="🧾"
              color="red"
            />
            <SummaryCard
              label="Profit"
              value={c(data.summary.profit)}
              icon={data.summary.profit >= 0 ? '📈' : '📉'}
              color={data.summary.profit >= 0 ? 'purple' : 'red'}
              sub="Revenue − Expenses"
            />
          </div>

          {/* Order type breakdown */}
          {data.orderTypeBreakdown.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3">Order Type</h2>
              <div className="flex gap-4">
                {data.orderTypeBreakdown.map((t) => (
                  <div key={t.order_type} className="flex-1 bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-gray-900">{t.count}</p>
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">
                      {t.order_type === 'dine-in' ? '🍽️ Dine In' : '🥡 Takeaway'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category revenue breakdown */}
          {data.categoryBreakdown?.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Revenue by Category</h2>
              <div className="space-y-2.5">
                {data.categoryBreakdown.map((cat) => (
                  <div key={cat.category} className="flex items-center gap-3 text-sm">
                    <span className="w-28 flex-shrink-0 text-gray-600 truncate" title={cat.category}>{cat.category}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-brand-400 rounded-full transition-all"
                        style={{ width: `${(parseFloat(cat.revenue) / maxCatRev) * 100}%` }}
                      />
                    </div>
                    <span className="text-gray-400 text-xs w-10 text-right">{cat.total_qty} sold</span>
                    <span className="font-medium text-gray-900 w-20 text-right">{c(cat.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {/* Top items */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Top Selling Items</h2>
              {data.topItems.length === 0 ? (
                <p className="text-gray-400 text-sm">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.topItems.map((item, i) => (
                    <div key={item.item_name} className="flex items-center gap-3 text-sm">
                      <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 font-medium text-gray-800 truncate">{item.item_name}</span>
                      <span className="text-gray-400">{item.total_qty} sold</span>
                      <span className="font-medium text-gray-900">{c(item.total_revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily revenue chart */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Revenue Breakdown</h2>
              {data.dailyBreakdown.length === 0 ? (
                <p className="text-gray-400 text-sm">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.dailyBreakdown.map((day) => (
                    <div key={day.date} className="flex items-center gap-3 text-xs">
                      <span className="text-gray-500 w-20 flex-shrink-0">
                        {new Date(day.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-brand-500 rounded-full transition-all"
                          style={{ width: `${(parseFloat(day.revenue) / maxRevenue) * 100}%` }}
                        />
                      </div>
                      <span className="font-medium text-gray-700 w-16 text-right">
                        {c(day.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Insights row — table turn + repeat customers */}
          <div className="grid md:grid-cols-3 gap-6">
            <div className="card text-center">
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {data.tableTurn?.avg_turn_mins != null ? `${data.tableTurn.avg_turn_mins} min` : '—'}
              </p>
              <p className="text-xs text-gray-500">Avg time to serve (dine-in)</p>
              {data.tableTurn?.served_dine_in_orders > 0 && (
                <p className="text-xs text-gray-400 mt-1">across {data.tableTurn.served_dine_in_orders} orders</p>
              )}
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {data.repeatCustomers?.total > 0
                  ? `${Math.round((data.repeatCustomers.repeat / data.repeatCustomers.total) * 100)}%`
                  : '—'}
              </p>
              <p className="text-xs text-gray-500">Repeat customer rate</p>
              {data.repeatCustomers?.total > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {data.repeatCustomers.repeat} of {data.repeatCustomers.total} paying customers
                </p>
              )}
            </div>
            <div className="card text-center">
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {data.repeatCustomers?.total || 0}
              </p>
              <p className="text-xs text-gray-500">Unique paying customers</p>
              <p className="text-xs text-gray-400 mt-1">by phone number</p>
            </div>
          </div>

          {/* Peak hours heatmap */}
          {data.peakHours?.length > 0 && (() => {
            const maxOrders = Math.max(...data.peakHours.map((h) => parseInt(h.order_count)));
            return (
              <div className="card">
                <h2 className="font-semibold text-gray-900 mb-4">Peak Hours</h2>
                <div className="flex items-end gap-1 h-24">
                  {Array.from({ length: 24 }, (_, hr) => {
                    const found = data.peakHours.find((h) => h.hour === hr);
                    const count = found ? parseInt(found.order_count) : 0;
                    const pct   = maxOrders > 0 ? (count / maxOrders) * 100 : 0;
                    return (
                      <div key={hr} className="flex-1 flex flex-col items-center gap-1" title={`${hr}:00 — ${count} orders`}>
                        <div
                          className="w-full rounded-t-sm transition-all"
                          style={{
                            height: `${Math.max(pct, 2)}%`,
                            backgroundColor: pct > 66 ? '#ef4444' : pct > 33 ? '#f97316' : '#cbd5e1',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                  <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  🔴 peak &nbsp;🟠 busy &nbsp;⬜ quiet
                </p>
              </div>
            );
          })()}

          {/* Expenses section */}
          <AddExpenseForm onAdded={load} />

          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">
              Expenses
              {data.expenses.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  {data.expenses.length} item{data.expenses.length !== 1 ? 's' : ''}
                  {' · '}Total {c(data.summary.total_expenses)}
                </span>
              )}
            </h2>
            {data.expenses.length === 0 ? (
              <p className="text-gray-400 text-sm">No expenses recorded for this period.</p>
            ) : (
              <div className="space-y-2">
                {data.expenses.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{exp.name}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(exp.expense_date).toLocaleDateString('en-IN')}
                        {exp.category && ` · ${exp.category}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <span className="font-semibold text-gray-900">{c(exp.amount)}</span>
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                        title="Delete expense"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
