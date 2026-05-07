import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { riderGetMe } from '../services/api';

const RiderAuthContext = createContext(null);

export function RiderAuthProvider({ children }) {
  const [rider, setRider]     = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const token = localStorage.getItem('dineverse_rider_token');
    if (!token) { setRider(null); setLoading(false); return; }
    try {
      const { data } = await riderGetMe();
      setRider(data.rider || null);
    } catch {
      localStorage.removeItem('dineverse_rider_token');
      setRider(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  // axios interceptor fires this when a 401 comes back
  useEffect(() => {
    const onLogout = () => { setRider(null); localStorage.removeItem('dineverse_rider_token'); };
    window.addEventListener('rider:logout', onLogout);
    return () => window.removeEventListener('rider:logout', onLogout);
  }, []);

  const login = useCallback((token, riderData) => {
    localStorage.setItem('dineverse_rider_token', token);
    setRider(riderData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('dineverse_rider_token');
    setRider(null);
  }, []);

  return (
    <RiderAuthContext.Provider value={{ rider, loading, login, logout, refresh: fetchMe }}>
      {children}
    </RiderAuthContext.Provider>
  );
}

export const useRiderAuth = () => useContext(RiderAuthContext);
