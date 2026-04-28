import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getConversations, getOwnerMessages, postOwnerMessage, deleteOwnerMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useBadges } from '../../context/BadgeContext';
import { fmtToken, fmtTime } from '../../utils/formatters';
import toast from 'react-hot-toast';

const LAST_READ_KEY    = 'dv_msg_last_read';
const DISMISSED_KEY    = 'dv_msg_dismissed';

function getLastRead() {
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}'); } catch { return {}; }
}
function setLastRead(orderId) {
  const map = getLastRead();
  map[orderId] = new Date().toISOString();
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
}
function markAllRead(conversations) {
  const map = getLastRead();
  const now = new Date().toISOString();
  conversations.forEach((c) => { map[c.order_id] = now; });
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
}
function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
}
function saveDismissed(set) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function statusColor(status) {
  const map = {
    pending:   'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    preparing: 'bg-orange-100 text-orange-700',
    ready:     'bg-green-100 text-green-700',
    served:    'bg-teal-100 text-teal-700',
    paid:      'bg-purple-100 text-purple-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}

// ✓ sent  ✓✓ seen by customer
function SeenTick({ msg, customerReadAt }) {
  if (msg.sender_type !== 'owner' || msg.is_deleted) return null;
  const seen = customerReadAt && new Date(customerReadAt) >= new Date(msg.created_at);
  return (
    <span className={`text-[10px] ml-1 select-none ${seen ? 'text-blue-400' : 'text-white/60'}`}>
      {seen ? '✓✓' : '✓'}
    </span>
  );
}

export default function MessagesPage() {
  const { cafe } = useAuth();
  const { setBadge } = useBadges();

  const [conversations,  setConversations]  = useState([]);
  const [loadingConvs,   setLoadingConvs]   = useState(true);
  const [selectedId,     setSelectedId]     = useState(null);
  const [messages,       setMessages]       = useState({});       // { orderId: Message[] }
  const [customerReadAt, setCustomerReadAt] = useState({});       // { orderId: ISOString }
  const [loadingMsgs,    setLoadingMsgs]    = useState(false);
  const [text,           setText]           = useState('');
  const [sending,        setSending]        = useState(false);
  const [lastRead,       setLastReadState]  = useState(getLastRead);
  const [showList,       setShowList]       = useState(true);     // mobile: list vs chat
  const [search,         setSearch]         = useState('');
  const [menuMsgId,      setMenuMsgId]      = useState(null);     // message context-menu open
  const [dismissed,      setDismissed]      = useState(getDismissed);

  const bottomRef  = useRef(null);
  const socketRef  = useRef(null);
  const inputRef   = useRef(null);

  // ── Load conversations ────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const { data } = await getConversations();
      setConversations(data.conversations);
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Socket ────────────────────────────────────────────────────
  useEffect(() => {
    if (!cafe?.id) return;
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socketRef.current = socket;
    socket.emit('join_cafe', cafe.id);
    socket.on('connect', () => socket.emit('join_cafe', cafe.id));

    socket.on('order_message', (msg) => {
      // Un-dismiss if a new customer message arrives for a dismissed conversation
      if (msg.sender_type === 'customer') {
        setDismissed((prev) => {
          if (!prev.has(msg.order_id)) return prev;
          const next = new Set(prev);
          next.delete(msg.order_id);
          saveDismissed(next);
          return next;
        });
      }
      setMessages((prev) => {
        const existing = prev[msg.order_id] || [];
        if (existing.find((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.order_id]: [...existing, msg] };
      });
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.order_id === msg.order_id);
        if (idx === -1) { loadConversations(); return prev; }
        const updated = { ...prev[idx],
          last_message:     msg.message,
          last_sender_type: msg.sender_type,
          last_message_at:  msg.created_at,
          total_messages:   (prev[idx].total_messages || 0) + 1,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
      if (msg.sender_type === 'customer') {
        setSelectedId((curr) => {
          if (curr !== msg.order_id) toast(`💬 New message from customer`, { duration: 4000, icon: '🔔' });
          return curr;
        });
      }
    });

    socket.on('order_message_deleted', ({ order_id, msg_id }) => {
      setMessages((prev) => {
        const thread = prev[order_id];
        if (!thread) return prev;
        return { ...prev, [order_id]: thread.map((m) => m.id === msg_id ? { ...m, is_deleted: true } : m) };
      });
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [cafe?.id, loadConversations]);

  // ── Unread count → sidebar badge ─────────────────────────────
  const unreadCount = useMemo(() => {
    const lr = lastRead;
    return conversations.reduce((total, conv) => {
      if (conv.last_sender_type !== 'customer') return total;
      const lastReadAt = lr[conv.order_id];
      if (!lastReadAt) return total + 1;
      return new Date(conv.last_message_at) > new Date(lastReadAt) ? total + 1 : total;
    }, 0);
  }, [conversations, lastRead]);

  useEffect(() => {
    setBadge('/owner/messages', unreadCount);
    return () => setBadge('/owner/messages', 0);
  }, [unreadCount, setBadge]);

  // ── Open conversation ─────────────────────────────────────────
  const openConversation = useCallback(async (orderId) => {
    setSelectedId(orderId);
    setShowList(false);
    setText('');
    setMenuMsgId(null);
    setTimeout(() => inputRef.current?.focus(), 100);
    setLastRead(orderId);
    setLastReadState(getLastRead());
    if (messages[orderId]) return;
    setLoadingMsgs(true);
    try {
      const { data } = await getOwnerMessages(orderId);
      setMessages((prev) => ({ ...prev, [orderId]: data.messages }));
      if (data.customer_read_at) {
        setCustomerReadAt((prev) => ({ ...prev, [orderId]: data.customer_read_at }));
      }
    } catch {
      toast.error('Could not load messages');
    } finally {
      setLoadingMsgs(false);
    }
  }, [messages]);

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  // ── Send ──────────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !selectedId || sending) return;
    setSending(true);
    try {
      await postOwnerMessage(selectedId, trimmed);
      setText('');
      if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // ── Delete message ────────────────────────────────────────────
  const handleDelete = async (msgId) => {
    setMenuMsgId(null);
    try {
      await deleteOwnerMessage(selectedId, msgId);
      // Optimistic update (socket also fires)
      setMessages((prev) => ({
        ...prev,
        [selectedId]: prev[selectedId].map((m) => m.id === msgId ? { ...m, is_deleted: true } : m),
      }));
    } catch {
      toast.error('Could not delete message');
    }
  };

  // ── Mark all read ─────────────────────────────────────────────
  const handleMarkAllRead = () => {
    markAllRead(conversations);
    setLastReadState(getLastRead());
    toast.success('All conversations marked as read');
  };

  const dismissConversation = (e, orderId) => {
    e.stopPropagation();
    try {
      const next = new Set([...dismissed, orderId]);
      setDismissed(next);
      saveDismissed(next);
      if (selectedId === orderId) { setSelectedId(null); setShowList(true); }
      toast.success('Conversation dismissed');
    } catch {
      toast.error('Failed to dismiss conversation');
    }
  };

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = conversations.filter((c) => !dismissed.has(c.order_id));
    if (!q) return visible;
    return visible.filter((c) => {
      const token = fmtToken(c.daily_order_number, c.order_type).toLowerCase();
      return token.includes(q) || c.customer_name.toLowerCase().includes(q) || (c.last_message || '').toLowerCase().includes(q);
    });
  }, [conversations, search, dismissed]);

  const selectedConv  = conversations.find((c) => c.order_id === selectedId);
  const activeMessages = messages[selectedId] || [];
  const convReadAt     = customerReadAt[selectedId] || selectedConv?.customer_msg_read_at || null;

  const isUnread = (conv) => {
    if (conv.last_sender_type !== 'customer') return false;
    const lr = lastRead[conv.order_id];
    if (!lr) return true;
    return new Date(conv.last_message_at) > new Date(lr);
  };

  const totalUnread = conversations.filter(isUnread).length;

  return (
    <div
      className="flex h-[calc(100vh-120px)] max-w-6xl gap-0 overflow-hidden rounded-2xl border border-gray-200 shadow-sm bg-white"
      onClick={() => menuMsgId && setMenuMsgId(null)}
    >

      {/* ── Conversation list ── */}
      <aside className={`${showList ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-100 flex-shrink-0`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-gray-900">Messages</h1>
            <p className="text-[11px] text-gray-400">{filtered.length} conversation{filtered.length !== 1 ? 's' : ''}{dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ''}</p>
          </div>
          {totalUnread > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-50">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
            <input
              type="text"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-gray-50"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs && <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>}
          {!loadingConvs && filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-sm">{search ? 'No matches' : 'No messages yet'}</p>
              <p className="text-xs mt-1 text-gray-300">Customer chats will appear here</p>
            </div>
          )}
          {filtered.map((conv) => {
            const unread   = isUnread(conv);
            const isActive = conv.order_id === selectedId;
            return (
              <div
                key={conv.order_id}
                className={`relative group flex items-start border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                  isActive ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
                }`}
              >
                <button
                  onClick={() => openConversation(conv.order_id)}
                  className="flex-1 text-left px-4 py-3.5 min-w-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-600">
                        {conv.customer_name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      {unread && (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-500 border-2 border-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`text-xs font-bold truncate ${unread ? 'text-gray-900' : 'text-gray-700'}`}>
                          {conv.customer_name}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0 mr-5">{timeAgo(conv.last_message_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-semibold text-brand-600">{fmtToken(conv.daily_order_number, conv.order_type)}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor(conv.status)}`}>
                          {conv.status}
                        </span>
                      </div>
                      <p className={`text-xs truncate ${unread ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                        {conv.last_sender_type === 'owner' && <span className="text-gray-400">You: </span>}
                        {conv.last_message}
                      </p>
                    </div>
                  </div>
                </button>
                {/* Dismiss button — always visible */}
                <button
                  onClick={(e) => dismissConversation(e, conv.order_id)}
                  title="Dismiss conversation"
                  className="absolute top-3 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors text-sm flex-shrink-0"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-gray-100">
          <button onClick={loadConversations} className="w-full text-xs text-gray-400 hover:text-brand-500 py-1 transition-colors">
            ↻ Refresh
          </button>
        </div>
      </aside>

      {/* ── Chat panel ── */}
      <div className={`${!showList ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0`}>
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-6">
            <p className="text-5xl mb-4">💬</p>
            <p className="text-base font-semibold text-gray-500">Select a conversation</p>
            <p className="text-xs mt-1 text-center">Choose a customer chat from the left to view and reply</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0 bg-white">
              <button onClick={() => setShowList(true)} className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 mr-1">←</button>
              <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-600 flex-shrink-0">
                {selectedConv.customer_name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{selectedConv.customer_name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs font-semibold text-brand-600">{fmtToken(selectedConv.daily_order_number, selectedConv.order_type)}</span>
                  <span className="text-gray-300 hidden sm:inline">·</span>
                  <span className="text-xs text-gray-500 hidden sm:inline">
                    {selectedConv.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${selectedConv.table_number}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor(selectedConv.status)}`}>
                    {selectedConv.status}
                  </span>
                  {convReadAt && (
                    <span className="text-[10px] text-blue-500 font-medium">✓✓ Seen</span>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
              {loadingMsgs && <div className="text-center text-sm text-gray-400 py-8">Loading messages…</div>}
              {!loadingMsgs && activeMessages.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">No messages yet. Send the first message!</div>
              )}
              {activeMessages.map((m) => (
                <div key={m.id} className={`flex ${m.sender_type === 'owner' ? 'justify-end' : 'justify-start'}`}>
                  {m.sender_type === 'customer' && (
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-600 mr-2 flex-shrink-0 self-end">
                      {selectedConv.customer_name?.charAt(0)?.toUpperCase()}
                    </div>
                  )}
                  <div className="max-w-[72%] group relative">
                    {m.is_deleted ? (
                      <div className={`px-3.5 py-2 rounded-2xl text-xs italic text-gray-400 border border-dashed border-gray-200 bg-white ${
                        m.sender_type === 'owner' ? 'rounded-br-sm' : 'rounded-bl-sm'
                      }`}>
                        Message deleted
                      </div>
                    ) : (
                      <>
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-snug ${
                          m.sender_type === 'owner'
                            ? 'bg-brand-500 text-white rounded-br-sm'
                            : 'bg-white border border-gray-200 text-gray-800 shadow-sm rounded-bl-sm'
                        }`}>
                          {m.message}
                          {m.sender_type === 'owner' && <SeenTick msg={m} customerReadAt={convReadAt} />}
                        </div>
                        {/* Delete button — owner messages only, appears on hover/tap */}
                        {m.sender_type === 'owner' && (
                          <div className={`absolute top-0 -left-8 opacity-0 group-hover:opacity-100 transition-opacity ${
                            menuMsgId === m.id ? 'opacity-100' : ''
                          }`}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuMsgId(menuMsgId === m.id ? null : m.id); }}
                              className="w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 text-xs"
                              title="Delete message"
                            >
                              ⋯
                            </button>
                            {menuMsgId === m.id && (
                              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-10 min-w-[120px]">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                                  className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 font-medium"
                                >
                                  🗑 Delete message
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <p className={`text-[10px] mt-1 text-gray-400 ${m.sender_type === 'owner' ? 'text-right' : 'text-left'}`}>
                      {fmtTime(m.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Reply input */}
            <div className="px-4 py-3 border-t border-gray-100 bg-white flex items-end gap-2 flex-shrink-0">
              <textarea
                ref={inputRef}
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-gray-50 max-h-32 leading-snug"
                placeholder="Type a reply…"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                className="px-4 py-2.5 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex-shrink-0"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
