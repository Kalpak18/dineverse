import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import SOCKET_URL from '../utils/socketUrl';

// Singleton AudioContext — browsers limit simultaneous contexts; reuse avoids leaks
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
  }
  return audioCtx;
}

/**
 * useSocketIO — persistent Socket.io connection hook
 * Handles auto-reconnection, room management, and event listeners.
 * Socket is created once and kept alive for the session. Only the room
 * membership and listeners change if cafeId changes.
 */
export function useSocketIO(cafeId, onNewOrder, onOrderUpdated, onNewReservation) {
  const socketRef = useRef(null);
  const onNewOrderRef = useRef(onNewOrder);
  const onOrderUpdatedRef = useRef(onOrderUpdated);
  const onNewReservationRef = useRef(onNewReservation);

  onNewOrderRef.current = onNewOrder;
  onOrderUpdatedRef.current = onOrderUpdated;
  onNewReservationRef.current = onNewReservation;

  useEffect(() => {
    if (!cafeId) return;

    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        transports: ['polling', 'websocket'], // polling first (reliable through Render proxy), upgrades to ws
      });
    }

    const socket = socketRef.current;

    socket.emit('join_cafe', cafeId);

    const handleNewOrder = (order) => {
      playNotificationSound();
      if (onNewOrderRef.current) onNewOrderRef.current(order);
    };

    const handleOrderUpdated = (updated) => {
      if (onOrderUpdatedRef.current) onOrderUpdatedRef.current(updated);
    };

    const handleNewReservation = (reservation) => {
      if (onNewReservationRef.current) onNewReservationRef.current(reservation);
    };

    const handleConnect = () => {
      socket.emit('join_cafe', cafeId); // rejoin room on reconnect
    };

    const handleConnectError = (error) => {
      console.error('Socket connection error:', error);
    };

    socket.on('new_order', handleNewOrder);
    socket.on('order_updated', handleOrderUpdated);
    socket.on('new_reservation', handleNewReservation);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.emit('leave_cafe', cafeId); // leave room before joining a new one
      socket.off('new_order', handleNewOrder);
      socket.off('order_updated', handleOrderUpdated);
      socket.off('new_reservation', handleNewReservation);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
    };
  }, [cafeId]);
}

// Each tune: array of [freq, startSec, stopSec, waveType?]
// waveType defaults to 'sine'. Gain is set per tune.
export const SOUND_TUNES = {
  classic: {
    label: 'Classic Beep',
    emoji: '🔔',
    gain: 0.3,
    notes: [[800, 0, 0.15], [600, 0.2, 0.35], [400, 0.4, 0.55]],
  },
  double_ping: {
    label: 'Double Ping',
    emoji: '🏓',
    gain: 0.25,
    notes: [[1046, 0, 0.08], [1046, 0.18, 0.26]],
  },
  ascending: {
    label: 'Ascending Chime',
    emoji: '📈',
    gain: 0.28,
    notes: [[400, 0, 0.14], [600, 0.16, 0.3], [800, 0.32, 0.5]],
  },
  bell: {
    label: 'Bell',
    emoji: '🔕',
    gain: 0.35,
    notes: [[523, 0, 0.08, 'triangle'], [523, 0.02, 0.7, 'sine']],
  },
  ding: {
    label: 'Single Ding',
    emoji: '🎵',
    gain: 0.3,
    notes: [[880, 0, 0.04, 'sine'], [880, 0.04, 0.5, 'triangle']],
  },
  triple_up: {
    label: 'Triple Up',
    emoji: '⬆️',
    gain: 0.25,
    notes: [[500, 0, 0.1], [700, 0.15, 0.25], [900, 0.3, 0.42]],
  },
};

const TUNE_KEY = 'dv_sound_tune';

export function playNotificationSound(tuneId) {
  try {
    const ctx = getAudioContext();
    const id = tuneId || localStorage.getItem(TUNE_KEY) || 'classic';
    const tune = SOUND_TUNES[id] || SOUND_TUNES.classic;

    const doPlay = () => {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(tune.gain, ctx.currentTime);
      tune.notes.forEach(([freq, start, stop, type = 'sine']) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.connect(gain);
        osc.frequency.value = freq;
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + stop);
      });
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(doPlay).catch(() => {});
    } else {
      doPlay();
    }
  } catch (err) {
    console.warn('Could not play notification sound:', err);
  }
}
