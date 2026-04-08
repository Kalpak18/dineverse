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

export function playNotificationSound() {
  try {
    const ctx = getAudioContext();

    const doPlay = () => {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      // Triple beep: high-medium-low (each needs its own oscillator node)
      [[800, 0, 0.15], [600, 0.2, 0.35], [400, 0.4, 0.55]].forEach(([freq, start, stop]) => {
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.frequency.value = freq;
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + stop);
      });
    };

    // Browsers auto-suspend AudioContext until user interaction — resume first
    if (ctx.state === 'suspended') {
      ctx.resume().then(doPlay).catch(() => {});
    } else {
      doPlay();
    }
  } catch (err) {
    console.warn('Could not play notification sound:', err);
  }
}
