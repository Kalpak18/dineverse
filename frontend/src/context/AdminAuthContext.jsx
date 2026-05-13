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
      .catch((err) => {
        // Only invalidate token on 401 — a 500/network error means the server
        // is having trouble, not that the token is bad. Wiping on 500 logs the
        // admin out silently on every backend hiccup.
        if (err.response?.status === 401) {
          localStorage.removeItem('dineverse_admin_token');
        }
      })
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
