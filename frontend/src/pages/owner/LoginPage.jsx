import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import DineLogo from '../../components/DineLogo';
import PasswordInput from '../../components/PasswordInput';

// Accepts email or phone (10-digit or +91 prefixed)
function isValidIdentifier(val) {
  const v = val.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;       // email
  if (/^(\+91[\s-]?)?[6-9]\d{9}$/.test(v.replace(/\s/g, ''))) return true; // IN mobile
  return false;
}

const STAFF_DEFAULT = { cashier: '/owner/orders', kitchen: '/owner/kitchen', manager: '/owner/dashboard', waiter: '/owner/kitchen' };

export default function LoginPage() {
  const { login, role, staffRole } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [registerDraft, setRegisterDraft] = useState(null); // { verifiedEmail, step }

  // Check for an incomplete registration draft in localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dv_register_draft');
      if (!saved) return;
      const d = JSON.parse(saved);
      // Only show the banner if email was fully pre-verified (token present)
      if (d.emailVerifiedToken && d.verifiedEmail && d.step === 2) {
        setRegisterDraft({ verifiedEmail: d.verifiedEmail });
      }
    } catch { /* ignore */ }
  }, []);

  const validate = () => {
    const e = {};
    if (!form.identifier.trim()) e.identifier = 'Email or phone number is required';
    else if (!isValidIdentifier(form.identifier)) e.identifier = 'Enter a valid email or phone number';
    if (!form.password) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await login(form.identifier.trim(), form.password);
      navigate('/owner');
    } catch (err) {
      // If the entered email matches a pending registration draft, prompt to continue
      const enteredEmail = form.identifier.trim().toLowerCase();
      if (registerDraft && enteredEmail === registerDraft.verifiedEmail) {
        toast(
          (t) => (
            <span className="text-sm">
              No account found — you have an unfinished registration.{' '}
              <button
                className="font-bold text-brand-600 underline"
                onClick={() => { toast.dismiss(t.id); navigate('/owner/register'); }}
              >
                Continue registration →
              </button>
            </span>
          ),
          { duration: 10000, icon: '📝' }
        );
      } else {
        toast.error(getApiError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4">
      <Link to="/" className="fixed top-4 left-4 z-50">
        <img src="/icons/header_logo_round_192x192.png" alt="DineVerse" className="w-9 h-9 rounded-full shadow-sm" />
      </Link>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <DineLogo size="xl" />
          </div>
          <p className="text-gray-500 text-sm mt-1">Owner & Staff dashboard</p>
        </div>

        {/* Incomplete registration banner */}
        {registerDraft && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 flex items-start gap-3">
            <span className="text-xl shrink-0">📝</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">You have an unfinished registration</p>
              <p className="text-xs text-amber-700 mt-0.5 truncate">Email verified: {registerDraft.verifiedEmail}</p>
              <Link
                to="/owner/register"
                className="inline-block mt-2 text-xs font-bold text-amber-900 bg-amber-200 hover:bg-amber-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                Continue registration → Step 2
              </Link>
            </div>
          </div>
        )}

        <div className="card shadow-lg">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">Sign in to your account</h2>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="label">Email or Phone</label>
              <input
                type="text"
                inputMode="email"
                autoComplete="username"
                className={`input ${errors.identifier ? 'border-red-400 focus:ring-red-300' : ''}`}
                placeholder="you@cafe.com or 9876543210"
                value={form.identifier}
                onChange={(e) => {
                  setForm({ ...form, identifier: e.target.value });
                  if (errors.identifier) setErrors({ ...errors, identifier: undefined });
                }}
              />
              {errors.identifier && <p className="text-red-500 text-xs mt-1">{errors.identifier}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Password</label>
                <Link to="/owner/forgot-password" className="text-xs text-brand-600 hover:underline font-medium">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                autoComplete="current-password"
                className={`input ${errors.password ? 'border-red-400 focus:ring-red-300' : ''}`}
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => {
                  setForm({ ...form, password: e.target.value });
                  if (errors.password) setErrors({ ...errors, password: undefined });
                }}
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            Don't have an account?{' '}
            <Link to="/owner/register" className="text-brand-600 font-medium hover:underline">
              Register your café
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
