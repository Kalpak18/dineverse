import { useState, useEffect } from 'react';
import { getStaff, createStaff, updateStaff, deleteStaff, resetStaffPassword } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHint from '../../components/PageHint';
import PasswordInput from '../../components/PasswordInput';

const ROLES = [
  { value: 'cashier',  label: 'Cashier',  desc: 'Takes orders and processes payments' },
  { value: 'kitchen',  label: 'Kitchen',  desc: 'Views and updates kitchen order queue' },
  { value: 'waiter',   label: 'Waiter',   desc: 'Serves ready dishes to tables via waiter view' },
  { value: 'manager',  label: 'Manager',  desc: 'Full access like owner (except billing)' },
];

const ROLE_BADGE = {
  cashier: 'bg-blue-100 text-blue-700',
  kitchen: 'bg-orange-100 text-orange-700',
  waiter:  'bg-teal-100 text-teal-700',
  manager: 'bg-purple-100 text-purple-700',
};

function initForm() {
  return { name: '', email: '', password: '', role: 'cashier' };
}

export default function StaffPage() {
  const [staff, setStaff]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState(initForm());
  const [saving, setSaving]       = useState(false);
  const [deletingId, setDeletingId]     = useState(null);
  const [togglingId, setTogglingId]     = useState(null);
  const [resetTarget, setResetTarget]   = useState(null); // { id, name }
  const [newPassword, setNewPassword]   = useState('');
  const [resetting, setResetting]       = useState(false);

  const loadStaff = async () => {
    try {
      const { data } = await getStaff();
      setStaff(data.staff || []);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStaff(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await createStaff(form);
      setStaff((prev) => [...prev, data.staff]);
      setForm(initForm());
      setShowAdd(false);
      toast.success('Staff account created');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member) => {
    setTogglingId(member.id);
    try {
      const { data } = await updateStaff(member.id, { is_active: !member.is_active });
      setStaff((prev) => prev.map((s) => s.id === member.id ? data.staff : s));
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setTogglingId(null);
    }
  };

  const handleRoleChange = async (member, role) => {
    try {
      const { data } = await updateStaff(member.id, { role });
      setStaff((prev) => prev.map((s) => s.id === member.id ? data.staff : s));
      toast.success('Role updated');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setResetting(true);
    try {
      await resetStaffPassword(resetTarget.id, newPassword);
      toast.success(`Password reset for ${resetTarget.name}`);
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this staff account? They will lose access immediately.')) return;
    setDeletingId(id);
    try {
      await deleteStaff(id);
      setStaff((prev) => prev.filter((s) => s.id !== id));
      toast.success('Staff account deleted');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner /></div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageHint
        storageKey="dv_hint_staff"
        title="Staff — give your team their own logins with the right level of access"
        items={[
          { icon: '💰', text: 'Cashier: Orders, Bills, Messages, Shifts. Accepts orders, collects payment, prints bills.' },
          { icon: '🍳', text: 'Kitchen: Kitchen display only. Advances orders Confirmed → Preparing → Ready (and per-item in KDS mode).' },
          { icon: '🍽️', text: 'Waiter: Waiter view only. Marks ready dishes as served once delivered to the table.' },
          { icon: '🧑‍💼', text: 'Manager: Full access like owner — Orders, Kitchen, Analytics, Menu, Staff, and more.' },
          { icon: '🔐', text: 'Staff log in at the same /owner/login page with their own email + password.' },
          { icon: '🔴', text: 'Deactivate a staff account instantly — they lose access immediately. Re-enable anytime.' },
        ]}
        tip="Never share the owner password. Create individual staff accounts so you can track and revoke access per person."
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage who can access your orders and kitchen view</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          + Add Staff
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {ROLES.map((r) => (
          <div key={r.value} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[r.value]}`}>{r.label}</span>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{r.desc}</p>
          </div>
        ))}
      </div>

      {staff.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-2xl">
          <div className="text-4xl mb-3">👥</div>
          <p className="font-medium text-gray-600">No staff accounts yet</p>
          <p className="text-sm mt-1">Add staff so your team can manage orders without sharing your login.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((member) => (
            <div
              key={member.id}
              className={`flex items-center gap-4 bg-white border rounded-xl p-4 transition-opacity ${
                !member.is_active ? 'opacity-50' : ''
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                <span className="text-brand-700 font-bold text-sm">
                  {member.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
                  {!member.is_active && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{member.email}</p>
              </div>
              {/* Role selector */}
              <select
                value={member.role || 'cashier'}
                onChange={(e) => handleRoleChange(member, e.target.value)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border-0 outline-none cursor-pointer ${ROLE_BADGE[member.role || 'cashier']}`}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {/* Toggle active */}
              <button
                onClick={() => handleToggleActive(member)}
                disabled={togglingId === member.id}
                title={member.is_active ? 'Disable access' : 'Enable access'}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
              >
                {member.is_active ? '🟢' : '🔴'}
              </button>
              {/* Reset password */}
              <button
                onClick={() => { setResetTarget({ id: member.id, name: member.name }); setNewPassword(''); }}
                title="Reset password"
                className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-300 hover:text-amber-500 transition-colors"
              >
                🔑
              </button>
              {/* Delete */}
              <button
                onClick={() => handleDelete(member.id)}
                disabled={deletingId === member.id}
                title="Delete"
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add staff modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-brand-500 rounded-t-2xl" />
            <div className="p-5">
              <h3 className="font-bold text-gray-900 text-lg mb-4">Add Staff Member</h3>
              <form onSubmit={handleAdd} className="space-y-3">
                <div>
                  <label className="label">Name</label>
                  <input className="input" required value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" required value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Password</label>
                  <PasswordInput className="input" required minLength={8} value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Role</label>
                  <select className="input" value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                    {saving ? 'Creating…' : 'Create Account'}
                  </button>
                  <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setResetTarget(null); setNewPassword(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="h-1 bg-amber-500 rounded-t-2xl" />
            <div className="p-5">
              <h3 className="font-bold text-gray-900 text-lg mb-1">Reset Password</h3>
              <p className="text-sm text-gray-500 mb-4">Set a new password for <strong>{resetTarget.name}</strong>. They can change it after logging in.</p>
              <div className="space-y-3">
                <div>
                  <label className="label">New Password</label>
                  <PasswordInput
                    className="input"
                    placeholder="Min. 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleResetPassword}
                    disabled={resetting || newPassword.length < 8}
                    className="btn-primary flex-1 disabled:opacity-60"
                  >
                    {resetting ? 'Resetting…' : 'Reset Password'}
                  </button>
                  <button
                    onClick={() => { setResetTarget(null); setNewPassword(''); }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
