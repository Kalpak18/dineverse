import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminForgotPassword, adminResetPassword } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';

export default function AdminForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // email → otp → password
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer.current);
  }, [cooldown]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toast.error('Enter your admin email'); return; }
    setLoading(true);
    try {
      await adminForgotPassword(email.trim().toLowerCase());
      toast.success('Reset code sent to your email');
      setStep('otp');
      setCooldown(60);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || loading) return;
    setLoading(true);
    try {
      await adminForgotPassword(email.trim().toLowerCase());
      toast.success('New code sent');
      setCooldown(60);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = (e) => {
    e.preventDefault();
    if (otp.length !== 6) { toast.error('Enter the 6-digit code'); return; }
    setStep('password');
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await adminResetPassword(email.trim().toLowerCase(), otp, password);
      toast.success('Password updated! Please log in.');
      navigate('/admin/login', { replace: true });
    } catch (err) {
      const msg = getApiError(err);
      toast.error(msg);
      if (msg.toLowerCase().includes('otp') || msg.toLowerCase().includes('code') || msg.toLowerCase().includes('expired')) {
        setOtp('');
        setStep('otp');
      }
    } finally {
      setLoading(false);
    }
  };

  const steps = ['email', 'otp', 'password'];

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Developer Console</h1>
          <p className="text-gray-400 text-sm mt-1">Reset admin password</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s
                  ? 'bg-brand-600 text-white'
                  : steps.indexOf(s) < steps.indexOf(step)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-500'
              }`}>
                {steps.indexOf(s) < steps.indexOf(step) ? '✓' : i + 1}
              </div>
              {i < 2 && <div className={`w-8 h-0.5 ${steps.indexOf(s) < steps.indexOf(step) ? 'bg-green-600' : 'bg-gray-800'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">

          {/* Step 1 */}
          {step === 'email' && (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Forgot password?</h2>
              <p className="text-xs text-gray-500 mb-5">Enter the email tied to your admin account and we'll send a reset code.</p>
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Admin Email</label>
                  <input
                    type="email"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="you@dine-verse.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus required
                  />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60">
                  {loading ? 'Sending...' : 'Send Reset Code'}
                </button>
              </form>
            </>
          )}

          {/* Step 2 */}
          {step === 'otp' && (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Check your inbox</h2>
              <p className="text-xs text-gray-500 mb-5">
                Reset code sent to <span className="text-gray-300 font-medium">{email}</span>
              </p>
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Reset Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-xl text-center font-mono tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="_ _ _ _ _ _"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                  />
                  <p className="text-xs text-gray-600 mt-1">Expires in 10 minutes</p>
                </div>
                <button
                  type="submit"
                  disabled={otp.length !== 6}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60"
                >
                  Verify Code
                </button>
              </form>
              <div className="mt-3 text-center space-y-2">
                <button
                  onClick={handleResend}
                  disabled={cooldown > 0 || loading}
                  className="text-sm text-brand-500 hover:underline disabled:text-gray-600 disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
                <br />
                <button onClick={() => { setStep('email'); setOtp(''); }} className="text-xs text-gray-600 hover:text-gray-400">
                  ← Use a different email
                </button>
              </div>
            </>
          )}

          {/* Step 3 */}
          {step === 'password' && (
            <>
              <h2 className="text-base font-semibold text-white mb-1">New password</h2>
              <p className="text-xs text-gray-500 mb-5">Choose a strong password for your admin account.</p>
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">New Password</label>
                  <input
                    type="password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus required
                  />
                  {password.length > 0 && password.length < 8 && (
                    <p className="text-red-400 text-xs mt-1">Must be at least 8 characters</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Confirm Password</label>
                  <input
                    type="password"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                  {confirm.length > 0 && password !== confirm && (
                    <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading || password.length < 8 || password !== confirm}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60"
                >
                  {loading ? 'Updating...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          <p className="text-center text-xs text-gray-600 mt-5">
            <button onClick={() => navigate('/admin/login')} className="text-brand-500 hover:underline">
              ← Back to login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
