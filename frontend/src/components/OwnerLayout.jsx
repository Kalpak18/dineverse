import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOutlets, switchOutlet } from '../services/api';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import NotificationCenter from './NotificationCenter';
import DineLogo from './DineLogo';

const navItems = [
  { to: '/owner/dashboard',    label: 'Dashboard',    icon: '📊' },
  { to: '/owner/orders',       label: 'Orders',       icon: '📋' },
  { to: '/owner/kitchen',      label: 'Kitchen',      icon: '🍳' },
  { to: '/owner/menu',         label: 'Menu',         icon: '🍽️' },
  { to: '/owner/offers',       label: 'Offers',       icon: '🏷️' },
  { to: '/owner/reservations', label: 'Reservations', icon: '📅' },
  { to: '/owner/ratings',      label: 'Ratings',      icon: '⭐' },
  { to: '/owner/analytics',    label: 'Analytics',    icon: '📈' },
  { to: '/owner/staff',        label: 'Staff',        icon: '👥' },
  { to: '/owner/tables',       label: 'Tables',       icon: '🪑' },
  { to: '/owner/inventory',    label: 'Inventory',    icon: '📦' },
  { to: '/owner/customers',    label: 'Customers',    icon: '🧑‍🤝‍🧑' },
  { to: '/owner/waitlist',     label: 'Waitlist',     icon: '🕐' },
  { to: '/owner/billing',      label: 'Billing',      icon: '💳' },
  { to: '/owner/help',         label: 'Help',         icon: '🎫' },
];

// Always accessible even when expired
const ALWAYS_ALLOWED = ['/owner/billing', '/owner/profile', '/owner/tables'];

function isExpired(cafe) {
  if (!cafe?.plan_expiry_date) return false;
  return new Date(cafe.plan_expiry_date) < new Date();
}

