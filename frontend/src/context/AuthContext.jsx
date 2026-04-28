import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loginCafe, registerCafe, createOwnerAccount, completeCafeSetup, getMe } from '../services/api';

const AuthContext = createContext(null);

const CAFE_CACHE_KEY = 'dv_cafe_cache';

function readCafeCache() {
  try { return JSON.parse(localStorage.getItem(CAFE_CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCafeCache(cafe) {
  try { localStorage.setItem(CAFE_CACHE_KEY, JSON.stringify(cafe)); } catch {}
}
function clearCafeCache() {
  localStorage.removeItem(CAFE_CACHE_KEY);
}

export function AuthProvider({ children }) {
  // Seed from cache so café ID is available on first render — prevents double-fetch in child effects
  const [cafe,      setCafe]      = useState(() => localStorage.getItem('dineverse_token') ? readCafeCache() : null);
  const [role,      setRole]      = useState(() => localStorage.getItem('dineverse_role') || null);
  const [staffRole, setStaffRole] = useState(null);   // 'cashier' | 'kitchen' | 'manager' | null
  const [staffInfo, setStaffInfo] = useState(null);   // { id, name, email }
  const [loading,   setLoading]   = useState(true);   // always true until getMe() confirms the token

  const loadStoredAuth = useCallback(async () => {
    const token = localStorage.getItem('dineverse_token');
    if (!token) { setLoading(false); return; }

    try {
      const { data } = await getMe();
      setCafe(data.cafe);
      writeCafeCache(data.cafe);
      const storedRole = localStorage.getItem('dineverse_role') || 'OWNER';
      setRole(storedRole);
      if (storedRole === 'STAFF') {
        const sr = data.staffRole || localStorage.getItem('dineverse_staff_role') || null;
        setStaffRole(sr);
        setStaffInfo(data.staff || null);
      }
    } catch {
      localStorage.removeItem('dineverse_token');
      localStorage.removeItem('dineverse_role');
      localStorage.removeItem('dineverse_staff_role');
      clearCafeCache();
      setCafe(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoredAuth();

    const handleLogout = () => {
      setCafe(null);
      setRole(null);
      setStaffRole(null);
      setStaffInfo(null);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [loadStoredAuth]);

  const login = async (identifier, password) => {
    const { data } = await loginCafe({ identifier, password });
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', data.role || 'OWNER');
    setCafe(data.cafe);
    writeCafeCache(data.cafe);
    setRole(data.role || 'OWNER');
    if (data.role === 'STAFF') {
      const sr = data.staffRole || null;
      localStorage.setItem('dineverse_staff_role', sr || '');
      setStaffRole(sr);
      setStaffInfo(data.staff || null);
    } else {
      localStorage.removeItem('dineverse_staff_role');
      setStaffRole(null);
      setStaffInfo(null);
    }
    return data.cafe;
  };

  const createAccount = async ({ email, password, emailVerifiedToken }) => {
    const { data } = await createOwnerAccount({ email, password, emailVerifiedToken });
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', data.role || 'OWNER');
    setCafe(data.cafe);
    writeCafeCache(data.cafe);
    setRole(data.role || 'OWNER');
    setStaffRole(null);
    setStaffInfo(null);
    setLoading(false);
    return data.cafe;
  };

  const completeSetup = async (formData) => {
    const { data } = await completeCafeSetup(formData);
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', data.role || 'OWNER');
    setCafe(data.cafe);
    writeCafeCache(data.cafe);
    setRole(data.role || 'OWNER');
    setStaffRole(null);
    setStaffInfo(null);
    return data.cafe;
  };

  const register = async (formData) => {
    const { data } = await registerCafe(formData);
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', 'OWNER');
    setCafe(data.cafe);
    writeCafeCache(data.cafe);
    setRole('OWNER');
    setStaffRole(null);
    setStaffInfo(null);
    return data.cafe;
  };

  const logout = () => {
    localStorage.removeItem('dineverse_token');
    localStorage.removeItem('dineverse_role');
    localStorage.removeItem('dineverse_staff_role');
    clearCafeCache();
    setCafe(null);
    setRole(null);
    setStaffRole(null);
    setStaffInfo(null);
    // Disconnect the global notification socket so a re-login as a different café
    // doesn't receive stale events from the previous session
    window.dispatchEvent(new Event('auth:logout'));
  };

  const updateCafe = (updatedCafe) => setCafe((prev) => {
    const next = { ...prev, ...updatedCafe };
    writeCafeCache(next);
    return next;
  });

  const refreshCafe = useCallback(async () => {
    try {
      const { data } = await getMe();
      setCafe(data.cafe);
      writeCafeCache(data.cafe);
      if (data.staffRole) setStaffRole(data.staffRole);
      if (data.staff) setStaffInfo(data.staff);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ cafe, role, staffRole, staffInfo, loading, login, createAccount, completeSetup, register, logout, updateCafe, refreshCafe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
