import { useState, useEffect } from 'react';
import { adminGetTickets, adminReplyTicket } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

const STATUS_STYLES = {
  open:        'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  in_progress: 'bg-blue-900/40 text-blue-400 border-blue-800',
  resolved:    'bg-green-900/40 text-green-400 border-green-800',
};
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [replies, setReplies] = useState({});
  const [saving, setSaving] = useState(null);

  const load = (status = filter) => {
    setLoading(true);
    adminGetTickets({ status: status || undefined })
      .then((res) => setTickets(res.data.tickets))
      .catch(() => toast.error('Failed to load tickets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const handleReply = async (ticket) => {
    const reply = replies[ticket.id]?.trim();
    if (!reply) { toast.error('Enter a reply first'); return; }
    setSaving(ticket.id);
    try {
      const { data } = await adminReplyTicket(ticket.id, {
        admin_reply: reply,
        status: 'resolved',
      });
      setTickets(tickets.map((t) => t.id === ticket.id ? data.ticket : t));
      setReplies({ ...replies, [ticket.id]: '' });
      toast.success('Reply sent & ticket resolved');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(null);
    }
  };

  const handleStatusChange = async (ticket, status) => {
    try {
      const { data } = await adminReplyTicket(ticket.id, { status });
      setTickets(tickets.map((t) => t.id === ticket.id ? data.ticket : t));
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const counts = tickets.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Support Tickets</h1>
        <p className="text-gray-400 text-sm mt-1">Manage all café owner support requests.</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: '', label: `All (${tickets.length})` },
          { key: 'open', label: `Open (${counts.open || 0})` },
          { key: 'in_progress', label: `In Progress (${counts.in_progress || 0})` },
          { key: 'resolved', label: `Resolved (${counts.resolved || 0})` },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); load(f.key); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f.key
                ? 'bg-brand-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-3">
          {tickets.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <p className="text-4xl mb-3">🎫</p>
              <p>No tickets found.</p>
            </div>
          )}
          {tickets.map((ticket) => (
            <div key={ticket.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpanded(expanded === ticket.id ? null : ticket.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/50 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-white truncate">{ticket.subject}</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[ticket.status]}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="text-brand-400">{ticket.cafe_name}</span>
                    {' · '}{ticket.cafe_email}
                    {' · '}{new Date(ticket.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span className="text-gray-500 ml-3 text-xs">{expanded === ticket.id ? '▲' : '▼'}</span>
              </button>

              {expanded === ticket.id && (
                <div className="px-5 pb-5 border-t border-gray-800 space-y-4 pt-4">
                  {/* Customer message */}
                  <div className="bg-gray-800/50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-2">Customer Message</p>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{ticket.message}</p>
                  </div>

                  {/* Existing reply */}
                  {ticket.admin_reply && (
                    <div className="bg-brand-900/30 border border-brand-800/50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-brand-400 mb-2">
                        Your Reply
                        {ticket.replied_at && (
                          <span className="text-gray-500 font-normal ml-2">
                            · {new Date(ticket.replied_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap">{ticket.admin_reply}</p>
                    </div>
                  )}

                  {/* Reply form */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-400">
                      {ticket.admin_reply ? 'Update Reply' : 'Write Reply'}
                    </label>
                    <textarea
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                      rows={3}
                      placeholder="Type your reply..."
                      value={replies[ticket.id] || ''}
                      onChange={(e) => setReplies({ ...replies, [ticket.id]: e.target.value })}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReply(ticket)}
                        disabled={saving === ticket.id}
                        className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
                      >
                        {saving === ticket.id ? 'Sending...' : 'Send & Resolve'}
                      </button>
                      {ticket.status !== 'in_progress' && (
                        <button
                          onClick={() => handleStatusChange(ticket, 'in_progress')}
                          className="bg-blue-900/40 hover:bg-blue-900/60 text-blue-400 text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                        >
                          Mark In Progress
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
