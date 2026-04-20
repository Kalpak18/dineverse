/**
 * NotificationCenter — persistent, DB-backed owner alerts.
 *
 * Lifecycle of a notification:
 *  1. Created on backend → persisted in DB → socket fires 'notification'
 *  2. On mount, fetches all unread from DB (catch-up after offline/refresh)
 *  3. Fresh socket events show a toast banner AND appear in the bell panel
 *  4. A notification disappears from the UI in exactly three ways:
 *       a. Owner navigates to the notification's related section (auto-dismiss)
 *       b. Owner clicks "View →" on a toast / panel entry (navigate + dismiss)
 *       c. Owner clicks "✕" / "Dismiss" on an individual notification
 *     → "Mark all read" in the panel is an explicit bulk-clear option
 *  5. Each dismiss is independent — acting on one notification never removes another.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../utils/socketUrl';
import { useNavigate, useLocation } from 'react-router-dom';
import { playNotificationSound } from '../hooks/useSocketIO';
import { getNotifications, markAllRead, markOneRead } from '../services/api';

let globalSocket = null;

const TYPE_CONFIG = {
  new_order:       { icon: '🔔', bg: 'bg-orange-500', border: 'border-orange-600', label: 'New Order',       path: '/owner/orders'       },
  new_reservation: { icon: '📅', bg: 'bg-blue-600',   border: 'border-blue-700',   label: 'New Reservation', path: '/owner/reservations' },
  order_ready:     { icon: '✅', bg: 'bg-teal-600',   border: 'border-teal-700',   label: 'Order Ready',     path: '/owner/kitchen'      },
  item_sold_out:   { icon: '⚠️', bg: 'bg-red-600',    border: 'border-red-700',    label: 'Sold Out',        path: '/owner/inventory'    },
  new_waitlist:    { icon: '🕐', bg: 'bg-purple-600', border: 'border-purple-700', label: 'Waitlist Join',   path: '/owner/waitlist'     },
};

// Which notification types to clear when arriving at a route
const ROUTE_CLEARS = {
  '/owner/orders':       ['new_order', 'order_ready'],
  '/owner/kitchen':      ['order_ready'],
  '/owner/reservations': ['new_reservation'],
  '/owner/inventory':    ['item_sold_out'],
  '/owner/waitlist':     ['new_waitlist'],
};

function requestBrowserNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function showBrowserNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try { new Notification(title, { body, icon: '/icons/favicon-96x96.png', tag: title }); } catch {}
}

export default function NotificationCenter({ cafeId }) {
  const [alerts, setAlerts]           = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen]     = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const seenIds   = useRef(new Set());

  // ── Load unread from DB on mount ───────────────────────────────────────
  useEffect(() => {
    if (!cafeId) return;
    requestBrowserNotifPermission();
    getNotifications()
      .then(({ data }) => {
        setUnreadCount(data.unread_count || 0);
        const unread = (data.notifications || []).filter((n) => !n.is_read);
        unread.forEach((n) => seenIds.current.add(n.id));
        setAlerts(unread.slice(0, 20).map((n) => dbToAlert(n, false)));
      })
      .catch(() => {});
  }, [cafeId]);

  // ── Socket: live notifications ─────────────────────────────────────────
  useEffect(() => {
    if (!cafeId) return;
    if (!globalSocket) {
      globalSocket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['polling', 'websocket'],
      });
    }
    const socket = globalSocket;
    socket.emit('join_cafe', cafeId);
    const onConnect = () => socket.emit('join_cafe', cafeId);

    const onNotification = (notif) => {
      if (notif.id && seenIds.current.has(notif.id)) return;
      if (notif.id) seenIds.current.add(notif.id);

      setAlerts((prev) => [dbToAlert(notif, true), ...prev].slice(0, 20));
      setUnreadCount((c) => c + 1);
      playNotificationSound();
      showBrowserNotif(notif.title, notif.body || '');

      if (document.hidden) {
        const prev = document.title;
        document.title = `🔔 ${notif.title}`;
        const restore = () => { document.title = prev; document.removeEventListener('visibilitychange', restore); };
        document.addEventListener('visibilitychange', restore);
      }
    };

    // Legacy socket events for backwards compat
    const onNewOrder = (order) => onNotification({
      id: null, type: 'new_order',
      title: `New order from ${order.customer_name ?? 'customer'}`,
      body: order.order_type === 'takeaway' ? 'Takeaway order' : `Table ${order.table_number ?? ''}`,
      ref_id: order.id,
    });
    const onOrderUpdated = (order) => {
      if (order.status === 'ready') onNotification({
        id: null, type: 'order_ready',
        title: `Order #${order.order_number ?? '—'} is ready`,
        body: order.order_type === 'takeaway' ? 'Pickup' : `Table ${order.table_number ?? ''}`,
        ref_id: order.id,
      });
    };

    socket.on('connect',       onConnect);
    socket.on('notification',  onNotification);
    socket.on('new_order',     onNewOrder);
    socket.on('order_updated', onOrderUpdated);

    const onLogout = () => {
      if (globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
      }
    };
    window.addEventListener('auth:logout', onLogout);

    return () => {
      socket.off('connect',       onConnect);
      socket.off('notification',  onNotification);
      socket.off('new_order',     onNewOrder);
      socket.off('order_updated', onOrderUpdated);
      window.removeEventListener('auth:logout', onLogout);
    };
  }, [cafeId]);

  // ── Auto-dismiss when owner navigates to the related section ───────────
  useEffect(() => {
    const typesToClear = ROUTE_CLEARS[location.pathname];
    if (!typesToClear) return;

    setAlerts((prev) => {
      const toRemove = prev.filter((a) => typesToClear.includes(a.type));
      if (toRemove.length === 0) return prev;
      // Mark each as read in DB
      toRemove.forEach((a) => { if (a.dbId) markOneRead(a.dbId).catch(() => {}); });
      setUnreadCount((c) => Math.max(0, c - toRemove.length));
      return prev.filter((a) => !typesToClear.includes(a.type));
    });
  }, [location.pathname]);

  // ── Per-notification dismiss ────────────────────────────────────────────
  const dismiss = useCallback((alert) => {
    setAlerts((prev) => prev.filter((a) => a.uid !== alert.uid));
    setUnreadCount((c) => Math.max(0, c - 1));
    if (alert.dbId) markOneRead(alert.dbId).catch(() => {});
  }, []);

  // ── Bulk clear ─────────────────────────────────────────────────────────
  const handleMarkAllRead = useCallback(() => {
    setAlerts([]);
    setUnreadCount(0);
    setPanelOpen(false);
    markAllRead().catch(() => {});
  }, []);

  // ── Navigate to section and dismiss that specific notification ──────────
  const goTo = useCallback((alert) => {
    dismiss(alert);
    setPanelOpen(false);
    navigate(TYPE_CONFIG[alert.type]?.path || '/owner/orders');
  }, [dismiss, navigate]);

  return (
    <>
      {/* ── Bell button ── */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Panel dropdown ── */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-[9990]" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-[9991] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="font-semibold text-gray-800 text-sm">Notifications</span>
              {alerts.length > 0 && (
                <button onClick={handleMarkAllRead} className="text-xs text-brand-600 hover:underline font-medium">
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {alerts.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No pending notifications</p>
              ) : (
                alerts.map((alert) => {
                  const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.new_order;
                  return (
                    <div key={alert.uid} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                      <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 leading-snug">{alert.title}</p>
                        {alert.body && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{alert.body}</p>}
                        <p className="text-[10px] text-gray-400 mt-1">{alert.age}</p>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => goTo(alert)}
                          className="text-[11px] text-brand-600 hover:underline font-medium whitespace-nowrap"
                        >
                          View →
                        </button>
                        <button
                          onClick={() => dismiss(alert)}
                          className="text-[11px] text-gray-400 hover:text-gray-600"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Toast banners (fresh live events only) ── */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
        {alerts.filter((a) => a.fresh).map((alert) => {
          const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.new_order;
          return (
            <div
              key={alert.uid}
              className={`${cfg.bg} ${cfg.border} border rounded-xl shadow-2xl text-white overflow-hidden pointer-events-auto cursor-pointer`}
              style={{ animation: 'slideInRight 0.25s ease-out' }}
              onClick={() => goTo(alert)}
            >
              <div className="h-1 bg-white/30 animate-pulse" />
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide opacity-80 mb-0.5">{cfg.label}</p>
                      <p className="text-sm font-medium leading-snug">{alert.title}</p>
                      {alert.body && <p className="text-xs opacity-80 mt-0.5">{alert.body}</p>}
                      <p className="text-xs opacity-60 mt-1">Tap to view →</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(alert); }}
                    className="text-white/60 hover:text-white text-lg leading-none flex-shrink-0 mt-0.5"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
let uidCounter = 0;

function dbToAlert(n, fresh) {
  const secs = Math.floor((Date.now() - new Date(n.created_at)) / 1000);
  const age  = secs < 60 ? `${secs}s ago`
             : secs < 3600 ? `${Math.floor(secs / 60)}m ago`
             : `${Math.floor(secs / 3600)}h ago`;
  return {
    uid:   ++uidCounter,
    dbId:  n.id || null,
    type:  n.type,
    title: n.title,
    body:  n.body || null,
    refId: n.ref_id || null,
    age,
    fresh,
  };
}
