import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Register service worker. Workbox is configured with skipWaiting:true so the
// new SW activates immediately on install. We reload when the controller changes
// so all open tabs switch to the new version automatically.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let hasReloadedForUpdate = false;

    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Skip the first takeover on fresh install. Reload only when an existing
        // service worker is being replaced, otherwise the first route click can
        // be interrupted and the user gets bounced back to the landing page.
        if (!hadController || hasReloadedForUpdate) return;
        hasReloadedForUpdate = true;
        window.location.replace(window.location.href);
      });
    } catch { /* SW not supported or blocked */ }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
    <HelmetProvider>
    <ErrorBoundary>
      <BrowserRouter>
        <AdminAuthProvider>
          <AuthProvider>
            <CartProvider>
              <App />
              <Toaster
                position="top-center"
                gutter={8}
                containerStyle={{ top: 16 }}
                toastOptions={{
                  duration: 4000,
                  style: {
                    borderRadius: '10px',
                    fontSize: '13.5px',
                    fontWeight: '500',
                    maxWidth: '360px',
                    padding: '11px 14px',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                    lineHeight: '1.45',
                  },
                  success: {
                    style: {
                      background: '#f0fdf4',
                      color: '#166534',
                      border: '1px solid #bbf7d0',
                    },
                    iconTheme: { primary: '#16a34a', secondary: '#dcfce7' },
                  },
                  error: {
                    duration: 5000,
                    style: {
                      background: '#fff7ed',
                      color: '#9a3412',
                      border: '1px solid #fed7aa',
                    },
                    iconTheme: { primary: '#ea580c', secondary: '#fff7ed' },
                  },
                }}
              />
            </CartProvider>
          </AuthProvider>
        </AdminAuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
    </HelmetProvider>
    </ThemeProvider>
  </React.StrictMode>
);
