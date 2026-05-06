import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useAdminAuth } from './context/AdminAuthContext';

// Always-eager: tiny wrappers and auth guards that gate everything else
import OwnerLayout from './components/OwnerLayout';
import AdminLayout from './components/AdminLayout';
import CafeLayout from './components/CafeLayout';
import LoadingSpinner from './components/LoadingSpinner';
import InstallBanner from './components/InstallBanner';

// ─── Lazy page bundles ────────────────────────────────────────────────────────
// Each group becomes its own JS chunk. The browser downloads only the chunk
// needed for the current route, then caches it permanently (content-hashed).

// Public / landing
const LandingPage  = lazy(() => import('./pages/LandingPage'));
const ExplorePage  = lazy(() => import('./pages/customer/ExplorePage'));
const MapPage      = lazy(() => import('./pages/customer/MapPage'));
const TermsPage    = lazy(() => import('./pages/TermsPage'));
const PrivacyPage  = lazy(() => import('./pages/PrivacyPage'));
const RefundPage   = lazy(() => import('./pages/RefundPage'));
const ContactPage  = lazy(() => import('./pages/ContactPage'));

// Customer
const CafeEntry         = lazy(() => import('./pages/customer/CafeEntry'));
const MenuPage          = lazy(() => import('./pages/customer/MenuPage'));
const CartPage          = lazy(() => import('./pages/customer/CartPage'));
const OrderConfirmation = lazy(() => import('./pages/customer/OrderConfirmation'));
const MyOrdersPage      = lazy(() => import('./pages/customer/MyOrdersPage'));
const ScanPage          = lazy(() => import('./pages/customer/ScanPage'));
const DriverTracking    = lazy(() => import('./pages/driver/DriverTracking'));

// Owner auth (tiny — keep separate so login page loads fast)
const LoginPage           = lazy(() => import('./pages/owner/LoginPage'));
const RegisterPage        = lazy(() => import('./pages/owner/RegisterPage'));
const ForgotPasswordPage  = lazy(() => import('./pages/owner/ForgotPasswordPage'));

// Owner dashboard — grouped because they're all behind ProtectedRoute anyway
const DashboardPage       = lazy(() => import('./pages/owner/DashboardPage'));
const MenuManagementPage  = lazy(() => import('./pages/owner/MenuManagementPage'));
const OrdersPage          = lazy(() => import('./pages/owner/OrdersPage'));
const AnalyticsPage       = lazy(() => import('./pages/owner/AnalyticsPage'));
const BillingPage         = lazy(() => import('./pages/owner/BillingPage'));
const HelpCenterPage      = lazy(() => import('./pages/owner/HelpCenterPage'));
const TablesPage          = lazy(() => import('./pages/owner/TablesPage'));
const KitchenPage         = lazy(() => import('./pages/owner/KitchenPage'));
const OffersPage          = lazy(() => import('./pages/owner/OffersPage'));
const ReservationsPage    = lazy(() => import('./pages/owner/ReservationsPage'));
const RatingsPage         = lazy(() => import('./pages/owner/RatingsPage'));
const StaffPage           = lazy(() => import('./pages/owner/StaffPage'));
const InventoryPage       = lazy(() => import('./pages/owner/InventoryPage'));
const CustomersPage       = lazy(() => import('./pages/owner/CustomersPage'));
const WaitlistPage        = lazy(() => import('./pages/owner/WaitlistPage'));
const SchedulePage        = lazy(() => import('./pages/owner/SchedulePage'));
const MessagesPage        = lazy(() => import('./pages/owner/MessagesPage'));
const ShiftPage           = lazy(() => import('./pages/owner/ShiftPage'));
const LoyaltyPage         = lazy(() => import('./pages/owner/LoyaltyPage'));
const ModifiersPage       = lazy(() => import('./pages/owner/ModifiersPage'));
const WaiterPage          = lazy(() => import('./pages/owner/WaiterPage'));
const ProfilePage         = lazy(() => import('./pages/owner/ProfilePage'));

// Admin
const AdminLoginPage          = lazy(() => import('./pages/admin/AdminLoginPage'));
const AdminSetupPage          = lazy(() => import('./pages/admin/AdminSetupPage'));
const AdminForgotPasswordPage = lazy(() => import('./pages/admin/AdminForgotPasswordPage'));
const AdminDashboardPage      = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminCafesPage          = lazy(() => import('./pages/admin/AdminCafesPage'));
const AdminRevenuePage        = lazy(() => import('./pages/admin/AdminRevenuePage'));
const AdminTicketsPage        = lazy(() => import('./pages/admin/AdminTicketsPage'));
const AdminAnalyticsPage      = lazy(() => import('./pages/admin/AdminAnalyticsPage'));
const AdminSettingsPage       = lazy(() => import('./pages/admin/AdminSettingsPage'));

// ─── Role config ──────────────────────────────────────────────────────────────
const STAFF_DEFAULT = {
  cashier: '/owner/orders',
  kitchen: '/owner/kitchen',
  manager: '/owner/dashboard',
  waiter:  '/owner/waiter',
};
const STAFF_ALLOWED = {
  kitchen: ['/owner/kitchen', '/owner/help', '/owner/profile'],
  waiter:  ['/owner/waiter',  '/owner/help', '/owner/profile'],
  cashier: ['/owner/orders', '/owner/billing', '/owner/messages', '/owner/shift', '/owner/help', '/owner/profile'],
  manager: null,
};

