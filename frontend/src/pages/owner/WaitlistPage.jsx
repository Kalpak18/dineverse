import { useState, useEffect, useCallback, useRef } from 'react';
import { getWaitlist, updateWaitlistEntry, deleteWaitlistEntry } from '../../services/api';
import toast from 'react-hot-toast';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

const STATUS_LABELS = {
  waiting:   { label: 'Waiting',   color: 'bg-amber-100 text-amber-700' },
  seated:    { label: 'Seated',    color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700' },
  no_show:   { label: 'No Show',   color: 'bg-gray-100 text-gray-500' },
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function WaitlistPage() {
  const { cafe } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('waiting'); // waiting | all
  const socketRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getWaitlist();
      setEntries(data.waitlist);
    } catch { toast.error('Failed to load waitlist'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates via socket
  useEffect(() => {
    if (!cafe?.id) return;
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socketRef.current = socket;
    socket.emit('join_cafe', cafe.id);
    socket.on('waitlist_update', () => load());
    return () => socket.disconnect();
  }, [cafe?.id, load]);

  const handleAction = async (id, status) => {
    try {
      const { data } = await updateWaitlistEntry(id, { status });
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, status: data.entry.status } : e));
      toast.success(
        status === 'seated'    ? 'Customer seated!' :
        status === 'no_show'   ? 'Marked as no-show' :
        status === 'cancelled' ? 'Entry cancelled' : 'Updated'
      );
    } catch { toast.error('Failed to update entry'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this waitlist entry?')) return;
    try {
      await deleteWaitlistEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success('Entry removed');
    } catch { toast.error('Failed to remove entry'); }
  };

  const displayed = filter === 'waiting'
    ? entries.filter((e) => e.status === 'waiting')
    : entries;

  const waitingCount = entries.filter((e) => e.status === 'waiting').length;

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-100" />)}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Waitlist</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {waitingCount} group{waitingCount !== 1 ? 's' : ''} waiting
          </p>
        </div>
        <button onClick={load} className="text-sm text-brand-600 hover:text-brand-800 font-medium">
          ↻ Refresh
        </button>
      </div>

      {/* Alert if no one waiting */}
      {waitingCount === 0 && filter === 'waiting' && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 text-green-700 text-sm font-medium flex items-center gap-2">
          ✅ No one is currently waiting.
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm w-fit">
        {[
          { key: 'waiting', label: `Waiting (${waitingCount})` },
          { key: 'all',     label: `All (${entries.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 font-medium transition-colors ${
              filter === key ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-3">
        {displayed.map((entry, idx) => {
          const badge = STATUS_LABELS[entry.status] || STATUS_LABELS.waiting;
          return (
            <div
              key={entry.id}
              className={`bg-white rounded-2xl border shadow-sm px-5 py-4 ${
                entry.status === 'waiting' ? 'border-amber-200' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {entry.status === 'waiting' && (
                    <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {idx + 1}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{entry.customer_name}</p>
                    <p className="text-xs text-gray-500">{entry.customer_phone}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.color}`}>
                  {badge.label}
                </span>
              </div>

              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span>👥 Party of <strong>{entry.party_size}</strong></span>
                {entry.notes && <span>📝 {entry.notes}</span>}
                <span className="ml-auto text-gray-400">{timeAgo(entry.created_at)}</span>
              </div>

              {entry.status === 'waiting' && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                  <button
                    onClick={() => handleAction(entry.id, 'seated')}
                    className="flex-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    ✓ Seat Now
                  </button>
                  <button
                    onClick={() => handleAction(entry.id, 'no_show')}
                    className="text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    No Show
                  </button>
                  <button
                    onClick={() => handleAction(entry.id, 'cancelled')}
                    className="text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {entry.status !== 'waiting' && (
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-xs text-gray-300 hover:text-red-500 transition-colors"
                    title="Remove entry"
                  >
                    🗑 Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {displayed.length === 0 && filter === 'all' && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-2">🕐</div>
            <p>No waitlist entries yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
