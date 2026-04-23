import { useState, useEffect } from 'react';
import { getPlans, createPaymentOrder, verifyPayment, getPaymentHistory } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

// ─── Plan duration options ────────────────────────────────────
const DURATIONS = [
  {
    key: '1year',
    label: '1 Year',
    years: 1,
    months: 12,
    perMonth: 499,
    total: 5988,
    regular: 5988,
    savings: 0,
    savingsPct: 0,
    badge: null,
  },
  {
    key: '2year',
    label: '2 Years',
    years: 2,
    months: 24,
    perMonth: 449,
    total: 10788,
    regular: 11976,   // 499 × 24
    savings: 1188,
    savingsPct: 10,
    badge: 'Save 10%',
  },
  {
    key: '3year',
    label: '3 Years',
    years: 3,
    months: 36,
    perMonth: 444,
    total: 15999,
    regular: 17964,   // 499 × 36
    savings: 1965,
    savingsPct: 11,
    badge: 'Best Value',
  },
];

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

function planLabel(plan_type) {
  const map = {
    free_trial: 'Free Trial',
    '1year': '1 Year Plan',
    '2year': '2 Year Plan',
    '3year': '3 Year Plan',
    yearly: '1 Year Plan',
  };
  return map[plan_type] || plan_type;
}

function PlanBadge({ plan_type, expiry }) {
  const expired = expiry && new Date(expiry) < new Date();
  const isTrial = plan_type === 'free_trial';
  const color = expired
    ? 'bg-red-100 text-red-700 border-red-200'
    : isTrial
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-green-100 text-green-700 border-green-200';
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {expired ? 'Expired' : planLabel(plan_type)}
    </span>
  );
}

