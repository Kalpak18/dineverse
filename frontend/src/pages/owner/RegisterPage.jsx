import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DineLogo from '../../components/DineLogo';
import { useAuth } from '../../context/AuthContext';
import { checkSlugAvailability, sendVerificationOtp } from '../../services/api';
import toast from 'react-hot-toast';

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

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu',
  'Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', slug: '', email: '', password: '', description: '', phone: '',
    address: '', address_line2: '', city: '', state: '', pincode: '',
    business_type: 'restaurant',
    currency: 'INR',
  });
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState(''); // email OTP was actually sent to
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [slugStatus, setSlugStatus] = useState('idle'); // idle | checking | available | taken
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const slugCheckTimer = useRef(null);
  const cooldownTimer  = useRef(null);
  const autoSlugRef    = useRef('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Auto-generate slug from name
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

  // Debounced slug availability check
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
          // Try city-appended variant automatically
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
      } catch {
        setSlugStatus('idle');
      }
    }, 500);
    return () => clearTimeout(slugCheckTimer.current);
  }, [form.slug, form.city]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownTimer.current = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(cooldownTimer.current);
  }, [resendCooldown]);

  const handleSendOtp = async () => {
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error('Enter a valid email first');
      return;
    }
    setOtpLoading(true);
    try {
      const emailToVerify = form.email.trim().toLowerCase();
      await sendVerificationOtp(emailToVerify);
      setVerifiedEmail(emailToVerify); // lock the email OTP was sent to
      setOtpSent(true);
      setResendCooldown(60);
      toast.success('Verification code sent to your email');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send code');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!otpSent)              { toast.error('Please verify your email first'); return; }
    if (!otp.trim())           { toast.error('Enter the verification code'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (!form.phone.trim())    { toast.error('Phone number is required'); return; }
    if (!form.address.trim())  { toast.error('Address line 1 is required'); return; }
    if (!form.city.trim())     { toast.error('City is required'); return; }
    if (!form.state)           { toast.error('State is required'); return; }
    if (!form.pincode.trim())  { toast.error('Pincode is required'); return; }
    if (slugStatus === 'taken')    { toast.error('Slug is already taken — please change it'); return; }
    if (slugStatus === 'checking') { toast.error('Please wait while slug is being checked'); return; }
    if (!agreedToTerms) { toast.error('Please accept the Terms & Conditions to continue'); return; }

    setLoading(true);
    try {
      await register({ ...form, email: verifiedEmail, otp });
      toast.success('Café registered successfully!');
      navigate('/owner/dashboard');
    } catch (err) {
      const errors = err.response?.data?.errors;
      if (errors) {
        errors.forEach((e) => toast.error(e.msg));
      } else {
        toast.error(err.response?.data?.error || 'Registration failed');
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
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <DineLogo size="xl" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Register your Café</h1>
          <p className="text-gray-500 text-sm mt-1">Start accepting orders in minutes</p>
        </div>

        <div className="card shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* ── Brand Info ── */}
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Business Type *</label>
                    <select className="input" value={form.business_type} onChange={set('business_type')} required>
                      {BUSINESS_TYPES.map((b) => (
                        <option key={b.value} value={b.value}>{b.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Used to calculate the correct GST rate on orders.</p>
                  </div>
                  <div>
                    <label className="label">Currency *</label>
                    <select className="input" value={form.currency} onChange={set('currency')} required>
                      <option value="INR">INR — Indian Rupee (₹)</option>
                      <option value="USD">USD — US Dollar ($)</option>
                      <option value="EUR">EUR — Euro (€)</option>
                      <option value="GBP">GBP — British Pound (£)</option>
                      <option value="AUD">AUD — Australian Dollar (A$)</option>
                      <option value="CAD">CAD — Canadian Dollar (C$)</option>
                      <option value="SGD">SGD — Singapore Dollar (S$)</option>
                      <option value="AED">AED — UAE Dirham (د.إ)</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">All menu prices will display in this currency.</p>
                  </div>
                </div>

                <div>
                  <label className="label">Description</label>
                  <textarea className="input resize-none" rows={2} placeholder="A cozy place for great coffee..."
                    value={form.description} onChange={set('description')} />
                </div>
              </div>
            </div>

            {/* ── Account ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Account</p>
              <div className="space-y-3">

                <div>
                  <label className="label">Email *</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      className={`input flex-1 ${otpSent ? 'border-green-400' : ''}`}
                      placeholder="owner@cafe.com"
                      value={form.email}
                      onChange={(e) => { setForm({ ...form, email: e.target.value }); if (otpSent) { setOtpSent(false); setVerifiedEmail(''); } }}
                      required
                    />
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={otpLoading || resendCooldown > 0}
                      className="btn-secondary whitespace-nowrap text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {otpLoading ? 'Sending...' : resendCooldown > 0 ? `Resend (${resendCooldown}s)` : otpSent ? 'Resend' : 'Send Code'}
                    </button>
                  </div>
                  {otpSent && <p className="text-xs text-green-600 mt-1 font-medium">✓ Code sent — check your inbox (and spam folder)</p>}
                </div>

                {otpSent && (
                  <div>
                    <label className="label">Verification Code *</label>
                    <input
                      type="text" inputMode="numeric" maxLength={6}
                      className="input tracking-widest text-center font-mono text-lg"
                      placeholder="_ _ _ _ _ _"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1">6-digit code — expires in 10 minutes</p>
                  </div>
                )}

                <div>
                  <label className="label">Password *</label>
                  <input type="password" className="input" placeholder="At least 8 characters"
                    value={form.password} onChange={set('password')} required />
                </div>

                <div>
                  <label className="label">Phone Number *</label>
                  <input type="tel" className="input" placeholder="+91 98765 43210"
                    value={form.phone} onChange={set('phone')} required />
                </div>
              </div>
            </div>

            {/* ── Location ── */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Location</p>
              <div className="space-y-3">

                <div>
                  <label className="label">Address Line 1 * <span className="text-gray-400 font-normal">(Shop/Building, Street)</span></label>
                  <input className="input" placeholder="e.g. Shop 4, Sunrise Complex, MG Road"
                    value={form.address} onChange={set('address')} />
                </div>

                <div>
                  <label className="label">Address Line 2 <span className="text-gray-400 font-normal">(optional — Floor, Landmark, Area)</span></label>
                  <input className="input" placeholder="e.g. Near Kotak Bank, Andheri West"
                    value={form.address_line2} onChange={set('address_line2')} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">City *</label>
                    <input className="input" placeholder="Mumbai" value={form.city} onChange={set('city')} />
                  </div>
                  <div>
                    <label className="label">Pincode *</label>
                    <input className="input" placeholder="400001" maxLength={10}
                      value={form.pincode} onChange={set('pincode')} />
                  </div>
                </div>

                <div>
                  <label className="label">State *</label>
                  <select className="input" value={form.state} onChange={set('state')}>
                    <option value="">Select state...</option>
                    {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {!otpSent && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                You must verify your email before creating your account.
              </p>
            )}

            {/* T&C acceptance */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                I have read and agree to the{' '}
                <Link to="/terms" target="_blank" className="text-brand-600 font-medium hover:underline">
                  Terms & Conditions
                </Link>{' '}
                and{' '}
                <Link to="/privacy" target="_blank" className="text-brand-600 font-medium hover:underline">
                  Privacy Policy
                </Link>
                . I confirm I am authorised to register this food business on DineVerse.
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !otpSent || !agreedToTerms || slugStatus === 'taken' || slugStatus === 'checking'}
              className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Create Café Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-4">
            Already registered?{' '}
            <Link to="/owner/login" className="text-brand-600 font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
