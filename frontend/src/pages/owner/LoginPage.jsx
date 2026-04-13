import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import DineLogo from '../../components/DineLogo';

// Accepts email or phone (10-digit or +91 prefixed)
function isValidIdentifier(val) {
  const v = val.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;       // email
  if (/^(\+91[\s-]?)?[6-9]\d{9}$/.test(v.replace(/\s/g, ''))) return true; // IN mobile
  return false;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

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
      navigate('/owner/dashboard');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <DineLogo size="xl" pill />
          </div>
          <p className="text-gray-500 text-sm mt-1">Owner dashboard</p>
        </div>

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
              <input
                type="password"
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
