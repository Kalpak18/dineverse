import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getDashboardStats, getMenuItems, getAreas, getPublicSetting, toggleCafeOpen } from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import SetupWizard from '../../components/SetupWizard';
import CafeQRCard from '../../components/CafeQRCard';
import { Link, useNavigate } from 'react-router-dom';
import { STATUS_CONFIG } from '../../constants/statusConfig';
import { fmtToken, fmtCurrency } from '../../utils/formatters';
import toast from 'react-hot-toast';

// Setup checklist items (mirrors wizard steps, excludes optional "staff")
const CHECKLIST = [
  {
    id: 'profile',
    icon: '🎨',
    label: 'Upload logo & complete profile',
    route: '/owner/profile',
    wizardStep: 0,
    done: (s) => !!s.hasLogo,
  },
  {
    id: 'tax',
    icon: '🧾',
    label: 'Set GSTIN & tax details',
    route: '/owner/profile',
    wizardStep: 1,
    done: (s) => !!s.hasGSTIN,
  },
  {
    id: 'menu',
    icon: '🍽️',
    label: 'Add menu items',
    route: '/owner/menu',
    wizardStep: 2,
    done: (s) => s.hasMenuItems,
  },
  {
    id: 'tables',
    icon: '🪑',
    label: 'Set up tables & QR codes',
    route: '/owner/tables',
    wizardStep: 3,
    done: (s) => s.hasTables,
  },
  {
    id: 'live',
    icon: '🟢',
    label: 'Go live — toggle café Open',
    route: null,
    wizardStep: 5,
    done: (s) => s.isOpen,
  },
];

