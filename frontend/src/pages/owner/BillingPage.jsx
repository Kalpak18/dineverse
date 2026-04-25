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
    name: 'Basic',
    tagline: 'Everything you need to run your café',
    color: 'brand',
    perMonth:   [499, 449, 444],
    totals:     [5988, 10788, 15999],
    regulars:   [5988, 11976, 17964],
    savings:    [0, 1188, 1965],
    savingsPct: [0, 10, 11],
    planKeys:   ['basic_1year', 'basic_2year', 'basic_3year'],
    features: [
      'Unlimited orders & menu items',
      'Real-time order notifications',
      'Kitchen Display Screen (KDS)',
      'Kitchen Order Ticket (KOT) printing',
      'Full analytics & reports',
      'GST-compliant bill printing',
      'Staff accounts',
      'Multi-outlet management',
      'Customer ratings & feedback',
      'Priority support',
    ],
  },
  premium: {
    name: 'Premium',
    tagline: 'For hotels & restaurants with kitchen teams',
    color: 'purple',
    perMonth:   [999, 899, 888],
    totals:     [11988, 21576, 31968],
    regulars:   [11988, 23976, 35964],
    savings:    [0, 2400, 3996],
    savingsPct: [0, 10, 11],
    planKeys:   ['premium_1year', 'premium_2year', 'premium_3year'],
    features: [
      'Everything in Basic',
      'Per-item status: Preparing → Ready → Served',
      'Course sequencing (starters before mains)',
      'Item-level cancellation with customer notification',
      'KOT auto-print when items are ready',
      'Customer sees live item-level progress',
      'KOT reprint history',
    ],
  },
};

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
    yearly:        'Basic · 1 Year',
    two_year:      'Basic · 2 Years',
    three_year:    'Basic · 3 Years',
    '1year':       'Basic · 1 Year',
    '2year':       'Basic · 2 Years',
    '3year':       'Basic · 3 Years',
    basic_1year:   'Basic · 1 Year',
    basic_2year:   'Basic · 2 Years',
    basic_3year:   'Basic · 3 Years',
    premium_1year: 'Premium · 1 Year',
    premium_2year: 'Premium · 2 Years',
    premium_3year: 'Premium · 3 Years',
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your DineVerse plan.</p>
      </div>

      {/* Payment success banner */}
      {activated && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-start gap-4">
          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xl">✓</div>
          <div className="flex-1">
            <p className="font-bold text-green-800 text-base">Subscription activated!</p>
            <p className="text-sm text-green-700 mt-0.5">
              {planLabel(activated.plan_type)} is now active.
              {activated.plan_expiry_date && (
                <> Valid until <strong>{new Date(activated.plan_expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
              )}
            </p>
            {activated.plan_tier === 'premium' && (
              <p className="text-xs text-green-600 mt-1">Kitchen Display & KOT printing are now unlocked.</p>
            )}
          </div>
          <button onClick={() => setActivated(null)} className="text-green-500 hover:text-green-700 font-bold text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}

      {/* Current Plan */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Current Plan</p>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">{planLabel(current?.plan_type)}</h2>
              <PlanBadge plan_type={current?.plan_type} plan_tier={current?.plan_tier} expiry={current?.plan_expiry_date} />
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
      <div className={`card border-2 ${accentBase.card} space-y-5`}>

        {/* Tier selector */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Plan Tier</p>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(TIERS).map(([key, t]) => (
              <button
                key={key}
                onClick={() => setTier(key)}
                className={`relative rounded-xl border-2 py-4 px-3 text-left transition-all ${
                  selectedTier === key
                    ? key === 'premium'
                      ? 'border-purple-500 bg-white shadow-md'
                      : 'border-brand-500 bg-white shadow-md'
                    : 'border-gray-200 bg-white/60 hover:border-gray-300'
                }`}
              >
                {key === 'premium' && (
                  <span className="absolute -top-2.5 right-3 text-[10px] font-bold bg-purple-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                    Kitchen & KOT
                  </span>
                )}
                <p className="font-bold text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">₹{fmt(t.perMonth[0])}/mo base</p>
                <p className="text-xs text-gray-400 mt-1 leading-snug">{t.tagline}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Duration selector */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Select Duration</p>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.idx}
                onClick={() => setDur(d.idx)}
                className={`relative rounded-xl border-2 py-3 px-2 text-center transition-all ${
                  selectedDur === d.idx ? accentBase.ring : 'border-gray-200 bg-white/60 hover:border-gray-300'
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
                <p className="text-xs text-gray-500 mt-0.5">₹{fmt(perMonth)}/mo</p>
              </button>
            ))}
          </div>
        </div>

        {/* Price breakdown */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-2">
          <div className="flex items-end gap-3">
            <p className="text-4xl font-black text-gray-900">
              ₹{fmt(perMonth)}<span className="text-base font-normal text-gray-500">/month</span>
            </p>
            {savingPct > 0 && (
              <span className="mb-1 text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                {savingPct}% off
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-700 font-semibold">₹{fmt(total)} billed for {dur.label.toLowerCase()}</span>
            {savings > 0 && (
              <>
                <span className="text-gray-400 line-through text-xs">₹{fmt(regular)}</span>
                <span className="text-green-600 font-semibold text-xs">You save ₹{fmt(savings)}</span>
              </>
            )}
          </div>
          {selectedDur === 0 && (
            <p className="text-xs text-gray-400">Choose 2 or 3 years to get a discount</p>
          )}
        </div>

        {/* Features */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm text-gray-700">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className={`font-bold flex-shrink-0 mt-0.5 ${selectedTier === 'premium' ? 'text-purple-500' : 'text-green-500'}`}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="space-y-2">
          <button
            onClick={handleUpgrade}
            disabled={paying}
            className={`w-full py-3.5 text-base font-bold rounded-xl disabled:opacity-60 transition-colors ${accentBase.btn}`}
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
