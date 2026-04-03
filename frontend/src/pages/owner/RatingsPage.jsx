import { useState, useEffect } from 'react';
import { getRatings } from '../../services/api';
import { fmtToken, fmtTime } from '../../utils/formatters';
import toast from 'react-hot-toast';

function Stars({ value, size = 'sm' }) {
  const sizes = { sm: 'text-sm', lg: 'text-2xl' };
  return (
    <span className={sizes[size]}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={s <= Math.round(value) ? 'text-yellow-400' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

export default function RatingsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRatings()
      .then(({ data }) => setData(data))
      .catch(() => toast.error('Failed to load ratings'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card text-center py-16 text-gray-400">Loading ratings...</div>;

  const { ratings = [], summary = {} } = data || {};
  const avg = parseFloat(summary.average || 0);
  const total = parseInt(summary.total || 0);

  const barMax = Math.max(
    parseInt(summary.five_star || 0), parseInt(summary.four_star || 0),
    parseInt(summary.three_star || 0), parseInt(summary.two_star || 0),
    parseInt(summary.one_star || 0), 1
  );

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Customer Ratings</h1>

      {/* Summary card */}
      {total > 0 ? (
        <div className="card flex flex-col sm:flex-row gap-6 items-center">
          <div className="text-center flex-shrink-0">
            <p className="text-6xl font-extrabold text-gray-900">{avg.toFixed(1)}</p>
            <Stars value={avg} size="lg" />
            <p className="text-sm text-gray-500 mt-1">{total} review{total !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1 w-full space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = parseInt(summary[`${['', 'one', 'two', 'three', 'four', 'five'][star]}_star`] || 0);
              const pct = Math.round((count / barMax) * 100);
              return (
                <div key={star} className="flex items-center gap-2">
                  <span className="text-xs w-5 text-right text-gray-500">{star}</span>
                  <span className="text-yellow-400 text-xs">★</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className="bg-yellow-400 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-6">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">⭐</p>
          <p className="font-medium text-gray-700">No ratings yet</p>
          <p className="text-sm mt-1">Ratings appear here after customers mark their orders as received and rate their experience</p>
        </div>
      )}

      {/* Individual reviews */}
      {ratings.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">All Reviews</h2>
          {ratings.map((r) => (
            <div key={r.id} className="card p-4 flex gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm flex-shrink-0">
                {r.customer_name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">{r.customer_name}</p>
                    <Stars value={r.rating} />
                  </div>
                  <p className="text-xs text-gray-400">{fmtTime(r.created_at)}</p>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Token #{fmtToken(r.daily_order_number)} ·{' '}
                  {r.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${r.table_number}`}
                </p>
                {r.comment && (
                  <p className="text-sm text-gray-700 mt-2 leading-relaxed">"{r.comment}"</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
