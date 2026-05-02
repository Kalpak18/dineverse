import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getCurrentShift, getShifts, openShift, closeShift } from '../../services/api';
import toast from 'react-hot-toast';
import { fmtCurrency, fmtDateTime } from '../../utils/formatters';
import PageHint from '../../components/PageHint';

export default function ShiftPage() {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [shift, setShift]       = useState(null);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [opening, setOpening]   = useState(false);
  const [closing, setClosing]   = useState(false);
  const [openBal, setOpenBal]   = useState('');
  const [closeBal, setCloseBal] = useState('');
  const [notes, setNotes]       = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cur, hist] = await Promise.all([
        getCurrentShift(),
        getShifts({ limit: 20 }),
      ]);
      setShift(cur.data.shift);
      setHistory(hist.data.shifts);
    } catch { toast.error('Could not load shift data — check your connection and refresh.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleOpen = async () => {
    setOpening(true);
    try {
      const { data } = await openShift({ opening_balance: parseFloat(openBal) || 0, notes });
      setShift(data.shift);
      setOpenBal(''); setNotes('');
      toast.success('Shift opened');
    } catch (e) { toast.error(e.response?.data?.message || e.message); }
    finally { setOpening(false); }
  };

  const handleClose = async () => {
    if (!closeBal && closeBal !== '0') return toast.error('Enter closing cash balance');
    setClosing(true);
    try {
      const { data } = await closeShift({ closing_balance: parseFloat(closeBal) || 0, notes });
      setShift(null);
      setHistory((prev) => [data.shift, ...prev]);
      setCloseBal(''); setNotes('');
      toast.success('Shift closed');
    } catch (e) { toast.error(e.response?.data?.message || e.message); }
    finally { setClosing(false); }
  };

  if (loading) return <div className="p-6 text-center text-gray-400">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <PageHint
        storageKey="dv_hint_shift"
        title="Shift — track daily cash flow and reconcile your till at end of service"
        items={[
          { icon: '🟢', text: 'Open a shift at the start of service by entering your opening cash float (e.g. ₹500). This is the starting cash in your drawer.' },
          { icon: '💰', text: 'During service the shift tracks live revenue, order count, and cash sales automatically as orders are paid.' },
          { icon: '🔒', text: 'At end of day: count the cash in your till, enter it as "Closing Cash", then close the shift. A full summary is generated.' },
          { icon: '📊', text: 'Shift History shows all past shifts — click any row to see a breakdown by payment mode (Cash / UPI / Card) and the cash variance.' },
          { icon: '⚠️', text: 'Cash Variance = Closing Cash − Expected Cash. Negative means cash is missing; positive means overage. Investigate any large gaps.' },
        ]}
        tip="Run one shift per service day. Open when you start taking orders, close when the last bill is paid. This gives you an accurate daily reconciliation."
      />
      <h1 className="text-xl font-bold text-gray-900">Cash Register</h1>

      {/* Current shift status */}
      {shift ? (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-green-600 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse" />
                Shift Open
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Started {fmtDateTime(shift.opened_at)}</p>
            </div>
            <span className="text-2xl font-bold text-gray-900">{c(shift.live_revenue || 0)}</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Orders', value: shift.live_orders || 0, icon: '📋' },
              { label: 'Cash Sales', value: c(shift.live_cash || 0), icon: '💵' },
              { label: 'Opening Cash', value: c(shift.opening_balance), icon: '🏦' },
            ].map(({ label, value, icon }) => (
              <div key={label} className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-lg">{icon}</p>
                <p className="text-sm font-bold text-gray-800">{value}</p>
                <p className="text-xs text-gray-400">{label}</p>
              </div>
            ))}
          </div>

          {/* Close shift */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Close Shift</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Closing Cash (₹)</label>
                <input type="number" min="0" step="1" placeholder="Count cash in drawer"
                  value={closeBal} onChange={(e) => setCloseBal(e.target.value)} className="input" />
              </div>
            </div>
            <textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="input resize-none" rows={2} />
            <button onClick={handleClose} disabled={closing}
              className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-60 transition-colors">
              {closing ? 'Closing…' : '🔒 Close Shift & Generate Summary'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card space-y-4">
          <div className="text-center py-4">
            <p className="text-4xl mb-2">💰</p>
            <p className="font-semibold text-gray-800">No shift open</p>
            <p className="text-xs text-gray-400 mt-1">Open a shift to start tracking today's sales</p>
          </div>
          <div>
            <label className="label">Opening Cash Balance (₹)</label>
            <input type="number" min="0" step="1" placeholder="e.g. 500" value={openBal}
              onChange={(e) => setOpenBal(e.target.value)} className="input" />
          </div>
          <textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="input resize-none" rows={2} />
          <button onClick={handleOpen} disabled={opening}
            className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-60 transition-colors">
            {opening ? 'Opening…' : '🟢 Open Shift'}
          </button>
        </div>
      )}

      {/* Shift history */}
      <div className="card">
        <button onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-700">
          <span>📊 Shift History</span>
          <span className="text-gray-400">{showHistory ? '▲' : '▼'}</span>
        </button>
        {showHistory && (
          <div className="mt-3 space-y-2">
            {history.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No closed shifts yet</p>}
            {history.map((s) => (
              <div key={s.id}
                onClick={() => setSelectedShift(selectedShift?.id === s.id ? null : s)}
                className="rounded-xl border border-gray-100 p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">{fmtDateTime(s.opened_at)}</p>
                    <p className="text-xs text-gray-400">{s.total_orders} orders</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{c(s.total_revenue)}</p>
                    {s.closing_balance != null && (
                      <p className={`text-xs font-medium ${
                        parseFloat(s.closing_balance) >= parseFloat(s.expected_cash)
                          ? 'text-green-600' : 'text-red-500'
                      }`}>
                        Cash: {c(s.closing_balance)}
                        {s.expected_cash && ` / Expected: ${c(s.expected_cash)}`}
                      </p>
                    )}
                  </div>
                </div>
                {selectedShift?.id === s.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
                    {[
                      ['Cash Sales', c(s.cash_sales)],
                      ['Card Sales', c(s.card_sales)],
                      ['UPI Sales', c(s.upi_sales)],
                      ['Discounts', c(s.total_discounts)],
                      ['Opening Balance', c(s.opening_balance)],
                      ['Cash Variance', s.closing_balance != null
                        ? c(parseFloat(s.closing_balance) - parseFloat(s.expected_cash || 0))
                        : '–'],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <p className="text-gray-400">{label}</p>
                        <p className="font-semibold text-gray-800">{val}</p>
                      </div>
                    ))}
                    {s.notes && <div className="col-span-2"><p className="text-gray-400">Notes</p><p className="text-gray-700">{s.notes}</p></div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
