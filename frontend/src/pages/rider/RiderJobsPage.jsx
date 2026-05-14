import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderGetJobs, riderUpdateJob, riderPingLocation } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { getApiError } from '../../utils/apiError';
import { fmtCurrency } from '../../utils/formatters';
import DeliveryMap from '../../components/DeliveryMap';

const STATUS_LABELS = {
  assigned:        { label: 'Assigned',    color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  picked_up:       { label: 'Picked up',   color: 'bg-blue-100 text-blue-700',     icon: '🥡' },
  out_for_delivery:{ label: 'On the way',  color: 'bg-purple-100 text-purple-700', icon: '🛵' },
  delivered:       { label: 'Delivered',   color: 'bg-green-100 text-green-700',   icon: '✅' },
  failed:          { label: 'Failed',      color: 'bg-red-100 text-red-700',       icon: '❌' },
};

const NEXT_STATUS = {
  assigned:         { next: 'picked_up',        label: '✓ Mark Picked Up'    },
  picked_up:        { next: 'out_for_delivery', label: '🛵 Out for Delivery'  },
  out_for_delivery: { next: 'delivered',        label: '✅ Mark Delivered'    },
};

// Build a Google Maps directions URL for turn-by-turn navigation
function mapsNavUrl(fromLat, fromLng, toLat, toLng, toAddr) {
  if (toLat && toLng) {
    const origin = fromLat && fromLng ? `&origin=${fromLat},${fromLng}` : '';
    return `https://www.google.com/maps/dir/?api=1${origin}&destination=${toLat},${toLng}&travelmode=driving`;
  }
  if (toAddr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toAddr)}`;
  return null;
}

export default function RiderJobsPage() {
  const { rider, logout, loading: authLoading } = useRiderAuth();
  const navigate = useNavigate();

  const [jobs,     setJobs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [updating, setUpdating] = useState(null);
  const [gpsOn,    setGpsOn]    = useState(false);
  const [lastPos,  setLastPos]  = useState(null);
  const [expandedMap, setExpandedMap] = useState(null); // job id with map open
  const [failModal, setFailModal] = useState(null); // job being failed
  const [failReason, setFailReason] = useState('Customer unreachable');
  const watchIdRef   = useRef(null);
  const pingTimerRef = useRef(null);

  const fmt = (n) => fmtCurrency(n, 'INR');

  useEffect(() => {
    if (!authLoading && !rider) navigate('/rider/login', { replace: true });
  }, [authLoading, rider, navigate]);

  const load = useCallback(async () => {
    try {
      const { data } = await riderGetJobs();
      setJobs(data.jobs || []);
    } catch (err) {
      if (err.response?.status !== 401) toast.error(getApiError(err));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (rider) load(); }, [rider, load]);

  useEffect(() => {
    if (!rider) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [rider, load]);

  // ── GPS sharing ──────────────────────────────────────────────────────────
  const stopGps = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = null;
    setGpsOn(false);
  }, []);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Your device does not support GPS'); return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => setLastPos({ lat: coords.latitude, lng: coords.longitude }),
      (err) => {
        toast.error(err.code === 1 ? 'Location permission denied' : 'GPS unavailable');
        stopGps();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setGpsOn(true);
    toast.success('GPS sharing on — customers can see your location');
  }, [stopGps]);

  useEffect(() => {
    if (!gpsOn || !lastPos) return;
    const ping = () => riderPingLocation(lastPos.lat, lastPos.lng).catch(() => {});
    ping();
    pingTimerRef.current = setInterval(ping, 10_000);
    return () => { if (pingTimerRef.current) clearInterval(pingTimerRef.current); };
  }, [gpsOn, lastPos]);

  useEffect(() => {
    if (gpsOn && jobs.length === 0) stopGps();
  }, [jobs.length, gpsOn, stopGps]);

  useEffect(() => () => stopGps(), [stopGps]);

  const advance = async (job) => {
    const target = NEXT_STATUS[job.delivery_status];
    if (!target) return;
    setUpdating(job.id);
    try {
      await riderUpdateJob(job.id, target.next);
      toast.success(`Marked ${target.next.replace(/_/g, ' ')}`);
      load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setUpdating(null); }
  };

  const confirmFailed = async () => {
    if (!failModal || !failReason.trim()) return;
    setUpdating(failModal.id);
    try {
      await riderUpdateJob(failModal.id, 'failed', failReason.trim());
      toast.success('Marked failed');
      setFailModal(null);
      setFailReason('Customer unreachable');
      load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setUpdating(null); }
  };

  const callPhone = (phone) => { if (phone) window.location.href = `tel:${phone}`; };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-9 h-9 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-gray-900 text-sm truncate">{rider?.name}</p>
            <p className="text-xs text-gray-400 truncate">{rider?.cafe_name}</p>
          </div>
          <button
            onClick={() => { logout(); navigate('/rider/login', { replace: true }); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2.5 py-1.5 rounded-xl hover:bg-red-50 transition-colors flex-shrink-0"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

        {/* ── GPS toggle ── */}
        <div className={`rounded-2xl border-2 p-4 flex items-center justify-between gap-3 transition-colors ${
          gpsOn ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
        }`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {gpsOn && <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse flex-shrink-0" />}
              <p className="font-bold text-sm text-gray-900">Location sharing</p>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {gpsOn
                ? lastPos ? `${lastPos.lat.toFixed(4)}, ${lastPos.lng.toFixed(4)}` : 'Getting GPS…'
                : 'Turn on while delivering'}
            </p>
          </div>
          <button
            onClick={gpsOn ? stopGps : startGps}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-colors flex-shrink-0 ${
              gpsOn ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'
            }`}
          >
            {gpsOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>

        {/* ── Job count heading ── */}
        <h2 className="text-sm font-bold text-gray-700 px-0.5">
          {jobs.length === 0 ? 'No active deliveries' : `${jobs.length} active ${jobs.length === 1 ? 'delivery' : 'deliveries'}`}
        </h2>

        {/* ── Empty state ── */}
        {jobs.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-3">🌴</div>
            <p className="font-semibold text-gray-700">All caught up</p>
            <p className="text-xs text-gray-400 mt-1">New jobs will appear here automatically.</p>
          </div>
        )}

        {/* ── Job cards ── */}
        {jobs.map((job) => {
          const badge    = STATUS_LABELS[job.delivery_status] || STATUS_LABELS.assigned;
          const target   = NEXT_STATUS[job.delivery_status];
          const fullAddr = [job.delivery_address, job.delivery_address2, job.delivery_city, job.delivery_zipcode].filter(Boolean).join(', ');
          const mapOpen  = expandedMap === job.id;

          // Navigation URLs
          const pickupNavUrl  = mapsNavUrl(null, null, job.cafe_lat, job.cafe_lng, job.cafe_address);
          const dropoffNavUrl = mapsNavUrl(job.cafe_lat, job.cafe_lng, job.delivery_lat, job.delivery_lng, fullAddr);

          return (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Card header */}
              <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-gray-100">
                <div>
                  <p className="font-bold text-gray-900">Order #{job.order_number}</p>
                  <p className="text-xs text-gray-400">{new Date(job.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${badge.color}`}>
                  {badge.icon} {badge.label}
                </span>
              </div>

              {/* Embedded map */}
              {job.cafe_lat && job.delivery_lat && (
                <>
                  {mapOpen ? (
                    <div className="relative">
                      <DeliveryMap
                        cafeLat={parseFloat(job.cafe_lat)}
                        cafeLng={parseFloat(job.cafe_lng)}
                        cafeLabel={job.cafe_name}
                        customerLat={parseFloat(job.delivery_lat)}
                        customerLng={parseFloat(job.delivery_lng)}
                        deliveryAddress={fullAddr}
                        driverLat={gpsOn ? lastPos?.lat : undefined}
                        driverLng={gpsOn ? lastPos?.lng : undefined}
                        height="220px"
                      />
                      {/* Open in Google Maps overlay */}
                      {dropoffNavUrl && (
                        <a
                          href={dropoffNavUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 bg-white rounded-xl shadow px-3 py-2 text-xs font-bold text-blue-600 border border-blue-100"
                        >
                          🗺️ Navigate
                        </a>
                      )}
                      <button
                        onClick={() => setExpandedMap(null)}
                        className="absolute top-2.5 right-2.5 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-600 text-sm font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setExpandedMap(job.id)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border-b border-brand-100"
                    >
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-brand-600"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                      View Route on Map
                    </button>
                  )}
                </>
              )}

              {/* Pickup section */}
              <div className="px-4 py-3 border-b border-gray-100 bg-orange-50/40">
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1.5">📦 Pick up from</p>
                <p className="text-sm font-bold text-gray-900">{job.cafe_name}</p>
                {job.cafe_address && <p className="text-xs text-gray-500 mt-0.5">{job.cafe_address}</p>}
                <div className="flex gap-2 mt-2.5">
                  {pickupNavUrl && (
                    <a
                      href={pickupNavUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold text-center transition-colors"
                    >
                      🗺️ Navigate to Café
                    </a>
                  )}
                  {job.cafe_phone && (
                    <button
                      onClick={() => callPhone(job.cafe_phone)}
                      className="flex-1 py-2 rounded-xl bg-white border border-orange-200 text-orange-700 text-xs font-semibold hover:bg-orange-50 transition-colors"
                    >
                      📞 Call Café
                    </button>
                  )}
                </div>
              </div>

              {/* Drop section */}
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1.5">🏠 Deliver to</p>
                <p className="text-sm font-bold text-gray-900">{job.customer_name}</p>
                {fullAddr && <p className="text-xs text-gray-500 mt-0.5">{fullAddr}</p>}
                {job.delivery_instructions && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-2">
                    📝 {job.delivery_instructions}
                  </p>
                )}
                <div className="flex gap-2 mt-2.5">
                  {dropoffNavUrl && (
                    <a
                      href={dropoffNavUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold text-center transition-colors"
                    >
                      🗺️ Navigate to Customer
                    </a>
                  )}
                  {job.delivery_phone && (
                    <button
                      onClick={() => callPhone(job.delivery_phone)}
                      className="flex-1 py-2 rounded-xl bg-white border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50 transition-colors"
                    >
                      📞 Call Customer
                    </button>
                  )}
                </div>
              </div>

              {/* Order items + total */}
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Order · {(job.items || []).length} item{(job.items || []).length !== 1 ? 's' : ''}
                </p>
                {(job.items || []).slice(0, 4).map((it, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600 py-0.5">
                    <span className="truncate">{it.name}</span>
                    <span className="flex-shrink-0 ml-3 font-medium">× {it.quantity}</span>
                  </div>
                ))}
                {(job.items || []).length > 4 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">+ {job.items.length - 4} more items</p>
                )}
                <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-500">Order total</span>
                  <span className="text-sm font-black text-gray-900">{fmt(job.final_amount)}</span>
                </div>
                {!job.payment_verified && job.payment_mode !== 'online' && (
                  <p className="text-xs text-red-600 font-bold mt-1.5 flex items-center gap-1">
                    ⚠️ Collect cash: {fmt(job.final_amount)}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="p-3 flex gap-2">
                {target ? (
                  <>
                    <button
                      onClick={() => advance(job)}
                      disabled={updating === job.id}
                      className="flex-1 py-3.5 rounded-2xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-bold text-sm transition-colors"
                    >
                      {updating === job.id ? 'Saving…' : target.label}
                    </button>
                    <button
                      onClick={() => { setFailModal(job); setFailReason('Customer unreachable'); }}
                      disabled={updating === job.id}
                      className="px-4 py-3.5 rounded-2xl border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold text-sm flex-shrink-0 transition-colors"
                    >
                      Failed
                    </button>
                  </>
                ) : (
                  <div className="flex-1 py-3 text-center text-sm text-gray-400 italic">No more actions</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Fail reason modal ── */}
      {failModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setFailModal(null)}>
          <div
            className="w-full max-w-lg mx-auto bg-white rounded-t-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-gray-900 mb-1">Mark delivery as failed</h3>
            <p className="text-xs text-gray-500 mb-3">Order #{failModal.order_number}</p>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Reason</label>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-300 mb-4"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="Why did this delivery fail?"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setFailModal(null)}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmFailed}
                disabled={!failReason.trim() || updating === failModal.id}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold text-sm transition-colors"
              >
                {updating === failModal.id ? 'Saving…' : 'Confirm Failed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
