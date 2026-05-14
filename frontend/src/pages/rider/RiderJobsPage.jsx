import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  riderGetJobs, riderUpdateJob, riderPingLocation,
  riderGetNearbyOrders, riderAcceptNearbyOrder,
  riderToggleAvailability, riderGetProfile,
} from '../../services/api';
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
  assigned:         { next: 'picked_up',        label: '✓ Mark Picked Up'   },
  picked_up:        { next: 'out_for_delivery', label: '🛵 Out for Delivery' },
  out_for_delivery: { next: 'delivered',        label: '✅ Mark Delivered'   },
};

function mapsNavUrl(toLat, toLng, toAddr) {
  if (toLat && toLng) return `https://www.google.com/maps/dir/?api=1&destination=${toLat},${toLng}&travelmode=driving`;
  if (toAddr)         return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toAddr)}`;
  return null;
}

export default function RiderJobsPage() {
  const { rider, logout, loading: authLoading } = useRiderAuth();
  const navigate = useNavigate();

  const [tab,      setTab]      = useState('active');  // 'active' | 'nearby'
  const [jobs,     setJobs]     = useState([]);
  const [nearby,   setNearby]   = useState([]);
  const [profile,  setProfile]  = useState(null);
  const [loadingJobs,   setLoadingJobs]   = useState(true);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [gpsOn,    setGpsOn]    = useState(false);
  const [lastPos,  setLastPos]  = useState(null);
  const [expandedMap, setExpandedMap] = useState(null);
  const [failModal, setFailModal] = useState(null);
  const [failReason, setFailReason] = useState('Customer unreachable');
  const [togglingOnline, setTogglingOnline] = useState(false);

  const watchIdRef   = useRef(null);
  const pingTimerRef = useRef(null);

  const fmt = (n) => fmtCurrency(n, 'INR');

  useEffect(() => {
    if (!authLoading && !rider) navigate('/rider/login', { replace: true });
  }, [authLoading, rider, navigate]);

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await riderGetJobs();
      setJobs(data.jobs || []);
    } catch (err) {
      if (err.response?.status !== 401) toast.error(getApiError(err));
    } finally { setLoadingJobs(false); }
  }, []);

  const loadNearby = useCallback(async () => {
    setLoadingNearby(true);
    try {
      const { data } = await riderGetNearbyOrders();
      setNearby(data.orders || []);
    } catch (err) {
      const msg = getApiError(err);
      if (msg.includes('base location')) {
        toast('Set your base location in profile to see nearby orders', { icon: '📍' });
      } else if (err.response?.status !== 401) {
        toast.error(msg);
      }
    } finally { setLoadingNearby(false); }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await riderGetProfile();
      setProfile(data.rider);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!rider) return;
    loadJobs();
    loadProfile();
  }, [rider, loadJobs, loadProfile]);

  useEffect(() => {
    if (!rider) return;
    const t = setInterval(loadJobs, 30_000);
    return () => clearInterval(t);
  }, [rider, loadJobs]);

  useEffect(() => {
    if (tab === 'nearby' && rider) loadNearby();
  }, [tab, rider, loadNearby]);

  // GPS
  const stopGps = useCallback(() => {
    if (watchIdRef.current != null) navigator.geolocation?.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    clearInterval(pingTimerRef.current);
    pingTimerRef.current = null;
    setGpsOn(false);
  }, []);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) { toast.error('GPS not available'); return; }
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => setLastPos({ lat: coords.latitude, lng: coords.longitude }),
      (err) => { toast.error(err.code === 1 ? 'Location permission denied' : 'GPS unavailable'); stopGps(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setGpsOn(true);
    toast.success('GPS on — customers can see you');
  }, [stopGps]);

  useEffect(() => {
    if (!gpsOn || !lastPos) return;
    const ping = () => riderPingLocation(lastPos.lat, lastPos.lng).catch(() => {});
    ping();
    pingTimerRef.current = setInterval(ping, 10_000);
    return () => clearInterval(pingTimerRef.current);
  }, [gpsOn, lastPos]);

  useEffect(() => { if (gpsOn && jobs.length === 0) stopGps(); }, [jobs.length, gpsOn, stopGps]);
  useEffect(() => () => stopGps(), [stopGps]);

  const handleToggleOnline = async () => {
    setTogglingOnline(true);
    try {
      const { data } = await riderToggleAvailability(!(profile?.is_online));
      setProfile((p) => ({ ...(p || {}), is_online: data.is_online }));
      toast.success(data.is_online ? 'You are now online 🟢' : 'You are offline');
    } catch (err) { toast.error(getApiError(err)); }
    finally { setTogglingOnline(false); }
  };

  const advance = async (job) => {
    const target = NEXT_STATUS[job.delivery_status];
    if (!target) return;
    setUpdating(job.id);
    try {
      await riderUpdateJob(job.id, target.next);
      toast.success(target.next.replace(/_/g, ' '));
      loadJobs();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setUpdating(null); }
  };

  const confirmFailed = async () => {
    if (!failModal || !failReason.trim()) return;
    setUpdating(failModal.id);
    try {
      await riderUpdateJob(failModal.id, 'failed', failReason.trim());
      toast.success('Marked failed');
      setFailModal(null);
      setFailReason('Customer unreachable');
      loadJobs();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setUpdating(null); }
  };

  const handleAccept = async (order) => {
    setAccepting(order.id);
    try {
      await riderAcceptNearbyOrder(order.id);
      toast.success(`Accepted order #${order.order_number} from ${order.cafe_name} 🎉`);
      setNearby((prev) => prev.filter((o) => o.id !== order.id));
      setTab('active');
      loadJobs();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setAccepting(null); }
  };

  if (authLoading || loadingJobs) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-9 h-9 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-6">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-0">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-black text-gray-900 text-base truncate">{rider?.name}</p>
                {profile?.is_online
                  ? <span className="flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />Online</span>
                  : <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Offline</span>
                }
              </div>
              <p className="text-xs text-gray-400 truncate">{rider?.cafe_name || 'Independent rider'}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Online toggle */}
              <button onClick={handleToggleOnline} disabled={togglingOnline}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-60 ${
                  profile?.is_online ? 'bg-gray-200 text-gray-700' : 'bg-green-500 text-white'
                }`}>
                {togglingOnline ? '…' : profile?.is_online ? 'Go Offline' : 'Go Online'}
              </button>
              <button onClick={() => navigate('/rider/profile')}
                className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-black text-orange-600">
                {rider?.name?.charAt(0)?.toUpperCase()}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {[
              { key: 'active', label: 'Active Jobs', badge: jobs.length },
              { key: 'nearby', label: 'Nearby Orders', badge: nearby.length || null },
            ].map(({ key, label, badge }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex-1 pb-2.5 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                  tab === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}>
                {label}
                {badge != null && badge > 0 && (
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${tab === key ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
            <button onClick={() => navigate('/rider/earnings')}
              className="flex-1 pb-2.5 text-xs font-bold text-gray-400 hover:text-gray-600 border-b-2 border-transparent">
              Earnings
            </button>
          </div>
        </div>
      </header>

      {/* ── GPS banner ── */}
      {tab === 'active' && (
        <div className="max-w-lg mx-auto px-4 pt-3">
          <div className={`rounded-2xl border-2 p-3 flex items-center justify-between gap-3 transition-colors ${gpsOn ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {gpsOn && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0" />}
                <p className="font-bold text-sm text-gray-900">Location sharing</p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {gpsOn
                  ? lastPos ? `${lastPos.lat.toFixed(4)}, ${lastPos.lng.toFixed(4)}` : 'Getting GPS…'
                  : 'Turn on while delivering so customers can track you'}
              </p>
            </div>
            <button onClick={gpsOn ? stopGps : startGps}
              className={`px-3.5 py-2 rounded-xl font-bold text-xs flex-shrink-0 transition-colors ${gpsOn ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'}`}>
              {gpsOn ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-3 space-y-3">

        {/* ── Active Jobs tab ── */}
        {tab === 'active' && (
          <>
            {jobs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center mt-4">
                <div className="text-5xl mb-3">🌴</div>
                <p className="font-bold text-gray-700">No active deliveries</p>
                <p className="text-xs text-gray-400 mt-1 mb-4">Browse nearby orders and accept one to get started</p>
                <button onClick={() => setTab('nearby')}
                  className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition-colors">
                  Browse Nearby Orders →
                </button>
              </div>
            ) : (
              jobs.map((job) => {
                const badge    = STATUS_LABELS[job.delivery_status] || STATUS_LABELS.assigned;
                const target   = NEXT_STATUS[job.delivery_status];
                const fullAddr = [job.delivery_address, job.delivery_address2, job.delivery_city, job.delivery_zipcode].filter(Boolean).join(', ');
                const mapOpen  = expandedMap === job.id;
                const navUrl   = mapsNavUrl(job.delivery_lat, job.delivery_lng, fullAddr);
                const pickNav  = mapsNavUrl(job.cafe_lat, job.cafe_lng, job.cafe_address);

                return (
                  <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                      <div>
                        <p className="font-black text-gray-900">Order #{job.order_number}</p>
                        <p className="text-xs text-gray-400">{new Date(job.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${badge.color}`}>{badge.icon} {badge.label}</span>
                    </div>

                    {/* Map toggle */}
                    {job.cafe_lat && job.delivery_lat && (
                      mapOpen ? (
                        <div className="relative">
                          <DeliveryMap
                            cafeLat={parseFloat(job.cafe_lat)} cafeLng={parseFloat(job.cafe_lng)}
                            cafeLabel={job.cafe_name}
                            customerLat={parseFloat(job.delivery_lat)} customerLng={parseFloat(job.delivery_lng)}
                            deliveryAddress={fullAddr}
                            driverLat={gpsOn ? lastPos?.lat : undefined}
                            driverLng={gpsOn ? lastPos?.lng : undefined}
                            height="200px"
                          />
                          {navUrl && (
                            <a href={navUrl} target="_blank" rel="noopener noreferrer"
                              className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 bg-white rounded-xl shadow px-3 py-2 text-xs font-bold text-blue-600 border border-blue-100">
                              🗺️ Navigate
                            </a>
                          )}
                          <button onClick={() => setExpandedMap(null)}
                            className="absolute top-2.5 right-2.5 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-sm font-bold text-gray-600">×</button>
                        </div>
                      ) : (
                        <button onClick={() => setExpandedMap(job.id)}
                          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors border-b border-orange-100">
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-orange-500"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                          View Route
                        </button>
                      )
                    )}

                    {/* Pickup */}
                    <div className="px-4 py-3 bg-orange-50/40 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1">📦 Pick up</p>
                      <p className="text-sm font-bold text-gray-900">{job.cafe_name}</p>
                      {job.cafe_address && <p className="text-xs text-gray-500 mt-0.5">{job.cafe_address}</p>}
                      <div className="flex gap-2 mt-2">
                        {pickNav && <a href={pickNav} target="_blank" rel="noopener noreferrer" className="flex-1 py-2 rounded-xl bg-orange-500 text-white text-xs font-bold text-center">🗺️ Navigate</a>}
                        {job.cafe_phone && <button onClick={() => { window.location.href = `tel:${job.cafe_phone}`; }} className="flex-1 py-2 rounded-xl bg-white border border-orange-200 text-orange-700 text-xs font-semibold">📞 Call</button>}
                      </div>
                    </div>

                    {/* Dropoff */}
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">🏠 Deliver to</p>
                      <p className="text-sm font-bold text-gray-900">{job.customer_name}</p>
                      {fullAddr && <p className="text-xs text-gray-500 mt-0.5">{fullAddr}</p>}
                      {job.delivery_instructions && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-1.5 mt-2">📝 {job.delivery_instructions}</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        {navUrl && <a href={navUrl} target="_blank" rel="noopener noreferrer" className="flex-1 py-2 rounded-xl bg-blue-500 text-white text-xs font-bold text-center">🗺️ Navigate</a>}
                        {job.delivery_phone && <button onClick={() => { window.location.href = `tel:${job.delivery_phone}`; }} className="flex-1 py-2 rounded-xl bg-white border border-blue-200 text-blue-700 text-xs font-semibold">📞 Call</button>}
                      </div>
                    </div>

                    {/* Items */}
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{(job.items || []).length} items</p>
                      {(job.items || []).slice(0, 3).map((it, i) => (
                        <div key={i} className="flex justify-between text-xs text-gray-600 py-0.5">
                          <span className="truncate">{it.name}</span><span className="ml-3 font-medium">×{it.quantity}</span>
                        </div>
                      ))}
                      {(job.items || []).length > 3 && <p className="text-[10px] text-gray-400 mt-0.5">+{job.items.length - 3} more</p>}
                      <div className="flex justify-between mt-2 pt-2 border-t border-gray-100">
                        <span className="text-xs text-gray-500">Total</span>
                        <span className="text-sm font-black text-gray-900">{fmt(job.final_amount)}</span>
                      </div>
                      {!job.payment_verified && job.payment_mode !== 'online' && (
                        <p className="text-xs text-red-600 font-bold mt-1">⚠️ Collect cash: {fmt(job.final_amount)}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="p-3 flex gap-2">
                      {target ? (
                        <>
                          <button onClick={() => advance(job)} disabled={updating === job.id}
                            className="flex-1 py-3.5 rounded-2xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-bold text-sm transition-colors">
                            {updating === job.id ? 'Saving…' : target.label}
                          </button>
                          <button onClick={() => { setFailModal(job); setFailReason('Customer unreachable'); }}
                            className="px-4 py-3.5 rounded-2xl border-2 border-red-200 text-red-600 font-bold text-sm flex-shrink-0">
                            Failed
                          </button>
                        </>
                      ) : (
                        <div className="flex-1 py-3 text-center text-sm text-gray-400 italic">No more actions</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Nearby Orders tab ── */}
        {tab === 'nearby' && (
          <>
            {/* Online gate */}
            {!profile?.is_online && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                <span className="text-xl flex-shrink-0">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-800">You're offline</p>
                  <p className="text-xs text-amber-700 mt-0.5 mb-3">Go online to browse and accept nearby delivery orders.</p>
                  <button onClick={handleToggleOnline} disabled={togglingOnline}
                    className="px-4 py-2 rounded-xl bg-green-500 text-white text-xs font-bold disabled:opacity-60">
                    {togglingOnline ? '…' : 'Go Online'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-700">
                {loadingNearby ? 'Loading…' : `${nearby.length} order${nearby.length !== 1 ? 's' : ''} nearby`}
              </p>
              <button onClick={loadNearby} disabled={loadingNearby}
                className="text-xs text-orange-600 font-bold hover:text-orange-700 disabled:opacity-50 flex items-center gap-1">
                {loadingNearby ? <span className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" /> : '↻'} Refresh
              </button>
            </div>

            {!loadingNearby && nearby.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                <div className="text-5xl mb-3">🔍</div>
                <p className="font-bold text-gray-700">No orders nearby right now</p>
                <p className="text-xs text-gray-400 mt-1">New orders will appear here automatically. Pull to refresh.</p>
              </div>
            )}

            {nearby.map((order) => {
              const isAccepting = accepting === order.id;
              const cafeNavUrl  = mapsNavUrl(order.cafe_lat, order.cafe_lng, order.cafe_address);

              return (
                <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  {/* Cafe + distance */}
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm truncate">{order.cafe_name}</p>
                      <p className="text-xs text-gray-400">{order.cafe_address}</p>
                    </div>
                    <div className="flex-shrink-0 text-right ml-3">
                      <p className="text-sm font-black text-orange-600">{order.distance_km} km</p>
                      <p className="text-[10px] text-gray-400">from you</p>
                    </div>
                  </div>

                  <div className="px-4 py-3 space-y-2 border-b border-gray-100">
                    {/* Customer */}
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Deliver to</p>
                      <p className="text-sm font-semibold text-gray-800">{order.customer_name}</p>
                      {order.delivery_address && <p className="text-xs text-gray-500">{order.delivery_address}{order.delivery_city ? `, ${order.delivery_city}` : ''}</p>}
                      {order.delivery_instructions && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1">📝 {order.delivery_instructions}</p>
                      )}
                    </div>

                    {/* Order info row */}
                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <span>🛒</span><span>{order.item_count} item{order.item_count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <span>💰</span><span>{fmt(order.final_amount)}</span>
                      </div>
                      {order.delivery_fee > 0 && (
                        <div className="flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <span>🛵</span><span>+{fmt(order.delivery_fee)}</span>
                        </div>
                      )}
                      {order.payment_mode === 'cash' && (
                        <span className="text-xs text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">COD</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-3 flex gap-2">
                    {cafeNavUrl && (
                      <a href={cafeNavUrl} target="_blank" rel="noopener noreferrer"
                        className="px-3 py-3 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 flex items-center gap-1 flex-shrink-0">
                        🗺️ Café
                      </a>
                    )}
                    <button onClick={() => handleAccept(order)} disabled={isAccepting}
                      className="flex-1 py-3 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-black text-sm transition-colors">
                      {isAccepting
                        ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Accepting…</span>
                        : '✓ Accept Order'
                      }
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── Fail reason bottom sheet ── */}
      {failModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setFailModal(null)}>
          <div className="w-full max-w-lg mx-auto bg-white rounded-t-3xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-gray-900 mb-0.5">Mark delivery failed</h3>
            <p className="text-xs text-gray-500 mb-4">Order #{failModal.order_number} · {failModal.customer_name}</p>
            <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">Reason</label>
            <input type="text" value={failReason} onChange={(e) => setFailReason(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-4"
              placeholder="Why did this delivery fail?" />
            <div className="flex flex-wrap gap-2 mb-4">
              {['Customer unreachable', 'Wrong address', 'Customer refused delivery', 'Item damaged'].map((r) => (
                <button key={r} type="button" onClick={() => setFailReason(r)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${failReason === r ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setFailModal(null)} className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-700 font-semibold text-sm">Cancel</button>
              <button onClick={confirmFailed} disabled={!failReason.trim() || updating === failModal.id}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold text-sm">
                {updating === failModal.id ? 'Saving…' : 'Confirm Failed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 safe-area-bottom z-10">
        <div className="max-w-lg mx-auto flex">
          {[
            { key: 'active',  icon: '📋', label: 'Jobs',     badge: jobs.length   },
            { key: 'nearby',  icon: '🔍', label: 'Nearby',   badge: null          },
            { key: 'earnings',icon: '💰', label: 'Earnings', badge: null, path: '/rider/earnings' },
            { key: 'profile', icon: '👤', label: 'Profile',  badge: null, path: '/rider/profile'  },
          ].map(({ key, icon, label, badge, path }) => (
            <button key={key}
              onClick={() => path ? navigate(path) : setTab(key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-[10px] font-bold transition-colors relative ${
                (path ? false : tab === key) ? 'text-orange-600' : 'text-gray-400 hover:text-gray-600'
              }`}>
              <span className="text-lg leading-none">{icon}</span>
              {label}
              {badge != null && badge > 0 && (
                <span className="absolute top-1.5 right-1/4 translate-x-3 w-4 h-4 bg-orange-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
