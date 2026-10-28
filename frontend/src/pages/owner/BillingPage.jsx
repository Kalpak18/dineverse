import { useState, useEffect, useCallback } from 'react';
import { getCommissionSummary, createCommissionPaymentOrder, verifyCommissionPaymentResult, reportCommissionPayment } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';
import { loadRazorpayScript } from '../../utils/razorpayLoader';

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
  auto_deducted: { text: 'Auto-settled', cls: 'bg-green-100 text-green-700' },
  cash_due:      { text: 'To remit',     cls: 'bg-orange-100 text-orange-700' },
  collected:     { text: 'Remitted',     cls: 'bg-gray-100 text-gray-500' },
  pending:       { text: 'Pending',      cls: 'bg-yellow-100 text-yellow-700' },
};

export default function BillingPage() {
  const { cafe } = useAuth();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('overview');
  const [paying, setPaying]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getCommissionSummary()
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load revenue data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePayCommission = async () => {
    setPaying(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast.error('Razorpay failed to load. Check internet connection.'); return; }

      const { data: order } = await createCommissionPaymentOrder();

      await new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'DineVerse',
          description: `Platform service fee — ${order.cafeName}`,
          order_id: order.orderId,
          prefill: { name: cafe?.name || '', email: cafe?.email || '' },
          theme: { color: '#f97316' },
          handler: async (response) => {
            try {
              await verifyCommissionPaymentResult({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              });
              toast.success(`₹${fmt(order.amount)} remitted to DineVerse successfully!`);
              load();
              resolve();
            } catch (err) {
              toast.error(err.response?.data?.message || 'Payment verification failed');
              reject(err);
            }
          },
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });
    } catch (err) {
      if (err?.response?.data?.message) toast.error(err.response.data.message);
    } finally {
      setPaying(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!data) return (
    <div className="card text-center py-16 text-gray-400">Could not load billing data. Please refresh.</div>
  );

  const rate              = parseFloat(data.commission_rate ?? 2);
  const cashOwed          = parseFloat(data.cash_commission_owed || 0);     // net after discount credit (clamped at 0)
  const cashGross         = parseFloat(data.cash_commission_gross || 0);    // before credit
  const platformCredit    = parseFloat(data.platform_discount_credit || 0); // DineVerse-funded offers (cash stream)
  const onlineCredit      = parseFloat(data.online_platform_credit || 0);   // DineVerse-funded offers (online stream)
  const dineVerseOwesYou  = parseFloat(data.dineverse_owes_owner || 0);     // > 0 if total credit exceeds owed
  const onlineSettled     = parseFloat(data.online_commission_auto || 0);
  const cashNetYours      = parseFloat(data.cash_net_yours || 0);
  const onlineReceived    = parseFloat(data.online_net_received || 0);
  const monthNet          = parseFloat(data.month_net_revenue || 0);
  const totalNet          = parseFloat(data.total_net_revenue || 0);
  const totalGmv          = parseFloat(data.total_gmv || 0);
  const totalComm         = parseFloat(data.total_commission || 0);

  return (
    <div className="space-y-5 max-w-3xl">

      {/* ── Hero card ── */}
      <div className="rounded-3xl bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-widest font-medium">Your Revenue</p>
            <p className="text-4xl font-black mt-1">₹{fmt(totalNet)}</p>
            <p className="text-xs text-gray-400 mt-1.5">Your food prices, 100% to you</p>
          </div>
          {/* Rate badge */}
          <div className="flex-shrink-0 bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-center min-w-[80px]">
            <p className="text-xs text-gray-300 font-semibold uppercase tracking-wide">Platform fee</p>
            <p className="text-3xl font-black leading-none mt-0.5">{rate}%</p>
            <p className="text-xs text-gray-400 mt-0.5">on customer bill</p>
          </div>
        </div>

        {/* This month row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/10 p-3 text-center">
            <p className="text-lg font-black">₹{fmt(data.month_gmv)}</p>
            <p className="text-xs text-gray-300 mt-0.5">Customer billing (month)</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3 text-center">
            <p className="text-lg font-black text-green-300">₹{fmt(monthNet)}</p>
            <p className="text-xs text-gray-300 mt-0.5">Your earnings (month)</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-3 text-center">
            <p className="text-lg font-black text-orange-300">₹{fmt(data.month_commission)}</p>
            <p className="text-xs text-gray-300 mt-0.5">Platform fee (month)</p>
          </div>
        </div>

        {/* Key message */}
        <p className="text-xs text-gray-400 text-center border-t border-white/10 pt-3">
          DineVerse adds a <strong className="text-white">{rate}% service charge</strong> on top of the customer's bill — your prices are never touched.
        </p>
      </div>

      {/* ── Settlement banner (3 states: owe / clear / DineVerse owes you) ── */}
      {dineVerseOwesYou > 0 ? (
        <div className="rounded-2xl border-2 border-purple-300 bg-purple-50 p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-purple-800 text-base">
                DineVerse owes you ₹{fmt(dineVerseOwesYou)}
              </p>
              <p className="text-sm text-purple-700 mt-0.5">
                Platform-funded offer credits exceed your commission owed. We'll settle this to your bank account at month end — no action needed from you.
              </p>
              <div className="mt-2 text-xs text-purple-600 space-y-0.5">
                {platformCredit > 0 && <div>· ₹{fmt(platformCredit)} from DineVerse offers on cash/UPI/card orders</div>}
                {onlineCredit > 0   && <div>· ₹{fmt(onlineCredit)} from DineVerse offers on online orders</div>}
                <div>· minus ₹{fmt(cashGross)} commission from cash/UPI/card orders</div>
              </div>
            </div>
          </div>
        </div>
      ) : cashOwed > 0 ? (
        <div className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">📤</span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-orange-800 text-base">
                ₹{fmt(cashOwed)} platform fee to remit
                {platformCredit > 0 && <span className="ml-2 text-sm font-normal text-purple-600">(after ₹{fmt(platformCredit)} DineVerse credit)</span>}
              </p>
              <p className="text-sm text-orange-700 mt-0.5">
                Customers paid this as a service charge on their bills — you collected it on DineVerse's behalf. Please remit it at least once a month.
              </p>
            </div>
          </div>
          <RemitPanel
            amount={cashOwed}
            cafeName={cafe?.name}
            details={data.remit?.details}
            onReported={load}
          />
          {data.remit?.online && (
            <button
              onClick={handlePayCommission}
              disabled={paying}
              className="mt-3 w-full min-h-[44px] py-3 rounded-xl border-2 border-orange-300 text-orange-700 font-bold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {paying ? 'Opening Razorpay…' : <>💳 Or pay ₹{fmt(cashOwed)} by card / netbanking (Razorpay)</>}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold text-green-800 text-sm">All platform fees remitted</p>
            <p className="text-xs text-green-600 mt-0.5">Nothing outstanding with DineVerse. You're all clear!</p>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[['overview','Overview'],['breakdown','Monthly'],['orders','Recent Orders']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div className="space-y-4">

          <div className={`grid grid-cols-1 gap-4 ${onlineReceived > 0 || onlineSettled > 0 ? 'sm:grid-cols-2' : ''}`}>

            {/* Online stream — only once customers have paid online */}
            {(onlineReceived > 0 || onlineSettled > 0) && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center text-lg">🏦</div>
                <div>
                  <p className="font-bold text-green-800 text-sm">Online (Razorpay)</p>
                  <p className="text-xs text-green-600">Auto-handled at checkout</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-green-700">Transferred to your bank</span>
                  <span className="font-bold text-green-800">₹{fmt(onlineReceived)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-green-600 opacity-70">Platform fee (customer paid)</span>
                  <span className="text-xs text-green-600 opacity-70">₹{fmt(onlineSettled)}</span>
                </div>
              </div>
              <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">
                When a customer pays online, Razorpay splits it instantly — your share goes to your bank, DineVerse's {rate}% fee goes to us. Zero effort on your part.
              </p>
            </div>
            )}

            {/* Cash/UPI/Card stream */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-lg">💵</div>
                <div>
                  <p className="font-bold text-blue-800 text-sm">Cash / UPI / Card</p>
                  <p className="text-xs text-blue-600">You collect, then remit</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-blue-700">Collected from customers</span>
                  <span className="font-bold text-blue-800">₹{fmt(data.cash_gmv_held)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-blue-700">Your earnings (food prices)</span>
                  <span className="font-bold text-blue-900">₹{fmt(cashNetYours)}</span>
                </div>
                {platformCredit > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-purple-600">⚡ DineVerse offer credit</span>
                    <span className="text-xs text-purple-600 font-semibold">−₹{fmt(platformCredit)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-blue-200 pt-2 mt-1">
                  <span className="text-xs text-orange-600 font-semibold">Net to remit</span>
                  <span className="text-xs text-orange-600 font-semibold">₹{fmt(cashOwed)}</span>
                </div>
              </div>
              {cashOwed > 0 && (
                <button
                  onClick={handlePayCommission}
                  disabled={paying}
                  className="w-full py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs transition-colors disabled:opacity-60"
                >
                  {paying ? 'Opening…' : `Remit ₹${fmt(cashOwed)} now`}
                </button>
              )}
            </div>
          </div>

          {/* All-time stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Your Total Revenue', value: `₹${fmt(totalNet)}`,         accent: 'text-green-700 bg-green-50 border-green-200' },
              { label: 'Total Customer Billing', value: `₹${fmt(totalGmv)}`,     accent: 'text-gray-700 bg-gray-50 border-gray-200' },
              { label: 'Platform Fees Collected', value: `₹${fmt(totalComm)}`,   accent: 'text-orange-600 bg-orange-50 border-orange-200' },
              { label: 'Paid Orders',        value: fmtInt(data.total_paid_orders), accent: 'text-blue-700 bg-blue-50 border-blue-200' },
            ].map(({ label, value, accent }) => (
              <div key={label} className={`rounded-2xl border p-4 ${accent}`}>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">{label}</p>
                <p className="text-xl font-black">{value}</p>
              </div>
            ))}
          </div>

          {/* How it works — owner-friendly framing */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="font-semibold text-gray-700 text-sm">How the platform fee works</p>
            <div className="space-y-2.5 text-xs text-gray-500">
              <div className="flex gap-2.5 items-start">
                <span className="mt-0.5 text-base">💡</span>
                <p>
                  <strong className="text-gray-700">Your prices stay exactly as you set them.</strong>{' '}
                  DineVerse adds a <strong className="text-gray-700">{rate}% service charge</strong> on top of the customer's bill — the customer pays it, not you.
                </p>
              </div>
              <div className="flex gap-2.5 items-start">
                <span className="mt-0.5 text-base">🟢</span>
                <p>
                  <strong className="text-gray-700">Online orders:</strong> Razorpay splits the payment automatically at checkout. Your share is transferred to your bank instantly — you never see or handle the platform fee.
                </p>
              </div>
              <div className="flex gap-2.5 items-start">
                <span className="mt-0.5 text-base">🟡</span>
                <p>
                  <strong className="text-gray-700">Cash/UPI/Card orders:</strong> Customers pay the platform fee as part of their bill at your counter. You hold it temporarily and remit it to DineVerse — either right here or we settle it at month end.
                </p>
              </div>
              <div className="flex gap-2.5 items-start">
                <span className="mt-0.5 text-base">📧</span>
                <p>Questions? <a href="mailto:support@dine-verse.com" className="text-brand-500 underline">support@dine-verse.com</a></p>
              </div>
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
                    {['Month','Orders','Customer Billing','Platform Fee','To Remit','Your Revenue'].map((h, i) => (
                      <th key={h} className={`py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right'} ${i === 5 ? 'text-green-600 pr-0' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.monthly_breakdown.map((row) => (
                    <tr key={row.month} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{monthLabel(row.month)}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-500">{fmtInt(row.paid_orders)}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-600">₹{fmtInt(row.gmv)}</td>
                      <td className="py-2.5 pr-3 text-right text-orange-600">₹{fmt(row.commission)}</td>
                      <td className="py-2.5 pr-3 text-right">
                        {Number(row.cash_commission_owed) > 0
                          ? <span className="text-orange-500 font-semibold">₹{fmt(row.cash_commission_owed)}</span>
                          : <span className="text-green-500 font-semibold text-xs">✓ Done</span>}
                      </td>
                      <td className="py-2.5 text-right font-bold text-green-700">₹{fmt(row.net_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="py-2.5 pr-3 font-bold text-gray-800">Total</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-gray-700">{fmtInt(data.total_paid_orders)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-gray-700">₹{fmtInt(totalGmv)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-orange-600">₹{fmt(totalComm)}</td>
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
                    <p className="font-semibold text-gray-800 text-sm">#{o.daily_order_number}</p>
                    <span className="text-xs text-gray-400 capitalize">{o.order_type?.replace('-', ' ')}</span>
                    <span className="text-xs text-gray-400">{MODE_LABEL[o.payment_mode] || o.payment_mode || ''}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 space-y-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.text}</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Customer paid ₹{fmt(o.final_amount)} · platform fee ₹{fmt(o.commission_amount)}
                  </p>
                  <p className="font-bold text-green-700 text-sm">₹{fmt(o.net_amount)} → your bank</p>
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

// How a café pays DineVerse its platform fee without Razorpay: UPI (opens the
// UPI app with the amount filled in) or bank transfer, then reports the
// reference so the DineVerse team can confirm it and mark the fees collected.
function RemitPanel({ amount, cafeName, details, onReported }) {
  const [form, setForm]       = useState(null); // null = closed
  const [sending, setSending] = useState(false);
  const upi  = details?.upi_id?.trim();
  const bank = details?.account_number?.trim();
  const upiLink = upi && `upi://pay?${new URLSearchParams({
    pa: upi, pn: details.payee_name || 'DineVerse', am: Number(amount).toFixed(2), cu: 'INR',
    tn: `DineVerse platform fee - ${cafeName || ''}`.slice(0, 50),
  })}`;

  const copy = (text) => navigator.clipboard?.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.error('Could not copy'));

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await reportCommissionPayment({ amount: parseFloat(form.amount), reference: form.reference, method: form.method });
      toast.success('Thanks! We will confirm your payment shortly.');
      setForm(null);
      onReported?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send — please try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {!upi && !bank && (
        <p className="text-sm text-orange-800 bg-white/70 rounded-xl px-3 py-2.5">
          DineVerse will share payment details with you. Once you have paid, tap “I've paid” below.
        </p>
      )}
      {upi && (
        <div className="rounded-xl bg-white border border-orange-200 p-3 space-y-2">
          <a href={upiLink} className="flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm">
            📱 Pay ₹{fmt(amount)} with any UPI app
          </a>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-gray-600 min-w-0 truncate">UPI ID: <strong className="text-gray-900">{upi}</strong></span>
            <button type="button" onClick={() => copy(upi)} className="min-h-[40px] px-3 rounded-lg border border-gray-200 text-xs font-semibold flex-shrink-0">Copy</button>
          </div>
        </div>
      )}
      {bank && (
        <div className="rounded-xl bg-white border border-orange-200 p-3 text-sm text-gray-700 space-y-1">
          <p className="font-semibold text-gray-900">Bank transfer</p>
          {details.account_name && <p>Name: <strong>{details.account_name}</strong></p>}
          <p className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">A/c: <strong>{bank}</strong></span>
            <button type="button" onClick={() => copy(bank)} className="min-h-[40px] px-3 rounded-lg border border-gray-200 text-xs font-semibold flex-shrink-0">Copy</button>
          </p>
          {details.ifsc && <p>IFSC: <strong>{details.ifsc}</strong>{details.bank_name && ` · ${details.bank_name}`}</p>}
        </div>
      )}
      {details?.note && <p className="text-xs text-orange-700">{details.note}</p>}

      {!form ? (
        <button
          type="button"
          onClick={() => setForm({ amount: Number(amount).toFixed(2), reference: '', method: upi ? 'upi' : 'bank' })}
          className="w-full min-h-[44px] rounded-xl border-2 border-orange-300 bg-white text-orange-700 font-bold text-sm"
        >
          ✅ I've paid — send the reference
        </button>
      ) : (
        <form onSubmit={submit} className="rounded-xl bg-white border border-orange-200 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-600">Amount paid (₹)
              <input type="number" min="1" step="0.01" required className="input mt-1 w-full"
                value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </label>
            <label className="text-xs text-gray-600">Paid by
              <select className="input mt-1 w-full" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-gray-600">UPI / bank reference number (UTR)
            <input required minLength={4} maxLength={100} className="input mt-1 w-full" placeholder="e.g. 412345678901"
              value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={sending} className="flex-1 min-h-[44px] rounded-xl bg-orange-500 text-white font-bold text-sm disabled:opacity-60">
              {sending ? 'Sending…' : 'Send to DineVerse'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="min-h-[44px] px-4 rounded-xl border border-gray-200 text-sm">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
