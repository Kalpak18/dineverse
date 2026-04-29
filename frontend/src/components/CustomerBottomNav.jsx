import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
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
function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

export default function CustomerBottomNav() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeOrderCount, setActiveOrderCount]   = useState(0);
  const [activeBkCount, setActiveBkCount]         = useState(0);
  const [visitedSheet, setVisitedSheet]            = useState(false);
  const [visited, setVisited]                      = useState([]);
  const [alertsSheet, setAlertsSheet]              = useState(false);
  const [notifications, setNotifications]          = useState([]);
  const [unreadCount, setUnreadCount]              = useState(0);

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
      setUnreadCount(getUnreadCount(slug));
      if (alertsSheet) setNotifications(getNotifications(slug));
    };
    window.addEventListener('customer:notification', handler);
    return () => window.removeEventListener('customer:notification', handler);
  }, [slug, alertsSheet]);

  const openVisited = () => {
    setVisited(loadVisited());
    setVisitedSheet(true);
  };

  const openAlerts = () => {
    const notifs = getNotifications(slug);
    setNotifications(notifs);
    setAlertsSheet(true);
    markAllRead(slug);
    setUnreadCount(0);
  };

  const path = location.pathname;
  const isHome     = path === `/cafe/${slug}` || path === `/cafe/${slug}/menu` || path === `/cafe/${slug}/cart`;
  const isOrders   = path === `/cafe/${slug}/my-orders` && !location.search.includes('tab=reservations');
  const isBookings = path === `/cafe/${slug}/my-orders` && location.search.includes('tab=reservations');
  const isAlerts   = alertsSheet;

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

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 flex items-stretch"
        style={{ height: 60, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Tab
          active={isHome}
          onClick={() => navigate(`/cafe/${slug}`)}
          icon={<HomeIcon />}
          label="Café"
        />
        <Tab
          active={isOrders}
          onClick={() => navigate(`/cafe/${slug}/my-orders`)}
          icon={<OrdersIcon />}
          label="Orders"
          badge={activeOrderCount}
        />
        <Tab
          active={isBookings}
          onClick={() => navigate(`/cafe/${slug}/my-orders?tab=reservations`)}
          icon={<BookingsIcon />}
          label="Bookings"
          badge={activeBkCount}
        />
        <Tab
          active={isAlerts}
          onClick={openAlerts}
          icon={<BellIcon />}
          label="Alerts"
          badge={unreadCount}
        />
        <Tab
          active={visitedSheet}
          onClick={openVisited}
          icon={<VisitedIcon />}
          label="Visited"
        />
      </nav>

      {/* Alerts sheet */}
      {alertsSheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setAlertsSheet(false)} />
          <div className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-bold text-gray-900">Alerts</h3>
              <div className="flex items-center gap-3">
                {notifications.length > 0 && (
                  <button
                    onClick={() => { clearNotifications(slug); setNotifications([]); }}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Clear all
                  </button>
                )}
                <button onClick={() => setAlertsSheet(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {notifications.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-4xl mb-2">🔔</p>
                  <p className="text-sm font-medium">No alerts yet</p>
                  <p className="text-xs mt-1">Order updates, table confirmations and waitlist calls will appear here</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {notifications.map((n) => {
                    const iconMap = { order: '📋', reservation: '📅', waitlist: '🪑', info: '🔔' };
                    const timeStr = new Date(n.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                    const dateStr = new Date(n.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const isToday = new Date(n.timestamp).toDateString() === new Date().toDateString();
                    return (
                      <div key={n.id} className={`px-5 py-3.5 flex items-start gap-3 ${n.read ? '' : 'bg-brand-50/40'}`}>
                        <span className="text-xl flex-shrink-0 mt-0.5">{iconMap[n.type] || '🔔'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                          <p className="text-[10px] text-gray-300 mt-1">{isToday ? timeStr : `${dateStr} · ${timeStr}`}</p>
                        </div>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Visited cafés sheet */}
      {visitedSheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setVisitedSheet(false)} />
          <div className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-bold text-gray-900">Visited Cafés</h3>
              <button onClick={() => setVisitedSheet(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {visited.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-3xl mb-2">🗺️</p>
                  <p className="text-sm font-medium">No visited cafés yet</p>
                  <p className="text-xs mt-1">Places you visit will appear here</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {visited.map((v) => (
                    <Link
                      key={v.slug}
                      to={`/cafe/${v.slug}`}
                      onClick={() => setVisitedSheet(false)}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      {v.logo_url ? (
                        <img src={v.logo_url} alt={v.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-gray-100" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0 text-brand-600 font-bold text-base">
                          {v.name?.charAt(0) || '?'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">{v.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">/{v.slug}</p>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
