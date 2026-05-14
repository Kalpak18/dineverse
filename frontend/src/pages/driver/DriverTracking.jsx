import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { updateDriverLocation, getDriverOrderInfo } from '../../services/api';
import DeliveryMap from '../../components/DeliveryMap';

const PING_INTERVAL_MS = 10_000;

const STATUS_CONFIG = {
  pending:          { label: 'Pending',         color: 'bg-gray-100 text-gray-600',    icon: '⏳' },
  assigned:         { label: 'Assigned',         color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  picked_up:        { label: 'Picked Up',        color: 'bg-blue-100 text-blue-700',    icon: '🥡' },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-purple-100 text-purple-700', icon: '🛵' },
  delivered:        { label: 'Delivered',        color: 'bg-green-100 text-green-700',  icon: '✅' },
  failed:           { label: 'Failed',           color: 'bg-red-100 text-red-700',      icon: '❌' },
};

export default function DriverTracking() {
  const { orderId, token } = useParams();
  const [order,   setOrder]   = useState(null);
  const [error,   setError]   = useState(null);
  const [sharing, setSharing] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    getDriverOrderInfo(orderId, token)
      .then(({ data }) => setOrder(data.order))
      .catch(() => setError('Invalid or expired tracking link.'));
  }, [orderId, token]);

  const sendPing = async (pos) => {
    try {
      await updateDriverLocation(orderId, token, pos.lat, pos.lng);
    } catch {
      // silent — will retry on next tick
    }
  };

  const startSharing = () => {
    if (!navigator.geolocation) { setError('GPS not available on this device.'); return; }
    setSharing(true);
    const pingOnce = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLastPos(loc);
          sendPing(loc);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };
    pingOnce();
    intervalRef.current = setInterval(pingOnce, PING_INTERVAL_MS);
  };

  const stopSharing = () => {
    setSharing(false);
    clearInterval(intervalRef.current);
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-lg p-8 text-center max-w-sm w-full">
          <p className="text-5xl mb-4">🚫</p>
          <p className="text-gray-800 font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-9 h-9 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const deliveredOrFailed = ['delivered', 'failed'].includes(order.delivery_status);
  const statusCfg = STATUS_CONFIG[order.delivery_status] || STATUS_CONFIG.pending;
  const hasMap = order.cafe_lat && order.delivery_lat;

  // Google Maps navigation URL (directions from café to customer)
  const navUrl = order.delivery_lat && order.delivery_lng
    ? `https://www.google.com/maps/dir/?api=1&origin=${order.cafe_lat},${order.cafe_lng}&destination=${order.delivery_lat},${order.delivery_lng}&travelmode=driving`
    : order.delivery_address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`
      : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-4 pt-5 pb-4 shadow-lg flex-shrink-0">
        <p className="text-[11px] font-semibold opacity-75 uppercase tracking-widest mb-0.5">Driver Tracking</p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black leading-tight">Order #{order.daily_order_number}</h1>
            <p className="text-sm opacity-85 mt-0.5">{order.customer_name}</p>
          </div>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${statusCfg.color}`}>
            {statusCfg.icon} {statusCfg.label}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Map */}
        {hasMap && (
          <div className="relative">
            <DeliveryMap
              cafeLat={parseFloat(order.cafe_lat)}
              cafeLng={parseFloat(order.cafe_lng)}
              cafeLabel={order.cafe_name || 'Restaurant'}
              customerLat={parseFloat(order.delivery_lat)}
              customerLng={parseFloat(order.delivery_lng)}
              deliveryAddress={order.delivery_address}
              driverLat={lastPos?.lat}
              driverLng={lastPos?.lng}
              height="300px"
            />
            {/* Navigate overlay button */}
            {navUrl && (
              <a
                href={navUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-3 right-3 flex items-center gap-2 bg-white rounded-2xl shadow-lg px-3 py-2.5 text-sm font-bold text-blue-600 border border-blue-100"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-600" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                Navigate
              </a>
            )}
          </div>
        )}

        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          {/* Delivery address card */}
          {order.delivery_address && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Deliver To</p>
              <p className="font-bold text-gray-900">{order.customer_name}</p>
              <p className="text-sm text-gray-600 mt-0.5">{order.delivery_address}</p>
              {order.delivery_instructions && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-2">
                  📝 {order.delivery_instructions}
                </p>
              )}
              <div className="flex gap-2 mt-3">
                {navUrl && (
                  <a
                    href={navUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold text-center transition-colors"
                  >
                    🗺️ Open Navigation
                  </a>
                )}
                {order.delivery_phone && (
                  <a
                    href={`tel:${order.delivery_phone}`}
                    className="flex-1 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold text-center hover:bg-gray-50 transition-colors"
                  >
                    📞 {order.delivery_phone}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* GPS sharing card */}
          {!deliveredOrFailed && (
            <div className={`bg-white rounded-2xl shadow-sm border-2 p-4 transition-colors ${
              sharing ? 'border-green-300' : 'border-gray-100'
            }`}>
              {sharing ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
                    <p className="font-bold text-green-700 text-sm">Sharing live location</p>
                  </div>
                  {lastPos && (
                    <p className="text-xs text-gray-400 font-mono mb-3">
                      {lastPos.lat.toFixed(5)}, {lastPos.lng.toFixed(5)}
                    </p>
                  )}
                  <button
                    onClick={stopSharing}
                    className="w-full py-3 rounded-xl bg-red-50 text-red-600 font-bold border border-red-200 active:bg-red-100 transition-colors"
                  >
                    Stop Sharing Location
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-3">
                    Share your live GPS so the customer can track their delivery on the map.
                  </p>
                  <button
                    onClick={startSharing}
                    className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold active:bg-orange-700 transition-colors"
                  >
                    📍 Start Sharing Location
                  </button>
                </>
              )}
            </div>
          )}

          {/* Terminal state banner */}
          {deliveredOrFailed && (
            <div className={`rounded-2xl p-4 text-center font-semibold text-sm ${
              order.delivery_status === 'delivered'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {order.delivery_status === 'delivered' ? '✅ Order delivered successfully' : '❌ Delivery marked as failed'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
