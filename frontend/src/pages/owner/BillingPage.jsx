import { useState, useEffect } from 'react';
import { getPlans, createPaymentOrder, verifyPayment, getPaymentHistory } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getApiError } from '../../utils/apiError';
import { loadRazorpayScript } from '../../utils/razorpayLoader';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

// ─── Pricing config ───────────────────────────────────────────
const TIERS = {
  basic: {
    name: 'Essential',
    badge: '🔥 Most Popular',
    badgeCls: 'bg-brand-500 text-white',
    tagline: 'Run your entire café from one screen',
    color: 'brand',
    perMonth:   [499, 449, 444],
    totals:     [5988, 10788, 15999],
    regulars:   [5988, 11976, 17964],
    savings:    [0, 1188, 1965],
    savingsPct: [0, 10, 11],
    planKeys:   ['basic_1year', 'basic_2year', 'basic_3year'],
    outcomes: [
      { icon: '📋', text: 'Accept unlimited orders — no caps, ever' },
      { icon: '🔔', text: 'Never miss an order with instant real-time alerts' },
      { icon: '🖥️', text: 'Kitchen display keeps your team in sync' },
      { icon: '🧾', text: 'Print KOTs & legal GST invoices in one click' },
      { icon: '📊', text: 'Track daily revenue & spot your bestsellers' },
      { icon: '👥', text: 'Separate logins for cashier, kitchen & manager' },
      { icon: '🏪', text: 'Manage multiple branches from one account' },
      { icon: '⭐', text: 'Collect customer ratings to improve & grow' },
    ],
  },
  premium: {
    name: 'Kitchen Pro',
    badge: '👨‍🍳 For Restaurant Teams',
    badgeCls: 'bg-purple-600 text-white',
    tagline: 'Full kitchen management for serious restaurants',
    color: 'purple',
    perMonth:   [999, 899, 888],
    totals:     [11988, 21576, 31968],
    regulars:   [11988, 23976, 35964],
    savings:    [0, 2400, 3996],
    savingsPct: [0, 10, 11],
    planKeys:   ['premium_1year', 'premium_2year', 'premium_3year'],
    outcomes: [
      { icon: '✅', text: 'Everything in Basic, plus:' },
      { icon: '🔄', text: 'Live per-item progress: Preparing → Ready → Served' },
      { icon: '🍽️', text: 'Course sequencing — starters fire before mains' },
      { icon: '❌', text: 'Cancel individual items & notify the customer' },
      { icon: '🖨️', text: 'KOT auto-prints the moment items are ready' },
      { icon: '📱', text: 'Customer sees exact item status on their phone' },
      { icon: '📜', text: 'Full KOT reprint history for every order' },
    ],
  },
};

// Feature comparison rows for the table
const COMPARE_ROWS = [
  { label: 'Orders & menu items',         basic: 'Unlimited',    premium: 'Unlimited' },
  { label: 'Real-time order alerts',      basic: true,           premium: true },
  { label: 'GST invoices & KOT printing', basic: true,           premium: true },
  { label: 'Analytics & revenue reports', basic: true,           premium: true },
  { label: 'Staff accounts & roles',      basic: true,           premium: true },
  { label: 'Multi-branch management',     basic: true,           premium: true },
  { label: 'Customer ratings',            basic: true,           premium: true },
  { label: 'Per-item kitchen status',     basic: false,          premium: true },
  { label: 'Course sequencing',           basic: false,          premium: true },
  { label: 'Item-level cancellation',     basic: false,          premium: true },
  { label: 'KOT auto-print on ready',     basic: false,          premium: true },
  { label: 'Customer live item tracking', basic: false,          premium: true },
];

const DURATIONS = [
  { idx: 0, label: '1 Year',  years: 1, badge: null },
  { idx: 1, label: '2 Years', years: 2, badge: 'Save 10%' },
  { idx: 2, label: '3 Years', years: 3, badge: 'Best Value' },
];

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

function planLabel(plan_type) {
  const map = {
    free_trial:    'Free Trial',
    yearly:        'Essential · 1 Year',
    two_year:      'Essential · 2 Years',
    three_year:    'Essential · 3 Years',
    '1year':       'Essential · 1 Year',
    '2year':       'Essential · 2 Years',
    '3year':       'Essential · 3 Years',
    basic_1year:   'Essential · 1 Year',
    basic_2year:   'Essential · 2 Years',
    basic_3year:   'Essential · 3 Years',
    premium_1year: 'Kitchen Pro · 1 Year',
    premium_2year: 'Kitchen Pro · 2 Years',
    premium_3year: 'Kitchen Pro · 3 Years',
  };
  return map[plan_type] || plan_type;
}

