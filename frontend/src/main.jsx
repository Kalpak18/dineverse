import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AdminAuthProvider } from './context/AdminAuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
    <ErrorBoundary>
      <BrowserRouter>
        <AdminAuthProvider>
          <AuthProvider>
            <CartProvider>
              <App />
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 3000,
                  style: { borderRadius: '8px', fontSize: '14px' },
                }}
              />
            </CartProvider>
          </AuthProvider>
        </AdminAuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>
);