export default function DashboardPage() {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const navigate  = useNavigate();

  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showWizard, setShowWizard]   = useState(false);
  const [wizardStep, setWizardStep]   = useState(0);
  const [announcement, setAnnouncement] = useState(null);
  const [isOpen,   setIsOpen]   = useState(cafe?.is_open ?? true);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(
    () => !!localStorage.getItem(`dv_checklist_done_${cafe?.id}`)
  );
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(
    () => localStorage.getItem('dineverse_announcement_dismissed') || ''
  );

  // Derived setup status
  const [setupStatus, setSetupStatus] = useState({
    hasLogo:      false,
    hasGSTIN:     false,
    hasMenuItems: false,
    hasTables:    false,
    isOpen:       false,
  });

  const loadDashboard = useCallback(async () => {
    try {
      const [statsRes, itemsRes, areasRes, annRes] = await Promise.all([
        getDashboardStats(),
        getMenuItems(),
        getAreas().catch(() => ({ data: { areas: [] } })),
        getPublicSetting('announcement').catch(() => null),
      ]);

      setStats(statsRes.data);

      const tables   = (areasRes.data.areas || []).flatMap((a) => a.tables || []);
      const cafeOpen = statsRes.data?.cafe_is_open ?? cafe?.is_open ?? true;
      setIsOpen(cafeOpen);

      const status = {
        hasLogo:      !!cafe?.logo_url,
        hasGSTIN:     !!cafe?.gst_number,
        hasMenuItems: (itemsRes.data.items || []).length > 0,
        hasTables:    tables.length > 0,
        isOpen:       cafeOpen,
      };
      setSetupStatus(status);

      // Auto-open wizard on very first visit if menu is empty
      const firstVisitKey = `dv_wizard_seen_${cafe?.id}`;
      if (!localStorage.getItem(firstVisitKey) && (itemsRes.data.items || []).length === 0) {
        localStorage.setItem(firstVisitKey, '1');
        setShowWizard(true);
      }

      if (annRes?.data?.value?.active && annRes.data.value.text) {
        setAnnouncement(annRes.data.value);
      }
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [cafe?.id, cafe?.logo_url, cafe?.gst_number, cafe?.is_open]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const handleToggleOpen = async () => {
    setTogglingOpen(true);
    try {
      const res = await toggleCafeOpen();
      setIsOpen(res.data.is_open);
      setSetupStatus((prev) => ({ ...prev, isOpen: res.data.is_open }));
      toast.success(res.data.is_open ? 'Café is now Open 🟢' : 'Café is now Closed 🔴');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setTogglingOpen(false);
    }
  };

  const openWizardAt = (step) => {
    setWizardStep(step);
    setShowWizard(true);
  };

  const doneCount    = CHECKLIST.filter((c) => c.done(setupStatus)).length;
  const totalCount   = CHECKLIST.length;
  const allDone      = doneCount === totalCount;
  const showChecklist = !checklistDismissed || !allDone;

  const dismissChecklist = () => {
    if (allDone) {
      localStorage.setItem(`dv_checklist_done_${cafe?.id}`, '1');
      setChecklistDismissed(true);
    }
  };

  if (loading) return <LoadingSpinner />;

  const cafeUrl = `${window.location.origin}/cafe/${cafe?.slug}`;

  return (
    <>
      {showWizard && (
        <SetupWizard
          initialStep={wizardStep}
          onComplete={() => { setShowWizard(false); loadDashboard(); }}
        />
      )}

      <div className="space-y-6 max-w-4xl">

        {/* Platform announcement */}
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
            >×</button>
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
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm font-medium ${
              expired
                ? 'bg-red-50 border border-red-200 text-red-800'
                : 'bg-amber-50 border border-amber-200 text-amber-800'
            }`}>
              <span>
                {expired
                  ? '🔴 Your subscription has expired. Renew to continue using all features.'
                  : `⚠️ Your ${cafe.plan_type === 'free_trial' ? 'free trial' : 'plan'} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`
                }
              </span>
              <Link to="/owner/billing" className="flex-shrink-0 underline font-semibold">Renew →</Link>
            </div>
          );
        })()}

        {/* ── SETUP CHECKLIST ── */}
        {showChecklist && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center text-lg">🚀</div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">
                    {allDone ? 'Setup complete!' : 'Get your café ready'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {allDone ? 'Your café is fully configured' : `${doneCount} of ${totalCount} steps done`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!allDone && (
                  <button
                    onClick={() => {
                      const firstPending = CHECKLIST.findIndex((c) => !c.done(setupStatus));
                      openWizardAt(firstPending >= 0 ? firstPending : 0);
                    }}
                    className="text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Setup Guide →
                  </button>
                )}
                {allDone && (
                  <button
                    onClick={dismissChecklist}
                    className="text-xs text-gray-400 hover:text-gray-600 font-medium"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100">
              <div
                className="h-1.5 bg-brand-500 transition-all duration-500"
                style={{ width: `${(doneCount / totalCount) * 100}%` }}
              />
            </div>

            {/* Checklist items */}
            <div className="divide-y divide-gray-50">
              {CHECKLIST.map((item) => {
                const done = item.done(setupStatus);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                      done ? 'opacity-60' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Check circle */}
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      done ? 'bg-green-500 border-green-500' : 'border-gray-300'
                    }`}>
                      {done && <span className="text-white text-[11px] font-bold">✓</span>}
                    </div>

                    {/* Label */}
                    <span className={`text-sm flex-1 ${done ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                      {item.icon} {item.label}
                    </span>

                    {/* Action */}
                    {!done && (
                      item.route ? (
                        <button
                          onClick={() => openWizardAt(item.wizardStep)}
                          className="text-xs text-brand-600 font-semibold hover:underline flex-shrink-0"
                        >
                          How? →
                        </button>
                      ) : (
                        <button
                          onClick={handleToggleOpen}
                          disabled={togglingOpen}
                          className="text-xs text-green-600 font-semibold hover:underline flex-shrink-0"
                        >
                          {togglingOpen ? '...' : 'Open now →'}
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Link
              to="/owner/profile"
              className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit Profile
            </Link>
            <button
              onClick={handleToggleOpen}
              disabled={togglingOpen}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                isOpen
                  ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                  : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              }`}
            >
              {togglingOpen ? '...' : isOpen ? '🟢 Open' : '🔴 Closed'}
            </button>
          </div>
        </div>

        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Good day!</h2>
            <p className="text-gray-500 text-sm mt-0.5">Here's how you're doing today.</p>
          </div>
          <button
            onClick={() => openWizardAt(0)}
            className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 border border-gray-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <span>📖</span> Setup Guide
          </button>
        </div>

        {/* QR / Link share */}
        <CafeQRCard url={cafeUrl} cafeName={cafe?.name} />

        {/* Today stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Today's Orders" value={stats?.today?.total_orders || 0} icon="📋" color="blue" />
          <StatCard label="Collected Revenue" value={c(stats?.today?.total_revenue || 0)} icon="💰" color="green" />
          <StatCard
            label="Pending"
            value={stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0}
            icon="⏳"
            color={(stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0) > 0 ? 'red' : 'yellow'}
            href="/owner/orders"
            pulse={(stats?.statusBreakdown?.find((s) => s.status === 'pending')?.count || 0) > 0}
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
              <div className="text-center py-6">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-gray-400 text-sm">No orders yet today.</p>
                <p className="text-xs text-gray-400 mt-1">Share your café link to start receiving orders.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats?.recentOrders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <span className="font-medium text-gray-800">{fmtToken(order.daily_order_number || order.order_number, order.order_type)}</span>
                      <span className="text-gray-400 ml-2">{order.customer_name} · {order.table_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c(order.total_amount)}</span>
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
              <div className="text-center py-6">
                <p className="text-3xl mb-2">🍽️</p>
                <p className="text-gray-400 text-sm">No sales data yet.</p>
                <Link to="/owner/menu" className="text-xs text-brand-600 hover:underline mt-1 block">Add menu items →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {stats?.topItems?.map((item, i) => (
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
        </div>

      </div>
    </>
  );
}

function StatCard({ label, value, icon, color, href, pulse }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    orange: 'bg-orange-50 text-orange-600',
    red:    'bg-red-50 text-red-600',
  };
  const inner = (
    <>
      <div className={`w-10 h-10 rounded-lg ${colors[color] || colors.blue} flex items-center justify-center text-xl mb-3 relative`}>
        {icon}
        {pulse && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />}
      </div>
      <p className={`text-2xl font-bold ${color === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {href && pulse && <p className="text-xs text-red-500 font-medium mt-1">Needs action →</p>}
    </>
  );
  if (href) return <Link to={href} className="card hover:shadow-md transition-shadow">{inner}</Link>;
  return <div className="card">{inner}</div>;
}
