import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import SOCKET_URL from '../utils/socketUrl';
import { requestService } from '../services/api';
import { useT } from '../i18n';

// Customer: "Call waiter" / "Request bill" for an open dine-in order.
// Shows "On the way ✓" when staff acknowledge (live, via the order's room).
export default function TableServiceButtons({ slug, order }) {
  const { t } = useT();
  const [state, setState] = useState({ waiter: 'idle', bill: 'idle' }); // idle | sending | sent | coming

  useEffect(() => {
    if (!order?.id) return undefined;
    const socket = io(SOCKET_URL, { transports: ['polling', 'websocket'], reconnection: true });
    const track = () => socket.emit('track_order', order.id);
    socket.on('connect', track);
    socket.on('service_request_updated', (r) => {
      if (r.order_id === order.id && r.status === 'acknowledged') {
        setState((s) => ({ ...s, [r.type]: 'coming' }));
        toast.success(r.type === 'bill' ? 'Your bill is on the way' : 'A waiter is on the way', { icon: '🙋' });
      }
    });
    return () => socket.disconnect();
  }, [order?.id]);

  const ask = async (type) => {
    setState((s) => ({ ...s, [type]: 'sending' }));
    try {
      const { data } = await requestService(slug, order.id, type);
      setState((s) => ({ ...s, [type]: data.request.status === 'acknowledged' ? 'coming' : 'sent' }));
      if (!data.repeat) toast.success(type === 'bill' ? 'Bill requested' : 'Waiter called');
    } catch (err) {
      setState((s) => ({ ...s, [type]: 'idle' }));
      toast.error(err?.response?.data?.message || 'Could not reach the staff — please wave to a waiter');
    }
  };

  if (!order || ['takeaway', 'delivery'].includes(order.order_type) || ['paid', 'cancelled'].includes(order.status)) return null;

  const label = (type) => {
    const st = state[type];
    if (st === 'sending') return t('order.sending');
    if (st === 'coming') return type === 'bill' ? t('order.billComing') : t('order.waiterComing');
    if (st === 'sent') return type === 'bill' ? t('order.billRequested') : t('order.waiterCalled');
    return type === 'bill' ? t('order.requestBill') : t('order.callWaiter');
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {['waiter', 'bill'].map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => ask(type)}
          disabled={state[type] === 'sending'}
          aria-live="polite"
          className={`min-h-[48px] rounded-xl text-sm font-bold border-2 transition-colors touch-manipulation ${
            state[type] === 'idle'
              ? 'border-brand-500 text-brand-600 bg-white active:bg-brand-50'
              : 'border-green-500 text-green-700 bg-green-50'
          }`}
        >
          {label(type)}
        </button>
      ))}
    </div>
  );
}
