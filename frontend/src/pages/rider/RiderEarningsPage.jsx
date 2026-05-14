import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderGetEarnings, riderGetHistory } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { getApiError } from '../../utils/apiError';

const fmt = (n) => `₹${Number(n || 0).toFixed(0)}`;
const fmtDec = (n) => `₹${Number(n || 0).toFixed(2)}`;

function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`rounded-2xl p-4 flex flex-col gap-0.5 ${accent ? 'bg-orange-500 text-white' : 'bg-white border border-gray-100 shadow-sm'}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${accent ? 'text-orange-100' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-2xl font-black ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs ${accent ? 'text-orange-100' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

function EarningsLedgerRow({ entry }) {
  const sign = entry.amount >= 0 ? '+' : '';
  const isPositive = entry.amount >= 0;
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-gray-50 last:border-0">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 ${isPositive ? 'bg-green-50' : 'bg-red-50'}`}>
        {entry.type === 'delivery_fee' ? '🛵' :
         entry.type === 'tip' ? '⭐' :
         entry.type === 'bonus' ? '🎉' :
         entry.type === 'adjustment' ? '🔧' : '💳'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">
          {entry.description || (entry.type === 'delivery_fee' ? 'Delivery fee' :
           entry.type === 'tip' ? 'Tip from customer' :
           entry.type === 'bonus' ? 'Bonus' : 'Adjustment')}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {entry.order_id ? `Order #${String(entry.order_id).slice(-6).toUpperCase()} · ` : ''}
          {new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <span className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
        {sign}{fmtDec(entry.amount)}
      </span>
    </div>
  );
}

function HistoryRow({ order }) {
  const isDelivered = order.delivery_status === 'delivered';
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {isDelivered ? 'Delivered' : 'Failed'}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(order.delivered_at || order.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-800 truncate">{order.cafe_name || 'Café'}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{order.delivery_address}</p>
        </div>
        {order.rider_earning != null && (
          <div className="text-right flex-shrink-0">
            <p className="text-base font-black text-orange-600">{fmt(order.rider_earning)}</p>
            <p className="text-[10px] text-gray-400">earned</p>
          </div>
        )}
      </div>
    </div>
  );
}

const PERIOD_LABELS = { today: "Today", week: "This week", month: "This month", all: "All time" };

export default function RiderEarningsPage() {
  const navigate = useNavigate();
  const { rider } = useRiderAuth();

  const [earnings, setEarnings] = useState(null);
  const [history, setHistory]   = useState([]);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);
  const [loadingE, setLoadingE] = useState(true);
  const [loadingH, setLoadingH] = useState(false);
  const [period, setPeriod]     = useState('week');
  const [tab, setTab]           = useState('earnings'); // 'earnings' | 'history'

  const loadEarnings = useCallback(async () => {
    setLoadingE(true);
    try {
      const { data } = await riderGetEarnings();
      setEarnings(data);
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setLoadingE(false); }
  }, []);

  const loadHistory = useCallback(async (p = 1, reset = false) => {
    setLoadingH(true);
    try {
      const { data } = await riderGetHistory({ page: p, limit: 15 });
      setHistory((prev) => reset ? (data.orders || []) : [...prev, ...(data.orders || [])]);
      setHasMore((data.orders || []).length === 15);
      setPage(p);
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setLoadingH(false); }
  }, []);

  useEffect(() => { loadEarnings(); }, [loadEarnings]);
  useEffect(() => { if (tab === 'history') loadHistory(1, true); }, [tab, loadHistory]);

  const summary = earnings?.summary || {};
  const ledger  = earnings?.ledger  || [];

  const periodData = {
    today: { earned: summary.today_earned, deliveries: summary.today_deliveries },
    week:  { earned: summary.week_earned,  deliveries: summary.week_deliveries  },
    month: { earned: summary.month_earned, deliveries: summary.month_deliveries },
    all:   { earned: summary.total_earned, deliveries: summary.total_deliveries },
  };
  const curr = periodData[period] || {};

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 pt-10 pb-4 sticky top-0 z-20">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button onClick={() => navigate('/rider/jobs')}
            className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600">
            ←
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-black text-gray-900">Earnings</h1>
            <p className="text-xs text-gray-400">{rider?.name || 'Rider'}</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mt-4 max-w-lg mx-auto bg-gray-100 rounded-xl p-1">
          {[['earnings', 'Earnings'], ['history', 'Delivery History']].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 max-w-lg mx-auto w-full">

        {/* ── Earnings Tab ── */}
        {tab === 'earnings' && (
          <>
            {loadingE ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Period selector */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                  {Object.entries(PERIOD_LABELS).map(([k, l]) => (
                    <button key={k} onClick={() => setPeriod(k)}
                      className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${period === k ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>

                {/* Main stat */}
                <div className="bg-orange-500 rounded-3xl p-6 text-white mb-4 relative overflow-hidden">
                  <div className="absolute right-4 top-3 text-6xl opacity-10">💰</div>
                  <p className="text-orange-100 text-sm font-semibold mb-1">{PERIOD_LABELS[period]}</p>
                  <p className="text-4xl font-black">{fmt(curr.earned)}</p>
                  <p className="text-orange-100 text-sm mt-1">{curr.deliveries ?? 0} deliveries</p>
                </div>

                {/* Sub stats */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <StatCard label="Total earned" value={fmt(summary.total_earned)} sub={`${summary.total_deliveries ?? 0} trips total`} />
                  <StatCard label="Avg per trip" value={summary.total_deliveries ? fmt(summary.total_earned / summary.total_deliveries) : '₹0'} sub="delivery fee" />
                </div>

                {/* Ledger */}
                <div className="mb-2">
                  <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-3">Recent transactions</h2>
                  {ledger.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                      <div className="text-4xl mb-3">💳</div>
                      <p className="text-sm font-semibold text-gray-500">No transactions yet</p>
                      <p className="text-xs text-gray-400 mt-1">Complete deliveries to see your earnings here</p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-1">
                      {ledger.map((e, i) => <EarningsLedgerRow key={e.id || i} entry={e} />)}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── History Tab ── */}
        {tab === 'history' && (
          <>
            {loadingH && history.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center mt-2">
                <div className="text-4xl mb-3">📦</div>
                <p className="text-sm font-semibold text-gray-500">No delivery history yet</p>
                <p className="text-xs text-gray-400 mt-1">Your completed deliveries will appear here</p>
              </div>
            ) : (
              <>
                {history.map((o) => <HistoryRow key={o.id} order={o} />)}

                {hasMore && (
                  <button onClick={() => loadHistory(page + 1)}
                    disabled={loadingH}
                    className="w-full py-3 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50 mt-1">
                    {loadingH ? 'Loading…' : 'Load more'}
                  </button>
                )}

                {!hasMore && history.length > 0 && (
                  <p className="text-center text-xs text-gray-400 py-4">All deliveries shown</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex z-30 safe-area-inset-bottom">
        {[
          { to: '/rider/jobs',     icon: '📦', label: 'Jobs'     },
          { to: '/rider/earnings', icon: '💰', label: 'Earnings', active: true },
          { to: '/rider/profile',  icon: '👤', label: 'Profile'  },
        ].map(({ to, icon, label, active }) => (
          <Link key={to} to={to}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-bold transition-colors ${active ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'}`}>
            <span className="text-xl leading-none">{icon}</span>
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
