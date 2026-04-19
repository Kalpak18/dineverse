import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useAdminAuth } from './context/AdminAuthContext';

// Landing + Explore
import LandingPage from './pages/LandingPage';
import ExplorePage from './pages/customer/ExplorePage';
import MapPage from './pages/customer/MapPage';

// Customer pages
import CafeEntry from './pages/customer/CafeEntry';
import MenuPage from './pages/customer/MenuPage';
import CartPage from './pages/customer/CartPage';
import OrderConfirmation from './pages/customer/OrderConfirmation';
import MyOrdersPage from './pages/customer/MyOrdersPage';
import ScanPage from './pages/customer/ScanPage';

// Owner pages
import LoginPage from './pages/owner/LoginPage';
import RegisterPage from './pages/owner/RegisterPage';
import ForgotPasswordPage from './pages/owner/ForgotPasswordPage';
import DashboardPage from './pages/owner/DashboardPage';
import MenuManagementPage from './pages/owner/MenuManagementPage';
import OrdersPage from './pages/owner/OrdersPage';
import ProfilePage from './pages/owner/ProfilePage';
import AnalyticsPage from './pages/owner/AnalyticsPage';
import BillingPage from './pages/owner/BillingPage';
import HelpCenterPage from './pages/owner/HelpCenterPage';
import TablesPage from './pages/owner/TablesPage';
import KitchenPage from './pages/owner/KitchenPage';
import OffersPage from './pages/owner/OffersPage';
import ReservationsPage from './pages/owner/ReservationsPage';
import RatingsPage from './pages/owner/RatingsPage';
import StaffPage from './pages/owner/StaffPage';
import InventoryPage from './pages/owner/InventoryPage';
import CustomersPage from './pages/owner/CustomersPage';
import WaitlistPage from './pages/owner/WaitlistPage';
import SchedulePage from './pages/owner/SchedulePage';
import MessagesPage from './pages/owner/MessagesPage';

// Admin pages
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminSetupPage from './pages/admin/AdminSetupPage';
import AdminForgotPasswordPage from './pages/admin/AdminForgotPasswordPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminCafesPage from './pages/admin/AdminCafesPage';
import AdminRevenuePage from './pages/admin/AdminRevenuePage';
import AdminTicketsPage from './pages/admin/AdminTicketsPage';
import AdminAnalyticsPage from './pages/admin/AdminAnalyticsPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';

// Shared
import OwnerLayout from './components/OwnerLayout';
import AdminLayout from './components/AdminLayout';
import LoadingSpinner from './components/LoadingSpinner';

function ProtectedRoute({ children }) {
  const { cafe, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!cafe) return <Navigate to="/owner/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { admin, loading } = useAdminAuth();
  if (loading) return <LoadingSpinner />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

// Register the Electron deep-link navigate callback once the router is ready
function ElectronBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (window.electronAPI?.registerNavigate) {
      window.electronAPI.registerNavigate((route) => navigate(route));
    }
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <Routes>
      {/* Electron navigate bridge (no-op on web/mobile) */}
      <Route path="*" element={<ElectronBridge />} />

      {/* Landing + Explore */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/map"     element={<MapPage />} />
      <Route path="/scan"    element={<ScanPage />} />

      {/* Customer routes */}
      <Route path="/cafe/:slug" element={<CafeEntry />} />
      <Route path="/cafe/:slug/menu" element={<MenuPage />} />
      <Route path="/cafe/:slug/cart" element={<CartPage />} />
      <Route path="/cafe/:slug/confirmation" element={<OrderConfirmation />} />
      <Route path="/cafe/:slug/my-orders"   element={<MyOrdersPage />} />

      {/* Owner auth */}
      <Route path="/owner/login" element={<LoginPage />} />
      <Route path="/owner/register" element={<RegisterPage />} />
      <Route path="/owner/forgot-password" element={<ForgotPasswordPage />} />

      {/* Owner dashboard (protected) */}
      <Route
        path="/owner"
        element={
          <ProtectedRoute>
            <OwnerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="menu" element={<MenuManagementPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="help" element={<HelpCenterPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="kitchen" element={<KitchenPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="ratings" element={<RatingsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="waitlist"  element={<WaitlistPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* Admin (developer console) */}
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/setup" element={<AdminSetupPage />} />
      <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="cafes" element={<AdminCafesPage />} />
        <Route path="revenue" element={<AdminRevenuePage />} />
        <Route path="tickets" element={<AdminTicketsPage />} />
        <Route path="analytics" element={<AdminAnalyticsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>

      {/* Redirects */}
      <Route path="*" element={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500 text-lg">Page not found</p></div>} />
    </Routes>
  );
}
