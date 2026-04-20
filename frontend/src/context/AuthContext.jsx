import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loginCafe, registerCafe, getMe } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [cafe,      setCafe]      = useState(null);
  const [role,      setRole]      = useState(null);   // 'OWNER' | 'STAFF' | null
  const [staffRole, setStaffRole] = useState(null);   // 'cashier' | 'kitchen' | 'manager' | null
  const [staffInfo, setStaffInfo] = useState(null);   // { id, name, email }
  const [loading,   setLoading]   = useState(true);

  const loadStoredAuth = useCallback(async () => {
    const token = localStorage.getItem('dineverse_token');
    if (!token) { setLoading(false); return; }

    try {
      const { data } = await getMe();
      setCafe(data.cafe);
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

  const register = async (formData) => {
    const { data } = await registerCafe(formData);
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', 'OWNER');
    setCafe(data.cafe);
    setRole('OWNER');
    setStaffRole(null);
    setStaffInfo(null);
    return data.cafe;
  };

  const logout = () => {
    localStorage.removeItem('dineverse_token');
    localStorage.removeItem('dineverse_role');
    localStorage.removeItem('dineverse_staff_role');
    setCafe(null);
    setRole(null);
    setStaffRole(null);
    setStaffInfo(null);
  };

  const updateCafe = (updatedCafe) => setCafe((prev) => ({ ...prev, ...updatedCafe }));

  const refreshCafe = useCallback(async () => {
    try {
      const { data } = await getMe();
      setCafe(data.cafe);
      if (data.staffRole) setStaffRole(data.staffRole);
      if (data.staff) setStaffInfo(data.staff);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ cafe, role, staffRole, staffInfo, loading, login, register, logout, updateCafe, refreshCafe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
