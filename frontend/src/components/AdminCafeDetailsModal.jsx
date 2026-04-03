import { useState, useEffect } from 'react';
import { adminGetCafeStats } from '../../services/api';
import LoadingSpinner from './LoadingSpinner';
import toast from 'react-hot-toast';

export default function AdminCafeDetailsModal({ cafeId, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cafeId) return;
    adminGetCafeStats(cafeId)
      .then((res) => setStats(res.data))
      .catch(() => toast.error('Failed to load cafe stats'))
      .finally(() => setLoading(false));
  }, [cafeId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <LoadingSpinner />
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const { cafe, orders, revenue, menu, ratings } = stats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{cafe.name}</h2>
            <p className="text-xs text-gray-500 mt-1">{cafe.email}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-4">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                cafe.is_active
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-red-900/30 text-red-400'
              }`}
            >
              {cafe.is_active ? '🟢 Active' : '🔴 Inactive'}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-900/30 text-blue-400">
              {cafe.plan_type === 'yearly' ? '💳 Paid' : '🆓 Trial'}
            </span>
            {cafe.plan_expiry_date && (
              <span className="text-xs text-gray-400">
                Expires: {new Date(cafe.plan_expiry_date).toLocaleDateString('en-IN')}
              </span>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Orders */}
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-3">📦 Orders</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Total:</span>
                  <span className="text-white font-semibold">{orders.total}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Pending:</span>
                  <span>{orders.pending}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Confirmed:</span>
                  <span>{orders.confirmed}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Ready:</span>
                  <span>{orders.ready}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Picked up:</span>
                  <span>{orders.picked_up}</span>
                </div>
                <div className="flex justify-between text-xs text-red-500">
                  <span>Cancelled:</span>
                  <span>{orders.cancelled}</span>
                </div>
              </div>
            </div>

            {/* Revenue */}
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-3">💰 Revenue</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Total:</span>
                  <span className="text-green-400 font-semibold">₹{revenue.total.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>From paid orders:</span>
                  <span>₹{revenue.paid.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Pending:</span>
                  <span>₹{revenue.pending.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Completed orders:</span>
                  <span>{revenue.completed_orders}</span>
                </div>
              </div>
            </div>

            {/* Menu */}
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-3">🍽️ Menu</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Categories:</span>
                  <span className="text-white font-semibold">{menu.total_categories}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Menu Items:</span>
                  <span className="text-white font-semibold">{menu.total_items}</span>
                </div>
                <div className="flex justify-between text-xs text-green-500">
                  <span>Available:</span>
                  <span>{menu.available_items}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Unavailable:</span>
                  <span>{menu.total_items - menu.available_items}</span>
                </div>
              </div>
            </div>

            {/* Ratings */}
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm mb-3">⭐ Ratings</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Average:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-yellow-400 text-lg">★</span>
                    <span className="text-white font-semibold">{ratings.avg_rating.toFixed(1)}</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Total ratings:</span>
                  <span>{ratings.total_ratings}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cafe Info */}
          <div className="bg-gray-800 rounded-lg p-4 text-sm">
            <p className="text-gray-300 font-semibold mb-3">ℹ️ Café Information</p>
            <div className="space-y-2 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>Slug:</span>
                <code className="font-mono text-gray-300">{cafe.slug}</code>
              </div>
              <div className="flex justify-between">
                <span>ID:</span>
                <code className="font-mono text-gray-300 truncate">{cafe.id}</code>
              </div>
              <div className="flex justify-between">
                <span>Phone:</span>
                <span>{cafe.phone || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Created:</span>
                <span>{new Date(cafe.created_at).toLocaleDateString('en-IN')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
