import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { updateDriverLocation, getDriverOrderInfo } from '../../services/api';
import DeliveryMap from '../../components/DeliveryMap';

const PING_INTERVAL_MS = 10_000;

const DELIVERY_STATUS_LABELS = {
  pending:          'Pending',
  assigned:         'Assigned',
  picked_up:        'Picked Up',
  out_for_delivery: 'Out for Delivery',
  delivered:        'Delivered',
  failed:           'Failed',
};

export default function DriverTracking() {
  const { orderId, token } = useParams();
  const [order,   setOrder]   = useState(null);
  const [error,   setError]   = useState(null);
  const [sharing, setSharing] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const intervalRef = useRef(null);

  // Load order info on mount
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
    if (!navigator.geolocation) {
      setError('GPS not available on this device.');
      return;
    }
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
        <div className="bg-white rounded-2xl shadow p-8 text-center max-w-sm">
          <p className="text-4xl mb-3">🚫</p>
          <p className="text-gray-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const deliveredOrFailed = ['delivered', 'failed'].includes(order.delivery_status);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-orange-500 text-white px-4 py-5 shadow">
        <p className="text-xs font-medium opacity-80 uppercase tracking-wider">Driver Tracking</p>
        <h1 className="text-xl font-black mt-0.5">
          Order #{order.daily_order_number}
        </h1>
        <p className="text-sm opacity-90 mt-0.5">{order.customer_name}</p>
      </div>

      <div className="max-w-md mx-auto px-4 mt-4 space-y-4">

        {/* Status badge */}
        <div className="bg-white rounded-2xl shadow p-4 flex items-center gap-3">
          <span className="text-2xl">🛵</span>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Delivery Status</p>
            <p className="text-gray-900 font-bold">
              {DELIVERY_STATUS_LABELS[order.delivery_status] || order.delivery_status || 'Pending'}
            </p>
          </div>
        </div>

        {/* Delivery address */}
        {order.delivery_address && (
          <div className="bg-white rounded-2xl shadow p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Deliver To</p>
            <p className="text-gray-800 font-medium">{order.customer_name}</p>
            <p className="text-gray-600 text-sm">{order.delivery_address}</p>
            {order.delivery_phone && (
              <a
                href={`tel:${order.delivery_phone}`}
                className="inline-flex items-center gap-1.5 mt-2 text-orange-600 font-semibold text-sm"
              >
                📞 {order.delivery_phone}
              </a>
            )}
          </div>
        )}

        {/* Map — shows route from café to customer */}
        {order.cafe_lat && order.delivery_lat && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <DeliveryMap
              cafeLat={parseFloat(order.cafe_lat)}
              cafeLng={parseFloat(order.cafe_lng)}
              cafeLabel={order.cafe_name || 'Restaurant'}
              customerLat={parseFloat(order.delivery_lat)}
              customerLng={parseFloat(order.delivery_lng)}
              deliveryAddress={order.delivery_address}
              driverLat={lastPos?.lat}
              driverLng={lastPos?.lng}
              height="280px"
            />
          </div>
        )}

        {/* GPS sharing toggle */}
        {!deliveredOrFailed && (
          <div className="bg-white rounded-2xl shadow p-5 text-center">
            {sharing ? (
              <>
                <div className="flex items-center justify-center gap-2 text-green-600 font-semibold mb-1">
                  <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                  Sharing live location
                </div>
                {lastPos && (
                  <p className="text-xs text-gray-400 mb-3">
                    {lastPos.lat.toFixed(5)}, {lastPos.lng.toFixed(5)}
                  </p>
                )}
                <button
                  onClick={stopSharing}
                  className="w-full py-3 rounded-xl bg-red-50 text-red-600 font-bold border border-red-200 active:bg-red-100 transition"
                >
                  Stop Sharing
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-500 text-sm mb-3">
                  Share your live GPS so the customer can track their delivery.
                </p>
                <button
                  onClick={startSharing}
                  className="w-full py-3 rounded-xl bg-orange-500 text-white font-bold active:bg-orange-600 transition"
                >
                  Start Sharing Location
                </button>
              </>
            )}
          </div>
        )}

        {deliveredOrFailed && (
          <div className="bg-green-50 rounded-2xl p-4 text-center text-green-700 font-semibold">
            {order.delivery_status === 'delivered' ? '✅ Order delivered' : '❌ Delivery marked as failed'}
          </div>
        )}
      </div>
    </div>
  );
}
