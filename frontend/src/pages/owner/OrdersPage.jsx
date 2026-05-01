import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../../utils/socketUrl';
import { getOrders, updateOrderStatus, setKitchenMode, updateItemStatus, getOwnerMessages, postOwnerMessage, remindBill } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useBadges } from '../../context/BadgeContext';
import { useSocketIO } from '../../hooks/useSocketIO';
import LoadingSpinner from '../../components/LoadingSpinner';
import DeliveryMap from '../../components/DeliveryMap';
import PageHint from '../../components/PageHint';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';
import { premiumToast, isPremiumError } from '../../utils/premiumToast';
import { STATUS_CONFIG, getNextStatus, getActionLabel } from '../../constants/statusConfig';
import { fmtToken, fmtCurrency, fmtTime, fmtDateTime } from '../../utils/formatters';
import { printBill } from '../../utils/printBill';
import { printKot } from '../../utils/printKot';

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
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const { setBadge } = useBadges();
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
  const [chatMessages, setChatMessages] = useState({}); // { orderId: Message[] }
  const [chatLoading, setChatLoading] = useState({}); // { orderId: bool }
  const socketRef = useRef(null);

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await getOrders({ limit: 200 });
      setOrders(data.orders || []);
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
      const token = fmtToken(order.daily_order_number, order.order_type);
      toast.success(`New order ${token} from ${order.customer_name}!`);
      // Native OS notification when running as Electron desktop app
      window.electronAPI?.notifyNewOrder(
        `New Order — ${token}`,
        `${order.customer_name} · ${order.order_type === 'takeaway' ? 'Takeaway' : `Table ${order.table_number}`}`
      );
    },
    (updated) => {
      setOrders((prev) =>
        prev.map((o) => o.id === updated.id ? { ...o, ...updated } : o)
      );
    }
  );

  // Opens BillingModal — stores orderId so bill always reflects live order state
  const openOrderBilling = useCallback((order) => {
    setBillingModal({
      orderId: order.id,
      onConfirm: (cashReceived) => handleStatusUpdate(order.id, 'paid', cashReceived),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the bill object from live orders state (keeps modal data fresh)
  const billingBill = billingModal?.orderId
    ? (() => {
        const o = orders.find((x) => x.id === billingModal.orderId);
        if (!o) return null;
        return {
          isTakeaway:     o.order_type === 'takeaway',
          customerName:   o.customer_name,
          orderNumber:    o.daily_order_number,
          table_number:   o.table_number,
          subtotal:       parseFloat(o.total_amount)    || 0,
          taxAmount:      parseFloat(o.tax_amount)      || 0,
          taxRate:        parseFloat(o.tax_rate)        || 0,
          discountAmount: parseFloat(o.discount_amount) || 0,
          tipAmount:      parseFloat(o.tip_amount)      || 0,
          deliveryFee:    parseFloat(o.delivery_fee)    || 0,
          total:          parseFloat(o.final_amount || o.total_amount) || 0,
          aggregatedItems: (o.items || []).map((i) => ({
            name: i.item_name, qty: i.quantity, total: parseFloat(i.subtotal),
          })),
          orders: [o],
        };
      })()
    : billingModal?.bill || null;

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
      throw err; // re-throw so callers (BillingModal, handleCollect) can detect failure
    }
  };

  const handleKitchenModeToggle = async (orderId, mode) => {
    try {
      const { data } = await setKitchenMode(orderId, mode);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, ...data.order } : o));
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleItemStatusUpdate = async (orderId, itemId, status) => {
    try {
      const { data } = await updateItemStatus(orderId, itemId, status);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, ...data.order } : o));
    } catch (err) {
      if (isPremiumError(err)) return premiumToast('Per-item status tracking');
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

    // Page-level listener: handles ALL chat messages (both directions)
    socket.on('order_message', (msg) => {
      // Always add message to state (dedup by id)
      setChatMessages((prev) => {
        const existing = prev[msg.order_id] || [];
        if (existing.find((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.order_id]: [...existing, msg] };
      });

      // Toast + unread badge only for incoming customer messages when chat panel is closed
      if (msg.sender_type !== 'customer') return;
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
    if (!o.status) return false;
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
      return (o.customer_name || '').toLowerCase().includes(q) || (o.table_number || '').toLowerCase().includes(q) || token.includes(q);
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
          total: 0, subtotal: 0, taxAmount: 0, discountAmount: 0, tipAmount: 0, deliveryFee: 0,
          taxRate: parseFloat(o.tax_rate) || 0,
          itemMap: {},
        };
      }
      const bill = tableMap[o.table_number];
      bill.orders.push(o);
      bill.subtotal       += parseFloat(o.total_amount)    || 0;
      bill.taxAmount      += parseFloat(o.tax_amount)      || 0;
      bill.discountAmount += parseFloat(o.discount_amount) || 0;
      bill.tipAmount      += parseFloat(o.tip_amount)      || 0;
      bill.deliveryFee    += parseFloat(o.delivery_fee)    || 0;
      bill.total          += parseFloat(o.final_amount || o.total_amount) || 0;
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

  const [historyDateRange, setHistoryDateRange] = useState('today');

  const historyFilteredCount = useMemo(() => {
    if (historyDateRange === 'all') return paidOrders.length;
    const todayStart     = new Date(); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(); yesterdayStart.setHours(0, 0, 0, 0); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return paidOrders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      if (historyDateRange === 'today')     return t >= todayStart.getTime();
      if (historyDateRange === 'yesterday') return t >= yesterdayStart.getTime() && t < todayStart.getTime();
      if (historyDateRange === '7d')        return t >= Date.now() - 7  * 86400000;
      if (historyDateRange === '30d')       return t >= Date.now() - 30 * 86400000;
      return true;
    }).length;
  }, [paidOrders, historyDateRange]);

  const statusCounts = useMemo(() => {
    const counts = {};
    orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return counts;
  }, [orders]);

  // Push active (non-paid, non-cancelled) order count to sidebar badge
  useEffect(() => {
    const activeCount = orders.filter((o) => !['paid', 'cancelled'].includes(o.status)).length;
    setBadge('/owner/orders', activeCount);
  }, [orders, setBadge]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-4xl space-y-5">
      <PageHint
        storageKey="dv_hint_orders"
        title="Orders — manage every order from receipt to payment"
        items={[
          { icon: '📋', text: 'Orders tab: incoming live orders. Confirm → Prepare → Ready. Orders with status Pending need your attention first.' },
          { icon: '🧾', text: 'Bills tab: collect payment. Click "Collect Payment" on a table — multiple rounds are combined into one bill automatically.' },
          { icon: '🕐', text: 'History tab: all paid orders. Search by date range, reprint any bill, or check daily totals.' },
          { icon: '💬', text: 'Each order has a chat button — reply to customer questions directly from the order card.' },
          { icon: '❌', text: 'Cancel an order with a reason (item unavailable, duplicate, etc.) — customer sees the cancellation note.' },
        ]}
        tip="Keep this page open on your counter device. New orders arrive in real time with a sound alert."
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <button onClick={loadOrders} className="btn-secondary text-sm">↻ Refresh</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: TABS.ORDERS,  label: 'Orders',  count: orders.filter(isOrdersTabVisible).length },
          { key: TABS.BILLS,   label: 'Bills',   count: billsCount },
          { key: TABS.HISTORY, label: 'History', count: historyFilteredCount },
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
                  onKitchenModeToggle={handleKitchenModeToggle}
                  onItemStatusUpdate={handleItemStatusUpdate}
                  onCancelClick={(o) => setCancelTarget(o)}
                  onChatClick={async (o) => {
                    const newChatId = chatOrderId === o.id ? null : o.id;
                    setChatOrderId(newChatId);
                    setUnreadChats((prev) => ({ ...prev, [o.id]: 0 }));
                    // Fetch message history the first time this order's chat is opened
                    if (newChatId && !chatLoading[o.id]) {
                      setChatLoading((prev) => ({ ...prev, [o.id]: true }));
                      try {
                        const { data } = await getOwnerMessages(o.id);
                        setChatMessages((prev) => {
                          // Merge HTTP history with socket messages, dedup by id
                          const all = [...(data.messages || []), ...(prev[o.id] || [])];
                          const merged = [...new Map(all.map((m) => [m.id, m])).values()];
                          merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                          return { ...prev, [o.id]: merged };
                        });
                      } catch {
                        // Leave whatever socket messages we already have
                      } finally {
                        setChatLoading((prev) => ({ ...prev, [o.id]: false }));
                      }
                    }
                  }}
                  onOpenBilling={openOrderBilling}
                  chatOpen={chatOrderId === order.id}
                  chatUnread={unreadChats[order.id] || 0}
                  chatMessages={chatMessages[order.id] || []}
                  chatMessagesLoading={chatLoading[order.id] || false}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
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
          onRemind={async (tableNumber) => {
            try {
              await remindBill(tableNumber);
              toast.success(`Reminder sent to table ${tableNumber}`);
            } catch {
              toast.error('Could not send reminder');
            }
          }}
        />
      )}

      {/* ── History Tab ── */}
      {activeTab === TABS.HISTORY && (
        <HistoryView orders={paidOrders} dateRange={historyDateRange} onDateRangeChange={setHistoryDateRange} />
      )}

      {/* ── Billing Modal (shared: Bills tab + OrderCard print) ── */}
      {billingBill && (
        <BillingModal
          bill={billingBill}
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

function OrderCard({ order, onStatusUpdate, onKitchenModeToggle, onItemStatusUpdate, onCancelClick, onChatClick, onOpenBilling, chatOpen, chatUnread, chatMessages, chatMessagesLoading, expanded, onToggle }) {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const isPremium = cafe?.plan_tier === 'premium';
  const [advancing, setAdvancing] = useState(false);
  const statusCfg = STATUS_CONFIG[order.status] || {};
  const nextStatus = getNextStatus(order.status, order.order_type);
  const actionLabel = getActionLabel(order.status, order.order_type);
  const isIndividual = order.kitchen_mode === 'individual';

  const handleAdvance = async () => {
    if (!nextStatus || advancing) return;
    setAdvancing(true);
    try { await onStatusUpdate(order.id, nextStatus); }
    catch { /* toast already shown by handleStatusUpdate */ }
    finally { setAdvancing(false); }
  };

  const borderColor = {
    pending:   'border-l-yellow-400',
    confirmed: 'border-l-blue-400',
    preparing: 'border-l-orange-400',
    ready:     'border-l-teal-400',
    served:    'border-l-green-400',
  }[order.status] || 'border-l-gray-300';

  // In individual mode hide the main "next status" button unless order is still pending (needs confirm)
  const showNextBtn = nextStatus && (!isIndividual || order.status === 'pending');

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 ${borderColor} flex flex-col`}>
      {/* Card header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-gray-900 text-sm">{fmtToken(order.daily_order_number, order.order_type)}</span>
          <div className="flex items-center gap-1.5">
            {isIndividual && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 uppercase tracking-wide">
                KOT
              </span>
            )}
            <span className={`badge text-xs ${statusCfg.color}`}>{statusCfg.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>
          {order.reservation_id && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
              🔖 Reserved
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
          {' · '}{fmtTime(order.created_at)}
        </p>
      </div>

      {/* Items — plain list (combined) or per-item KOT rows (individual) */}
      <div className="px-4 pb-2">
        {isIndividual ? (
          <div className="space-y-1">
            {(order.items || []).map((item) => (
              <ItemKotRow
                key={item.id}
                item={item}
                cafe={cafe}
                orderToken={fmtToken(order.daily_order_number, order.order_type)}
                tableNumber={order.table_number}
                orderType={order.order_type}
                onStatusUpdate={(status) => onItemStatusUpdate(order.id, item.id, status)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {(order.items || []).slice(0, expanded ? undefined : 3).map((item) => (
              <div key={item.id} className="flex justify-between text-xs text-gray-600">
                <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
                <span className="flex-shrink-0">{c(item.subtotal)}</span>
              </div>
            ))}
            {!expanded && (order.items || []).length > 3 && (
              <p className="text-xs text-gray-400 italic">+{order.items.length - 3} more…</p>
            )}
          </div>
        )}
        {expanded && order.notes && (
          <p className="text-xs text-amber-600 mt-1.5 italic">📝 {order.notes}</p>
        )}
      </div>

      {/* Kitchen mode toggle (premium only — basic stays combined) */}
      {isPremium && !['paid', 'cancelled', 'served'].includes(order.status) && (
        <div className="px-4 pb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide shrink-0">Kitchen</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] font-medium">
            <button
              onClick={() => onKitchenModeToggle(order.id, 'combined')}
              className={`px-2.5 py-1 transition-colors ${!isIndividual ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              Combined
            </button>
            <button
              onClick={() => onKitchenModeToggle(order.id, 'individual')}
              className={`px-2.5 py-1 transition-colors ${isIndividual ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              Individual
            </button>
          </div>
        </div>
      )}

      {/* Total + toggle */}
      <div
        className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <span className="font-bold text-gray-900 text-sm">{c(order.final_amount || order.total_amount)}</span>
        <span className="text-xs text-gray-400">{expanded ? '▲ less' : '▼ more'}</span>
      </div>

      {/* Action buttons */}
      <div className="px-3 pb-3 pt-2 flex gap-2 mt-auto">
        {showNextBtn && (
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-xs font-bold transition-colors"
          >
            {advancing ? '…' : actionLabel}
          </button>
        )}
        <button
          onClick={() => onOpenBilling(order)}
          className="px-2.5 py-1.5 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors flex-shrink-0 flex items-center gap-1"
        >
          🖨️ <span>Bill</span>
        </button>
        <button
          onClick={() => onChatClick(order)}
          className={`relative px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors flex-shrink-0 flex items-center gap-1 ${
            chatOpen ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100'
          }`}
        >
          💬 <span>Chat</span>
          {chatUnread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {chatUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => onCancelClick(order)}
          className="px-2.5 py-1.5 rounded-xl border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 active:bg-red-100 transition-colors flex-shrink-0 flex items-center gap-1"
        >
          ✕ <span>Cancel</span>
        </button>
      </div>

      {/* Delivery section — map + driver link (delivery orders only) */}
      {order.order_type === 'delivery' && (
        <div className="border-t border-gray-50 px-3 pt-3 pb-3 space-y-2">
          {order.delivery_address && (
            <p className="text-xs text-gray-500">🛵 <span className="font-medium">{order.delivery_address}</span></p>
          )}
          {order.delivery_token && (
            <button
              onClick={() => {
                const url = `${window.location.origin}/driver/${order.id}/${order.delivery_token}`;
                navigator.clipboard.writeText(url).then(
                  () => toast.success('Driver link copied!'),
                  () => toast.error('Copy failed')
                );
              }}
              className="w-full py-1.5 rounded-xl border border-orange-200 text-orange-600 text-xs font-semibold hover:bg-orange-50 active:bg-orange-100 transition-colors"
            >
              📋 Copy Driver Tracking Link
            </button>
          )}
          {cafe?.latitude && order.delivery_lat && (
            <div className="rounded-xl overflow-hidden">
              <DeliveryMap
                cafeLat={parseFloat(cafe.latitude)}
                cafeLng={parseFloat(cafe.longitude)}
                cafeLabel={cafe.name || 'Restaurant'}
                customerLat={parseFloat(order.delivery_lat)}
                customerLng={parseFloat(order.delivery_lng)}
                deliveryAddress={order.delivery_address}
                driverLat={order.driver_lat ? parseFloat(order.driver_lat) : undefined}
                driverLng={order.driver_lng ? parseFloat(order.driver_lng) : undefined}
                height="220px"
              />
            </div>
          )}
        </div>
      )}

      {/* Inline chat panel */}
      {chatOpen && (
        <OwnerChatPanel order={order} messages={chatMessages} loading={chatMessagesLoading} />
      )}
    </div>
  );
}

// ─── Per-Item KOT Row (Individual Kitchen Mode) ───────────────────────────

function ItemKotRow({ item, cafe, orderToken, tableNumber, orderType, onStatusUpdate }) {
  const [loading, setLoading] = useState(false);

  const handleUpdate = async (status) => {
    setLoading(true);
    try { await onStatusUpdate(status); }
    finally { setLoading(false); }
  };

  const statusStyle = {
    pending:   'bg-gray-100 text-gray-500',
    preparing: 'bg-orange-100 text-orange-700',
    ready:     'bg-teal-100 text-teal-700',
    served:    'bg-green-100 text-green-700',
  }[item.item_status] || 'bg-gray-100 text-gray-400';

  const statusLabel = { pending: 'Pending', preparing: 'Cooking', ready: 'Ready', served: 'Served' };
  const isServed = item.item_status === 'served';

  return (
    <div className={`flex items-center gap-1.5 py-1 px-2 rounded-lg ${isServed ? 'opacity-40' : 'bg-gray-50'}`}>
      <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${statusStyle}`}>
        {statusLabel[item.item_status] || item.item_status}
      </span>
      <span className={`flex-1 text-xs min-w-0 truncate ${isServed ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
        {item.item_name} × {item.quantity}
      </span>
      {item.item_status === 'pending' && (
        <button
          disabled={loading}
          onClick={() => handleUpdate('preparing')}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 hover:bg-orange-100 font-semibold transition-colors disabled:opacity-50"
        >
          Start
        </button>
      )}
      {item.item_status === 'preparing' && (
        <button
          disabled={loading}
          onClick={() => handleUpdate('ready')}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-teal-50 text-teal-600 hover:bg-teal-100 font-semibold transition-colors disabled:opacity-50"
        >
          Ready
        </button>
      )}
      {(item.item_status === 'preparing' || item.item_status === 'ready') && (
        <button
          onClick={() => printKot({ cafe, item, orderToken, tableNumber, orderType })}
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          title="Print KOT for this item"
        >
          🖨
        </button>
      )}
      {item.item_status === 'ready' && (
        <button
          disabled={loading}
          onClick={() => handleUpdate('served')}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-green-50 text-green-600 hover:bg-green-100 font-semibold transition-colors disabled:opacity-50"
        >
          Served
        </button>
      )}
      {isServed && (
        <span className="shrink-0 text-green-500 text-xs">✓</span>
      )}
    </div>
  );
}

// ─── Bills View (Takeaway Pickup + Table Bills) ────────────────────────────

function BillsView({ takeawayPickups, tableBills, onStatusUpdate, onOpenBilling, onRemind }) {
  const { cafe: _bv } = useAuth();
  const c = (n) => fmtCurrency(n, _bv?.currency);
  const [expandedTable, setExpandedTable] = useState(null);
  const [search, setSearch] = useState('');
  const [collecting, setCollecting] = useState(null); // orderId or tableNumber being paid
  const [reminding, setReminding] = useState(null);

  const handleCollect = async (bill, cashReceived) => {
    const key = bill.isTakeaway ? bill.orders[0].id : bill.table_number;
    setCollecting(key);
    try {
      const toPay = bill.orders.filter((o) =>
        bill.isTakeaway ? o.status === 'ready' : o.status === 'served'
      );
      const results = await Promise.allSettled(
        toPay.map((o, i) => onStatusUpdate(o.id, 'paid', i === 0 ? cashReceived : null))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === 0) {
        toast.success(
          bill.isTakeaway
            ? `${fmtToken(bill.orders[0].daily_order_number, 'takeaway')} — payment collected!`
            : `Table ${bill.table_number} — payment collected!`
        );
      } else if (failed < toPay.length) {
        toast.error(`${failed} order(s) could not be marked paid — please retry`);
      }
    } catch (err) {
      toast.error('Failed to collect payment — please try again');
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
      subtotal:       parseFloat(order.total_amount)    || 0,
      taxAmount:      parseFloat(order.tax_amount)      || 0,
      taxRate:        parseFloat(order.tax_rate)        || 0,
      discountAmount: parseFloat(order.discount_amount) || 0,
      tipAmount:      parseFloat(order.tip_amount)      || 0,
      deliveryFee:    parseFloat(order.delivery_fee)    || 0,
      total:          parseFloat(order.final_amount || order.total_amount) || 0,
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
                        <span className="font-bold text-gray-900 text-sm">{fmtToken(token, 'takeaway')}</span>
                        <span className="badge bg-teal-100 text-teal-700 text-xs">Ready for Pickup</span>
                      </div>
                      <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">🥡 Takeaway · {fmtTime(order.created_at)}</p>
                      <div className="mt-2 space-y-0.5">
                        {order.items?.map((item) => (
                          <div key={item.id} className="flex justify-between text-xs text-gray-600">
                            <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
                            <span className="flex-shrink-0">{c(item.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                      <span className="font-bold text-gray-900 text-sm">{c(order.final_amount || order.total_amount)}</span>
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
                  .reduce((s, o) => s + parseFloat(o.final_amount || o.total_amount), 0);
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
                        <p className="font-bold text-gray-900">{c(bill.total)}</p>
                        <p className={`text-xs font-medium ${
                          allServed ? 'text-green-600' : hasActive ? 'text-orange-500' : 'text-gray-400'
                        }`}>
                          {allServed ? '✓ Ready to bill' : hasActive ? `Served ${c(servedTotal)}` : 'Partial'}
                        </p>
                      </div>
                    </div>

                    <div className="px-4 pb-3 border-t border-gray-50 flex items-center justify-between pt-2">
                      <span className="text-xs text-gray-400">{isExpanded ? '▲ Hide details' : '▼ Show details'}</span>
                      <div className="flex items-center gap-2">
                        {allServed && onRemind && (
                          <button
                            onClick={async () => {
                              setReminding(bill.table_number);
                              await onRemind(bill.table_number);
                              setReminding(null);
                            }}
                            disabled={reminding === bill.table_number}
                            className="py-1.5 px-3 rounded-xl bg-amber-100 hover:bg-amber-200 disabled:opacity-60 text-amber-700 font-semibold text-xs transition-colors"
                          >
                            {reminding === bill.table_number ? 'Sending…' : '🔔 Remind'}
                          </button>
                        )}
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
                                <span className="font-medium">{c(item.total)}</span>
                              </div>
                            ))}
                            <div className="flex justify-between font-bold text-gray-900 px-3 py-2.5 bg-gray-50 rounded-b-xl">
                              <span>Total Bill</span>
                              <span>{c(bill.total)}</span>
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
                                    <span className="font-semibold text-gray-800 text-sm">{fmtToken(token, order.order_type)}</span>
                                    <span className="text-xs text-gray-400">{fmtTime(order.created_at)}</span>
                                    <span className={`badge text-xs ${STATUS_CONFIG[order.status].color}`}>
                                      {STATUS_CONFIG[order.status].label}
                                    </span>
                                    <span className="font-bold text-gray-900 text-sm">{c(order.final_amount || order.total_amount)}</span>
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
  const c = (n) => fmtCurrency(n, cafe?.currency);
  // step: 'collect' → select payment & mark paid  |  'receipt' → print / done
  const [step, setStep]           = useState('collect');
  const [confirming, setConfirming] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  // saved values carried into receipt step
  const [paidMode, setPaidMode]   = useState(null);
  const [paidCash, setPaidCash]   = useState(null);

  const grandTotal  = bill.total;
  const cash        = parseFloat(cashInput) || 0;
  const change      = cash - grandTotal;
  const isValid     = cash >= grandTotal;
  const isCash      = paymentMode === 'cash';

  const doPrint = (mode, cashVal, isPaid = true) =>
    printBill({ cafe, bill, cashReceived: cashVal, paymentMode: mode, isPaid });

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

  const isDirty = cashInput !== '' || paymentMode !== 'cash';

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget) return;
    if (step === 'receipt') { onClose(); return; }
    if (isDirty) {
      if (window.confirm('Discard payment details and close?')) onClose();
    } else {
      onClose();
    }
  };

  const overlay = (children) => (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden max-h-[90vh] overflow-y-auto">
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
            {' · '}{c(bill.total)}
          </p>
          <p className="text-xs text-gray-400 mt-1">{modeLabel}</p>
          {paidCash != null && (
            <p className="text-xs text-gray-400">
              Cash: {c(paidCash)} · Change: {c(paidCash - bill.total)}
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
  const hasBreakdown = (bill.taxAmount > 0) || (bill.discountAmount > 0) || (bill.tipAmount > 0) || (bill.deliveryFee > 0);

  return overlay(
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-bold text-gray-900 text-lg">Collect Payment</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          {bill.isTakeaway
            ? `🥡 ${bill.customerName} — ${fmtToken(bill.orderNumber, 'takeaway')}`
            : `🍽️ Table ${bill.table_number}`}
        </p>
      </div>

      {/* Item list + price breakdown */}
      <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1 text-sm">
        {bill.aggregatedItems.map((item) => (
          <div key={item.name} className="flex justify-between text-gray-600">
            <span>{item.name} × {item.qty}</span>
            <span>{c(item.total)}</span>
          </div>
        ))}

        {hasBreakdown && (
          <>
            <div className="border-t border-gray-200 pt-2 mt-1 space-y-1">
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Subtotal</span>
                <span>{c(bill.subtotal)}</span>
              </div>
              {bill.taxAmount > 0 && (
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>Tax{bill.taxRate > 0 ? ` (${bill.taxRate}%)` : ''}</span>
                  <span>{c(bill.taxAmount)}</span>
                </div>
              )}
              {bill.discountAmount > 0 && (
                <div className="flex justify-between text-green-600 text-xs">
                  <span>Discount</span>
                  <span>− {c(bill.discountAmount)}</span>
                </div>
              )}
              {bill.tipAmount > 0 && (
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>Tip (customer)</span>
                  <span>{c(bill.tipAmount)}</span>
                </div>
              )}
              {bill.deliveryFee > 0 && (
                <div className="flex justify-between text-gray-500 text-xs">
                  <span>🛵 Delivery fee</span>
                  <span>{c(bill.deliveryFee)}</span>
                </div>
              )}
            </div>
          </>
        )}

        <div className={`${hasBreakdown ? '' : 'border-t border-gray-200 pt-2'} flex justify-between font-bold text-gray-900`}>
          <span>Total</span>
          <span>{c(grandTotal)}</span>
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
          <label className="label">Cash Received</label>
          <input
            type="number"
            min={grandTotal}
            step="0.50"
            placeholder={`Min ${c(grandTotal)}`}
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
              <p className="text-3xl font-bold text-green-700 mt-0.5">{c(change)}</p>
            </>
          ) : (
            <p className="text-sm text-red-600 font-medium">Short by {c(grandTotal - cash)}</p>
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
          onClick={() => doPrint(paymentMode, isCash && cashInput ? parseFloat(cashInput) : null, false)}
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
              {fmtToken(order.daily_order_number, order.order_type)} · {order.customer_name}
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
// messages and loading are lifted to OrdersPage level.
// The page-level socket handler updates chatMessages state, which flows down here.
// No socket subscription or HTTP fetch needed in this component.
function OwnerChatPanel({ order, messages, loading }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await postOwnerMessage(order.id, msg);
      setText('');
      // Message appears via socket → page-level handler → chatMessages state update
    } catch { toast.error('Could not send message'); }
    finally { setSending(false); }
  };

  return (
    <div className="border-t border-gray-100 bg-gray-50">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500">💬 Customer Chat</span>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-40 overflow-y-auto">
        {loading && <p className="text-xs text-gray-400">Loading…</p>}
        {!loading && messages.length === 0 && (
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

const HISTORY_DATE_PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d',        label: 'Last 7 days' },
  { key: '30d',       label: 'Last 30 days' },
  { key: 'all',       label: 'All time' },
];

function HistoryView({ orders, dateRange, onDateRangeChange }) {
  const { cafe } = useAuth();
  const c = (n) => fmtCurrency(n, cafe?.currency);
  const [search, setSearch] = useState('');
  const setDateRange = onDateRangeChange;

  const todayStart   = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const yesterdayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-1); return d; }, []);
  const yesterdayEnd   = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const dateFiltered = useMemo(() => {
    if (dateRange === 'all') return orders;
    return orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      if (dateRange === 'today')     return t >= todayStart.getTime();
      if (dateRange === 'yesterday') return t >= yesterdayStart.getTime() && t < yesterdayEnd.getTime();
      if (dateRange === '7d')        return t >= Date.now() - 7  * 86400000;
      if (dateRange === '30d')       return t >= Date.now() - 30 * 86400000;
      return true;
    });
  }, [orders, dateRange, todayStart, yesterdayStart, yesterdayEnd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dateFiltered;
    return dateFiltered.filter((o) => {
      const rawToken = String(o.daily_order_number || '');
      const fmtTok   = fmtToken(o.daily_order_number, o.order_type).toLowerCase();
      return (
        rawToken.includes(q) ||
        fmtTok.includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.table_number || '').toLowerCase().includes(q)
      );
    });
  }, [dateFiltered, search]);

  const dateLabel = HISTORY_DATE_PRESETS.find((p) => p.key === dateRange)?.label ?? 'Period';

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
      {/* Date filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {HISTORY_DATE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => setDateRange(preset.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              dateRange === preset.key
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Summary line */}
      <p className="text-xs text-gray-400">
        {dateLabel} · {dateFiltered.length} order{dateFiltered.length !== 1 ? 's' : ''} ·{' '}
        Revenue: <span className="font-semibold text-gray-600">
          {c(dateFiltered.reduce((s, o) => s + parseFloat(o.final_amount || o.total_amount), 0))}
        </span>
      </p>

      <SearchInput value={search} onChange={setSearch} placeholder="Search by token (e.g. T-05, TK-3), customer or table..." />

      {filtered.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-2xl mb-1">🔍</p>
          <p className="text-sm">No orders match{search ? ' your search' : ` for ${dateLabel.toLowerCase()}`}.</p>
          {!search && dateRange !== 'all' && (
            <button
              onClick={() => setDateRange('all')}
              className="mt-2 text-xs text-brand-500 hover:underline"
            >
              View all history →
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((order) => {
          const token = order.daily_order_number;
          return (
            <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden border-l-4 border-l-purple-400 flex flex-col">
              <div className="px-4 pt-4 pb-3 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-900 text-sm">{fmtToken(token, order.order_type)}</span>
                  <span className="badge bg-purple-100 text-purple-800 text-xs">Paid</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-gray-800 text-sm leading-tight">{order.customer_name}</p>
                  {order.reservation_id && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                      🔖 Reserved
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {order.order_type === 'takeaway' ? '🥡 Takeaway' : `🍽️ ${order.table_number}`}
                  {' · '}{fmtDateTime(order.created_at)}
                </p>
                <div className="mt-2 space-y-0.5">
                  {(order.items || []).slice(0, 3).map((item) => (
                    <div key={item.id} className="flex justify-between text-xs text-gray-500">
                      <span className="truncate mr-2">{item.item_name} × {item.quantity}</span>
                      <span className="flex-shrink-0">{c(item.subtotal)}</span>
                    </div>
                  ))}
                  {(order.items || []).length > 3 && (
                    <p className="text-xs text-gray-400 italic">+{order.items.length - 3} more…</p>
                  )}
                </div>
              </div>
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">{c(order.final_amount || order.total_amount)}</span>
                <button
                  onClick={() => printBill({
                    cafe,
                    isPaid: true,
                    bill: {
                      isTakeaway: order.order_type === 'takeaway',
                      customerName: order.customer_name,
                      orderNumber: token,
                      table_number: order.table_number,
                      total: parseFloat(order.final_amount || order.total_amount),
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
