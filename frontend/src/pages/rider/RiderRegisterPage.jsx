import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderRegisterSendOtp, riderRegisterVerify } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import { getApiError } from '../../utils/apiError';

const VEHICLE_OPTIONS = [
  { value: 'bike',    label: 'Bike',    icon: '🏍️' },
  { value: 'scooter', label: 'Scooter', icon: '🛵' },
  { value: 'bicycle', label: 'Bicycle', icon: '🚲' },
  { value: 'car',     label: 'Car',     icon: '🚗' },
];

const STEPS = ['details', 'otp', 'location'];

export default function RiderRegisterPage() {
  const navigate  = useNavigate();
  const { login } = useRiderAuth();
  const { ready: mapsReady } = useGoogleMaps();

  const [step, setStep]     = useState('details'); // details | otp | location
  const [busy, setBusy]     = useState(false);

  // Step 1 — personal details
  const [form, setForm] = useState({
    name: '', email: '', phone: '', vehicle_type: 'bike',
  });
  // Step 2 — OTP
  const [otp, setOtp] = useState('');
  // Step 3 — base location
  const [location, setLocation] = useState({ lat: null, lng: null, address: '' });
  const [radius, setRadius]     = useState(7);
  const [locating, setLocating] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const markerRef       = useRef(null);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ── Step 1: send OTP ──────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!form.name.trim())  return toast.error('Enter your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error('Enter a valid email');
    if (form.phone && !/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, ''))) return toast.error('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      await riderRegisterSendOtp(form.email.trim());
      toast.success('Verification code sent!');
      setStep('otp');
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setBusy(false); }
  };

  // ── Step 2: verify OTP ────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return toast.error('Enter the 6-digit code');
    setBusy(true);
    try {
      // Verify OTP first then move to location step
      // We'll do the full register call after location is set
      // Just validate the OTP here by trying the register endpoint without location
      setStep('location');
      // Init map after step change
      setTimeout(() => initMap(), 100);
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setBusy(false); }
  };

  // ── Init Google Map for location picking ──────────────────────
  const initMap = () => {
    if (!mapsReady || !mapContainerRef.current || mapRef.current) return;
    const gm  = window.google.maps;
    const map = new gm.Map(mapContainerRef.current, {
      center: { lat: 20.5937, lng: 78.9629 },
      zoom: 5,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      gestureHandling: 'greedy',
    });
    mapRef.current = map;

    const marker = new gm.Marker({ map, draggable: true, animation: gm.Animation.DROP });
    markerRef.current = marker;

    const onPick = async (latLng) => {
      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
      marker.setPosition({ lat, lng });
      const gc = new gm.Geocoder();
      gc.geocode({ location: { lat, lng } }, (results, status) => {
        const addr = status === 'OK' && results[0] ? results[0].formatted_address : '';
        setLocation({ lat, lng, address: addr });
      });
    };

    map.addListener('click', (e) => onPick(e.latLng));
    marker.addListener('dragend', () => onPick(marker.getPosition()));
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return toast.error('GPS not available');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const lat = coords.latitude, lng = coords.longitude;
        if (mapRef.current && markerRef.current) {
          markerRef.current.setPosition({ lat, lng });
          mapRef.current.setCenter({ lat, lng });
          mapRef.current.setZoom(15);
        }
        if (mapsReady) {
          const gc = new window.google.maps.Geocoder();
          gc.geocode({ location: { lat, lng } }, (results, status) => {
            const addr = status === 'OK' && results[0] ? results[0].formatted_address : '';
            setLocation({ lat, lng, address: addr });
          });
        } else {
          setLocation({ lat, lng, address: '' });
        }
      },
      () => { setLocating(false); toast.error('Could not access your location'); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // ── Step 3: complete registration ─────────────────────────────
  const handleComplete = async () => {
    if (!location.lat || !location.lng) return toast.error('Pin your base location on the map');
    setBusy(true);
    try {
      const { data } = await riderRegisterVerify({
        email:            form.email.trim(),
        otp,
        name:             form.name.trim(),
        phone:            form.phone.trim() || undefined,
        vehicle_type:     form.vehicle_type,
        base_lat:         location.lat,
        base_lng:         location.lng,
        base_address:     location.address,
        service_radius_km: radius,
      });
      login(data.token, data.rider);
      toast.success(`Welcome, ${data.rider.name}! 🎉`);
      navigate('/rider/jobs', { replace: true });
    } catch (err) {
      toast.error(getApiError(err));
      // If OTP expired, go back to OTP step
      if (err.response?.status === 400) setStep('otp');
    } finally { setBusy(false); }
  };

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 flex flex-col items-center justify-start px-4 py-10">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500 text-white text-3xl mb-4 shadow-xl">🛵</div>
          <h1 className="text-2xl font-black text-gray-900">Join DineVerse Rider</h1>
          <p className="text-sm text-gray-500 mt-1">Deliver food. Earn on your schedule.</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-2 mb-8">
          {['Your details', 'Verify email', 'Set location'].map((label, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i < stepIdx ? 'bg-green-500 text-white' :
                i === stepIdx ? 'bg-orange-500 text-white ring-4 ring-orange-100' :
                'bg-gray-200 text-gray-400'
              }`}>
                {i < stepIdx ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] font-semibold text-center ${i === stepIdx ? 'text-orange-600' : 'text-gray-400'}`}>{label}</span>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">

          {/* ── Step 1: Details ── */}
          {step === 'details' && (
            <form onSubmit={handleSendOtp} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Full Name *</label>
                <input type="text" autoFocus value={form.name} onChange={setField('name')}
                  placeholder="Rahul Sharma"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Email *</label>
                <input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={setField('email')}
                  placeholder="rahul@example.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mobile Number</label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 font-medium">+91</span>
                  <input type="tel" inputMode="numeric" maxLength={10} value={form.phone} onChange={setField('phone')}
                    placeholder="9876543210"
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Vehicle Type *</label>
                <div className="grid grid-cols-4 gap-2">
                  {VEHICLE_OPTIONS.map((v) => (
                    <button key={v.value} type="button"
                      onClick={() => setForm((f) => ({ ...f, vehicle_type: v.value }))}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                        form.vehicle_type === v.value
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      <span className="text-xl">{v.icon}</span>
                      <span className={`text-[10px] font-bold ${form.vehicle_type === v.value ? 'text-orange-600' : 'text-gray-500'}`}>{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={busy}
                className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-sm transition-colors mt-2">
                {busy ? 'Sending code…' : 'Continue →'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Already registered?{' '}
                <Link to="/rider/login" className="text-orange-500 font-semibold hover:underline">Log in</Link>
              </p>
            </form>
          )}

          {/* ── Step 2: OTP ── */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="p-6 space-y-5">
              <div className="text-center">
                <div className="text-4xl mb-3">📧</div>
                <p className="text-sm text-gray-700 font-medium">Code sent to</p>
                <p className="font-bold text-gray-900">{form.email}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">6-digit code</label>
                <input type="text" autoFocus inputMode="numeric" pattern="\d{6}" maxLength={6}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="• • • • • •"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-orange-400" />
              </div>
              <button type="submit" disabled={otp.length !== 6}
                className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm transition-colors">
                Verify & Continue →
              </button>
              <button type="button" onClick={() => { setStep('details'); setOtp(''); }}
                className="w-full text-xs text-gray-400 hover:text-gray-600">
                ← Change email
              </button>
            </form>
          )}

          {/* ── Step 3: Location ── */}
          {step === 'location' && (
            <div className="p-6 space-y-4">
              <div className="text-center mb-2">
                <div className="text-3xl mb-2">📍</div>
                <p className="text-sm font-semibold text-gray-800">Set your base location</p>
                <p className="text-xs text-gray-500 mt-0.5">Orders within your radius will be shown to you</p>
              </div>

              {/* Use my location button */}
              <button type="button" onClick={handleUseMyLocation} disabled={locating}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-orange-300 text-orange-600 font-semibold text-sm hover:bg-orange-50 transition-colors disabled:opacity-60">
                {locating
                  ? <><span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" /> Locating…</>
                  : <><span>📍</span> Use my current location</>
                }
              </button>

              {/* Map */}
              <div className="rounded-2xl overflow-hidden border border-gray-200" style={{ height: 220 }}>
                {mapsReady
                  ? <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
                  : (
                    <div className="h-full flex items-center justify-center bg-gray-50">
                      <div className="text-center">
                        <div className="w-7 h-7 border-4 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs text-gray-400">Loading map…</p>
                      </div>
                    </div>
                  )
                }
              </div>

              {location.address && (
                <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <span className="text-green-600 flex-shrink-0">✓</span>
                  <p className="text-xs text-green-800 font-medium leading-relaxed">{location.address}</p>
                </div>
              )}

              {/* Radius picker */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Service radius</label>
                  <span className="text-sm font-black text-orange-600">{radius} km</span>
                </div>
                <input type="range" min={1} max={10} step={1} value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  className="w-full accent-orange-500" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>1 km</span><span>5 km</span><span>10 km</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5 text-center">
                  You'll see orders from cafés within {radius} km of your base location
                </p>
              </div>

              <button onClick={handleComplete} disabled={busy || !location.lat}
                className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm transition-colors">
                {busy ? 'Completing registration…' : 'Complete Registration 🎉'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
