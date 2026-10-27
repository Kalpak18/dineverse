import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getServiceRequests, ackServiceRequest } from '../services/api';
import { useSocketIO, playNotificationSound } from '../hooks/useSocketIO';
import { useAuth } from '../context/AuthContext';
import { getApiError } from '../utils/apiError';

// Live "Call waiter" / "Request bill" requests for floor staff (Waiter and
// Orders screens). Renders nothing when there are no open requests.
const TYPE = {
  waiter: { icon: '🙋', label: 'Calling a waiter' },
  bill:   { icon: '🧾', label: 'Wants the bill' },
};

const minsAgo = (ts) => Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));

export default function ServiceRequestsPanel({ dark = false }) {
  const { cafe } = useAuth();
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(null);
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    getServiceRequests().then(({ data }) => setRequests(data.requests || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000); // refresh "n min ago"
    return () => clearInterval(id);
  }, []);

  useSocketIO(cafe?.id, null, null, null, {
    onReconnect: load,
    events: {
      service_request: (r) => {
        setRequests((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
        playNotificationSound();
        navigator.vibrate?.([150, 80, 150]);
      },
      service_request_updated: (r) => setRequests((prev) => prev.filter((x) => x.id !== r.id)),
    },
  });

  const acknowledge = async (r) => {
    setBusy(r.id);
    try {
      await ackServiceRequest(r.id);
      setRequests((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err) {
      toast.error(getApiError(err));
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!requests.length) return null;

  return (
    <section aria-label="Table requests" className={`rounded-2xl border p-3 ${dark ? 'border-amber-500/60 bg-amber-500/10' : 'border-amber-300 bg-amber-50'}`}>
      <p className={`text-xs font-black uppercase tracking-widest mb-2 ${dark ? 'text-amber-300' : 'text-amber-700'}`}>
        Table requests ({requests.length})
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {requests.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${dark ? 'bg-gray-900' : 'bg-white shadow-sm'}`}>
            <span className="text-2xl" aria-hidden="true">{TYPE[r.type]?.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={`font-black truncate ${dark ? 'text-white' : 'text-gray-900'}`}>
                {/^\d+$/.test(r.table_number || '') ? `Table ${r.table_number}` : r.table_number}
              </p>
              <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                {TYPE[r.type]?.label} · {minsAgo(r.created_at) ? `${minsAgo(r.created_at)} min ago` : 'just now'}
                {r.table_verified === false && ' · table not confirmed'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => acknowledge(r)}
              disabled={busy === r.id}
              className="flex-shrink-0 min-h-[44px] px-3 rounded-xl bg-amber-500 text-white text-sm font-bold disabled:opacity-60 touch-manipulation"
            >
              {busy === r.id ? '…' : 'On my way'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
