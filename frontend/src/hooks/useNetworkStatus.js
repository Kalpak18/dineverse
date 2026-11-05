import { useEffect, useState } from 'react';
import { getNetworkState, subscribeNetwork } from '../utils/networkHealth';

// 'online' | 'weak' | 'offline' — re-renders when it changes
export function useNetworkStatus() {
  const [state, setState] = useState(getNetworkState);
  useEffect(() => subscribeNetwork(setState), []);
  return state;
}