// ─── Guards ───────────────────────────────────────────────────────────────────
function StaffGuard({ children }) {
  const { role, staffRole } = useAuth();
  const location = useLocation();
  if (role !== 'STAFF' || staffRole === 'manager') return children;
  const allowed = STAFF_ALLOWED[staffRole];
  if (!allowed) return children;
  const ok = allowed.some((p) => location.pathname.startsWith(p));
  if (!ok) return <Navigate to={STAFF_DEFAULT[staffRole] || '/owner/orders'} replace />;
  return children;
}

function CitySlugRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/cafe/${slug}`} replace />;
}

function ProtectedRoute({ children }) {
  const { cafe, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!cafe && localStorage.getItem('dineverse_token')) return <LoadingSpinner />;
  if (!cafe) return <Navigate to="/owner/login" replace />;
  if (cafe.setup_completed === false) return <Navigate to="/owner/register" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { admin, loading } = useAdminAuth();
  if (loading) return <LoadingSpinner />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

function ElectronBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (window.electronAPI?.registerNavigate) {
      window.electronAPI.registerNavigate((route) => navigate(route));
    }
  }, [navigate]);
  return null;
}

function StaffAwareIndex() {
  const { role, staffRole } = useAuth();
  if (role === 'STAFF') return <Navigate to={STAFF_DEFAULT[staffRole] || '/owner/orders'} replace />;
  return <Navigate to="dashboard" replace />;
}

function OwnerAuthPage({ mode }) {
  const { cafe, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (cafe?.setup_completed === false) {
    return mode === 'register' ? <RegisterPage /> : <Navigate to="/owner/register" replace />;
  }
  if (cafe) return <Navigate to="/owner/dashboard" replace />;
  return mode === 'register' ? <RegisterPage /> : <LoginPage />;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <>
      <InstallBanner />
      {/* Single Suspense boundary: shows a spinner while any lazy chunk loads */}
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="*" element={<ElectronBridge />} />

          {/* Landing + public */}
          <Route path="/"        element={<LandingPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/map"     element={<MapPage />} />
          <Route path="/scan"    element={<ScanPage />} />
          <Route path="/terms"   element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund"  element={<RefundPage />} />
          <Route path="/contact" element={<ContactPage />} />

          {/* Customer */}
          <Route path="/cafe/:slug" element={<CafeLayout />}>
            <Route index            element={<CafeEntry />} />
            <Route path="menu"         element={<MenuPage />} />
            <Route path="cart"         element={<CartPage />} />
            <Route path="confirmation" element={<OrderConfirmation />} />
            <Route path="my-orders"    element={<MyOrdersPage />} />
          </Route>

          <Route path="/driver/:orderId/:token" element={<DriverTracking />} />
          <Route path="/restaurants/:city/:slug" element={<CitySlugRedirect />} />

          {/* Owner auth */}
          <Route path="/owner/login"           element={<OwnerAuthPage mode="login" />} />
          <Route path="/owner/register"        element={<OwnerAuthPage mode="register" />} />
          <Route path="/owner/forgot-password" element={<ForgotPasswordPage />} />

          {/* Owner dashboard */}
          <Route
            path="/owner"
            element={
              <ProtectedRoute>
                <StaffGuard>
                  <OwnerLayout />
                </StaffGuard>
              </ProtectedRoute>
            }
          >
            <Route index element={<StaffAwareIndex />} />
            <Route path="dashboard"   element={<DashboardPage />} />
            <Route path="menu"        element={<MenuManagementPage />} />
            <Route path="orders"      element={<OrdersPage />} />
            <Route path="analytics"   element={<AnalyticsPage />} />
            <Route path="billing"     element={<BillingPage />} />
            <Route path="help"        element={<HelpCenterPage />} />
            <Route path="tables"      element={<TablesPage />} />
            <Route path="kitchen"     element={<KitchenPage />} />
            <Route path="offers"      element={<OffersPage />} />
            <Route path="reservations" element={<ReservationsPage />} />
            <Route path="ratings"     element={<RatingsPage />} />
            <Route path="staff"       element={<StaffPage />} />
            <Route path="inventory"   element={<InventoryPage />} />
            <Route path="customers"   element={<CustomersPage />} />
            <Route path="waitlist"    element={<WaitlistPage />} />
            <Route path="schedule"    element={<SchedulePage />} />
            <Route path="messages"    element={<MessagesPage />} />
            <Route path="shift"       element={<ShiftPage />} />
            <Route path="loyalty"     element={<LoyaltyPage />} />
            <Route path="modifiers"   element={<ModifiersPage />} />
            <Route path="waiter"      element={<WaiterPage />} />
            <Route path="profile"     element={<ProfilePage />} />
          </Route>

          {/* Admin */}
          <Route path="/admin/login"           element={<AdminLoginPage />} />
          <Route path="/admin/setup"           element={<AdminSetupPage />} />
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
            <Route path="cafes"     element={<AdminCafesPage />} />
            <Route path="revenue"   element={<AdminRevenuePage />} />
            <Route path="tickets"   element={<AdminTicketsPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="settings"  element={<AdminSettingsPage />} />
          </Route>

          <Route path="*" element={
            <div className="flex items-center justify-center min-h-screen">
              <p className="text-gray-500 text-lg">Page not found</p>
            </div>
          } />
        </Routes>
      </Suspense>
    </>
  );
}
