import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminSetup, adminGetMe } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';
import PasswordInput from '../../components/PasswordInput';

export default function AdminSetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // If an admin token already exists and is valid → redirect to dashboard
  // If setup was already done → the endpoint returns 409, we redirect to login
  useEffect(() => {
    const token = localStorage.getItem('dineverse_admin_token');
    if (token) {
      adminGetMe()
        .then(() => navigate('/admin/dashboard', { replace: true }))
        .catch(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Valid email required';
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const { data } = await adminSetup({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      localStorage.setItem('dineverse_admin_token', data.token);
      toast.success(`Welcome, ${data.admin.name}! Developer console is ready.`);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      const msg = getApiError(err);
      // 409 = admin already exists
      if (msg.toLowerCase().includes('already exists') || err.response?.status === 409) {
        toast.error('Admin account already set up. Please log in.');
        navigate('/admin/login', { replace: true });
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white">DineVerse</h1>
          <p className="text-gray-400 text-sm mt-1">First-time developer setup</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-white">Create Developer Account</h2>
            <p className="text-xs text-gray-500 mt-1">This can only be done once. This account will have full admin access.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Name</label>
              <input
                type="text"
                className={`w-full bg-gray-800 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.name ? 'border-red-600' : 'border-gray-700'}`}
                placeholder="Kalpak"
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: undefined }); }}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email</label>
              <input
                type="email"
                className={`w-full bg-gray-800 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.email ? 'border-red-600' : 'border-gray-700'}`}
                placeholder="you@dine-verse.com"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors({ ...errors, email: undefined }); }}
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Password</label>
              <PasswordInput
                className={`w-full bg-gray-800 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.password ? 'border-red-600' : 'border-gray-700'}`}
                placeholder="At least 8 characters"
                value={form.password}
                onChange={(e) => { setForm({ ...form, password: e.target.value }); setErrors({ ...errors, password: undefined }); }}
              />
              {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Confirm Password</label>
              <PasswordInput
                className={`w-full bg-gray-800 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 ${errors.confirm ? 'border-red-600' : 'border-gray-700'}`}
                placeholder="Re-enter password"
                value={form.confirm}
                onChange={(e) => { setForm({ ...form, confirm: e.target.value }); setErrors({ ...errors, confirm: undefined }); }}
              />
              {errors.confirm && <p className="text-red-400 text-xs mt-1">{errors.confirm}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating account...' : 'Create Admin Account'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-600 mt-4">
            Already set up?{' '}
            <button onClick={() => navigate('/admin/login')} className="text-brand-500 hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
