import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { loadOrders } from '../utils/cafeOrderStorage';
import { loadReservations } from '../utils/cafeReservationStorage';
import { loadVisited } from '../utils/visitedCafes';
import { getNotifications, getUnreadCount, markAllRead, clearNotifications } from '../utils/customerNotifications';

function HomeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21V12h6v9" />
    </svg>
  );
}
function OrdersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
function BookingsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" />
      <line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" />
      <line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" />
    </svg>
  );
}
function VisitedIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function BellIcon({ filled = false }) {
  return (
    <svg className="w-5 h-5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

const ICON_MAP = { order: '📋', reservation: '📅', waitlist: '🪑', info: 'ℹ️' };

export default function CustomerBottomNav() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeOrderCount, setActiveOrderCount]   = useState(0);
  const [activeBkCount, setActiveBkCount]         = useState(0);
  const [alertsOpen, setAlertsOpen]               = useState(false);
  const [visitedOpen, setVisitedOpen]             = useState(false);
  const [visited, setVisited]                     = useState([]);
  const [notifications, setNotifications]         = useState([]);
  const [unreadCount, setUnreadCount]             = useState(0);

  // Flash state for the top bell bubble — animates on new notification
  const [bellFlash, setBellFlash]                 = useState(false);
  const bellFlashTimer                            = useRef(null);

  // Refresh badge counts whenever route changes
  useEffect(() => {
    const orders = loadOrders(slug);
    setActiveOrderCount(orders.filter((o) => !['paid', 'cancelled'].includes(o.status)).length);
    const res = loadReservations(slug);
    setActiveBkCount(res.filter((r) => ['pending', 'confirmed'].includes(r.status)).length);
    setUnreadCount(getUnreadCount(slug));
  }, [slug, location.pathname]);

  // Listen for new notifications pushed from socket handlers
  useEffect(() => {
    const handler = (e) => {
      if (!slug || e.detail?.slug !== slug) return;
      const count = getUnreadCount(slug);
      setUnreadCount(count);
      if (alertsOpen) setNotifications(getNotifications(slug));
      // Animate the bell bubble
      setBellFlash(true);
      clearTimeout(bellFlashTimer.current);
      bellFlashTimer.current = setTimeout(() => setBellFlash(false), 3000);
    };
    window.addEventListener('customer:notification', handler);
    return () => {
      window.removeEventListener('customer:notification', handler);
      clearTimeout(bellFlashTimer.current);
    };
  }, [slug, alertsOpen]);

  const openAlerts = () => {
    setNotifications(getNotifications(slug));
    setAlertsOpen(true);
    setBellFlash(false);
    markAllRead(slug);
    setUnreadCount(0);
  };

  const openVisited = () => {
    setVisited(loadVisited());
    setVisitedOpen(true);
  };

  const path = location.pathname;
  const isHome     = path === `/cafe/${slug}` || path === `/cafe/${slug}/menu` || path === `/cafe/${slug}/cart`;
  const isOrders   = path === `/cafe/${slug}/my-orders` && !location.search.includes('tab=reservations');
  const isBookings = path === `/cafe/${slug}/my-orders` && location.search.includes('tab=reservations');
  const isAlerts   = alertsOpen;

  const Tab = ({ active, onClick, icon, label, badge }) => (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors relative ${
        active ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      <div className="relative">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </div>
      <span className={`text-[10px] font-medium leading-none ${active ? 'font-semibold' : ''}`}>{label}</span>
      {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand-500 rounded-full" />}
    </button>
  );

  // Full-screen page shared header
  const PageHeader = ({ title, onBack, actions }) => (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white flex-shrink-0">
      <button onClick={onBack} className="p-1 -ml-1 text-gray-500 hover:text-gray-800 transition-colors rounded-lg">
        <ChevronLeft />
      </button>
      <h2 className="flex-1 font-bold text-gray-900 text-base">{title}</h2>
      {actions}
    </div>
  );

  return (
    <>
      {/* ── Instagram-style top bell bubble ── */}
      {unreadCount > 0 && !alertsOpen && (
        <button
          onClick={openAlerts}
          className={`fixed top-3 right-3 z-40 flex items-center gap-1.5 bg-white border shadow-lg rounded-full px-3 py-1.5 transition-all ${
            bellFlash ? 'scale-110 border-brand-400 shadow-brand-100' : 'border-gray-200'
          }`}
          style={{ animation: bellFlash ? 'none' : undefined }}
        >
          <span className={`text-brand-600 ${bellFlash ? 'animate-bounce' : ''}`}>
            <BellIcon filled />
          </span>
          <span className="text-xs font-bold text-brand-600">{unreadCount > 9 ? '9+' : unreadCount}</span>
        </button>
      )}

      {/* ── Bottom nav bar ── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 flex items-stretch"
        style={{ height: 60, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Tab active={isHome}     onClick={() => navigate(`/cafe/${slug}`)}           icon={<HomeIcon />}    label="Café"     />
        <Tab active={isOrders}   onClick={() => navigate(`/cafe/${slug}/my-orders`)} icon={<OrdersIcon />}  label="Orders"   badge={activeOrderCount} />
        <Tab active={isBookings} onClick={() => navigate(`/cafe/${slug}/my-orders?tab=reservations`)} icon={<BookingsIcon />} label="Bookings" badge={activeBkCount} />
        <Tab active={isAlerts}   onClick={openAlerts}  icon={<BellIcon />} label="Alerts"  badge={unreadCount} />
        <Tab active={visitedOpen} onClick={openVisited} icon={<VisitedIcon />} label="Visited" />
      </nav>

      {/* ── Alerts — full screen page ── */}
      {alertsOpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <PageHeader
            title="Alerts"
            onBack={() => setAlertsOpen(false)}
            actions={
              notifications.length > 0 ? (
                <button
                  onClick={() => { clearNotifications(slug); setNotifications([]); }}
                  className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors px-2 py-1"
                >
                  Clear all
                </button>
              ) : null
            }
          />
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6 text-center">
                <span className="text-6xl mb-4">🔔</span>
                <p className="font-semibold text-gray-500">No alerts yet</p>
                <p className="text-sm mt-1">Order updates, table confirmations and waitlist calls will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map((n) => {
                  const timeStr = new Date(n.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                  const dateStr = new Date(n.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                  const isToday = new Date(n.timestamp).toDateString() === new Date().toDateString();
                  return (
                    <div key={n.id} className={`px-5 py-4 flex items-start gap-3 ${n.read ? '' : 'bg-brand-50/40'}`}>
                      <span className="text-2xl flex-shrink-0 mt-0.5">{ICON_MAP[n.type] || '🔔'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                        <p className="text-[10px] text-gray-300 mt-1.5">{isToday ? timeStr : `${dateStr} · ${timeStr}`}</p>
                      </div>
                      {!n.read && <span className="w-2.5 h-2.5 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Bottom padding so last item isn't hidden behind the nav bar */}
          <div style={{ height: 60 }} />
        </div>
      )}

      {/* ── Visited Cafés — full screen page ── */}
      {visitedOpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <PageHeader title="Visited Cafés" onBack={() => setVisitedOpen(false)} />
          <div className="overflow-y-auto flex-1">
            {visited.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6 text-center">
                <span className="text-6xl mb-4">🗺️</span>
                <p className="font-semibold text-gray-500">No visited cafés yet</p>
                <p className="text-sm mt-1">Places you visit will appear here for quick access.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visited.map((v) => (
                  <Link
                    key={v.slug}
                    to={`/cafe/${v.slug}`}
                    onClick={() => setVisitedOpen(false)}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    {v.logo_url ? (
                      <img src={v.logo_url} alt={v.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-gray-100" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0 text-brand-600 font-bold text-lg">
                        {v.name?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{v.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">/{v.slug}</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div style={{ height: 60 }} />
        </div>
      )}
    </>
  );
}
