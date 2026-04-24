import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DineLogo from '../../components/DineLogo';
import { useAuth } from '../../context/AuthContext';
import { checkSlugAvailability, sendVerificationOtp, preVerifyEmail } from '../../services/api';
import toast from 'react-hot-toast';
import PasswordInput from '../../components/PasswordInput';
import PhoneInput from '../../components/PhoneInput';
import OtpInput from '../../components/OtpInput';
import MapPicker from '../../components/MapPicker';
import { getApiError } from '../../utils/apiError';

// ── Password strength indicator ───────────────────────────────
function PasswordStrength({ password }) {
  if (!password) return null;
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const meta = [
    null,
    { label: 'Weak',        text: 'text-red-500',    bar: 'bg-red-400' },
    { label: 'Fair',        text: 'text-amber-500',  bar: 'bg-amber-400' },
    { label: 'Good',        text: 'text-yellow-600', bar: 'bg-yellow-400' },
    { label: 'Strong',      text: 'text-green-600',  bar: 'bg-green-500' },
    { label: 'Very Strong', text: 'text-green-700',  bar: 'bg-green-600' },
  ][score];
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i <= score ? meta.bar : 'bg-gray-200'}`} />
        ))}
      </div>
      <p className={`text-xs font-medium ${meta.text}`}>{meta.label}</p>
    </div>
  );
}

// ── Country ↔ dial-code maps (covers PhoneInput's 10 countries) ─
const COUNTRY_TO_DIAL = {
  'India': '+91', 'United States': '+1', 'Canada': '+1',
  'United Kingdom': '+44', 'Australia': '+61',
  'United Arab Emirates': '+971', 'Singapore': '+65',
  'Malaysia': '+60', 'Sri Lanka': '+94', 'Nepal': '+977',
  'Bangladesh': '+880',
};
const DIAL_TO_COUNTRY = {
  '+91': 'India', '+44': 'United Kingdom', '+61': 'Australia',
  '+971': 'United Arab Emirates', '+65': 'Singapore',
  '+60': 'Malaysia', '+94': 'Sri Lanka', '+977': 'Nepal', '+880': 'Bangladesh',
  '+1': 'United States',
};
// Longest codes first so "+977" doesn't match "+9" accidentally
const KNOWN_DIALS = ['+977', '+971', '+880', '+94', '+65', '+61', '+60', '+44', '+91', '+1'];

function extractLocal(phone) {
  for (const code of KNOWN_DIALS) {
    if (phone.startsWith(code + ' ')) return phone.slice(code.length + 1);
    if (phone === code) return '';
  }
  return phone;
}

function toSlug(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const BUSINESS_TYPES = [
  { value: 'restaurant',    label: 'Restaurant' },
  { value: 'restaurant_ac', label: 'Restaurant (AC)' },
  { value: 'cafe',          label: 'Café / Coffee Shop' },
  { value: 'bakery',        label: 'Bakery / Sweet Shop' },
  { value: 'bar',           label: 'Bar / Pub' },
  { value: 'food_stall',    label: 'Food Stall / Cloud Kitchen' },
  { value: 'hotel_rest',    label: 'Hotel Restaurant' },
  { value: 'unregistered',  label: 'Not GST Registered' },
];

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina',
  'Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados',
  'Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina',
  'Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia',
  'Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros',
  'Congo (DRC)','Congo (Republic)','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic',
  'Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador',
  'Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France',
  'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea',
  'Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia',
  'Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya',
  'Kiribati','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya',
  'Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives',
  'Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova',
  'Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru',
  'Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea',
  'North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama',
  'Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar',
  'Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia',
  'Saint Vincent and the Grenadines','Samoa','San Marino','Saudi Arabia','Senegal',
  'Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands',
  'Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand',
  'Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan',
  'Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States',
  'Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen',
  'Zambia','Zimbabwe',
];

const DRAFT_KEY = 'dv_register_draft';

function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

export default function RegisterPage() {
  const { cafe, createAccount, completeSetup } = useAuth();
  const navigate = useNavigate();
  const accountCreated = cafe?.setup_completed === false;

  // Step 1: email + password + OTP  |  Step 2: business + location
  const [step, setStep] = useState(1);

  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [otp, setOtp]                               = useState('');
  const [otpSent, setOtpSent]                       = useState(false);
  const [verifiedEmail, setVerifiedEmail]           = useState(''); // locked after OTP sent
  const [emailVerifiedToken, setEmailVerifiedToken] = useState(''); // 24h token issued after OTP passes
  const [otpLoading, setOtpLoading]                 = useState(false);
  const [resendCooldown, setResendCooldown]         = useState(0);

  const [form, setForm] = useState({
    name: '', slug: '', description: '', phone: '',
    address: '', address_line2: '', city: '', state: '', pincode: '', country: '',
    business_type: 'restaurant',
    currency: 'INR',
    gst_number: '',
    gst_rate: 5,
    latitude: null,
    longitude: null,
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [slugStatus, setSlugStatus] = useState('idle');
  const [loading, setLoading] = useState(false);

  const slugCheckTimer  = useRef(null);
  const cooldownTimer   = useRef(null);
  const autoSlugRef     = useRef('');
  const registeredRef   = useRef(false); // set true after success so the draft effect doesn't re-write
  const pincodeAbort    = useRef(null);

  // ── Restore draft from localStorage on mount ─────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const d = JSON.parse(saved);
      if (d.email)               setEmail(d.email);
      if (d.password)            setPassword(d.password);
      if (d.otpSent)             setOtpSent(d.otpSent);
      if (d.verifiedEmail)       setVerifiedEmail(d.verifiedEmail);
      if (d.emailVerifiedToken)  setEmailVerifiedToken(d.emailVerifiedToken);
      if (d.form)                setForm((f) => ({ ...f, ...d.form }));
      if (d.form?.slug)          autoSlugRef.current = d.form.slug;
      // Jump to step 2 only if email was fully pre-verified (token present)
      if (d.emailVerifiedToken && d.verifiedEmail && d.step === 2) setStep(2);
    } catch { /* ignore corrupt data */ }
  }, []);

  useEffect(() => {
    if (!cafe || cafe.setup_completed !== false) return;
    setStep(2);
    setVerifiedEmail(cafe.email || '');
    setForm((prev) => ({
      ...prev,
      name: cafe.name === 'My Cafe' ? '' : (cafe.name || prev.name),
      slug: cafe.slug?.startsWith('setup-') ? '' : (cafe.slug || prev.slug),
      description: cafe.description || prev.description,
      phone: cafe.phone || prev.phone,
      address: cafe.address || prev.address,
      address_line2: cafe.address_line2 || prev.address_line2,
      city: cafe.city || prev.city,
      state: cafe.state || prev.state,
      pincode: cafe.pincode || prev.pincode,
      country: cafe.country || prev.country,
      business_type: cafe.business_type || prev.business_type,
      currency: cafe.currency || prev.currency,
      gst_number: cafe.gst_number || prev.gst_number,
      gst_rate: cafe.gst_rate ?? prev.gst_rate,
      latitude: cafe.latitude ?? prev.latitude,
      longitude: cafe.longitude ?? prev.longitude,
    }));
  }, [cafe]);

  // ── Persist draft to localStorage on every change ────────────
  useEffect(() => {
    if (registeredRef.current) return; // don't overwrite after successful registration
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ email, password, otpSent, verifiedEmail, emailVerifiedToken, form, step }));
  }, [email, password, otpSent, verifiedEmail, emailVerifiedToken, form, step]);

  // ── Slug availability check ───────────────────────────────────
  useEffect(() => {
    if (!form.slug) { setSlugStatus('idle'); return; }
    setSlugStatus('checking');
    clearTimeout(slugCheckTimer.current);
    slugCheckTimer.current = setTimeout(async () => {
      try {
        const res = await checkSlugAvailability(form.slug);
        if (res.data.available) {
          setSlugStatus('available');
        } else {
          const cityPart = toSlug(form.city);
          if (cityPart) {
            const citySlug = `${autoSlugRef.current}-${cityPart}`;
            if (citySlug !== form.slug) {
              const res2 = await checkSlugAvailability(citySlug);
              if (res2.data.available) {
                autoSlugRef.current = citySlug;
                setForm((prev) => ({ ...prev, slug: citySlug }));
                return;
              }
            }
          }
          setSlugStatus('taken');
        }
      } catch { setSlugStatus('idle'); }
    }, 500);
    return () => clearTimeout(slugCheckTimer.current);
  }, [form.slug, form.city]);

  // ── Resend cooldown countdown ─────────────────────────────────
  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownTimer.current = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(cooldownTimer.current);
  }, [resendCooldown]);

  // ── Country → phone dial-code sync ───────────────────────────
  useEffect(() => {
    const dialCode = COUNTRY_TO_DIAL[form.country];
    if (!dialCode) return;
    if (form.phone.startsWith(dialCode + ' ') || form.phone === dialCode) return;
    const local = extractLocal(form.phone);
    setForm((f) => ({ ...f, phone: local ? `${dialCode} ${local}` : '' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.country]);

  // ── Pincode → city / state auto-fill (India only) ─────────
  useEffect(() => {
    const pin = form.pincode?.trim();
    if (!/^\d{6}$/.test(pin)) return;
    if (form.country && form.country !== 'India') return;
    pincodeAbort.current?.abort();
    const ctrl = new AbortController();
    pincodeAbort.current = ctrl;
    (async () => {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: ctrl.signal });
        const data = await res.json();
        if (data[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
          const po = data[0].PostOffice[0];
          setForm((f) => ({
            ...f,
            city:    f.city    || po.Division || po.Block || '',
            state:   f.state   || po.State    || '',
            country: f.country || 'India',
          }));
        }
      } catch { /* aborted or network error — ignore */ }
    })();
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.pincode]);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handlePhoneChange = (fullPhone) => {
    let countryFromDial = null;
    for (const code of KNOWN_DIALS) {
      if (fullPhone.startsWith(code + ' ') || fullPhone === code) {
        countryFromDial = DIAL_TO_COUNTRY[code];
        break;
      }
    }
    setForm((f) => ({
      ...f,
      phone: fullPhone,
      ...(countryFromDial && f.country !== countryFromDial ? { country: countryFromDial } : {}),
    }));
  };

  const handleNameChange = (e) => {
    const name = e.target.value;
    const baseSlug = toSlug(name);
    autoSlugRef.current = baseSlug;
    setForm((prev) => ({ ...prev, name, slug: baseSlug }));
  };

  const handleSlugChange = (e) => {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    autoSlugRef.current = slug;
    setForm((prev) => ({ ...prev, slug }));
  };

  const handleMapChange = ({ lat, lng }) => {
    setForm((prev) => ({ ...prev, latitude: lat, longitude: lng }));
  };

  // ── OTP send ─────────────────────────────────────────────────
  const handleSendOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Enter a valid email first');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await sendVerificationOtp(trimmed);
      setVerifiedEmail(trimmed);
      setOtpSent(true);
      setResendCooldown(60);
      if (res.data?.dev) {
        toast('DEV: OTP is in the server logs (BREVO_API_KEY not set)', { icon: '⚠️', duration: 8000 });
      } else {
        toast.success('Verification code sent — check your inbox (and spam folder)');
      }
    } catch (err) {
      // Sync cooldown from backend if it sent retryAfter
      const retryAfter = err.response?.data?.retryAfter;
      if (retryAfter) {
        setResendCooldown(retryAfter);
        if (!otpSent) { setVerifiedEmail(trimmed); setOtpSent(true); }
      }
      toast.error(getApiError(err));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setOtpSent(false);
    setVerifiedEmail('');
    setEmailVerifiedToken('');
    setOtp('');
  };

  const [step1Loading, setStep1Loading] = useState(false);

  // Stage 1: validate → auto-send OTP → show OTP input
  // Stage 2: verify OTP → create account → proceed to Step 2
  const handleStep1Continue = async (e) => {
    e.preventDefault();

    if (!otpSent) {
      // ── Stage 1: send OTP ──────────────────────────────────────
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        toast.error('Enter a valid email address'); return;
      }
      if (password.length < 8) {
        toast.error('Password must be at least 8 characters'); return;
      }
      setStep1Loading(true);
      try {
        const res = await sendVerificationOtp(trimmed);
        setVerifiedEmail(trimmed);
        setOtpSent(true);
        setResendCooldown(60);
        if (res.data?.dev) {
          toast('DEV: OTP printed to server logs (BREVO_API_KEY not set)', { icon: '⚠️', duration: 8000 });
        } else {
          toast.success('Verification code sent — check your inbox');
        }
      } catch (err) {
        const retryAfter = err.response?.data?.retryAfter;
        if (retryAfter) {
          setResendCooldown(retryAfter);
          setVerifiedEmail(trimmed);
          setOtpSent(true); // show OTP box even on cooldown — code was already sent
        }
        toast.error(getApiError(err));
      } finally {
        setStep1Loading(false);
      }
      return;
    }

    // ── Stage 2: verify OTP + create account ──────────────────
    if (otp.length < 6) { toast.error('Enter the 6-digit code sent to your email'); return; }

    setStep1Loading(true);
    try {
      const token = emailVerifiedToken || (await preVerifyEmail(verifiedEmail, otp)).data.emailVerifiedToken;
      setEmailVerifiedToken(token);
      await createAccount({ email: verifiedEmail, password, emailVerifiedToken: token });
      setPassword('');
      setOtp('');
      setOtpSent(false);
      setEmailVerifiedToken('');
      clearDraft();
      setStep(2);
      toast.success('Account created! Now finish your café setup.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const msg = getApiError(err);
      const code = err.response?.data?.errorCode;
      toast.error(msg);
      if (['OTP_NOT_SENT', 'OTP_EXPIRED', 'OTP_MAX_ATTEMPTS'].includes(code)) {
        setOtpSent(false);
        setVerifiedEmail('');
        setOtp('');
      }
    } finally {
      setStep1Loading(false);
    }
  };

  // ── Final submit ─────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone.trim())   { toast.error('Phone number is required'); return; }
    if (!form.address.trim()) { toast.error('Address line 1 is required'); return; }
    if (!form.city.trim())    { toast.error('City is required'); return; }
    if (!form.country)        { toast.error('Country is required'); return; }
    if (slugStatus === 'taken')    { toast.error('Slug is already taken — please change it'); return; }
    if (slugStatus === 'checking') { toast.error('Please wait while slug is being checked'); return; }
    if (!agreedToTerms) { toast.error('Please accept the Terms & Conditions to continue'); return; }

    setLoading(true);
    try {
      await completeSetup(form);
      registeredRef.current = true;
      clearDraft();
      toast.success('Cafe setup completed successfully!');
      navigate('/owner/dashboard');
    } catch (err) {
      const errors = err.response?.data?.errors;
      if (errors) {
        errors.forEach((e) => toast.error(e.msg));
      } else {
        toast.error(getApiError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const slugIndicator = () => {
    if (!form.slug) return null;
    if (slugStatus === 'checking') return <span className="text-xs text-gray-400">Checking...</span>;
    if (slugStatus === 'available') return <span className="text-xs text-green-600 font-medium">✓ Available</span>;
    if (slugStatus === 'taken') return <span className="text-xs text-red-600 font-medium">✗ Already taken — please change it</span>;
    return null;
  };

  return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4 pt-10 pb-28 sm:py-10">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4"><DineLogo size="xl" /></div>
          <h1 className="text-2xl font-bold text-gray-900">Register your Café</h1>
          <p className="text-gray-500 text-sm mt-1">Start accepting orders in minutes</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s ? 'bg-brand-500 text-white' :
                step > s ? 'bg-green-500 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {step > s ? '✓' : s}
              </div>
              <span className={`text-xs font-medium ${step === s ? 'text-gray-800' : 'text-gray-400'}`}>
                {s === 1 ? 'Create Account' : 'Cafe Details'}
              </span>
              {s < 2 && <div className={`w-8 h-px ${step > s ? 'bg-green-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="card shadow-lg">

          {/* ── STEP 1: Email + Password → auto OTP → Create Account ── */}
          {step === 1 && (
            <form id="reg-form-1" onSubmit={handleStep1Continue} className="space-y-5">
              <p className="text-sm font-semibold text-gray-700">
                {otpSent ? 'Enter the code we sent to your email.' : 'Create your owner account.'}
              </p>

              <div className="space-y-3">
                {/* Email — editable before OTP, locked after */}
                <div>
                  <label className="label">Email Address *</label>
                  {otpSent ? (
                    <div className="flex items-center gap-2">
                      <div className="input flex-1 bg-green-50 border-green-400 flex items-center gap-2 cursor-default select-none">
                        <span className="text-green-600 text-sm">✓</span>
                        <span className="truncate text-sm text-gray-700">{verifiedEmail}</span>
                      </div>
                      <button type="button" onClick={handleChangeEmail}
                        className="text-xs text-gray-500 hover:text-gray-700 underline whitespace-nowrap">
                        Change
                      </button>
                    </div>
                  ) : (
                    <input
                      type="email"
                      className="input"
                      placeholder="owner@cafe.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoFocus
                      required
                    />
                  )}
                </div>

                {/* Password — hidden once OTP is sent */}
                {!otpSent && (
                  <div>
                    <label className="label">Password *</label>
                    <PasswordInput
                      className="input"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <PasswordStrength password={password} />
                  </div>
                )}

                {/* OTP boxes — appear after auto-send */}
                {otpSent && (
                  <div>
                    <label className="label text-center block mb-3">6-digit verification code</label>
                    <OtpInput value={otp} onChange={setOtp} autoFocus />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">Expires in 5 min</p>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={otpLoading || resendCooldown > 0}
                        className="text-xs text-brand-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="hidden sm:block">
                <button
                  type="submit"
                  disabled={step1Loading || (!otpSent && (!email || password.length < 8)) || (otpSent && otp.length < 6)}
                  className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {step1Loading
                    ? (otpSent ? 'Verifying…' : 'Sending code…')
                    : (otpSent ? 'Verify & Create Account →' : 'Register →')}
                </button>
              </div>

              <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
                <span>🔒</span> Your email is verified before the account is created
              </p>

              <p className="text-center text-sm text-gray-500">
                Already registered?{' '}
                <Link to="/owner/login" className="text-brand-600 font-medium hover:underline">Sign in</Link>
              </p>
            </form>
          )}

          {/* ── STEP 2: Business + Location ── */}
          {step === 2 && (
            <form id="reg-form-2" onSubmit={handleSubmit} className="space-y-5">

              {/* Verified email pill */}
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                <span className="text-green-600 text-sm">✓</span>
                <span className="text-sm text-green-800 font-medium">{verifiedEmail}</span>
                <button
                  type="button"
                  onClick={() => { handleChangeEmail(); setStep(1); }}
                  className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Change
                </button>
              </div>

              {/* Brand Info */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Brand Info</p>
                <div className="space-y-3">

                  <div>
                    <label className="label">Café / Restaurant Name *</label>
                    <input className="input" placeholder="The Coffee House" value={form.name} onChange={handleNameChange} required />
                  </div>

                  <div>
                    <label className="label">URL Slug *</label>
                    <div className="flex">
                      <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg px-3 flex items-center text-sm text-gray-500 whitespace-nowrap">
                        /cafe/
                      </span>
                      <input
                        className={`input rounded-l-none ${slugStatus === 'taken' ? 'border-red-400 focus:ring-red-300' : slugStatus === 'available' ? 'border-green-400 focus:ring-green-300' : ''}`}
                        placeholder="coffee-house"
                        value={form.slug}
                        onChange={handleSlugChange}
                        required
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-gray-400">yourapp.com/cafe/{form.slug || 'your-slug'}</p>
                      {slugIndicator()}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Business Type *</label>
                      <select className="input" value={form.business_type} onChange={setField('business_type')} required>
                        {BUSINESS_TYPES.map((b) => (
                          <option key={b.value} value={b.value}>{b.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Currency *</label>
                      <select className="input" value={form.currency} onChange={setField('currency')} required>
                        <option value="INR">INR — Indian Rupee (₹)</option>
                        <option value="USD">USD — US Dollar ($)</option>
                        <option value="EUR">EUR — Euro (€)</option>
                        <option value="GBP">GBP — British Pound (£)</option>
                        <option value="AUD">AUD — Australian Dollar (A$)</option>
                        <option value="CAD">CAD — Canadian Dollar (C$)</option>
                        <option value="SGD">SGD — Singapore Dollar (S$)</option>
                        <option value="AED">AED — UAE Dirham (د.إ)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="label">Description</label>
                    <textarea className="input resize-none" rows={2} placeholder="A cozy place for great coffee..."
                      value={form.description} onChange={setField('description')} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">GST Number</label>
                      <input
                        className="input uppercase"
                        placeholder="22AAAAA0000A1Z5"
                        value={form.gst_number}
                        onChange={setField('gst_number')}
                      />
                    </div>
                    <div>
                      <label className="label">Tax Rate</label>
                      <select className="input" value={form.gst_rate} onChange={setField('gst_rate')}>
                        <option value={0}>0%</option>
                        <option value={5}>5%</option>
                        <option value={12}>12%</option>
                        <option value={18}>18%</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contact</p>
                <div>
                  <label className="label">Phone Number *</label>
                  <PhoneInput
                    value={form.phone}
                    onChange={handlePhoneChange}
                    placeholder="xxxxx xxxxx"
                    required
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Location</p>
                <div className="space-y-3">

                  <div>
                    <label className="label">Country *</label>
                    <select className="input" value={form.country} onChange={setField('country')} required>
                      <option value="">Select country...</option>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="label">Address Line 1 * <span className="text-gray-400 font-normal">(Building / Street)</span></label>
                    <input className="input" placeholder="e.g. 123 Main Street, Suite 4"
                      value={form.address} onChange={setField('address')} />
                  </div>

                  <div>
                    <label className="label">Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input className="input" placeholder="e.g. Near Central Park, Downtown"
                      value={form.address_line2} onChange={setField('address_line2')} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">City *</label>
                      <input className="input" placeholder="e.g. Mumbai" value={form.city} onChange={setField('city')} />
                    </div>
                    <div>
                      <label className="label">Postal Code</label>
                      <input className="input" placeholder="e.g. 400001" maxLength={10}
                        value={form.pincode} onChange={setField('pincode')} />
                    </div>
                  </div>

                  <div>
                    <label className="label">State / Region</label>
                    <input className="input" placeholder="e.g. Maharashtra"
                      value={form.state} onChange={setField('state')} />
                  </div>

                  <div>
                    <label className="label">Map Preview</label>
                    <MapPicker
                      lat={form.latitude}
                      lng={form.longitude}
                      address={[form.address, form.address_line2, form.city, form.state, form.pincode, form.country].filter(Boolean).join(', ')}
                      onChange={handleMapChange}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      We auto-locate your cafe from the typed address. You can still adjust the pin if needed.
                    </p>
                  </div>
                </div>
              </div>

              {/* Trust signals */}
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400 py-1">
                <span className="flex items-center gap-1">🔒 Secure &amp; encrypted</span>
                <span className="flex items-center gap-1">🚫 No spam, ever</span>
                <span className="flex items-center gap-1">⚡ Instant setup</span>
              </div>

              {/* T&C */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I have read and agree to the{' '}
                  <Link to="/terms" target="_blank" className="text-brand-600 font-medium hover:underline">Terms & Conditions</Link>
                  {' '}and{' '}
                  <Link to="/privacy" target="_blank" className="text-brand-600 font-medium hover:underline">Privacy Policy</Link>.
                  {' '}I confirm I am authorised to register this food business on DineVerse.
                </span>
              </label>

              <div className="hidden sm:flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={accountCreated ? 'hidden' : 'btn-secondary flex-shrink-0'}
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !agreedToTerms || slugStatus === 'taken' || slugStatus === 'checking'}
                  className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving cafe setup…' : 'Finish Cafe Setup'}
                </button>
              </div>

              <p className="text-center text-sm text-gray-500">
                Already registered?{' '}
                <Link to="/owner/login" className="text-brand-600 font-medium hover:underline">Sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>

    {/* ── Mobile sticky CTA — Step 1 ────────────────────────────── */}
    {step === 1 && (
      <div className="sm:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 z-20"
           style={{ boxShadow: '0 -2px 12px rgba(0,0,0,0.08)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button
          type="submit"
          form="reg-form-1"
          disabled={step1Loading || (!otpSent && (!email || password.length < 8)) || (otpSent && otp.length < 6)}
          className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {step1Loading
            ? (otpSent ? 'Verifying…' : 'Sending code…')
            : (otpSent ? 'Verify & Create Account →' : 'Register →')}
        </button>
      </div>
    )}

    {/* ── Mobile sticky CTA — Step 2 ────────────────────────────── */}
    {step === 2 && (
      <div className="sm:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 z-20"
           style={{ boxShadow: '0 -2px 12px rgba(0,0,0,0.08)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={accountCreated ? 'hidden' : 'btn-secondary flex-shrink-0'}
          >
            ← Back
          </button>
          <button
            type="submit"
            form="reg-form-2"
            disabled={loading || !agreedToTerms || slugStatus === 'taken' || slugStatus === 'checking'}
            className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving cafe setup…' : 'Finish Cafe Setup'}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
