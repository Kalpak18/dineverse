import { useState, useEffect } from 'react';
import { getCommissionSummary } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-IN');
}
function monthLabel(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

const MODE_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', online: 'Online (Razorpay)' };
const STATUS_BADGE = {
  auto_deducted: { text: 'Transferred', cls: 'bg-green-100 text-green-700' },
  cash_due:      { text: 'Owed to DineVerse', cls: 'bg-orange-100 text-orange-700' },
  collected:     { text: 'Settled', cls: 'bg-gray-100 text-gray-500' },
  pending:       { text: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
};

function StatCard({ label, value, sub, accent, note }) {
  const colors = {
    green:  'bg-green-50 border-green-200 text-green-800',
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
    orange: 'bg-orange-50 border-orange-200 text-orange-800',
    red:    'bg-red-50 border-red-200 text-red-800',
    gray:   'bg-gray-50 border-gray-100 text-gray-700',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[accent] || colors.gray}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">{label}</p>
      <p className="text-2xl font-black">{value}</p>
      {sub && <p className="text-xs mt-0.5 opacity-70">{sub}</p>}
      {note && <p className="text-xs mt-1.5 opacity-60 italic">{note}</p>}
    </div>
  );
}

export default function BillingPage() {
  const { cafe } = useAuth();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('overview'); // 'overview' | 'breakdown' | 'orders'

  useEffect(() => {
    getCommissionSummary()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load revenue data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!data) return (
    <div className="card text-center py-16 text-gray-400">Could not load billing data. Please refresh.</div>
  );

  const rate             = data.commission_rate ?? 5;
  const cashOwed         = Number(data.cash_commission_owed || 0);
  const onlineReceived   = Number(data.online_net_received || 0);
  const cashNetYours     = Number(data.cash_net_yours || 0);
  const monthNet         = Number(data.month_net_revenue || 0);
  const totalNet         = Number(data.total_net_revenue || 0);

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Revenue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Your earnings after DineVerse's <strong>{rate}% commission</strong>. All features included — no subscription.
          </p>
        </div>
        <div className="flex-shrink-0 bg-brand-50 border border-brand-200 rounded-2xl px-4 py-2 text-center">
          <p className="text-xs text-brand-600 font-semibold uppercase tracking-wide">Commission</p>
          <p className="text-3xl font-black text-brand-600">{rate}%</p>
        </div>
      </div>

      {/* Cash commission alert */}
      {cashOwed > 0 && (
        <div className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-4 flex gap-3">
          <span className="text-2xl flex-shrink-0">⚠️</span>
          <div>
            <p className="font-bold text-orange-800">₹{fmt(cashOwed)} cash commission outstanding</p>
            <p className="text-sm text-orange-700 mt-0.5">
              This is DineVerse's share from your cash/UPI/card orders. DineVerse will collect this monthly.
              Contact <a href="mailto:support@dine-verse.com" className="underline font-medium">support@dine-verse.com</a> for questions.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[['overview','Overview'],['breakdown','Monthly'],['orders','Recent Orders']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div className="space-y-5">

          {/* This month */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">This Month</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard
                accent="green"
                label="Net revenue"
                value={`₹${fmt(monthNet)}`}
                sub="what you keep this month"
              />
              <StatCard
                accent="gray"
                label="Gross GMV"
                value={`₹${fmt(data.month_gmv)}`}
                sub="total order value"
              />
              <StatCard
                accent="orange"
                label="Commission"
                value={`₹${fmt(data.month_commission)}`}
                sub={`${rate}% of GMV`}
              />
            </div>
          </div>

          {/* Payment stream split */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Online stream */}
            <div className="rounded-2xl border border-green-200 bg-green-50 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏦</span>
                <h3 className="font-bold text-green-800">Online Payments (Razorpay)</h3>
              </div>
              <p className="text-xs text-green-700">
                Commission auto-deducted at payment time. Your net is transferred directly to your linked bank account.
              </p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-green-700">Already in your bank</span>
                  <span className="font-bold text-green-800">₹{fmt(onlineReceived)}</span>
                </div>
                <div className="flex justify-between text-xs text-green-600 opacity-75">
                  <span>Commission auto-deducted</span>
                  <span>−₹{fmt(data.online_commission_auto)}</span>
                </div>
              </div>
              {onlineReceived === 0 && (
                <p className="text-xs text-green-600 italic">No online payments yet or Razorpay Route not enabled.</p>
              )}
            </div>

            {/* Cash/UPI/Card stream */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">💵</span>
                <h3 className="font-bold text-blue-800">Cash / UPI / Card</h3>
              </div>
              <p className="text-xs text-blue-700">
                You collect the full amount. Commission is owed to DineVerse and collected monthly.
              </p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-blue-700">Total collected</span>
                  <span className="font-bold text-blue-800">₹{fmt(data.cash_gmv_held)}</span>
                </div>
                <div className="flex justify-between text-xs text-orange-600 font-semibold">
                  <span>Commission owed to DineVerse</span>
                  <span>−₹{fmt(data.cash_commission_owed)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-blue-200 pt-1.5 mt-1.5">
                  <span className="text-blue-700 font-medium">Your net</span>
                  <span className="font-bold text-blue-800">₹{fmt(cashNetYours)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* All-time totals */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">All Time</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard accent="green"  label="Total net revenue" value={`₹${fmt(totalNet)}`}               sub="your earnings"         />
              <StatCard accent="gray"   label="Total GMV"         value={`₹${fmtInt(data.total_gmv)}`}      sub="gross order value"     />
              <StatCard accent="orange" label="Total commission"  value={`₹${fmt(data.total_commission)}`}  sub="paid to DineVerse"     />
              <StatCard accent="blue"   label="Paid orders"       value={fmtInt(data.total_paid_orders)}    sub="all time"              />
            </div>
          </div>

          {/* How it works */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500 space-y-2">
            <p className="font-semibold text-gray-600 text-sm mb-1">How commission works</p>
            <div className="flex gap-2">
              <span>🟢</span>
              <p><strong>Razorpay (online):</strong> Commission ({rate}%) is auto-deducted via Razorpay Route when the customer pays online. Your net amount arrives in your bank instantly — no manual settlement needed.</p>
            </div>
            <div className="flex gap-2">
              <span>🟡</span>
              <p><strong>Cash / UPI / Card:</strong> You collect the full amount at your counter. DineVerse invoices you for the {rate}% commission monthly and collects via bank transfer or deduction from future payouts.</p>
            </div>
            <div className="flex gap-2">
              <span>📧</span>
              <p>Questions? Email <a href="mailto:support@dine-verse.com" className="text-brand-500 hover:underline">support@dine-verse.com</a></p>
            </div>
          </div>
        </div>
      )}

      {/* ── MONTHLY BREAKDOWN TAB ── */}
      {tab === 'breakdown' && (
        <div className="card">
          {data.monthly_breakdown?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Month</th>
                    <th className="text-right py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders</th>
                    <th className="text-right py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">GMV</th>
                    <th className="text-right py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Commission</th>
                    <th className="text-right py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Cash Owed</th>
                    <th className="text-right py-2 text-xs font-semibold text-green-600 uppercase tracking-wide">Your Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.monthly_breakdown.map((row) => (
                    <tr key={row.month} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{monthLabel(row.month)}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-500">{fmtInt(row.paid_orders)}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-600">₹{fmtInt(row.gmv)}</td>
                      <td className="py-2.5 pr-3 text-right text-orange-600 font-medium">−₹{fmt(row.commission)}</td>
                      <td className="py-2.5 pr-3 text-right">
                        {Number(row.cash_commission_owed) > 0
                          ? <span className="text-orange-500 font-semibold">₹{fmt(row.cash_commission_owed)}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="py-2.5 text-right font-bold text-green-700">₹{fmt(row.net_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td className="py-2.5 pr-3 font-bold text-gray-800">Total</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-gray-700">{fmtInt(data.total_paid_orders)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-gray-700">₹{fmtInt(data.total_gmv)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-orange-600">−₹{fmt(data.total_commission)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-orange-500">₹{fmt(cashOwed)}</td>
                    <td className="py-2.5 text-right font-bold text-green-700">₹{fmt(totalNet)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-center py-12 text-gray-400">No paid orders yet.</p>
          )}
        </div>
      )}

      {/* ── RECENT ORDERS TAB ── */}
      {tab === 'orders' && (
        <div className="card divide-y divide-gray-50">
          {data.recent_orders?.length > 0 ? data.recent_orders.map((o) => {
            const badge = STATUS_BADGE[o.commission_status] || STATUS_BADGE.pending;
            return (
              <div key={o.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-800 text-sm">Order #{o.daily_order_number}</p>
                    <span className="text-xs text-gray-400 capitalize">{o.order_type?.replace('-', ' ')}</span>
                    {o.payment_mode && (
                      <span className="text-xs text-gray-400">{MODE_LABEL[o.payment_mode] || o.payment_mode}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 space-y-1">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                  </div>
                  <p className="text-xs text-gray-400">
                    ₹{fmt(o.final_amount)} &minus; ₹{fmt(o.commission_amount)} commission
                  </p>
                  <p className="font-bold text-green-700 text-sm">= ₹{fmt(o.net_amount)} yours</p>
                </div>
              </div>
            );
          }) : (
            <p className="text-center py-12 text-gray-400">No paid orders yet.</p>
          )}
        </div>
      )}

    </div>
  );
}
