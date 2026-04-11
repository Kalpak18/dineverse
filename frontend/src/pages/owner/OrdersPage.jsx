import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getOrders, updateOrderStatus, getOwnerMessages, postOwnerMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
import { fmtToken, fmtCurrency, fmtTime } from '../../utils/formatters';
import { printBill } from '../../utils/printBill';

const QUICK_REASONS = [
  'Item(s) out of stock',
  'Kitchen is closed',
  'Too busy — cannot prepare',
  'Customer requested cancellation',
  'Incorrect order details',
  'Item unavailable today',
];

const TABS = { ORDERS: 'orders', BILLS: 'bills', HISTORY: 'history' };

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
      <input
        type="text"
        placeholder={placeholder}
        className="input pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { cafe } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS.ORDERS);
  // Cancel with reason
  const [cancelTarget, setCancelTarget] = useState(null);
  // Billing modal — lifted to top level so OrderCard can open it too
  // Shape: { bill: {...}, onConfirm: (cashReceived) => void } | null
  const [billingModal, setBillingModal] = useState(null);
  // Chat
  const [chatOrderId, setChatOrderId] = useState(null);
  const [unreadChats, setUnreadChats] = useState({}); // { orderId: count }
  const socketRef = useRef(null);

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await getOrders({ limit: 200 });
      setOrders(data.orders);
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useSocketIO(
    cafe?.id,
    (order) => {
      setOrders((prev) => [order, ...prev]);
      toast.success(`New order #${fmtToken(order.daily_order_number)} from ${order.customer_name}!`);
    },
    (updated) => {
      setOrders((prev) =>
        prev.map((o) => o.id === updated.id ? { ...o, status: updated.status, updated_at: updated.updated_at } : o)
      );
    }
  );

  // Opens BillingModal for a single active-order card (print / quick mark-paid)
  const openOrderBilling = useCallback((order) => {
    setBillingModal({
      bill: {
        isTakeaway: order.order_type === 'takeaway',
        customerName: order.customer_name,
        orderNumber: order.daily_order_number,
        table_number: order.table_number,
        total: parseFloat(order.total_amount),
        aggregatedItems: (order.items || []).map((i) => ({
          name: i.item_name, qty: i.quantity, total: parseFloat(i.subtotal),
        })),
        orders: [order],
      },
      onConfirm: (cashReceived) => handleStatusUpdate(order.id, 'paid', cashReceived),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusUpdate = async (orderId, newStatus, cashReceived = null, cancellationReason = null) => {
    try {
      await updateOrderStatus(orderId, newStatus, cashReceived, cancellationReason);
      setOrders((prev) =>
        prev.map((o) => o.id === orderId
          ? { ...o, status: newStatus, cancellation_reason: cancellationReason || o.cancellation_reason }
          : o)
      );
      toast.success(`Order marked as ${newStatus}`);
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  // Connect socket + page-level listener for incoming customer messages
  useEffect(() => {
    if (!cafe?.id) return;
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    socketRef.current = socket;
    socket.emit('join_cafe', cafe.id);
    socket.on('connect', () => socket.emit('join_cafe', cafe.id));

    // Page-level listener: notify owner when a customer message arrives
    socket.on('order_message', (msg) => {
      if (msg.sender_type !== 'customer') return;
      // Only bump unread count if chat panel isn't already open for this order
      setChatOrderId((currentChatId) => {
        if (currentChatId !== msg.order_id) {
          setUnreadChats((prev) => ({ ...prev, [msg.order_id]: (prev[msg.order_id] || 0) + 1 }));
          toast(`💬 New message from customer`, { duration: 4000, icon: '🔔' });
        }
        return currentChatId;
      });
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [cafe?.id]);

  // Orders tab: active kitchen orders.
  // Takeaway "ready" → Bills tab (ready for pickup + payment)
  // Dine-in "served" → Bills tab (Table Bills)
  const isOrdersTabVisible = (o) => {
    if (['paid', 'cancelled'].includes(o.status)) return false;
    if (o.order_type === 'takeaway' && o.status === 'ready') return false;
    if (o.order_type !== 'takeaway' && o.status === 'served') return false;
    return true;
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (!isOrdersTabVisible(o)) return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (!q) return true;
      const token = String(o.daily_order_number || '');
      return o.customer_name.toLowerCase().includes(q) || o.table_number.toLowerCase().includes(q) || token.includes(q);
    });
  }, [orders, statusFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bills tab: takeaway orders ready for pickup
  const takeawayPickups = useMemo(
    () => orders.filter((o) => o.order_type === 'takeaway' && o.status === 'ready'),
    [orders]
  );

  // Bills tab: dine-in tables with ≥1 served order
  const tableBills = useMemo(() => {
    const todayStr = new Date().toDateString();
    const tableMap = {};

    orders.forEach((o) => {
      if (o.status === 'cancelled' || o.status === 'paid') return;
      if (o.order_type === 'takeaway') return;
      if (new Date(o.created_at).toDateString() !== todayStr) return;

      if (!tableMap[o.table_number]) {
        tableMap[o.table_number] = {
          table_number: o.table_number,
          customer_name: o.customer_name,
          orders: [],
          total: 0,
          itemMap: {},
        };
      }
      const bill = tableMap[o.table_number];
      bill.orders.push(o);
      bill.total += parseFloat(o.total_amount);
      o.items?.forEach((item) => {
        if (!bill.itemMap[item.item_name]) {
          bill.itemMap[item.item_name] = { name: item.item_name, qty: 0, total: 0 };
        }
        bill.itemMap[item.item_name].qty += item.quantity;
        bill.itemMap[item.item_name].total += parseFloat(item.subtotal);
      });
    });

    return Object.values(tableMap)
      .filter((b) => b.orders.some((o) => o.status === 'served'))
      .map((b) => ({ ...b, aggregatedItems: Object.values(b.itemMap) }))
      .sort((a, b) => new Date(b.orders[0].created_at) - new Date(a.orders[0].created_at));
  }, [orders]);

  const billsCount = tableBills.length + takeawayPickups.length;

  const paidOrders = useMemo(() => orders.filter((o) => o.status === 'paid'), [orders]);

  const statusCounts = useMemo(() => {
    const counts = {};
    orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return counts;
  }, [orders]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <button onClick={loadOrders} className="btn-secondary text-sm">↻ Refresh</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: TABS.ORDERS,  label: 'Orders',  count: orders.filter(isOrdersTabVisible).length },
          { key: TABS.BILLS,   label: 'Bills',   count: billsCount },
          { key: TABS.HISTORY, label: 'History', count: paidOrders.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === key
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === key ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Orders Tab ── */}
      {activeTab === TABS.ORDERS && (
        <div className="space-y-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by customer name or table number..."
          />

          {/* Status filter pills */}
          <div className="flex gap-2 flex-wrap">
            {['', 'pending', 'confirmed', 'preparing', 'ready'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s === '' ? 'All' : STATUS_CONFIG[s].label}
                {s !== '' && (
                  <span className="ml-1 text-xs">({statusCounts[s] || 0})</span>
                )}
              </button>
            ))}
          </div>

          {(search || statusFilter) && (
            <p className="text-xs text-gray-400">
              {filteredOrders.length} result{filteredOrders.length !== 1 ? 's' : ''}
              {search && ` for "${search}"`}
              {statusFilter && ` · ${STATUS_CONFIG[statusFilter].label}`}
            </p>
          )}

          {filteredOrders.length === 0 ? (
            <div className="card text-center py-16 text-gray-400">
              <p className="text-4xl mb-2">📋</p>
              <p>
                No active orders
                {search && ` matching "${search}"`}
                {statusFilter && ` with status "${STATUS_CONFIG[statusFilter].label}"`}.
              </p>
              {(search || statusFilter) && (
                <button
                  onClick={() => { setSearch(''); setStatusFilter(''); }}
                  className="mt-3 text-sm text-brand-600 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusUpdate={handleStatusUpdate}
                  onCancelClick={(o) => setCancelTarget(o)}
                  onChatClick={(o) => {
                    setChatOrderId(chatOrderId === o.id ? null : o.id);
                    setUnreadChats((prev) => ({ ...prev, [o.id]: 0 }));
                  }}
                  onOpenBilling={openOrderBilling}
                  chatOpen={chatOrderId === order.id}
                  chatUnread={unreadChats[order.id] || 0}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                  socketRef={socketRef}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bills Tab ── */}
      {activeTab === TABS.BILLS && (
        <BillsView
          takeawayPickups={takeawayPickups}
          tableBills={tableBills}
          onStatusUpdate={handleStatusUpdate}
          onOpenBilling={(bill, onConfirm) => setBillingModal({ bill, onConfirm })}
        />
      )}

      {/* ── History Tab ── */}
      {activeTab === TABS.HISTORY && (
        <HistoryView orders={paidOrders} />
      )}

      {/* ── Billing Modal (shared: Bills tab + OrderCard print) ── */}
      {billingModal && (
        <BillingModal
          bill={billingModal.bill}
          onConfirm={billingModal.onConfirm}
          onClose={() => setBillingModal(null)}
        />
      )}

      {/* ── Cancel Reason Modal ── */}
      {cancelTarget && (
        <CancelReasonModal
          order={cancelTarget}
          onConfirm={(reason) => {
            handleStatusUpdate(cancelTarget.id, 'cancelled', null, reason);
            setCancelTarget(null);
          }}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Order Card (Grid Item) ───────────────────────────────────────────────

function OrderCard({ order, onStatusUpdate, onCancelClick, onChatClick, onOpenBilling, chatOpen, chatUnread, expanded, onToggle, socketRef }) {
  const statusCfg = STATUS_CONFIG[order.status];
  const nextStatus = getNextStatus(order.status, order.order_type);
  const actionLabel = getActionLabel(order.status, order.order_type);

  // Status-based left border colors
  const borderColor = {
    pending:   'border-l-yellow-400',
    confirmed: 'border-l-blue-400',
    preparing: 'border-l-orange-400',
    ready:     'border-l-teal-400',
    served:    'border-l-green-400',
  }[order.status] || 'border-l-gray-300';

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 ${borderColor} flex flex-col`}>
      {/* Card header */}
      <div className="px-4 pt-4 pb-3">
        {/* Row 1: order number + status badge */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-gray-900 text-sm">#{fmtToken(order.daily_order_number)}</span>
          <span className={`badge text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
        </div>

        {/* Row 2: customer name */}
        <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>

        {/* Row 3: table + time */}
        <p className="text-xs text-gray-400 mt-0.5">
          {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
          {' · '}{fmtTime(order.created_at)}
        </p>
      </div>

      {/* Items preview (always visible) */}
      <div className="px-4 pb-2">
        <div className="space-y-0.5">
          {(order.items || []).slice(0, expanded ? undefined : 3).map((item) => (
            <div key={item.id} className="flex justify-between text-xs text-gray-600">
              <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
              <span className="flex-shrink-0">{fmtCurrency(item.subtotal)}</span>
            </div>
          ))}
          {!expanded && (order.items || []).length > 3 && (
            <p className="text-xs text-gray-400 italic">+{order.items.length - 3} more…</p>
          )}
        </div>
        {expanded && order.notes && (
          <p className="text-xs text-amber-600 mt-1.5 italic">📝 {order.notes}</p>
        )}
      </div>

      {/* Total + toggle */}
      <div
        className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <span className="font-bold text-gray-900 text-sm">{fmtCurrency(order.total_amount)}</span>
        <span className="text-xs text-gray-400">{expanded ? '▲ less' : '▼ more'}</span>
      </div>

      {/* Action buttons */}
      <div className="px-3 pb-3 pt-2 flex gap-2 mt-auto">
        {nextStatus && (
          <button
            onClick={() => onStatusUpdate(order.id, nextStatus)}
            className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition-colors"
          >
            {actionLabel}
          </button>
        )}
        <button
          onClick={() => onOpenBilling(order)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors flex-shrink-0"
          title="Print / collect payment"
        >
          🖨️
        </button>
        <button
          onClick={() => onChatClick(order)}
          className={`relative px-3 py-2 rounded-xl border text-xs font-medium transition-colors flex-shrink-0 ${
            chatOpen ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
          title="Chat with customer"
        >
          💬
          {chatUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {chatUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => onCancelClick(order)}
          className="px-3 py-2 rounded-xl border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors flex-shrink-0"
          title="Cancel order"
        >
          ✕
        </button>
      </div>

      {/* Inline chat panel */}
      {chatOpen && (
        <OwnerChatPanel order={order} socketRef={socketRef} />
      )}
    </div>
  );
}

// ─── Bills View (Takeaway Pickup + Table Bills) ────────────────────────────

function BillsView({ takeawayPickups, tableBills, onStatusUpdate, onOpenBilling }) {
  const [expandedTable, setExpandedTable] = useState(null);
  const [search, setSearch] = useState('');
  const [collecting, setCollecting] = useState(null); // orderId or tableNumber being paid

  const handleCollect = async (bill, cashReceived) => {
    const key = bill.isTakeaway ? bill.orders[0].id : bill.table_number;
    setCollecting(key);
    try {
      const toPay = bill.orders.filter((o) =>
        bill.isTakeaway ? o.status === 'ready' : o.status === 'served'
      );
      await Promise.all(
        toPay.map((o, i) => onStatusUpdate(o.id, 'paid', i === 0 ? cashReceived : null))
      );
      toast.success(
        bill.isTakeaway
          ? `Token #${bill.orders[0].daily_order_number} — payment collected!`
          : `Table ${bill.table_number} — payment collected!`
      );
    } finally {
      setCollecting(null);
    }
  };

  const openTakeawayBilling = (order) => {
    const bill = {
      isTakeaway: true,
      customerName: order.customer_name,
      orderNumber: order.daily_order_number,
      table_number: 'Takeaway',
      total: parseFloat(order.total_amount),
      aggregatedItems: (order.items || []).map((i) => ({
        name: i.item_name, qty: i.quantity, total: parseFloat(i.subtotal),
      })),
      orders: [order],
    };
    onOpenBilling(bill, (cashReceived) => handleCollect(bill, cashReceived));
  };

  const q = search.trim().toLowerCase();

  const filteredTakeaway = useMemo(() => {
    if (!q) return takeawayPickups;
    return takeawayPickups.filter((o) => {
      const token = String(o.daily_order_number || '');
      return (
        token.includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.table_number.toLowerCase().includes(q)
      );
    });
  }, [takeawayPickups, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTables = useMemo(() => {
    if (!q) return tableBills;
    return tableBills.filter((b) => {
      const tokenMatch = b.orders.some((o) =>
        String(o.daily_order_number || '').includes(q)
      );
      return (
        tokenMatch ||
        b.table_number.toLowerCase().includes(q) ||
        b.customer_name.toLowerCase().includes(q)
      );
    });
  }, [tableBills, q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (takeawayPickups.length === 0 && tableBills.length === 0) {
    return (
      <div className="card text-center py-16 text-gray-400">
        <p className="text-4xl mb-2">🧾</p>
        <p>No active bills right now.</p>
        <p className="text-xs mt-1">
          Takeaway orders ready for pickup and dine-in served orders appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Combined search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by token #, customer or table..."
      />

      {/* ── Takeaway Pickup section ── */}
      {takeawayPickups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              🥡 Takeaway Pickup
            </h2>
            <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-2 py-0.5 rounded-full">
              {filteredTakeaway.length}
            </span>
          </div>

          {filteredTakeaway.length === 0 ? (
            <div className="card text-center py-8 text-gray-400">
              <p>No takeaway orders match "{search}".</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredTakeaway.map((order) => {
                const token = order.daily_order_number;
                return (
                  <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 border-l-teal-400 flex flex-col">
                    <div className="px-4 pt-4 pb-3 flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-900 text-sm">#{fmtToken(token)}</span>
                        <span className="badge bg-teal-100 text-teal-700 text-xs">Ready for Pickup</span>
                      </div>
                      <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">🥡 Takeaway · {fmtTime(order.created_at)}</p>
                      <div className="mt-2 space-y-0.5">
                        {order.items?.map((item) => (
                          <div key={item.id} className="flex justify-between text-xs text-gray-600">
                            <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
                            <span className="flex-shrink-0">{fmtCurrency(item.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                      <span className="font-bold text-gray-900 text-sm">{fmtCurrency(order.total_amount)}</span>
                    </div>
                    <div className="px-3 pb-3 pt-0">
                      <button
                        onClick={() => openTakeawayBilling(order)}
                        disabled={collecting === order.id}
                        className="w-full py-2.5 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-bold text-sm transition-colors"
                      >
                        {collecting === order.id ? 'Processing…' : '💵 Collect Payment'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Table Bills section ── */}
      {tableBills.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              🍽️ Table Bills
            </h2>
            <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
              {filteredTables.length}
            </span>
          </div>

          {filteredTables.length === 0 ? (
            <div className="card text-center py-8 text-gray-400">
              <p>No tables match "{search}".</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredTables.map((bill) => {
                const allServed = bill.orders.every((o) => o.status === 'served');
                const hasActive = bill.orders.some((o) =>
                  ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)
                );
                const servedTotal = bill.orders
                  .filter((o) => o.status === 'served')
                  .reduce((s, o) => s + parseFloat(o.total_amount), 0);
                const isExpanded = expandedTable === bill.table_number;

                return (
                  <div key={bill.table_number} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 border-l-green-400 flex flex-col">
                    {/* Summary row */}
                    <div
                      className="flex items-center justify-between px-4 pt-4 pb-3 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setExpandedTable(isExpanded ? null : bill.table_number)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {bill.table_number}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{bill.customer_name}</p>
                          <p className="text-xs text-gray-400">
                            {bill.orders.length} order{bill.orders.length !== 1 ? 's' : ''}
                            {bill.orders.length > 1 && (
                              <span className="ml-1 text-orange-500 font-medium">· multiple rounds</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900">{fmtCurrency(bill.total)}</p>
                        <p className={`text-xs font-medium ${
                          allServed ? 'text-green-600' : hasActive ? 'text-orange-500' : 'text-gray-400'
                        }`}>
                          {allServed ? '✓ Ready to bill' : hasActive ? `Served ${fmtCurrency(servedTotal)}` : 'Partial'}
                        </p>
                      </div>
                    </div>

                    <div className="px-4 pb-3 border-t border-gray-50 flex items-center justify-between pt-2">
                      <span className="text-xs text-gray-400">{isExpanded ? '▲ Hide details' : '▼ Show details'}</span>
                      {allServed && (
                        <button
                          onClick={() => onOpenBilling(bill, (cashReceived) => handleCollect(bill, cashReceived))}
                          disabled={collecting === bill.table_number}
                          className="py-1.5 px-4 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-bold text-xs transition-colors"
                        >
                          {collecting === bill.table_number ? 'Processing…' : '💵 Collect Payment'}
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-4">
                        {/* Aggregated items */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Combined Items
                          </p>
                          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                            {bill.aggregatedItems.map((item) => (
                              <div key={item.name} className="flex justify-between text-sm text-gray-700 px-3 py-2">
                                <span>{item.name} × {item.qty}</span>
                                <span className="font-medium">{fmtCurrency(item.total)}</span>
                              </div>
                            ))}
                            <div className="flex justify-between font-bold text-gray-900 px-3 py-2.5 bg-gray-50 rounded-b-xl">
                              <span>Total Bill</span>
                              <span>{fmtCurrency(bill.total)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Per-order breakdown */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Order Breakdown
                          </p>
                          <div className="space-y-2">
                            {bill.orders.map((order) => {
                              const token = order.daily_order_number;
                              return (
                                <div key={order.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-gray-800 text-sm">#{fmtToken(token)}</span>
                                    <span className="text-xs text-gray-400">{fmtTime(order.created_at)}</span>
                                    <span className={`badge text-xs ${STATUS_CONFIG[order.status].color}`}>
                                      {STATUS_CONFIG[order.status].label}
                                    </span>
                                    <span className="font-bold text-gray-900 text-sm">{fmtCurrency(order.total_amount)}</span>
                                  </div>
                                  {order.items?.length > 0 && (
                                    <div className="mt-1.5 pl-1 space-y-0.5">
                                      {order.items.map((item) => (
                                        <p key={item.id} className="text-xs text-gray-400">
                                          {item.item_name} × {item.quantity}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Billing Modal ────────────────────────────────────────────────────────

const PAYMENT_MODES = [
  { value: 'cash',    label: '💵 Cash' },
  { value: 'upi',     label: '📱 UPI' },
  { value: 'card',    label: '💳 Card / POS' },
];

function BillingModal({ bill, onConfirm, onClose }) {
  const { cafe } = useAuth();
  // step: 'collect' → select payment & mark paid  |  'receipt' → print / done
  const [step, setStep]           = useState('collect');
  const [confirming, setConfirming] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  // saved values carried into receipt step
  const [paidMode, setPaidMode]   = useState(null);
  const [paidCash, setPaidCash]   = useState(null);

  const cash    = parseFloat(cashInput) || 0;
  const change  = cash - bill.total;
  const isValid = cash >= bill.total;
  const isCash  = paymentMode === 'cash';

  const doPrint = (mode, cashVal) =>
    printBill({
      cafe,
      bill,
      cashReceived: cashVal,
      paymentMode: mode,
      isPaid: true,
    });

  const handleMarkPaid = async () => {
    const cashVal = isCash && cashInput ? parseFloat(cashInput) : null;
    setConfirming(true);
    try {
      await onConfirm(cashVal);
      setPaidMode(paymentMode);
      setPaidCash(cashVal);
      setStep('receipt');
    } finally {
      setConfirming(false);
    }
  };

  const overlay = (children) => (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="h-1 bg-green-500 rounded-t-2xl" />
        {children}
      </div>
    </div>
  );

  // ── Step 2: Receipt ───────────────────────────────────────────
  if (step === 'receipt') {
    const modeLabel = PAYMENT_MODES.find((m) => m.value === paidMode)?.label ?? paidMode;
    return overlay(
      <div className="p-5 space-y-4">
        <div className="text-center py-2">
          <div className="text-4xl mb-2">✅</div>
          <h3 className="font-bold text-gray-900 text-lg">Payment Collected!</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {bill.isTakeaway ? `🥡 ${bill.customerName}` : `🍽️ Table ${bill.table_number}`}
            {' · '}{fmtCurrency(bill.total)}
          </p>
          <p className="text-xs text-gray-400 mt-1">{modeLabel}</p>
          {paidCash != null && (
            <p className="text-xs text-gray-400">
              Cash: {fmtCurrency(paidCash)} · Change: {fmtCurrency(paidCash - bill.total)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => { doPrint(paidMode, paidCash); onClose(); }}
            className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm transition-colors"
          >
            🖨️ Print Bill &amp; Done
          </button>
          <button onClick={onClose} className="btn-secondary w-full py-3">
            Done (Skip Print)
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: Collect ───────────────────────────────────────────
  return overlay(
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-bold text-gray-900 text-lg">Collect Payment</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          {bill.isTakeaway
            ? `🥡 ${bill.customerName} — Token #${fmtToken(bill.orderNumber)}`
            : `🍽️ Table ${bill.table_number}`}
        </p>
      </div>

      {/* Item list */}
      <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1 text-sm">
        {bill.aggregatedItems.map((item) => (
          <div key={item.name} className="flex justify-between text-gray-600">
            <span>{item.name} × {item.qty}</span>
            <span>{fmtCurrency(item.total)}</span>
          </div>
        ))}
        <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900">
          <span>Bill Total</span>
          <span>{fmtCurrency(bill.total)}</span>
        </div>
      </div>

      {/* Payment mode selector */}
      <div>
        <label className="label">Payment Mode</label>
        <div className="flex gap-2">
          {PAYMENT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { setPaymentMode(m.value); if (m.value !== 'cash') setCashInput(''); }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                paymentMode === m.value
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cash received */}
      {isCash && (
        <div>
          <label className="label">Cash Received (₹)</label>
          <input
            type="number"
            min={bill.total}
            step="0.50"
            placeholder={`Min ₹${bill.total.toFixed(2)}`}
            className="input text-lg font-semibold"
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Change display */}
      {isCash && cashInput && (
        <div className={`rounded-xl px-4 py-3 text-center ${
          isValid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          {isValid ? (
            <>
              <p className="text-xs text-green-600 font-medium">Return to Customer</p>
              <p className="text-3xl font-bold text-green-700 mt-0.5">{fmtCurrency(change)}</p>
            </>
          ) : (
            <p className="text-sm text-red-600 font-medium">Short by {fmtCurrency(bill.total - cash)}</p>
          )}
        </div>
      )}

      {/* UPI hint */}
      {paymentMode === 'upi' && cafe?.upi_id && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-center text-blue-700">
          UPI: <strong>{cafe.upi_id}</strong>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={handleMarkPaid}
          disabled={confirming || (isCash && cashInput !== '' && !isValid)}
          className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold text-sm transition-colors"
        >
          {confirming ? 'Processing…' : isCash && cashInput ? 'Confirm & Mark Paid' : 'Mark Paid'}
        </button>
        <button
          onClick={() => doPrint(paymentMode, isCash && cashInput ? parseFloat(cashInput) : null)}
          className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm transition-colors"
        >
          🖨️ Print Draft Bill
        </button>
        <button onClick={onClose} className="btn-secondary w-full py-3">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Cancel Reason Modal ───────────────────────────────────────
function CancelReasonModal({ order, onConfirm, onClose }) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">Cancel Order</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              #{fmtToken(order.daily_order_number)} · {order.customer_name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600 font-medium">Select a reason (required):</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  reason === r
                    ? 'bg-red-500 text-white border-red-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-red-300 hover:text-red-600'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="input resize-none text-sm"
            rows={2}
            placeholder="Or type a custom reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onConfirm(reason.trim())}
              disabled={!reason.trim()}
              className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-bold transition-colors"
            >
              Cancel Order
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors"
            >
              Keep Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Owner Chat Panel (inline on OrderCard) ────────────────────
function OwnerChatPanel({ order, socketRef }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    getOwnerMessages(order.id)
      .then(({ data }) => setMessages(data.messages || []))
      .catch(() => {})
      .finally(() => setLoadingMsgs(false));
  }, [order.id]);

  useEffect(() => {
    if (!socketRef?.current) return;
    const handler = (msg) => {
      if (msg.order_id !== order.id) return;
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
    };
    socketRef.current.on('order_message', handler);
    return () => socketRef.current?.off('order_message', handler);
  }, [order.id, socketRef]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      const { data } = await postOwnerMessage(order.id, msg);
      setMessages((prev) => [...prev, data.message]);
      setText('');
    } catch { toast.error('Could not send message'); }
    finally { setSending(false); }
  };

  return (
    <div className="border-t border-gray-100 bg-gray-50">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">💬 Customer Chat</span>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-40 overflow-y-auto">
        {loadingMsgs && <p className="text-xs text-gray-400">Loading…</p>}
        {!loadingMsgs && messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-2">No messages yet.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_type === 'owner' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-2.5 py-1.5 rounded-xl text-xs leading-snug ${
              m.sender_type === 'owner'
                ? 'bg-brand-500 text-white rounded-br-none'
                : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
            }`}>
              {m.sender_type === 'customer' && (
                <span className="block text-[10px] font-semibold text-gray-400 mb-0.5">Customer</span>
              )}
              {m.message}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-3 pb-3 pt-1 flex gap-2">
        <input
          className="flex-1 input text-xs py-1.5"
          placeholder="Reply to customer…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-xs font-bold transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── History View ─────────────────────────────────────────────────────────

function HistoryView({ orders }) {
  const { cafe } = useAuth();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const token = String(o.daily_order_number || '');
      return (
        token.includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.table_number.toLowerCase().includes(q)
      );
    });
  }, [orders, search]);

  if (orders.length === 0) {
    return (
      <div className="card text-center py-16 text-gray-400">
        <p className="text-4xl mb-2">💜</p>
        <p>No paid orders yet.</p>
        <p className="text-xs mt-1">Orders marked as Paid will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Paid orders — revenue is counted from these.{' '}
        Total: {fmtCurrency(orders.reduce((s, o) => s + parseFloat(o.total_amount), 0))}
      </p>
      <SearchInput value={search} onChange={setSearch} placeholder="Search by token #, customer or table..." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((order) => {
          const token = order.daily_order_number;
          return (
            <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 border-l-purple-400 flex flex-col">
              <div className="px-4 pt-4 pb-3 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-900 text-sm">#{fmtToken(token)}</span>
                  <span className="badge bg-purple-100 text-purple-800 text-xs">Paid</span>
                </div>
                <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
                  {' · '}{fmtTime(order.created_at)}
                </p>
                <div className="mt-2 space-y-0.5">
                  {(order.items || []).slice(0, 3).map((item) => (
                    <div key={item.id} className="flex justify-between text-xs text-gray-500">
                      <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
                      <span className="flex-shrink-0">{fmtCurrency(item.subtotal)}</span>
                    </div>
                  ))}
                  {(order.items || []).length > 3 && (
                    <p className="text-xs text-gray-400 italic">+{order.items.length - 3} more…</p>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">{fmtCurrency(order.total_amount)}</span>
                <button
                  onClick={() => printBill({
                    cafe,
                    isPaid: true,
                    bill: {
                      isTakeaway: order.order_type === 'takeaway',
                      customerName: order.customer_name,
                      orderNumber: token,
                      table_number: order.table_number,
                      total: parseFloat(order.total_amount),
                      aggregatedItems: (order.items || []).map((i) => ({
                        name: i.item_name, qty: i.quantity, total: parseFloat(i.subtotal),
                      })),
                      orders: [order],
                    },
                  })}
                  className="text-xs px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
                  title="Print bill"
                >
                  🖨️ Print
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
