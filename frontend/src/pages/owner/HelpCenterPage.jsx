import { useState, useEffect } from 'react';
import { createTicket, getMyTickets } from '../../services/api';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

const STATUS_STYLES = {
  open:        'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved:    'bg-green-100 text-green-700',
};
const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };

export default function HelpCenterPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ subject: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    getMyTickets()
      .then((res) => setTickets(res.data.tickets))
      .catch(() => toast.error('Failed to load tickets'))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await createTicket(form);
      setTickets([data.ticket, ...tickets]);
      setForm({ subject: '', message: '' });
      toast.success('Ticket submitted! We\'ll get back to you soon.');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help Center</h1>
        <p className="text-gray-500 text-sm mt-1">Need help? Send us a message and our team will respond shortly.</p>
      </div>

      {/* New Ticket Form */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-4">📬 Submit a Request</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Subject</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Razorpay payment not working"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              maxLength={255}
              required
            />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea
              className="input resize-none"
              rows={4}
              placeholder="Describe your issue in detail..."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              required
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">
            {submitting ? 'Submitting...' : 'Submit Ticket'}
          </button>
        </form>
      </div>

      {/* Ticket List */}
      {tickets.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Your Tickets ({tickets.length})</h2>
          <div className="space-y-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="border border-gray-100 rounded-xl overflow-hidden">
                {/* Header row */}
                <button
                  onClick={() => setExpanded(expanded === ticket.id ? null : ticket.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{ticket.subject}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(ticket.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${STATUS_STYLES[ticket.status]}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                    <span className="text-gray-400 text-xs">{expanded === ticket.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded content */}
                {expanded === ticket.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                    <div className="bg-gray-50 rounded-lg p-3 mt-3">
                      <p className="text-xs font-semibold text-gray-500 mb-1">Your message</p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.message}</p>
                    </div>
                    {ticket.admin_reply ? (
                      <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-brand-700 mb-1">
                          DineVerse Support replied
                          {ticket.replied_at && (
                            <span className="text-brand-400 font-normal ml-2">
                              · {new Date(ticket.replied_at).toLocaleDateString('en-IN', {
                                day: 'numeric', month: 'short',
                              })}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.admin_reply}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">
                        Waiting for response from our support team...
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tickets.length === 0 && (
        <div className="card text-center py-10 text-gray-400">
          <p className="text-3xl mb-2">🎉</p>
          <p className="font-medium">No support tickets yet.</p>
          <p className="text-sm mt-1">Submit a ticket above if you need help.</p>
        </div>
      )}
    </div>
  );
}
