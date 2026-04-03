/**
 * NotificationCenter — persistent action-required alerts for owners/staff.
 *
 * Banners stay on screen until the user explicitly dismisses them or
 * navigates to the relevant page (which counts as "actioned").
 *
 * Events listened to:
 *   new_order        → "New order received — needs confirmation"
 *   new_reservation  → "New reservation request — needs confirm/cancel"
 *   order_updated    → if status becomes 'ready' → "Order ready — notify customer"
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../utils/socketUrl';
import { useNavigate } from 'react-router-dom';
import { playNotificationSound } from '../hooks/useSocketIO';

let globalSocket = null; // reuse across mounts

const TYPE_CONFIG = {
  new_order: {
    icon: '🔔',
    bg: 'bg-orange-500',
    border: 'border-orange-600',
    label: 'New Order',
  },
  new_reservation: {
    icon: '📅',
    bg: 'bg-blue-600',
    border: 'border-blue-700',
    label: 'New Reservation',
  },
  order_ready: {
    icon: '✅',
    bg: 'bg-teal-600',
    border: 'border-teal-700',
    label: 'Order Ready',
  },
};

let idCounter = 0;
function nextId() { return ++idCounter; }

export default function NotificationCenter({ cafeId }) {
  const [alerts, setAlerts] = useState([]);
  const navigate = useNavigate();
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const addAlert = useCallback((type, message, actionLabel, actionPath, data = {}) => {
    // De-duplicate: if same type + same reference id already shown, skip
    if (data.id) {
      const dup = alertsRef.current.find((a) => a.refId === data.id && a.type === type);
      if (dup) return;
    }

    const alert = {
      id: nextId(),
      refId: data.id || null,
      type,
      message,
      actionLabel,
      actionPath,
      ts: new Date(),
    };

    setAlerts((prev) => [alert, ...prev].slice(0, 8)); // max 8 visible
    playNotificationSound();

    // For mobile / browser tab: update document title briefly
    const prevTitle = document.title;
    document.title = `🔔 ${TYPE_CONFIG[type]?.label || 'Alert'} — ${prevTitle}`;
    setTimeout(() => { document.title = prevTitle; }, 5000);
  }, []);

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const action = useCallback((alert) => {
    dismiss(alert.id);
    navigate(alert.actionPath);
  }, [dismiss, navigate]);

  useEffect(() => {
    if (!cafeId) return;

    if (!globalSocket) {
      globalSocket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['websocket', 'polling'],
      });
    }

    const socket = globalSocket;
    socket.emit('join_cafe', cafeId);

    const onConnect = () => socket.emit('join_cafe', cafeId);

    const onNewOrder = (order) => {
      addAlert(
        'new_order',
        `Order #${order.order_number ?? '—'} from ${order.customer_name ?? 'customer'} — ${order.order_type === 'takeaway' ? '🥡 Takeaway' : `Table ${order.table_number ?? ''}`}`,
        'View Orders',
        '/owner/orders',
        order
      );
    };

    const onNewReservation = (res) => {
      addAlert(
        'new_reservation',
        `${res.customer_name} wants to book for ${res.party_size} on ${res.reserved_date} at ${res.reserved_time?.slice(0, 5) ?? ''}`,
        'View Reservations',
        '/owner/reservations',
        res
      );
    };

    const onOrderUpdated = (order) => {
      if (order.status === 'ready') {
        addAlert(
          'order_ready',
          `Order #${order.order_number ?? '—'} is ready — ${order.order_type === 'takeaway' ? 'Pickup counter' : `Table ${order.table_number ?? ''}`}`,
          'View Kitchen',
          '/owner/kitchen',
          { id: `ready-${order.id}` }
        );
      }
    };

    socket.on('connect', onConnect);
    socket.on('new_order', onNewOrder);
    socket.on('new_reservation', onNewReservation);
    socket.on('order_updated', onOrderUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('new_order', onNewOrder);
      socket.off('new_reservation', onNewReservation);
      socket.off('order_updated', onOrderUpdated);
    };
  }, [cafeId, addAlert]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {alerts.map((alert) => {
        const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.new_order;
        const age = Math.round((new Date() - alert.ts) / 1000);
        return (
          <div
            key={alert.id}
            className={`${cfg.bg} ${cfg.border} border rounded-xl shadow-2xl text-white overflow-hidden`}
            style={{ animation: 'slideInRight 0.25s ease-out' }}
          >
            {/* Pulse bar at top */}
            <div className="h-1 bg-white/30 animate-pulse" />

            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-xl flex-shrink-0 mt-0.5">{cfg.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide opacity-80 mb-0.5">
                      {cfg.label} · {age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}
                    </p>
                    <p className="text-sm font-medium leading-snug">{alert.message}</p>
                  </div>
                </div>
                <button
                  onClick={() => dismiss(alert.id)}
                  className="text-white/60 hover:text-white text-lg leading-none flex-shrink-0 mt-0.5"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => action(alert)}
                  className="flex-1 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors border border-white/20"
                >
                  {alert.actionLabel} →
                </button>
                <button
                  onClick={() => dismiss(alert.id)}
                  className="px-3 py-1.5 rounded-lg text-white/70 hover:text-white text-xs transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Dismiss all button when 2+ alerts */}
      {alerts.length >= 2 && (
        <button
          onClick={() => setAlerts([])}
          className="text-xs text-gray-500 hover:text-gray-700 text-center py-1 bg-white/80 rounded-lg border border-gray-200 shadow"
        >
          Dismiss all ({alerts.length})
        </button>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
