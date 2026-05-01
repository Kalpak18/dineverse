import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { fmtCurrency, fmtDateTime } from '../../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import {
  getLoyaltyProgram, saveLoyaltyProgram,
  getLoyaltyCustomers, adjustLoyaltyPoints, getLoyaltyTransactions,
} from '../../services/api';

const TABS = ['Program', 'Customers', 'Transactions'];

export default function LoyaltyPage() {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [tab, setTab] = useState('Program');

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Loyalty Program</h1>
        <span className="text-2xl">🎁</span>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t}</button>
        ))}
      </div>

      {tab === 'Program'      && <ProgramTab c={c} />}
      {tab === 'Customers'    && <CustomersTab c={c} />}
      {tab === 'Transactions' && <TransactionsTab />}
    </div>
  );
}

// ─── Program Settings ──────────────────────────────────────────
function ProgramTab({ c }) {
  const [form, setForm] = useState({
    points_per_rupee: '1',
    rupees_per_point: '0.25',
    min_points_redeem: '100',
    max_redeem_pct: '20',
    points_expiry_days: '365',
    is_active: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLoyaltyProgram()
      .then(({ data }) => {
        if (data.data.program) {
          const p = data.data.program;
          setForm({
            points_per_rupee: String(p.points_per_rupee ?? 1),
            rupees_per_point: String(p.rupees_per_point ?? 0.25),
            min_points_redeem: String(p.min_points_redeem ?? 100),
            max_redeem_pct: String(p.max_redeem_pct ?? 20),
            points_expiry_days: String(p.points_expiry_days ?? 365),
            is_active: p.is_active ?? true,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveLoyaltyProgram({
        points_per_rupee: parseFloat(form.points_per_rupee) || 1,
        rupees_per_point: parseFloat(form.rupees_per_point) || 0.25,
        min_points_redeem: parseInt(form.min_points_redeem) || 100,
        max_redeem_pct: parseFloat(form.max_redeem_pct) || 20,
        points_expiry_days: parseInt(form.points_expiry_days) || 365,
        is_active: form.is_active,
      });
      toast.success('Loyalty program saved');
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Loading…</div>;

  const exampleBill = 500;
  const earned = Math.floor(exampleBill * parseFloat(form.points_per_rupee || 1));
  const pointValue = (earned * parseFloat(form.rupees_per_point || 0.25)).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Preview card */}
      <div className="card bg-gradient-to-br from-brand-50 to-purple-50 border-brand-100">
        <p className="text-xs font-semibold text-brand-700 mb-2">Example</p>
        <p className="text-sm text-gray-700">
          Customer pays <strong>₹{exampleBill}</strong> → earns <strong>{earned} pts</strong> → worth <strong>₹{pointValue}</strong>
        </p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-800">Program Settings</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-500">Active</span>
            <button
              onClick={() => set('is_active', !form.is_active)}
              className={`relative w-9 h-5 rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Points per ₹1 spent</label>
            <input type="number" min="0.1" step="0.1" className="input"
              value={form.points_per_rupee} onChange={(e) => set('points_per_rupee', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">e.g. 1 = 1 point per rupee</p>
          </div>
          <div>
            <label className="label">₹ value per 1 point</label>
            <input type="number" min="0.01" step="0.01" className="input"
              value={form.rupees_per_point} onChange={(e) => set('rupees_per_point', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">e.g. 0.25 = 100 pts → ₹25</p>
          </div>
          <div>
            <label className="label">Min points to redeem</label>
            <input type="number" min="1" step="1" className="input"
              value={form.min_points_redeem} onChange={(e) => set('min_points_redeem', e.target.value)} />
          </div>
          <div>
            <label className="label">Max redeem % of bill</label>
            <input type="number" min="1" max="100" step="1" className="input"
              value={form.max_redeem_pct} onChange={(e) => set('max_redeem_pct', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">e.g. 20 = max 20% off via points</p>
          </div>
          <div>
            <label className="label">Points expiry (days)</label>
            <input type="number" min="0" step="1" className="input"
              value={form.points_expiry_days} onChange={(e) => set('points_expiry_days', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">0 = never expire</p>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-60 transition-colors">
          {saving ? 'Saving…' : 'Save Program Settings'}
        </button>
      </div>
    </div>
  );
}

// ─── Customer Points List ──────────────────────────────────────
function CustomersTab({ c }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ type: 'credit', points: '', reason: '' });
  const [adjusting, setAdjusting] = useState(false);

  const load = async (q = '') => {
    setLoading(true);
    try {
      const { data } = await getLoyaltyCustomers({ search: q, limit: 50 });
      setCustomers(data.data.customers);
    } catch { toast.error('Failed to load customers'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e) => {
    setSearch(e.target.value);
    load(e.target.value);
  };

  const handleAdjust = async () => {
    if (!adjustForm.points || parseInt(adjustForm.points) <= 0) return toast.error('Enter valid points');
    setAdjusting(true);
    try {
      await adjustLoyaltyPoints({
        phone: adjustTarget.phone,
        points: parseInt(adjustForm.points),
        type: adjustForm.type,
        reason: adjustForm.reason,
      });
      toast.success(`Points ${adjustForm.type === 'credit' ? 'added' : 'deducted'}`);
      setAdjustTarget(null);
      load(search);
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setAdjusting(false); }
  };

  return (
    <div className="space-y-3">
      <input type="search" placeholder="Search by phone or name…" value={search}
        onChange={handleSearch} className="input" />

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🎁</p>
          <p>No loyalty members yet</p>
          <p className="text-xs mt-1">Points are awarded automatically when customers pay</p>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((cu) => (
            <div key={cu.phone} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 text-sm truncate">{cu.customer_name || cu.phone}</p>
                <p className="text-xs text-gray-400">{cu.phone}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Earned: <span className="font-medium text-gray-700">{cu.total_earned}</span> pts ·
                  Redeemed: <span className="font-medium text-gray-700">{cu.total_redeemed}</span> pts
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xl font-bold text-brand-600">{cu.points_balance}</p>
                <p className="text-xs text-gray-400">points</p>
                <button onClick={() => { setAdjustTarget(cu); setAdjustForm({ type: 'credit', points: '', reason: '' }); }}
                  className="mt-1 text-xs text-brand-600 hover:underline">Adjust</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Adjust modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <p className="font-semibold text-gray-900">Adjust Points — {adjustTarget.customer_name || adjustTarget.phone}</p>
            <p className="text-sm text-gray-500">Current balance: <strong>{adjustTarget.points_balance} pts</strong></p>

            <div className="flex gap-2">
              {['credit', 'debit'].map((t) => (
                <button key={t} onClick={() => setAdjustForm((f) => ({ ...f, type: t }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    adjustForm.type === t
                      ? t === 'credit' ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>{t === 'credit' ? '+ Add' : '− Deduct'}</button>
              ))}
            </div>

            <div>
              <label className="label">Points</label>
              <input type="number" min="1" step="1" placeholder="e.g. 50" className="input"
                value={adjustForm.points} onChange={(e) => setAdjustForm((f) => ({ ...f, points: e.target.value }))} />
            </div>
            <div>
              <label className="label">Reason (optional)</label>
              <input type="text" placeholder="e.g. Birthday bonus" className="input"
                value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setAdjustTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleAdjust} disabled={adjusting}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-60 ${
                  adjustForm.type === 'credit' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                }`}>
                {adjusting ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Transaction History ────────────────────────────────────────
function TransactionsTab() {
  const [phone, setPhone] = useState('');
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await getLoyaltyTransactions(phone.trim());
      setTxns(data.data.transactions);
    } catch { toast.error('Could not load transactions'); setTxns([]); }
    finally { setLoading(false); }
  };

  const TYPE_LABEL = { earn: 'Earned', redeem: 'Redeemed', expire: 'Expired', adjustment: 'Adjusted' };
  const TYPE_CLS   = { earn: 'text-green-600', redeem: 'text-red-500', expire: 'text-gray-400', adjustment: 'text-blue-600' };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input type="tel" placeholder="Customer phone number" className="input flex-1"
          value={phone} onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
        <button onClick={handleSearch} disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-semibold disabled:opacity-60">
          Search
        </button>
      </div>

      {loading && <div className="text-center py-8 text-gray-400">Loading…</div>}
      {!loading && searched && txns.length === 0 && (
        <p className="text-center py-8 text-gray-400">No transactions found</p>
      )}
      {!loading && txns.length > 0 && (
        <div className="space-y-2">
          {txns.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100">
              <div>
                <p className={`text-sm font-semibold ${TYPE_CLS[t.type] || 'text-gray-700'}`}>
                  {TYPE_LABEL[t.type] || t.type}
                </p>
                {t.description && <p className="text-xs text-gray-400">{t.description}</p>}
                <p className="text-xs text-gray-400">{fmtDateTime(t.created_at)}</p>
              </div>
              <p className={`text-lg font-bold ${t.points > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {t.points > 0 ? '+' : ''}{t.points}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
