import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword, resetPassword } from '../../services/api';
// step: 'email' → 'otp' → 'password'
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimer = useRef(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownTimer.current = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(cooldownTimer.current);
  }, [resendCooldown]);

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  // Step 1: send reset OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      const { data } = await forgotPassword(email.trim().toLowerCase());
      setMaskedPhone(data.masked_phone || '');
      toast.success('Reset code sent to your registered mobile');
      setStep('otp');
      setResendCooldown(60);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP (same as step 1 but without moving steps)
  const handleResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setLoading(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      toast.success('New reset code sent to your mobile');
      setResendCooldown(60);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: verify OTP → move to password step
  const handleVerifyOtp = (e) => {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error('Enter the 6-digit code from your email');
      return;
    }
    setStep('password');
  };

  // Step 3: set new password
  const handleReset = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email.trim().toLowerCase(), otp, password);
      toast.success('Password updated! Please log in with your new password.');
      navigate('/owner/login');
    } catch (err) {
      const msg = getApiError(err);
      toast.error(msg);
      // If OTP was invalid/expired, send user back to OTP step
      if (msg.toLowerCase().includes('otp') || msg.toLowerCase().includes('code') || msg.toLowerCase().includes('expired')) {
        setOtp('');
        setStep('otp');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl">☕</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">DineVerse</h1>
          <p className="text-gray-500 text-sm mt-1">Reset your password</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {['email', 'otp', 'password'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s
                  ? 'bg-brand-500 text-white'
                  : ['otp', 'password'].indexOf(s) < ['email', 'otp', 'password'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}>
                {['otp', 'password'].indexOf(s) < ['email', 'otp', 'password'].indexOf(step) ? '✓' : i + 1}
              </div>
              {i < 2 && <div className={`w-8 h-0.5 ${
                ['otp', 'password'].indexOf(s) < ['email', 'otp', 'password'].indexOf(step) - 1 || step === 'password' && s === 'otp'
                  ? 'bg-green-400'
                  : step === s ? 'bg-brand-300' : 'bg-gray-200'
              }`} />}
            </div>
          ))}
        </div>

        <div className="card shadow-lg">
          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Forgot your password?</h2>
              <p className="text-sm text-gray-500 mb-5">Enter your registered email — we'll send a reset code to your linked mobile number via SMS.</p>
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="you@cafe.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'Sending...' : 'Send Reset Code'}
                </button>
              </form>
            </>
          )}

          {/* ── Step 2: OTP ── */}
          {step === 'otp' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Check your phone</h2>
              <p className="text-sm text-gray-500 mb-1">
                We sent a 6-digit reset code via SMS to your registered mobile
                {maskedPhone ? <span className="font-semibold text-gray-700"> (ending ••••{maskedPhone})</span> : ''}.
              </p>
              <p className="text-xs text-gray-400 mb-5">Didn't receive it? Check that your number is correct or tap Resend.</p>
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="label">Reset Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="input tracking-widest text-center font-mono text-xl"
                    placeholder="_ _ _ _ _ _"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1">Code expires in 10 minutes</p>
                </div>
                <button
                  type="submit"
                  disabled={otp.length !== 6}
                  className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Verify Code
                </button>
              </form>
              <div className="mt-4 text-center">
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || loading}
                  className="text-sm text-brand-600 font-medium hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
              <div className="mt-3 text-center">
                <button
                  onClick={() => { setStep('email'); setOtp(''); setMaskedPhone(''); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  ← Use a different email
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: New Password ── */}
          {step === 'password' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Create new password</h2>
              <p className="text-sm text-gray-500 mb-5">Choose a strong password for your account.</p>
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="label">New Password</label>
                  <input
                    type="password"
                    className="input"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    required
                  />
                  {password.length > 0 && password.length < 8 && (
                    <p className="text-xs text-red-500 mt-1">Must be at least 8 characters</p>
                  )}
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input
                    type="password"
                    className="input"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  {confirmPassword.length > 0 && password !== confirmPassword && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading || password.length < 8 || password !== confirmPassword}
                  className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Updating password...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          {/* Back to login */}
          <p className="text-center text-sm text-gray-500 mt-5">
            Remembered it?{' '}
            <Link to="/owner/login" className="text-brand-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
