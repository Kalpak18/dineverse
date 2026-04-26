import { Outlet, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BadgeProvider, useBadges } from '../context/BadgeContext';
import { getOutlets, switchOutlet, toggleCafeOpen } from '../services/api';
import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import NotificationCenter from './NotificationCenter';
import NavIcon from './NavIcon';

// All nav items — filtered by role below
const ALL_NAV = [
  { to: '/owner/dashboard',    label: 'Dashboard',    icon: 'dashboard',    roles: ['owner', 'manager'] },
  { to: '/owner/orders',       label: 'Orders',       icon: 'orders',       roles: ['owner', 'manager', 'cashier'] },
  { to: '/owner/messages',     label: 'Messages',     icon: 'messages',     roles: ['owner', 'manager', 'cashier'] },
  { to: '/owner/kitchen',      label: 'Kitchen',      icon: 'kitchen',      roles: ['owner', 'manager', 'cashier', 'kitchen'] },
  { to: '/owner/menu',         label: 'Menu',         icon: 'menu',         roles: ['owner', 'manager'] },
  { to: '/owner/offers',       label: 'Offers',       icon: 'offers',       roles: ['owner', 'manager'] },
  { to: '/owner/reservations', label: 'Reservations', icon: 'reservations', roles: ['owner', 'manager', 'cashier'] },
  { to: '/owner/ratings',      label: 'Ratings',      icon: 'ratings',      roles: ['owner', 'manager'] },
  { to: '/owner/analytics',    label: 'Analytics',    icon: 'analytics',    roles: ['owner', 'manager'] },
  { to: '/owner/staff',        label: 'Staff',        icon: 'staff',        roles: ['owner'] },
  { to: '/owner/tables',       label: 'Tables',       icon: 'tables',       roles: ['owner', 'manager'] },
  { to: '/owner/inventory',    label: 'Inventory',    icon: 'inventory',    roles: ['owner', 'manager'] },
  { to: '/owner/customers',    label: 'Customers',    icon: 'customers',    roles: ['owner', 'manager'] },
  { to: '/owner/waitlist',     label: 'Waitlist',     icon: 'waitlist',     roles: ['owner', 'manager', 'cashier'] },
  { to: '/owner/schedule',     label: 'Schedule',     icon: 'schedule',     roles: ['owner', 'manager'] },
  { to: '/owner/billing',      label: 'Billing',      icon: 'billing',      roles: ['owner'] },
  { to: '/owner/help',         label: 'Help',         icon: 'help',         roles: ['owner', 'manager'] },
];

const ROLE_BADGE = {
  cashier: { label: 'Cashier',  cls: 'bg-blue-100 text-blue-700' },
  kitchen: { label: 'Kitchen',  cls: 'bg-orange-100 text-orange-700' },
  manager: { label: 'Manager',  cls: 'bg-purple-100 text-purple-700' },
};

// Always accessible even when subscription expired (owner only)
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
  return (
    <BadgeProvider>
      <OwnerLayoutInner />
    </BadgeProvider>
  );
}