function PlanBadge({ plan_type, plan_tier, expiry }) {
  const expired = expiry && new Date(expiry) < new Date();
  const isTrial = plan_type === 'free_trial';
  const isPremium = plan_tier === 'premium';
  const color = expired
    ? 'bg-red-100 text-red-700 border-red-200'
    : isTrial
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : isPremium
        ? 'bg-purple-100 text-purple-700 border-purple-200'
        : 'bg-green-100 text-green-700 border-green-200';
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {expired ? 'Expired' : planLabel(plan_type)}
    </span>
  );
}

export default function BillingPage() {
  const { cafe, updateCafe } = useAuth();
  const [data, setData]           = useState(null);
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [paying, setPaying]       = useState(false);
  const [selectedTier, setTier]   = useState('basic');
  const [selectedDur, setDur]     = useState(0);
  const [activated, setActivated] = useState(null);

  useEffect(() => {
    Promise.all([getPlans(), getPaymentHistory()])
      .then(([plansRes, histRes]) => {
        setData(plansRes.data);
        setHistory(histRes.data.payments);
      })
      .catch(() => toast.error('Failed to load billing info'))
      .finally(() => setLoading(false));
  }, []);

  const tier = TIERS[selectedTier];
  const dur  = DURATIONS[selectedDur];

  const handleUpgrade = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const planKey = tier.planKeys[selectedDur];
      const { data: order } = await createPaymentOrder(planKey);

      const options = {
        key: data.razorpay_key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'DineVerse',
        description: `${tier.name} · ${dur.label}`,
        order_id: order.order_id,
        prefill: {
          name:    order.cafe_name,
          email:   order.cafe_email,
          contact: cafe?.phone || '',
        },
        theme: { color: selectedTier === 'premium' ? '#7c3aed' : '#f97316' },
        handler: async (response) => {
          try {
            const { data: verified } = await verifyPayment({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            });
            updateCafe({
              plan_type:        verified.plan_type,
              plan_tier:        verified.plan_tier,
              plan_expiry_date: verified.plan_expiry_date,
            });
            setActivated(verified);
            const [plansRes, histRes] = await Promise.all([getPlans(), getPaymentHistory()]);
            setData(plansRes.data);
            setHistory(histRes.data.payments);
          } catch {
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
        const loaded = await loadRazorpayScript();
        if (!loaded) {
          toast.error('Payment gateway not loaded. Please refresh and try again.');
          setPaying(false);
          return;
        }
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

  const total     = tier.totals[selectedDur];
  const perMonth  = tier.perMonth[selectedDur];
  const savings   = tier.savings[selectedDur];
  const regular   = tier.regulars[selectedDur];
  const savingPct = tier.savingsPct[selectedDur];

  const btnLabel = paying
    ? 'Opening payment...'
    : isExpired
      ? `Renew — ₹${fmt(total)}`
      : isPaid
        ? `Upgrade / Extend — ₹${fmt(total)}`
        : `Activate — ₹${fmt(total)}`;

  const accentBase = selectedTier === 'premium'
    ? { ring: 'border-purple-500 bg-white shadow-md', badge: 'bg-purple-500', btn: 'bg-purple-600 hover:bg-purple-700 text-white', card: 'border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50' }
    : { ring: 'border-brand-500 bg-white shadow-md', badge: 'bg-brand-500', btn: 'btn-primary', card: 'border-brand-200 bg-gradient-to-br from-brand-50 to-orange-50' };

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Plans & Pricing</h1>
        <p className="text-gray-500 text-sm mt-1">
          {!isPaid
            ? 'Your 30-day free trial is active. Subscribe before it expires to keep your café running.'
            : 'Manage your subscription below.'}
        </p>
      </div>

      {/* Payment success banner */}
      {activated && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-start gap-4">
          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xl">✓</div>
          <div className="flex-1">
            <p className="font-bold text-green-800 text-base">You're all set!</p>
            <p className="text-sm text-green-700 mt-0.5">
              {planLabel(activated.plan_type)} is now active.
              {activated.plan_expiry_date && (
                <> Valid until <strong>{new Date(activated.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
              )}
            </p>
          </div>
          <button onClick={() => setActivated(null)} className="text-green-500 hover:text-green-700 font-bold text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}

      {/* Current Plan Status */}
      <div className="card">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Current Plan</p>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{planLabel(current?.plan_type)}</h2>
              <PlanBadge plan_type={current?.plan_type} plan_tier={current?.plan_tier} expiry={current?.plan_expiry_date} />
            </div>
            {expiryDate && (
              <p className={`text-sm mt-1 ${isExpired ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                {isExpired ? '⚠️ Expired on ' : 'Active until '}{expiryDate}
              </p>
            )}
            {!isExpired && current?.days_left > 0 && current.days_left <= 30 && (
              <p className="text-xs text-amber-600 font-medium mt-1">
                ⏳ {current.days_left} day{current.days_left !== 1 ? 's' : ''} remaining — renew now to avoid interruption
              </p>
            )}
          </div>
          {isExpired && (
            <span className="text-sm font-semibold text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
              Service paused — renew below
            </span>
          )}
        </div>
      </div>

      {/* ── Plan cards (side-by-side) ── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Choose your plan</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(TIERS).map(([key, t]) => {
            const isPrem = key === 'premium';
            const isSelected = selectedTier === key;
            const basePerMonth = t.perMonth[0];
            return (
              <button
                key={key}
                onClick={() => setTier(key)}
                className={`relative rounded-2xl border-2 p-5 text-left transition-all ${
                  isSelected
                    ? isPrem
                      ? 'border-purple-500 bg-white shadow-lg'
                      : 'border-brand-500 bg-white shadow-lg'
                    : 'border-gray-200 bg-gray-50 hover:bg-white hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                {/* Badge */}
                <span className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-3 ${t.badgeCls}`}>
                  {t.badge}
                </span>

                <p className="text-lg font-bold text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 mb-3 leading-snug">{t.tagline}</p>

                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-2xl font-black text-gray-900">₹{fmt(basePerMonth)}</span>
                  <span className="text-sm text-gray-400">/mo</span>
                </div>
                <p className="text-xs text-gray-400">billed annually · save more on 2–3 year plans</p>

                {/* Selected indicator */}
                <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? isPrem ? 'border-purple-500 bg-purple-500' : 'border-brand-500 bg-brand-500'
                    : 'border-gray-300'
                }`}>
                  {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── What you get with selected plan ── */}
      <div className={`rounded-2xl border-2 p-5 space-y-4 ${accentBase.card}`}>
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900">{tier.name}</span>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tier.badgeCls}`}>{tier.badge}</span>
        </div>
        <ul className="space-y-2">
          {tier.outcomes.map((o) => (
            <li key={o.text} className="flex items-start gap-3 text-sm text-gray-700">
              <span className="flex-shrink-0 text-base">{o.icon}</span>
              <span>{o.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Feature comparison table ── */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-brand-600 hover:text-brand-700 list-none flex items-center gap-1.5 select-none">
          <span className="group-open:hidden">▶</span>
          <span className="hidden group-open:inline">▼</span>
          Compare all features
        </summary>
        <div className="mt-3 rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Feature</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-brand-600 uppercase tracking-wide text-center">Basic</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-purple-600 uppercase tracking-wide text-center">Premium</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.basic === true
                      ? <span className="text-green-500 font-bold">✓</span>
                      : row.basic === false
                        ? <span className="text-gray-300 font-bold">—</span>
                        : <span className="text-xs font-semibold text-brand-600">{row.basic}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {row.premium === true
                      ? <span className="text-purple-500 font-bold">✓</span>
                      : row.premium === false
                        ? <span className="text-gray-300 font-bold">—</span>
                        : <span className="text-xs font-semibold text-purple-600">{row.premium}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* ── Duration selector + pricing ── */}
      <div className={`card border-2 space-y-4 ${accentBase.card}`}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Billing period</p>
        <div className="grid grid-cols-3 gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.idx}
              onClick={() => setDur(d.idx)}
              className={`relative rounded-xl border-2 py-3 px-2 text-center transition-all ${
                selectedDur === d.idx ? accentBase.ring : 'border-gray-200 bg-white/70 hover:border-gray-300'
              }`}
            >
              {d.badge && (
                <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  d.idx === 2 ? 'bg-green-500 text-white' : 'bg-amber-400 text-amber-900'
                }`}>
                  {d.badge}
                </span>
              )}
              <p className="font-bold text-gray-900 text-sm mt-1">{d.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">₹{fmt(tier.perMonth[d.idx])}/mo</p>
            </button>
          ))}
        </div>

        {/* Price summary */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-gray-900">₹{fmt(perMonth)}</span>
            <span className="text-base text-gray-500">/month</span>
            {savingPct > 0 && (
              <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{savingPct}% off</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-gray-700 font-semibold">₹{fmt(total)} billed for {dur.label.toLowerCase()}</span>
            {savings > 0 && (
              <>
                <span className="text-gray-400 line-through text-xs">₹{fmt(regular)}</span>
                <span className="text-green-600 font-semibold text-xs">You save ₹{fmt(savings)}</span>
              </>
            )}
          </div>
          {selectedDur === 0 && (
            <p className="text-xs text-gray-400">Switch to 2 or 3 years to unlock a discount</p>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={handleUpgrade}
          disabled={paying}
          className={`w-full py-4 text-base font-bold rounded-xl disabled:opacity-60 transition-colors ${accentBase.btn}`}
        >
          {paying ? 'Opening payment…' : isExpired
            ? `Renew ${tier.name} — ₹${fmt(total)}`
            : isPaid
              ? `Upgrade to ${tier.name} — ₹${fmt(total)}`
              : `Get ${tier.name} — ₹${fmt(total)}`}
        </button>
        <p className="text-center text-xs text-gray-400">
          🔒 Secure payment via Razorpay &nbsp;·&nbsp; Instant activation &nbsp;·&nbsp; No hidden fees
        </p>
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
                    {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
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
