import { useCallback, useRef } from 'react';

const STALE = Symbol('stale');

// Live screens fetch more than once (page load, after joining the live
// channel, after reconnects). Only the newest request may update the screen:
// an older, slower response would overwrite fresher data, e.g. an order that
// just arrived live.
//   const latest = useLatestRequest();
//   latest(getOrders()).then(apply).catch((err) => { if (isStale(err)) return; ... });
export function useLatestRequest() {
  const seq = useRef(0);
  return useCallback((promise) => {
    const id = ++seq.current;
    return promise.then((result) => {
      if (id !== seq.current) throw STALE;
      return result;
    });
  }, []);
}

export const isStale = (err) => err === STALE;
