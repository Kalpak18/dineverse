import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getDashboardStats, getMenuItems, getPublicSetting } from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import SetupWizard from '../../components/SetupWizard';
import { Link } from 'react-router-dom';
import { STATUS_CONFIG } from '../../constants/statusConfig';
import { fmtToken, fmtCurrency } from '../../utils/formatters';
import toast from 'react-hot-toast';

export default function DashboardPage() {
  const { cafe } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [announcement, setAnnouncement] = useState(null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(
    () => localStorage.getItem('dineverse_announcement_dismissed') || ''
  );

  useEffect(() => {
    Promise.all([
      getDashboardStats(),
      getMenuItems(),
      getPublicSetting('announcement').catch(() => null),
    ])
      .then(([statsRes, itemsRes, annRes]) => {
        setStats(statsRes.data);
        // Show wizard only once — if no menu items AND not already seen
        const wizardKey = `dineverse_setup_done_${cafe?.id}`;
        if (itemsRes.data.items.length === 0 && !localStorage.getItem(wizardKey)) {
          localStorage.setItem(wizardKey, '1');
          setShowWizard(true);
        }
        // Set announcement if active
        if (annRes?.data?.value?.active && annRes.data.value.text) {
          setAnnouncement(annRes.data.value);
        }
      })
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  if (loading) return <LoadingSpinner />;

  const cafeUrl = `${window.location.origin}/cafe/${cafe?.slug}`;

  return (
    <>
      {showWizard && <SetupWizard onComplete={() => setShowWizard(false)} />}
      <div className="space-y-6 max-w-4xl">

      {/* Platform announcement banner */}
      {announcement && dismissedAnnouncement !== announcement.text && (
        <div className={`rounded-xl px-4 py-3 flex items-start gap-3 text-sm border ${
          announcement.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
          announcement.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                                            'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <span className="text-base flex-shrink-0 mt-0.5">
            {announcement.type === 'warning' ? '⚠️' : announcement.type === 'success' ? '✅' : 'ℹ️'}
          </span>
          <span className="flex-1">{announcement.text}</span>
          <button
            onClick={() => {
              localStorage.setItem('dineverse_announcement_dismissed', announcement.text);
              setDismissedAnnouncement(announcement.text);
            }}
            className="flex-shrink-0 opacity-60 hover:opacity-100 font-bold text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Subscription warning */}
      {cafe?.plan_expiry_date && (() => {
        const daysLeft = Math.ceil(
          (new Date(cafe.plan_expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft > 7) return null;
        const expired = daysLeft <= 0;
        return (
          <div className={`rounded-xl px-4 py-3 flex items-center gap-3 text-sm font-medium ${
            expired
              ? 'bg-red-50 border border-red-200 text-red-800'
              : 'bg-amber-50 border border-amber-200 text-amber-800'
          }`}>
            <span className="text-lg">{expired ? '🔴' : '⚠️'}</span>
            <span>
              {expired
                ? 'Your subscription has expired. Renew now to continue using all features.'
                : `Your ${cafe.plan_type === 'free_trial' ? 'free trial' : 'plan'} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Renew to avoid interruption.`
              }
            </span>
          </div>
        );
      })()}

      {/* Profile header card */}
      <div className="card flex items-center gap-4">
        {cafe?.logo_url ? (
          <img
            src={cafe.logo_url}
            alt={cafe.name}
            className="w-16 h-16 rounded-xl object-cover border border-gray-200 flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-brand-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {cafe?.name?.charAt(0) || 'C'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{cafe?.name}</h1>
          <p className="text-xs text-gray-400 mt-0.5">/{cafe?.slug}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
              cafe?.plan_type === 'free_trial'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-green-100 text-green-700'
            }`}>
              {cafe?.plan_type === 'free_trial' ? '🧪 Free Trial' : '✅ Pro Plan'}
            </span>
            {cafe?.city && (
              <span className="text-xs text-gray-500">📍 {cafe.city}{cafe.state ? `, ${cafe.state}` : ''}</span>
            )}
          </div>
        </div>
        <Link
          to="/owner/profile"
          className="flex-shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Edit Profile
        </Link>
      </div>

      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Good day!</h1>
        <p className="text-gray-500 text-sm mt-1">Here's how you're doing today.</p>
      </div>

      {/* QR / Link share */}
      <div className="card bg-brand-50 border-brand-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-800">Your Customer Ordering Link</p>
            <p className="text-xs text-brand-600 mt-0.5 break-all">{cafeUrl}</p>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(cafeUrl); }}
            className="text-sm font-medium text-brand-700 bg-white border border-brand-300 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
          >
            Copy Link
          </button>
        </div>
      </div>

      {/* Today stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Today's Orders"
          value={stats?.today?.total_orders || 0}
          icon="📋"
          color="blue"
        />
        <StatCard
          label="Collected Revenue"
          value={fmtCurrency(stats?.today?.total_revenue || 0)}
          icon="💰"
          color="green"
        />
        <StatCard
          label="Pending"
          value={stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0}
          icon="⏳"
          color="yellow"
        />
        <StatCard
          label="Preparing"
          value={stats?.statusBreakdown?.find((s) => s.status === 'preparing')?.count || 0}
          icon="👨‍🍳"
          color="orange"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent orders */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Orders</h2>
            <Link to="/owner/orders" className="text-xs text-brand-600 hover:underline">View all</Link>
          </div>
          {stats?.recentOrders?.length === 0 ? (
            <p className="text-gray-400 text-sm">No orders yet today.</p>
          ) : (
            <div className="space-y-2">
              {stats?.recentOrders?.map((order) => (
                <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="font-medium text-gray-800">#{fmtToken(order.daily_order_number || order.order_number)}</span>
                    <span className="text-gray-400 ml-2">{order.customer_name} · {order.table_number}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{fmtCurrency(order.total_amount)}</span>
                    <span className={`badge ${STATUS_CONFIG[order.status]?.color}`}>{order.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top items */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Top Items (This Week)</h2>
          {stats?.topItems?.length === 0 ? (
            <p className="text-gray-400 text-sm">No data yet.</p>
          ) : (
            <div className="space-y-2">
              {stats?.topItems?.map((item, i) => (
                <div key={item.item_name} className="flex items-center gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 font-medium text-gray-800 truncate">{item.item_name}</span>
                  <span className="text-gray-400">{item.total_qty} sold</span>
                  <span className="font-medium text-gray-900">{fmtCurrency(item.total_revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

function StatCard({ label, value, icon, color }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="card">
      <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center text-xl mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
