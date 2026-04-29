import { useState, useEffect, useCallback } from 'react';
import { getReservations, updateReservation, deleteReservation } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import toast from 'react-hot-toast';

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: 'bg-yellow-100 text-yellow-700' },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-600' },
  completed: { label: 'Completed', color: 'bg-gray-100 text-gray-600' },
  no_show:   { label: 'No Show',   color: 'bg-orange-100 text-orange-700' },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d) {
  if (!d) return '';
  const dateOnly = String(d).slice(0, 10); // handle both "YYYY-MM-DD" and full ISO timestamps
  return new Date(dateOnly + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function ReservationsPage() {
  const { cafe } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (date) params.date = date;
      if (statusFilter) params.status = statusFilter;
      const { data } = await getReservations(params);
      setReservations(data.reservations);
    } catch { toast.error('Failed to load reservations'); }
    finally { setLoading(false); }
  }, [date, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Live new reservations via socket
  useSocketIO(cafe?.id, null, null, (reservation) => {
    if (reservation && reservation.reserved_date === date) {
      setReservations((prev) => [reservation, ...prev]);
      toast('New reservation!', { icon: '📅', style: { background: '#1f2937', color: '#fff' } });
    }
  });

  const handleStatus = async (id, status) => {
    try {
      const { data } = await updateReservation(id, { status });
      setReservations((prev) => prev.map((r) => r.id === id ? data.reservation : r));
      toast.success(`Marked as ${STATUS_CONFIG[status].label}`);
    } catch { toast.error('Failed to update reservation'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this reservation?')) return;
    try {
      await deleteReservation(id);
      setReservations((prev) => prev.filter((r) => r.id !== id));
      toast.success('Reservation deleted');
    } catch { toast.error('Failed to delete reservation'); }
  };

  const counts = reservations.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage table bookings from customers</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input text-sm py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button onClick={load} className="btn-secondary text-sm">↻</button>
        </div>
      </div>

      {/* Stats */}
      {reservations.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) =>
            counts[key] ? (
              <div key={key} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${cfg.color}`}>
                {cfg.label}: {counts[key]}
              </div>
            ) : null
          )}
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {[['', 'All'], ...Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card text-center py-12 text-gray-400">Loading...</div>
      ) : reservations.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📅</p>
          <p className="font-medium text-gray-700">No reservations for {fmtDate(date)}</p>
          <p className="text-sm mt-1">Share your café link so customers can book tables</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reservations.map((r) => {
            const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
            return (
              <div key={r.id} className="card p-0 overflow-hidden">
                <div className="p-4 flex items-start gap-4">
                  {/* Time block */}
                  <div className="w-16 text-center flex-shrink-0">
                    <p className="font-bold text-gray-900 text-base">{fmtTime12(r.reserved_time)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(r.reserved_date)}</p>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-bold text-gray-900">{r.customer_name}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                      <span>👥 {r.party_size} guest{r.party_size !== 1 ? 's' : ''}</span>
                      {r.customer_phone && <span>📞 {r.customer_phone}</span>}
                      {r.table_label
                        ? <span>🪑 {r.table_label}{r.area_name ? ` (${r.area_name})` : ''}</span>
                        : r.area_name && <span>📍 {r.area_name}</span>
                      }
                    </div>
                    {r.notes && (
                      <p className="text-xs text-gray-500 mt-1 italic">"{r.notes}"</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {r.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleStatus(r.id, 'confirmed')}
                          className="px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-bold transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => handleStatus(r.id, 'cancelled')}
                          className="px-3 py-1.5 rounded-lg border border-red-300 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {r.status === 'confirmed' && (
                      <>
                        <button
                          onClick={() => handleStatus(r.id, 'completed')}
                          className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition-colors"
                        >
                          Done
                        </button>
                        <button
                          onClick={() => handleStatus(r.id, 'no_show')}
                          className="px-3 py-1.5 rounded-lg border border-orange-300 text-orange-500 text-xs font-medium hover:bg-orange-50 transition-colors"
                        >
                          No Show
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="px-3 py-1.5 rounded-lg text-gray-400 text-xs hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
