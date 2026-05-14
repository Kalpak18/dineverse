import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { riderSendOtp, riderVerifyOtp } from '../../services/api';
import { useRiderAuth } from '../../context/RiderAuthContext';
import { getApiError } from '../../utils/apiError';

export default function RiderLoginPage() {
  const navigate = useNavigate();
  const { login } = useRiderAuth();

  const [email, setEmail]   = useState('');
  const [otp, setOtp]       = useState('');
  const [stage, setStage]   = useState('email'); // 'email' | 'otp'
  const [busy, setBusy]     = useState(false);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Enter a valid email'); return;
    }
    setBusy(true);
    try {
      await riderSendOtp(email.trim());
      toast.success('Code sent to your email');
      setStage('otp');
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setBusy(false); }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) { toast.error('Enter the 6-digit code'); return; }
    setBusy(true);
    try {
      const { data } = await riderVerifyOtp(email.trim(), otp);
      login(data.token, data.rider);
      toast.success(`Welcome back, ${data.rider?.name || 'rider'}!`);
      navigate('/rider/jobs', { replace: true });
    } catch (err) {
      toast.error(getApiError(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500 text-white text-2xl mb-3 shadow-lg">🛵</div>
          <h1 className="text-2xl font-black text-gray-900">DineVerse Rider</h1>
          <p className="text-sm text-gray-500 mt-1">Log in to see your delivery jobs</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          {stage === 'email' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  autoFocus
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rider@example.com"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-sm transition-colors"
              >
                {busy ? 'Sending…' : 'Send code'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                New rider?{' '}
                <Link to="/rider/register" className="text-orange-500 font-semibold hover:underline">
                  Register here
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <p className="text-sm text-gray-700">
                  We sent a 6-digit code to <span className="font-semibold">{email}</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
                  Verification code
                </label>
                <input
                  type="text"
                  autoFocus
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-center text-xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <button
                type="submit"
                disabled={busy || otp.length !== 6}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-sm transition-colors"
              >
                {busy ? 'Verifying…' : 'Verify & log in'}
              </button>
              <button
                type="button"
                onClick={() => { setStage('email'); setOtp(''); }}
                className="w-full text-xs text-gray-500 hover:text-gray-700"
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>

        {/* Phone login placeholder — uncomment when SMS gateway is wired */}
        {/*
        <div className="mt-4 text-center">
          <button className="text-xs text-gray-400 hover:text-gray-600">
            Or log in with phone OTP →
          </button>
        </div>
        */}
      </div>
    </div>
  );
}
