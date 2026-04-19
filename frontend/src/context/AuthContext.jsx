import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loginCafe, registerCafe, getMe } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [cafe, setCafe] = useState(null);
  const [role, setRole] = useState(null); // 'OWNER' | 'STAFF' | null
  const [loading, setLoading] = useState(true);

  const loadStoredAuth = useCallback(async () => {
    const token = localStorage.getItem('dineverse_token');
    if (!token) { setLoading(false); return; }

    try {
      const { data } = await getMe();
      setCafe(data.cafe);
      setRole(localStorage.getItem('dineverse_role') || 'OWNER');
    } catch {
      localStorage.removeItem('dineverse_token');
      localStorage.removeItem('dineverse_role');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoredAuth();

    const handleLogout = () => {
      setCafe(null);
      setRole(null);
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
    return data.cafe;
  };

  const register = async (formData) => {
    const { data } = await registerCafe(formData);
    localStorage.setItem('dineverse_token', data.token);
    localStorage.setItem('dineverse_role', 'OWNER');
    setCafe(data.cafe);
    setRole('OWNER');
    return data.cafe;
  };

  const logout = () => {
    localStorage.removeItem('dineverse_token');
    localStorage.removeItem('dineverse_role');
    setCafe(null);
    setRole(null);
  };

  const updateCafe = (updatedCafe) => setCafe((prev) => ({ ...prev, ...updatedCafe }));

  const refreshCafe = useCallback(async () => {
    try {
      const { data } = await getMe();
      setCafe(data.cafe);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ cafe, role, loading, login, register, logout, updateCafe, refreshCafe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