function OwnerLayoutInner() {
  const { badges } = useBadges();
  const { cafe, role, staffRole, staffInfo, logout, updateCafe } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [outlets, setOutlets]         = useState([]);
  const [outletOpen, setOutletOpen]   = useState(false);
  const [switching, setSwitching]     = useState(false);
  const [isOpen, setIsOpen]           = useState(cafe?.is_open ?? true);
  const [togglingOpen, setTogglingOpen] = useState(false);

  // Sync local isOpen whenever AuthContext cafe.is_open changes (e.g. toggled from Dashboard)
  useEffect(() => { setIsOpen(cafe?.is_open ?? true); }, [cafe?.is_open]);
  const [collapsed, setCollapsed]     = useState(
    () => localStorage.getItem('dv_sidebar_collapsed') === 'true'
  );

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem('dv_sidebar_collapsed', String(next));
      return next;
    });
  };

  const isStaff    = role === 'STAFF';
  const effectiveRole = isStaff ? (staffRole || 'cashier') : 'owner';

  // Only load outlets for owners
  useEffect(() => {
    if (!isStaff) {
      getOutlets().then(({ data }) => setOutlets(data.outlets || [])).catch(() => {});
    }
  }, [cafe?.id, isStaff]);

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

  const handleToggleOpen = async () => {
    setTogglingOpen(true);
    try {
      const res = await toggleCafeOpen();
      setIsOpen(res.data.is_open);
      updateCafe({ is_open: res.data.is_open });
      toast.success(res.data.is_open ? 'Café is now Open 🟢' : 'Café is now Closed 🔴');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setTogglingOpen(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/owner/login');
  };

  const expired     = !isStaff && isExpired(cafe);
  const remaining   = !isStaff ? daysLeft(cafe) : null;
  const pageAllowed = !expired || ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    const handle = () => navigate('/owner/billing');
    window.addEventListener('subscription:expired', handle);
    return () => window.removeEventListener('subscription:expired', handle);
  }, [navigate]);

  // Filter nav by role
  const visibleNav = ALL_NAV.filter((item) => item.roles.includes(effectiveRole));

  // Avatar: logo image or first-letter fallback
  const Avatar = ({ size = 'md' }) => {
    const cls = size === 'lg'
      ? 'w-14 h-14 rounded-xl text-2xl'
      : size === 'sm'
      ? 'w-9 h-9 rounded-lg text-base'
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
          ${collapsed ? 'md:w-16' : 'w-64'}
          bg-white border-r border-gray-200 flex flex-col transition-all duration-200 overflow-hidden`}
      >
        {/* Brand + profile header */}
        <div className={`pt-4 pb-3 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'px-2' : 'px-4 space-y-3'}`}>
          {collapsed ? (
            /* Collapsed: show avatar/icon only + open/close dot */
            <div className="flex flex-col items-center gap-2">
              {isStaff ? (
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600">
                  <NavIcon name={effectiveRole === 'kitchen' ? 'chef' : effectiveRole === 'cashier' ? 'cashier' : 'manager'} className="w-5 h-5" />
                </div>
              ) : (
                <div className="relative">
                  <NavLink to="/owner/profile" onClick={() => setMobileOpen(false)} title={cafe?.name}>
                    <Avatar size="sm" />
                  </NavLink>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isOpen ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
              )}
              {!isStaff && (
                <button
                  onClick={handleToggleOpen}
                  disabled={togglingOpen}
                  role="switch"
                  aria-checked={isOpen}
                  title={isOpen ? 'Open — click to close' : 'Closed — click to open'}
                  style={{ width: 36, height: 20 }}
                  className={`relative rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none ${isOpen ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span
                    style={{
                      width: 14, height: 14,
                      transform: isOpen ? 'translateX(18px)' : 'translateX(3px)',
                      top: 3, position: 'absolute',
                      transition: 'transform 200ms',
                    }}
                    className="rounded-full bg-white shadow block"
                  />
                </button>
              )}
            </div>
          ) : (
            /* Expanded: full header */
            <>
              {isStaff ? (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-600">
                    <NavIcon name={effectiveRole === 'kitchen' ? 'chef' : effectiveRole === 'cashier' ? 'cashier' : 'manager'} className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate text-sm">
                      {staffInfo?.name || 'Staff'}
                    </p>
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_BADGE[effectiveRole]?.cls || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_BADGE[effectiveRole]?.label || effectiveRole}
                    </span>
                    <span className="text-[11px] text-gray-400 ml-1">· {cafe?.name}</span>
                  </div>
                </div>
              ) : (
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
                  <NavIcon name="profile" className="w-4 h-4 flex-shrink-0 text-gray-300 group-hover:text-brand-400" />
                </NavLink>
              )}

              {/* Open/Closed toggle — owner only */}
              {!isStaff && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${isOpen ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOpen ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className={`text-xs font-semibold ${isOpen ? 'text-green-800' : 'text-red-700'}`}>
                      {togglingOpen ? 'Updating…' : isOpen ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={handleToggleOpen}
                    disabled={togglingOpen}
                    role="switch"
                    aria-checked={isOpen}
                    style={{ width: 36, height: 20 }}
                    className={`relative rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none ${isOpen ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span
                      style={{
                        width: 14, height: 14,
                        transform: isOpen ? 'translateX(18px)' : 'translateX(3px)',
                        top: 3, position: 'absolute',
                        transition: 'transform 200ms',
                      }}
                      className="rounded-full bg-white shadow block"
                    />
                  </button>
                </div>
              )}

              {/* Outlet dropdown (owner only) */}
              {!isStaff && outlets.length > 1 && (
                <div className="relative mt-2">
                  <button
                    onClick={() => setOutletOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs text-gray-600 font-medium transition-colors"
                  >
                    <span>{outlets.find((o) => o.id === cafe?.id)?.parent_cafe_id ? 'Outlet' : 'Main branch'}</span>
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
            </>
          )}
        </div>

        {/* Nav — scrollable */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
          {visibleNav.map((item) => {
            const badgeCount = badges[item.to] || 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg text-sm font-medium transition-colors ${
                    collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <div className="relative flex-shrink-0">
                  <NavIcon name={item.icon} />
                  {collapsed && badgeCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {badgeCount > 0 && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom: Profile (owner only) + Logout + Collapse toggle */}
        <div className={`pb-3 pt-2 border-t border-gray-100 flex-shrink-0 space-y-0.5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
          {!isStaff && (
            <NavLink
              to="/owner/profile"
              onClick={() => setMobileOpen(false)}
              title={collapsed ? 'Profile' : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <NavIcon name="profile" />
              {!collapsed && <span>Profile</span>}
            </NavLink>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`w-full flex items-center rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors ${
              collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
            }`}
          >
            <NavIcon name="logout" />
            {!collapsed && <span>Logout</span>}
          </button>

          {/* Collapse toggle — desktop only */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden md:flex w-full items-center rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors ${
              collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'
            }`}
          >
            <svg className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Expired: dim non-essential nav links (owner only) */}
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
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top bar (mobile) — fixed so it never scrolls away on iOS Safari */}
        <header className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">

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
            <span className="font-semibold text-gray-800 text-sm">
              {isStaff ? (staffInfo?.name || 'Staff') : cafe?.name}
            </span>
            {isStaff && (
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_BADGE[effectiveRole]?.cls || ''}`}>
                {ROLE_BADGE[effectiveRole]?.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 relative">
            {!isStaff && (
              <button
                onClick={handleToggleOpen}
                disabled={togglingOpen}
                title={isOpen ? 'Open — tap to close' : 'Closed — tap to open'}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  isOpen ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${isOpen ? 'bg-green-500' : 'bg-red-500'}`} />
                {isOpen ? 'Open' : 'Closed'}
              </button>
            )}
            {!isStaff && <NotificationCenter cafeId={cafe?.id} />}
            {!isStaff && (
              <NavLink to="/owner/profile" className="p-2 rounded-lg hover:bg-gray-100">
                <span className="text-gray-500 text-sm">⚙️</span>
              </NavLink>
            )}
          </div>
        </header>

        {/* Spacer so content doesn't hide under the fixed mobile header (≈57px tall) */}
        <div className="md:hidden h-[57px] flex-shrink-0" />

        {/* Expiry warning (owner only) */}
        {!isStaff && !expired && remaining !== null && remaining <= 7 && (
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

        {/* Notification bell — desktop, owner only */}
        {!isStaff && (
          <div className="hidden md:flex absolute top-4 right-4 z-50 items-center gap-2">
            <NotificationCenter cafeId={cafe?.id} />
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {pageAllowed ? (
            <Outlet />
          ) : (
            <Navigate to="/owner/billing" replace />
          )}
        </main>
      </div>
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