export default function BillingPage() {
  const { cafe, updateCafe } = useAuth();
  const [data, setData]         = useState(null);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [paying, setPaying]     = useState(false);
  const [selected, setSelected] = useState('1year');
  const [activated, setActivated] = useState(null); // { plan_type, plan_expiry_date } after successful payment

  const selectedDuration = DURATIONS.find((d) => d.key === selected);

  useEffect(() => {
    Promise.all([getPlans(), getPaymentHistory()])
      .then(([plansRes, histRes]) => {
        setData(plansRes.data);
        setHistory(histRes.data.payments);
      })
      .catch(() => toast.error('Failed to load billing info'))
      .finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const { data: order } = await createPaymentOrder(selected);

      const dur = selectedDuration;
      const options = {
        key: data.razorpay_key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'DineVerse',
        description: `${dur.label} — ${dur.months} months`,
        order_id: order.order_id,
        prefill: {
          name:    order.cafe_name,
          email:   order.cafe_email,
          contact: cafe?.phone || '',
        },
        theme: { color: '#f97316' },
        handler: async (response) => {
          try {
            const { data: verified } = await verifyPayment({
              razorpay_order_id:  response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            });
            updateCafe({
              plan_type:        verified.plan_type,
              plan_expiry_date: verified.plan_expiry_date,
            });
            setActivated(verified);
            const [plansRes, histRes] = await Promise.all([getPlans(), getPaymentHistory()]);
            setData(plansRes.data);
            setHistory(histRes.data.payments);
          } catch {
            // Payment succeeded on Razorpay's side — the webhook will activate the subscription.
            // Don't show a scary error; just let the user know it's being processed.
            toast('Payment received! Your subscription is being activated — it should reflect within a minute. If it doesn\'t, contact support.', {
              duration: 10000,
              icon: '⏳',
            });
          } finally {
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      };

      if (!window.Razorpay) {
        toast.error('Payment gateway not loaded. Please refresh and try again.');
        setPaying(false);
        return;
      }
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response) => {
        toast.error(`Payment failed: ${response.error.description}`);
        setPaying(false);
      });
      rzp.open();
    } catch (err) {
      toast.error(getApiError(err));
      setPaying(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const current    = data?.current;
  const expiryDate = current?.plan_expiry_date
    ? new Date(current.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const isExpired  = current?.plan_expiry_date && new Date(current.plan_expiry_date) < new Date();
  const isPaid     = current?.plan_type && current.plan_type !== 'free_trial';
  const dur        = selectedDuration;

  const btnLabel = paying
    ? 'Opening payment...'
    : isExpired
      ? `Renew — ₹${fmt(dur.total)}`
      : isPaid
        ? `Extend Plan — ₹${fmt(dur.total)}`
        : `Upgrade Now — ₹${fmt(dur.total)}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your DineVerse plan.</p>
      </div>

      {/* Payment success banner */}
      {activated && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-start gap-4">
          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xl">
            ✓
          </div>
          <div className="flex-1">
            <p className="font-bold text-green-800 text-base">Subscription activated!</p>
            <p className="text-sm text-green-700 mt-0.5">
              {planLabel(activated.plan_type)} is now active.
              {activated.plan_expiry_date && (
                <> Valid until <strong>{new Date(activated.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
              )}
            </p>
            <p className="text-xs text-green-600 mt-1">Thanks for choosing DineVerse — all features are now unlocked.</p>
          </div>
          <button
            onClick={() => setActivated(null)}
            className="text-green-500 hover:text-green-700 font-bold text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* Current Plan */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Current Plan</p>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">
                {planLabel(current?.plan_type)}
              </h2>
              <PlanBadge plan_type={current?.plan_type} expiry={current?.plan_expiry_date} />
            </div>
            {expiryDate && (
              <p className={`text-sm mt-1 ${isExpired ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                {isExpired ? '⚠️ Expired on ' : 'Valid until '}{expiryDate}
              </p>
            )}
            {!isExpired && current?.days_left > 0 && current.days_left <= 30 && (
              <p className="text-xs text-amber-600 font-medium mt-1">
                {current.days_left} day{current.days_left !== 1 ? 's' : ''} remaining
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Upgrade Card ── */}
      <div className="card border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-orange-50 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xl">🚀</span>
          <h3 className="font-bold text-gray-900 text-lg">DineVerse Pro</h3>
          <span className="text-xs font-bold bg-brand-500 text-white px-2 py-0.5 rounded-full">
            ₹499/mo base rate
          </span>
        </div>

        {/* Duration selector — Hostinger style */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Select Plan Duration
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => setSelected(d.key)}
                className={`relative rounded-xl border-2 py-3 px-2 text-center transition-all ${
                  selected === d.key
                    ? 'border-brand-500 bg-white shadow-md'
                    : 'border-gray-200 bg-white/60 hover:border-brand-300'
                }`}
              >
                {d.badge && (
                  <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    d.key === '3year'
                      ? 'bg-green-500 text-white'
                      : 'bg-amber-400 text-amber-900'
                  }`}>
                    {d.badge}
                  </span>
                )}
                <p className="font-bold text-gray-900 text-sm mt-1">{d.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">₹{fmt(d.perMonth)}/mo</p>
              </button>
            ))}
          </div>
        </div>

        {/* Price breakdown */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-2">
          <div className="flex items-end gap-3">
            <p className="text-4xl font-black text-gray-900">
              ₹{fmt(dur.perMonth)}
              <span className="text-base font-normal text-gray-500">/month</span>
            </p>
            {dur.savingsPct > 0 && (
              <span className="mb-1 text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                {dur.savingsPct}% off
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-700 font-semibold">
              ₹{fmt(dur.total)} billed for {dur.label.toLowerCase()}
            </span>
            {dur.savings > 0 && (
              <>
                <span className="text-gray-400 line-through text-xs">₹{fmt(dur.regular)}</span>
                <span className="text-green-600 font-semibold text-xs">
                  You save ₹{fmt(dur.savings)}
                </span>
              </>
            )}
          </div>

          {dur.key === '1year' && (
            <p className="text-xs text-gray-400">Choose 2 or 3 years to get a discount</p>
          )}
        </div>

        {/* Features */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm text-gray-700">
          {[
            'Unlimited orders & menu items',
            'Real-time order notifications',
            'Full analytics & reports',
            'GST-compliant bill printing',
            'Staff accounts',
            'Multi-outlet management',
            'Customer ratings & feedback',
            'Priority support',
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-green-500 font-bold flex-shrink-0">✓</span> {f}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="space-y-2">
          <button
            onClick={handleUpgrade}
            disabled={paying}
            className="btn-primary w-full py-3.5 text-base font-bold disabled:opacity-60"
          >
            {btnLabel}
          </button>
          <p className="text-center text-xs text-gray-400">
            Secure payment via Razorpay &nbsp;·&nbsp; Instant activation &nbsp;·&nbsp; No hidden fees
          </p>
        </div>
      </div>

      {/* Payment History */}
      {history.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Payment History</h2>
          <div className="space-y-2">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="font-medium text-gray-800">{planLabel(p.plan_type)}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(p.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    {p.razorpay_payment_id && (
                      <span className="ml-2 font-mono">#{p.razorpay_payment_id.slice(-8)}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">₹{fmt(p.amount_paise / 100)}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
