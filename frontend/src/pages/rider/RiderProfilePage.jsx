import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderGetProfile, riderUpdateProfile, riderUpdateBaseLocation, riderToggleAvailability } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { useGoogleMaps } from '../../hooks/useGoogleMaps';
import { getApiError } from '../../utils/apiError';

const VEHICLE_OPTIONS = [
  { value: 'bike',    label: 'Bike',    icon: '🏍️' },
  { value: 'scooter', label: 'Scooter', icon: '🛵' },
  { value: 'bicycle', label: 'Bicycle', icon: '🚲' },
  { value: 'car',     label: 'Car',     icon: '🚗' },
];

export default function RiderProfilePage() {
  const navigate   = useNavigate();
  const { rider: authRider, logout, refresh } = useRiderAuth();
  const { ready: mapsReady } = useGoogleMaps();

  const [profile,  setProfile]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [editing,  setEditing]  = useState(false);

  const [form, setForm] = useState({ name: '', phone: '', vehicle_type: 'bike', vehicle_number: '', bio: '' });
  const [radius, setRadius] = useState(7);
  const [location, setLocation] = useState({ lat: null, lng: null, address: '' });
  const [locating, setLocating] = useState(false);
  const [savingLoc, setSavingLoc] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const markerRef       = useRef(null);
  const mapInitedRef    = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data } = await riderGetProfile();
      setProfile(data.rider);
      setForm({
        name:           data.rider.name || '',
        phone:          data.rider.phone || '',
        vehicle_type:   data.rider.vehicle_type || 'bike',
        vehicle_number: data.rider.vehicle_number || '',
        bio:            data.rider.bio || '',
      });
      setRadius(parseFloat(data.rider.service_radius_km) || 7);
      setLocation({
        lat:     data.rider.base_lat ? parseFloat(data.rider.base_lat) : null,
        lng:     data.rider.base_lng ? parseFloat(data.rider.base_lng) : null,
        address: data.rider.base_address || '',
      });
    } catch { toast.error('Could not load profile'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Init map once mapsReady + profile loaded
  useEffect(() => {
    if (!mapsReady || mapInitedRef.current || !mapContainerRef.current) return;
    mapInitedRef.current = true;
    const gm   = window.google.maps;
    const initLat = location.lat || 20.5937;
    const initLng = location.lng || 78.9629;
    const map  = new gm.Map(mapContainerRef.current, {
      center: { lat: initLat, lng: initLng },
      zoom:   location.lat ? 14 : 5,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      gestureHandling: 'greedy',
    });
    mapRef.current = map;
    const marker = new gm.Marker({ map, draggable: true, position: { lat: initLat, lng: initLng } });
    markerRef.current = marker;

    const onPick = (latLng) => {
      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
      marker.setPosition({ lat, lng });
      const gc = new gm.Geocoder();
      gc.geocode({ location: { lat, lng } }, (results, status) => {
        const addr = status === 'OK' && results[0] ? results[0].formatted_address : '';
        setLocation({ lat, lng, address: addr });
      });
    };
    map.addListener('click',          (e) => onPick(e.latLng));
    marker.addListener('dragend',     ()  => onPick(marker.getPosition()));
  }, [mapsReady, location.lat]); // eslint-disable-line react-hooks/exhaustive-deps

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
          new window.google.maps.Geocoder().geocode({ location: { lat, lng } }, (r, s) => {
            const addr = s === 'OK' && r[0] ? r[0].formatted_address : '';
            setLocation({ lat, lng, address: addr });
          });
        } else { setLocation({ lat, lng, address: '' }); }
      },
      () => { setLocating(false); toast.error('Could not access your location'); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveProfile = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      await riderUpdateProfile(form);
      await refresh();
      toast.success('Profile updated');
      setEditing(false);
      load();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSaving(false); }
  };

  const handleSaveLocation = async () => {
    if (!location.lat || !location.lng) return toast.error('Pin your location on the map first');
    setSavingLoc(true);
    try {
      await riderUpdateBaseLocation({ base_lat: location.lat, base_lng: location.lng, base_address: location.address, service_radius_km: radius });
      toast.success('Location saved');
      load();
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSavingLoc(false); }
  };

  const handleToggleOnline = async () => {
    setTogglingOnline(true);
    try {
      const { data } = await riderToggleAvailability(!profile.is_online);
      setProfile((p) => ({ ...p, is_online: data.is_online }));
      toast.success(data.is_online ? 'You are now online 🟢' : 'You are now offline');
    } catch (err) { toast.error(getApiError(err)); }
    finally { setTogglingOnline(false); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-9 h-9 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24">

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/rider/jobs')} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-600">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current strokeWidth-2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="font-black text-gray-900 text-base flex-1">My Profile</h1>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs font-bold text-orange-600 hover:text-orange-700 px-3 py-1.5 rounded-xl hover:bg-orange-50 transition-colors">
              Edit
            </button>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Availability card */}
        <div className={`rounded-2xl border-2 p-4 flex items-center justify-between gap-3 transition-colors ${
          profile?.is_online ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
        }`}>
          <div>
            <div className="flex items-center gap-2">
              {profile?.is_online && <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />}
              <p className="font-bold text-gray-900 text-sm">{profile?.is_online ? 'Online — accepting deliveries' : 'Offline'}</p>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{profile?.is_online ? 'Nearby orders are visible to you' : 'Go online to see and accept orders'}</p>
          </div>
          <button onClick={handleToggleOnline} disabled={togglingOnline}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex-shrink-0 transition-colors disabled:opacity-60 ${
              profile?.is_online ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-green-500 text-white hover:bg-green-600'
            }`}>
            {togglingOnline ? '…' : profile?.is_online ? 'Go Offline' : 'Go Online'}
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Today',    value: profile?.today_deliveries ?? 0,   sub: '₹' + (profile?.today_earnings ?? 0) },
            { label: 'Total',    value: profile?.total_deliveries ?? 0,   sub: 'deliveries' },
            { label: 'Earned',   value: '₹' + (Math.round(profile?.total_earnings ?? 0)), sub: 'lifetime' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-white rounded-2xl border border-gray-100 p-3.5 text-center shadow-sm">
              <p className="text-xl font-black text-gray-900">{value}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{label}</p>
              <p className="text-[11px] text-orange-600 font-semibold mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Personal info card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Personal Info</h2>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} type="tel"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Vehicle</label>
                <div className="grid grid-cols-4 gap-2">
                  {VEHICLE_OPTIONS.map((v) => (
                    <button key={v.value} type="button"
                      onClick={() => setForm(f => ({ ...f, vehicle_type: v.value }))}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all ${
                        form.vehicle_type === v.value ? 'border-orange-500 bg-orange-50' : 'border-gray-200'
                      }`}>
                      <span className="text-lg">{v.icon}</span>
                      <span className="text-[9px] font-bold text-gray-500">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Vehicle Number</label>
                <input value={form.vehicle_number} onChange={(e) => setForm(f => ({ ...f, vehicle_number: e.target.value }))}
                  placeholder="MH12AB1234"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">Cancel</button>
                <button onClick={handleSaveProfile} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold transition-colors">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'Name',    value: profile?.name },
                { label: 'Email',   value: profile?.email },
                { label: 'Phone',   value: profile?.phone || '—' },
                { label: 'Vehicle', value: `${VEHICLE_OPTIONS.find(v => v.value === profile?.vehicle_type)?.icon || '🛵'} ${VEHICLE_OPTIONS.find(v => v.value === profile?.vehicle_type)?.label || profile?.vehicle_type || '—'}` },
                { label: 'Plate',   value: profile?.vehicle_number || '—' },
                { label: 'Café',    value: profile?.cafe_name || (profile?.is_self_registered ? 'Independent rider' : '—') },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
                  <span className="text-sm font-semibold text-gray-800">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Base location card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Delivery Zone</h2>

          <button onClick={handleUseMyLocation} disabled={locating}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-orange-300 text-orange-600 font-semibold text-sm hover:bg-orange-50 transition-colors disabled:opacity-60">
            {locating
              ? <><span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />Locating…</>
              : <><span>📍</span> Use current location</>
            }
          </button>

          <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 200 }}>
            {mapsReady
              ? <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
              : <div className="h-full flex items-center justify-center bg-gray-50 text-xs text-gray-400">Loading map…</div>
            }
          </div>

          {location.address && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              <span className="text-green-600 text-xs flex-shrink-0 mt-0.5">✓</span>
              <p className="text-xs text-green-800 font-medium leading-relaxed">{location.address}</p>
            </div>
          )}

          <div>
            <div className="flex justify-between mb-1.5">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Radius</label>
              <span className="text-sm font-black text-orange-600">{radius} km</span>
            </div>
            <input type="range" min={1} max={10} step={1} value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              className="w-full accent-orange-500" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>1 km</span><span>5 km</span><span>10 km</span></div>
          </div>

          <button onClick={handleSaveLocation} disabled={savingLoc || !location.lat}
            className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm transition-colors">
            {savingLoc ? 'Saving…' : 'Save Location & Radius'}
          </button>
        </div>

        {/* Logout */}
        <button onClick={() => { logout(); navigate('/rider/login', { replace: true }); }}
          className="w-full py-3 rounded-2xl border-2 border-red-200 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors">
          Log out
        </button>
      </div>
    </div>
  );
}
