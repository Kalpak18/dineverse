import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getConversations, getOwnerMessages, postOwnerMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useBadges } from '../../context/BadgeContext';
import { fmtToken, fmtTime } from '../../utils/formatters';
import toast from 'react-hot-toast';

// localStorage key for last-read timestamps per order
const LAST_READ_KEY = 'dv_msg_last_read';

function getLastRead() {
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) || '{}'); } catch { return {}; }
}
function setLastRead(orderId) {
  const map = getLastRead();
  map[orderId] = new Date().toISOString();
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
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

export default function MessagesPage() {
  const { cafe } = useAuth();
  const { setBadge } = useBadges();

  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [selectedId, setSelectedId] = useState(null); // order_id
  const [messages, setMessages] = useState({}); // { orderId: Message[] }
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [lastRead, setLastReadState] = useState(getLastRead);
  const [showList, setShowList] = useState(true); // mobile: show list vs chat
  const [search, setSearch] = useState('');

  const bottomRef = useRef(null);
  const socketRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Load conversation list ────────────────────────────────────
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
      // Update messages cache for open thread
      setMessages((prev) => {
        const existing = prev[msg.order_id] || [];
        if (existing.find((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.order_id]: [...existing, msg] };
      });

      // Update conversation list: bump last_message + last_message_at
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.order_id === msg.order_id);
        if (idx === -1) {
          // New conversation — reload list to get full order details
          loadConversations();
          return prev;
        }
        const updated = { ...prev[idx],
          last_message:     msg.message,
          last_sender_type: msg.sender_type,
          last_message_at:  msg.created_at,
          total_messages:   (prev[idx].total_messages || 0) + 1,
        };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest]; // bump to top
      });

      // Toast for incoming customer messages when chat is not open
      if (msg.sender_type === 'customer') {
        setSelectedId((curr) => {
          if (curr !== msg.order_id) {
            toast(`💬 New message from customer`, { duration: 4000, icon: '🔔' });
          }
          return curr;
        });
      }
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

  // ── Open a conversation ───────────────────────────────────────
  const openConversation = useCallback(async (orderId) => {
    setSelectedId(orderId);
    setShowList(false);
    setText('');
    setTimeout(() => inputRef.current?.focus(), 100);

    // Mark as read
    setLastRead(orderId);
    setLastReadState(getLastRead());

    // Load messages if not already cached
    if (messages[orderId]) return;
    setLoadingMsgs(true);
    try {
      const { data } = await getOwnerMessages(orderId);
      setMessages((prev) => ({ ...prev, [orderId]: data.messages }));
    } catch {
      toast.error('Could not load messages');
    } finally {
      setLoadingMsgs(false);
    }
  }, [messages]);

  // ── Auto-scroll when messages change ─────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  // ── Send reply ────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !selectedId || sending) return;
    setSending(true);
    try {
      await postOwnerMessage(selectedId, trimmed);
      setText('');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // ── Filtered conversation list ────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const token = fmtToken(c.daily_order_number, c.order_type).toLowerCase();
      return (
        token.includes(q) ||
        c.customer_name.toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q)
      );
    });
  }, [conversations, search]);

  const selectedConv = conversations.find((c) => c.order_id === selectedId);
  const activeMessages = (messages[selectedId] || []);

  const isUnread = (conv) => {
    if (conv.last_sender_type !== 'customer') return false;
    const lr = lastRead[conv.order_id];
    if (!lr) return true;
    return new Date(conv.last_message_at) > new Date(lr);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-120px)] max-w-6xl gap-0 overflow-hidden rounded-2xl border border-gray-200 shadow-sm bg-white">

      {/* ── Conversation list ── */}
      <aside className={`${showList ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-100 flex-shrink-0`}>
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-900">Messages</h1>
          <p className="text-xs text-gray-400 mt-0.5">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p>
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
          {loadingConvs && (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>
          )}
          {!loadingConvs && filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-sm">{search ? 'No matches' : 'No messages yet'}</p>
              <p className="text-xs mt-1 text-gray-300">Customer chats will appear here</p>
            </div>
          )}
          {filtered.map((conv) => {
            const unread = isUnread(conv);
            const isActive = conv.order_id === selectedId;
            return (
              <button
                key={conv.order_id}
                onClick={() => openConversation(conv.order_id)}
                className={`w-full text-left px-4 py-3.5 border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                  isActive ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-brand-600">
                    {conv.customer_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className={`text-xs font-bold truncate ${unread ? 'text-gray-900' : 'text-gray-700'}`}>
                        {conv.customer_name}
                      </span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(conv.last_message_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-semibold text-brand-600">{fmtToken(conv.daily_order_number, conv.order_type)}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor(conv.status)}`}>
                        {conv.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs truncate ${unread ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                        {conv.last_sender_type === 'owner' && <span className="text-gray-400">You: </span>}
                        {conv.last_message}
                      </p>
                      {unread && (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-500" />
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Refresh */}
        <div className="px-3 py-2 border-t border-gray-100">
          <button
            onClick={loadConversations}
            className="w-full text-xs text-gray-400 hover:text-brand-500 py-1 transition-colors"
          >
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
              {/* Mobile back button */}
              <button
                onClick={() => setShowList(true)}
                className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 mr-1"
              >
                ←
              </button>
              <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-600 flex-shrink-0">
                {selectedConv.customer_name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{selectedConv.customer_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-semibold text-brand-600">{fmtToken(selectedConv.daily_order_number, selectedConv.order_type)}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-500">
                    {selectedConv.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${selectedConv.table_number}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${statusColor(selectedConv.status)}`}>
                    {selectedConv.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
              {loadingMsgs && (
                <div className="text-center text-sm text-gray-400 py-8">Loading messages…</div>
              )}
              {!loadingMsgs && activeMessages.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">No messages yet</div>
              )}
              {activeMessages.map((m) => (
                <div key={m.id} className={`flex ${m.sender_type === 'owner' ? 'justify-end' : 'justify-start'}`}>
                  {m.sender_type === 'customer' && (
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-600 mr-2 flex-shrink-0 self-end">
                      {selectedConv.customer_name?.charAt(0)?.toUpperCase()}
                    </div>
                  )}
                  <div className={`max-w-[70%] group`}>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-snug ${
                      m.sender_type === 'owner'
                        ? 'bg-brand-500 text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-800 shadow-sm rounded-bl-sm'
                    }`}>
                      {m.message}
                    </div>
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
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