function daysLeft(cafe) {
  if (!cafe?.plan_expiry_date) return null;
  const diff = new Date(cafe.plan_expiry_date) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function OwnerLayout() {
  const { cafe, logout, updateCafe } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [outlets, setOutlets]       = useState([]);
  const [outletOpen, setOutletOpen] = useState(false);
  const [switching, setSwitching]   = useState(false);

  useEffect(() => {
    getOutlets().then(({ data }) => setOutlets(data.outlets || [])).catch(() => {});
  }, [cafe?.id]);

  const handleSwitchOutlet = async (id) => {
    if (id === cafe?.id) return;
    setSwitching(true);
    try {
      const { data } = await switchOutlet(id);
      localStorage.setItem('dineverse_token', data.token);
      window.location.href = '/owner/dashboard';
    } catch {
      toast.error('Could not switch outlet');
    } finally {
      setSwitching(false);
      setOutletOpen(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/owner/login');
  };

  const expired    = isExpired(cafe);
  const remaining  = daysLeft(cafe);
  const pageAllowed = !expired || ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    const handle = () => navigate('/owner/billing');
    window.addEventListener('subscription:expired', handle);
    return () => window.removeEventListener('subscription:expired', handle);
  }, [navigate]);

  // Avatar: logo image or first-letter fallback
  const Avatar = ({ size = 'md' }) => {
    const cls = size === 'lg'
      ? 'w-14 h-14 rounded-xl text-2xl'
      : 'w-10 h-10 rounded-lg text-lg';
    return cafe?.logo_url ? (
      <img
        src={cafe.logo_url}
        alt={cafe.name}
        className={`${cls} object-cover flex-shrink-0 border border-gray-200`}
      />
    ) : (
      <div className={`${cls} bg-brand-500 flex items-center justify-center text-white font-bold flex-shrink-0`}>
        {cafe?.name?.charAt(0) || 'C'}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Sidebar ── */}
      <aside
        className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 fixed md:static inset-y-0 left-0 z-40
          w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200`}
      >
        {/* DineVerse brand mark */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0 space-y-3">
          <DineLogo size="sm" />

          {/* Café profile link */}
          <NavLink
            to="/owner/profile"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 min-w-0 group"
          >
            <Avatar />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate text-sm group-hover:text-brand-600 transition-colors">
                {cafe?.name}
              </p>
              <p className="text-xs text-gray-400 truncate">/{cafe?.slug}</p>
            </div>
            <span className="text-gray-300 group-hover:text-brand-400 text-xs flex-shrink-0">⚙️</span>
          </NavLink>

          {/* Outlet dropdown */}
          {outlets.length > 1 && (
            <div className="relative mt-2">
              <button
                onClick={() => setOutletOpen((v) => !v)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs text-gray-600 font-medium transition-colors"
              >
                <span>🏪 {outlets.find((o) => o.id === cafe?.id)?.parent_cafe_id ? 'Outlet' : 'Main branch'}</span>
                <span className="text-gray-400">{outletOpen ? '▲' : '▼'}</span>
              </button>
              {outletOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  {outlets.map((o) => {
                    const isCurrent = o.id === cafe?.id;
                    return (
                      <button
                        key={o.id}
                        onClick={() => handleSwitchOutlet(o.id)}
                        disabled={isCurrent || switching}
                        className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                          isCurrent
                            ? 'bg-brand-50 text-brand-700 font-semibold cursor-default'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <span>{o.name}</span>
                        {isCurrent
                          ? <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full">Active</span>
                          : !o.parent_cafe_id
                            ? <span className="text-[10px] text-gray-400">Main</span>
                            : null
                        }
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav — scrollable so Profile always reachable */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Profile + Logout pinned at bottom */}
        <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex-shrink-0 space-y-0.5">
          <NavLink
            to="/owner/profile"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <span>⚙️</span> Profile
          </NavLink>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Expired: dim non-essential nav links */}
      {expired && (
        <style>{`
          nav a:not([href="/owner/billing"]):not([href="/owner/profile"]) {
            opacity: 0.4;
            pointer-events: none;
          }
        `}</style>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            {cafe?.logo_url
              ? <img src={cafe.logo_url} alt={cafe.name} className="w-6 h-6 rounded object-cover" />
              : null
            }
            <span className="font-semibold text-gray-800 text-sm">{cafe?.name}</span>
          </div>
          <NavLink to="/owner/profile" className="p-2 rounded-lg hover:bg-gray-100">
            <span className="text-gray-500 text-sm">⚙️</span>
          </NavLink>
        </header>

        {/* Expiry warning */}
        {!expired && remaining !== null && remaining <= 7 && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
            <p className="text-sm text-amber-800 font-medium">
              ⚠️ Your {cafe?.plan_type === 'free_trial' ? 'free trial' : 'subscription'} expires in{' '}
              <strong>{remaining} day{remaining !== 1 ? 's' : ''}</strong>. Renew to avoid interruption.
            </p>
            <button
              onClick={() => navigate('/owner/billing')}
              className="text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >
              Renew Now
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {pageAllowed ? (
            <Outlet />
          ) : (
            <SubscriptionExpiredWall
              cafe={cafe}
              onBilling={() => navigate('/owner/billing')}
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>

      {/* Persistent notification alerts */}
      <NotificationCenter cafeId={cafe?.id} />
    </div>
  );
}

// ─── Subscription Expired Wall ────────────────────────────────
function SubscriptionExpiredWall({ cafe, onBilling, onLogout }) {
  const expiredOn = cafe?.plan_expiry_date
    ? new Date(cafe.plan_expiry_date).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;
  const isTrial = cafe?.plan_type === 'free_trial';

  return (
    <div className="flex items-center justify-center min-h-full py-16 px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-5">
          <span className="text-4xl">🔒</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isTrial ? 'Your Free Trial Has Ended' : 'Subscription Expired'}
        </h2>
        <p className="text-gray-500 text-sm mb-1">
          {isTrial ? 'Your 30-day free trial expired' : 'Your yearly plan expired'}{' '}
          {expiredOn && <span>on <strong>{expiredOn}</strong></span>}.
        </p>
        <p className="text-gray-500 text-sm mb-6">
          Your data is safe — subscribe to pick up right where you left off.
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-6 text-left space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">What's paused</p>
          {[['📋','Orders'],['🍽️','Menu'],['📈','Analytics'],['👥','Staff']].map(([icon, text]) => (
            <div key={text} className="flex items-center gap-2 text-sm text-gray-600">
              <span>{icon}</span><span>{text} — locked while subscription is inactive</span>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-2 mt-2 flex items-center gap-2 text-sm text-green-700 font-medium">
            <span>✓</span><span>Profile & Billing — always accessible</span>
          </div>
        </div>
        <button onClick={onBilling} className="w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base transition-colors mb-3">
          🚀 Subscribe Now — ₹2,999/year
        </button>
        <button onClick={onLogout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Logout
        </button>
      </div>
    </div>
  );
}
