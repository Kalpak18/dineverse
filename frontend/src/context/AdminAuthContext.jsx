import { createContext, useContext, useState, useEffect } from 'react';
import { adminLogin, adminGetMe } from '../services/api';

const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('dineverse_admin_token');
    if (!token) { setLoading(false); return; }
    adminGetMe()
      .then(({ data }) => setAdmin(data.admin))
      .catch(() => localStorage.removeItem('dineverse_admin_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await adminLogin({ email, password });
    localStorage.setItem('dineverse_admin_token', data.token);
    setAdmin(data.admin);
  };

  const logout = () => {
    localStorage.removeItem('dineverse_admin_token');
    setAdmin(null);
  };

  return (
    <AdminAuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export const useAdminAuth = () => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
};
