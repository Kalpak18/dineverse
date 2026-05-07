import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderGetJobs, riderUpdateJob, riderPingLocation } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { getApiError } from '../../utils/apiError';
import { fmtCurrency } from '../../utils/formatters';

const STATUS_LABELS = {
  assigned:        { label: 'Assigned',        color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  picked_up:       { label: 'Picked up',       color: 'bg-blue-100 text-blue-700',     icon: '🥡' },
  out_for_delivery:{ label: 'On the way',      color: 'bg-purple-100 text-purple-700', icon: '🛵' },
  delivered:       { label: 'Delivered',       color: 'bg-green-100 text-green-700',   icon: '✓'  },
  failed:          { label: 'Failed',          color: 'bg-red-100 text-red-700',       icon: '✕'  },
};

const NEXT_STATUS = {
  assigned:         { next: 'picked_up',        label: '✓ Picked up'    },
  picked_up:        { next: 'out_for_delivery', label: '🛵 On the way'  },
  out_for_delivery: { next: 'delivered',        label: '✓ Delivered'    },
};

export default function RiderJobsPage() {
  const { rider, logout, loading: authLoading } = useRiderAuth();
  const navigate = useNavigate();

  const [jobs,    setJobs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null); // jobId being updated
  const [gpsOn,   setGpsOn]   = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const watchIdRef = useRef(null);
  const pingTimerRef = useRef(null);

  const fmt = (n) => fmtCurrency(n, 'INR');

  // Redirect to login if no rider
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

  // Poll for new jobs every 30s (lightweight; use socket later for instant)
  useEffect(() => {
    if (!rider) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [rider, load]);

  // ── GPS sharing ─────────────────────────────────────────────
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

  // Ping location to backend every 10s while GPS is on AND there's an active job
  useEffect(() => {
    if (!gpsOn || !lastPos) return;
    const ping = () => riderPingLocation(lastPos.lat, lastPos.lng).catch(() => {});
    ping(); // immediate
    pingTimerRef.current = setInterval(ping, 10_000);
    return () => { if (pingTimerRef.current) clearInterval(pingTimerRef.current); };
  }, [gpsOn, lastPos]);

  // Auto-stop GPS when no active jobs remain
  useEffect(() => {
    if (gpsOn && jobs.length === 0) stopGps();
  }, [jobs.length, gpsOn, stopGps]);

  // Cleanup on unmount
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

  const markFailed = async (job) => {
    const reason = window.prompt('Why did delivery fail?', 'Customer unreachable');
    if (!reason?.trim()) return;
    setUpdating(job.id);
    try {
      await riderUpdateJob(job.id, 'failed', reason.trim());
      toast.success('Marked failed');
      load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setUpdating(null); }
  };

  const openMaps = (lat, lng, addr) => {
    const url = lat && lng
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr || '')}`;
    window.open(url, '_blank');
  };

  const callPhone = (phone) => {
    if (phone) window.location.href = `tel:${phone}`;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400">Logged in as</p>
            <p className="font-bold text-gray-900 text-sm truncate">{rider?.name}</p>
            <p className="text-xs text-gray-500 truncate">{rider?.cafe_name}</p>
          </div>
          <button
            onClick={() => { logout(); navigate('/rider/login', { replace: true }); }}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      </header>

      {/* GPS toggle banner */}
      <div className="max-w-md mx-auto px-4 pt-3">
        <div className={`rounded-2xl border-2 p-3 flex items-center justify-between gap-3 ${gpsOn ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
          <div className="min-w-0">
            <p className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
              {gpsOn ? <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> : null}
              Location sharing
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {gpsOn ? 'Customers see your live location' : 'Turn on while delivering'}
            </p>
          </div>
          <button
            onClick={gpsOn ? stopGps : startGps}
            className={`px-4 py-2 rounded-xl font-semibold text-xs transition-colors flex-shrink-0 ${
              gpsOn
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-orange-500 hover:bg-orange-600 text-white'
            }`}
          >
            {gpsOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>

      {/* Jobs list */}
      <div className="max-w-md mx-auto px-4 pt-4 space-y-3">
        <h2 className="text-sm font-bold text-gray-700">
          {jobs.length === 0 ? 'No active deliveries' : `${jobs.length} active ${jobs.length === 1 ? 'job' : 'jobs'}`}
        </h2>

        {jobs.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <div className="text-5xl mb-3">🌴</div>
            <p className="font-semibold text-gray-700 text-sm">All caught up</p>
            <p className="text-xs text-gray-400 mt-1">New jobs will appear here when assigned to you.</p>
          </div>
        )}

        {jobs.map((job) => {
          const badge = STATUS_LABELS[job.delivery_status] || STATUS_LABELS.assigned;
          const target = NEXT_STATUS[job.delivery_status];
          const fullAddr = [job.delivery_address, job.delivery_address2, job.delivery_city, job.delivery_zipcode].filter(Boolean).join(', ');

          return (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900 text-sm">#{job.order_number}</p>
                  <p className="text-xs text-gray-400">{new Date(job.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${badge.color}`}>
                  {badge.icon} {badge.label}
                </span>
              </div>

              {/* Pickup (cafe) */}
              <div className="px-4 py-3 border-b border-gray-100 bg-orange-50/50">
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wide mb-1">Pick up from</p>
                <p className="text-sm font-bold text-gray-900">{job.cafe_name}</p>
                {job.cafe_address && <p className="text-xs text-gray-600 mt-0.5">{job.cafe_address}</p>}
                <div className="flex gap-2 mt-2">
                  {job.cafe_lat && job.cafe_lng && (
                    <button onClick={() => openMaps(job.cafe_lat, job.cafe_lng, job.cafe_address)}
                      className="flex-1 py-2 rounded-lg bg-white border border-orange-200 text-orange-700 text-xs font-semibold hover:bg-orange-50">
                      🗺️ Navigate
                    </button>
                  )}
                  {job.cafe_phone && (
                    <button onClick={() => callPhone(job.cafe_phone)}
                      className="flex-1 py-2 rounded-lg bg-white border border-orange-200 text-orange-700 text-xs font-semibold hover:bg-orange-50">
                      📞 Call café
                    </button>
                  )}
                </div>
              </div>

              {/* Drop (customer) */}
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-1">Deliver to</p>
                <p className="text-sm font-bold text-gray-900">{job.customer_name}</p>
                {fullAddr && <p className="text-xs text-gray-600 mt-0.5">{fullAddr}</p>}
                {job.delivery_instructions && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1.5">
                    📝 {job.delivery_instructions}
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => openMaps(job.delivery_lat, job.delivery_lng, fullAddr)}
                    className="flex-1 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold">
                    🗺️ Navigate
                  </button>
                  {job.delivery_phone && (
                    <button onClick={() => callPhone(job.delivery_phone)}
                      className="flex-1 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50">
                      📞 Call
                    </button>
                  )}
                </div>
              </div>

              {/* Items + bill */}
              <div className="px-4 py-3 border-b border-gray-100 text-xs">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Order ({(job.items || []).length} items)</p>
                {(job.items || []).slice(0, 3).map((it, i) => (
                  <div key={i} className="flex justify-between text-gray-600 py-0.5">
                    <span className="truncate">{it.name}</span>
                    <span className="flex-shrink-0 ml-2">× {it.quantity}</span>
                  </div>
                ))}
                {(job.items || []).length > 3 && (
                  <p className="text-gray-400 mt-0.5">+ {job.items.length - 3} more</p>
                )}
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                  <span className="text-gray-500">Order total</span>
                  <span className="font-bold text-gray-900">{fmt(job.final_amount)}</span>
                </div>
                {!job.payment_verified && job.payment_mode !== 'online' && (
                  <p className="text-[11px] text-red-600 font-semibold mt-1">⚠ Collect cash on delivery: {fmt(job.final_amount)}</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="p-3 flex gap-2">
                {target ? (
                  <>
                    <button
                      onClick={() => advance(job)}
                      disabled={updating === job.id}
                      className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-bold text-sm transition-colors"
                    >
                      {updating === job.id ? 'Saving…' : target.label}
                    </button>
                    <button
                      onClick={() => markFailed(job)}
                      disabled={updating === job.id}
                      className="px-4 py-3 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 font-semibold text-sm flex-shrink-0"
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
    </div>
  );
}
