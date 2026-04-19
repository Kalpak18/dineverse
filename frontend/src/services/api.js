import axios from 'axios';

// Dev: Vite proxy sends /api → localhost:5000 (no env var needed)
// Production: set VITE_API_URL=https://your-api.example.com/api
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

// Attach JWT token from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dineverse_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 → clear token and logout. On subscription_expired → redirect to billing.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('dineverse_token');
      window.dispatchEvent(new Event('auth:logout'));
    }
    if (err.response?.data?.error === 'subscription_expired') {
      window.dispatchEvent(new Event('subscription:expired'));
    }
    return Promise.reject(err);
  }
);

// ─── Auth ─────────────────────────────────────────────────────
export const sendVerificationOtp = (email) => api.post('/auth/send-otp', { email });
export const registerCafe = (data) => api.post('/auth/register', data);
export const loginCafe = (data) => api.post('/auth/login', data); // data: { identifier, password }
export const checkSlugAvailability = (slug) => api.get('/auth/check-slug', { params: { slug } });
export const getMe = () => api.get('/auth/me');
export const updateProfile = (data) => api.patch('/auth/me', data);
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const resetPassword = (email, otp, password) => api.post('/auth/reset-password', { email, otp, password });

// ─── Outlets ──────────────────────────────────────────────────
export const getOutlets    = () => api.get('/auth/outlets');
export const createOutlet  = (data) => api.post('/auth/outlets', data);
export const switchOutlet  = (id) => api.post(`/auth/outlets/switch/${id}`);

// ─── Payments (Owner) ─────────────────────────────────────────
export const getPlans = () => api.get('/payments/plans');
export const createPaymentOrder = (plan_key) => api.post('/payments/create-order', { plan_key });
export const verifyPayment = (data) => api.post('/payments/verify', data);
export const getPaymentHistory = () => api.get('/payments/history');

// ─── Support Tickets (Owner) ──────────────────────────────────
export const getMyTickets = () => api.get('/support');
export const createTicket = (data) => api.post('/support', data);

// ─── Admin API ────────────────────────────────────────────────
const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});
adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('dineverse_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
adminApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('dineverse_admin_token');
      window.dispatchEvent(new Event('admin:logout'));
    }
    return Promise.reject(err);
  }
);

export const adminSetup = (data) => adminApi.post('/admin/setup', data);
export const adminLogin = (data) => adminApi.post('/admin/login', data);
export const adminGetMe = () => adminApi.get('/admin/me');
export const adminForgotPassword = (email) => adminApi.post('/admin/forgot-password', { email });
export const adminResetPassword = (email, otp, password) => adminApi.post('/admin/reset-password', { email, otp, password });
export const adminGetDashboard = () => adminApi.get('/admin/dashboard');
export const adminGetCafes = (params) => adminApi.get('/admin/cafes', { params });
export const adminUpdateCafe = (id, data) => adminApi.patch(`/admin/cafes/${id}`, data);
export const adminGetRevenue = (params) => adminApi.get('/admin/revenue', { params });
export const adminGetTickets = (params) => adminApi.get('/admin/tickets', { params });
export const adminReplyTicket = (id, data) => adminApi.patch(`/admin/tickets/${id}`, data);
export const adminGetAnalytics    = () => adminApi.get('/admin/analytics');
export const adminGetCafeStats    = (id) => adminApi.get(`/admin/cafes/${id}/stats`);
export const adminGetSettings     = () => adminApi.get('/admin/settings');
export const adminUpdateSetting   = (key, value) => adminApi.put(`/admin/settings/${key}`, { value });
export const adminBroadcast       = (data) => adminApi.post('/admin/broadcast', data);
export const getPublicSetting     = (key) => api.get(`/admin/public-settings/${key}`);

// ─── Cafe open/close toggle (owner) ──────────────────────────
export const toggleCafeOpen     = () => api.post('/cafes/toggle-open');

// ─── Public (Customer) ────────────────────────────────────────
export const getCafeBySlug      = (slug) => api.get(`/cafes/${slug}`);
export const getCafeTables      = (slug, params) => api.get(`/cafes/${slug}/tables`, { params });
export const exploreCafes       = (city) => api.get('/cafes/explore', { params: city ? { city } : {} });
export const getNearbyCafes     = (lat, lng, radius = 30) => api.get('/cafes/nearby', { params: { lat, lng, radius } });
export const getAvailableTables = (slug) => api.get(`/cafes/${slug}/available-tables`);

// Owner: areas + tables management
export const getAreas         = ()             => api.get('/tables/areas');
export const createArea       = (data)         => api.post('/tables/areas', data);
export const updateArea       = (id, data)     => api.patch(`/tables/areas/${id}`, data);
export const deleteArea       = (id)           => api.delete(`/tables/areas/${id}`);
export const createTable      = (data)         => api.post('/tables', data);
export const updateTable      = (id, data)     => api.patch(`/tables/${id}`, data);
export const deleteTable      = (id)           => api.delete(`/tables/${id}`);
export const getCafeMenu = (slug) => api.get(`/cafes/${slug}/menu`);
export const placeOrder = (slug, data) => api.post(`/orders/cafe/${slug}/orders`, data);
export const getOrderStatus = (slug, id) => api.get(`/orders/cafe/${slug}/orders/${id}/status`);
export const cancelOrder = (slug, id) => api.post(`/orders/cafe/${slug}/orders/${id}/cancel`);
export const createOrderPayment = (slug, id) => api.post(`/orders/cafe/${slug}/orders/${id}/pay`);
export const verifyOrderPayment = (slug, id, data) => api.post(`/orders/cafe/${slug}/orders/${id}/pay/verify`, data);

// ─── Order Chat ───────────────────────────────────────────────
// Customer-side (public, no auth)
export const getCustomerMessages  = (slug, id) => api.get(`/orders/cafe/${slug}/orders/${id}/messages`);
export const postCustomerMessage  = (slug, id, message) => api.post(`/orders/cafe/${slug}/orders/${id}/messages`, { message });
// Owner-side (authenticated)
export const getConversations  = () => api.get('/orders/messages/conversations');
export const getOwnerMessages  = (id) => api.get(`/orders/${id}/messages`);
export const postOwnerMessage  = (id, message) => api.post(`/orders/${id}/messages`, { message });

// ─── Categories (Owner) ───────────────────────────────────────
export const getCategories = () => api.get('/menu/categories');
export const createCategory = (data) => api.post('/menu/categories', data);
export const updateCategory = (id, data) => api.patch(`/menu/categories/${id}`, data);
export const deleteCategory = (id) => api.delete(`/menu/categories/${id}`);

// ─── Menu Items (Owner) ───────────────────────────────────────
export const getMenuItems = () => api.get('/menu/items');
export const createMenuItem = (data) => api.post('/menu/items', data);
export const updateMenuItem = (id, data) => api.patch(`/menu/items/${id}`, data);
export const deleteMenuItem = (id) => api.delete(`/menu/items/${id}`);
export const toggleItemAvailability = (id) => api.patch(`/menu/items/${id}/toggle`);

// ─── Uploads (Owner) ──────────────────────────────────────────
export const getPresignedUrl = (contentType, size, uploadType) =>
  api.post('/uploads/presign', { contentType, size, uploadType });

// ─── Orders (Owner) ───────────────────────────────────────────
export const getOrders = (params) => api.get('/orders', { params });
export const getOrderById = (id) => api.get(`/orders/${id}`);
export const updateOrderStatus = (id, status, cash_received = null, cancellation_reason = null) =>
  api.patch(`/orders/${id}/status`, {
    status,
    ...(cash_received != null && { cash_received }),
    ...(cancellation_reason && { cancellation_reason }),
  });
export const getDashboardStats = () => api.get('/orders/stats');

// ─── Staff (Owner) ────────────────────────────────────────────
export const getStaff    = ()         => api.get('/staff');
export const createStaff = (data)     => api.post('/staff', data);
export const updateStaff = (id, data) => api.patch(`/staff/${id}`, data);
export const deleteStaff = (id)       => api.delete(`/staff/${id}`);

// ─── Expenses (Owner) ─────────────────────────────────────────
export const getExpenses = (params) => api.get('/expenses', { params });
export const createExpense = (data) => api.post('/expenses', data);
export const deleteExpense = (id) => api.delete(`/expenses/${id}`);

// ─── Analytics (Owner) ────────────────────────────────────────
export const getAnalytics    = (params) => api.get('/analytics', { params });
export const exportOrdersCSV = (params) => api.get('/analytics/export', { params, responseType: 'blob' });

// ─── Stock / Inventory (Owner) ────────────────────────────────
export const updateStock   = (id, data) => api.patch(`/menu/items/${id}/stock`, data);
export const getInventory  = ()         => api.get('/menu/inventory');

// ─── AI Menu Import (Owner) ───────────────────────────────────
export const aiMenuImport  = (imageBase64, mimeType) =>
  api.post('/menu/ai-import', { image: imageBase64, mimeType }, { timeout: 60000 });

// ─── Customers CRM (Owner) ────────────────────────────────────
export const getCustomers      = (params) => api.get('/customers', { params });
export const getCustomerOrders = (params) => api.get('/customers/orders', { params });

// ─── Waitlist ─────────────────────────────────────────────────
export const joinWaitlist     = (slug, data) => api.post(`/waitlist/cafe/${slug}/waitlist`, data);
export const getWaitlist      = ()           => api.get('/waitlist');
export const updateWaitlistEntry = (id, data) => api.patch(`/waitlist/${id}`, data);
export const deleteWaitlistEntry = (id)      => api.delete(`/waitlist/${id}`);

// ─── Ratings ──────────────────────────────────────────────────
export const submitRating = (slug, orderId, data) => api.post(`/ratings/cafe/${slug}/orders/${orderId}/rate`, data);
export const getRatings = (params) => api.get('/ratings', { params });

// ─── Offers ───────────────────────────────────────────────────
export const getPublicOffers = (slug)       => api.get(`/offers/cafe/${slug}/offers`);
export const previewOffer    = (slug, data) => api.post(`/offers/cafe/${slug}/preview`, data);
export const getOffers       = ()           => api.get('/offers');
export const createOffer     = (data)       => api.post('/offers', data);
export const updateOffer     = (id, data)   => api.patch(`/offers/${id}`, data);
export const deleteOffer     = (id)         => api.delete(`/offers/${id}`);

// ─── Table combined bill (customer-facing) ────────────────────
export const getTableBill = (slug, tableNumber) =>
  api.get(`/orders/cafe/${slug}/table-bill/${encodeURIComponent(tableNumber)}`);

// ─── Reservations ─────────────────────────────────────────────
export const createReservation = (slug, data) => api.post(`/reservations/cafe/${slug}/reserve`, data);
export const getPublicReservationStatus = (slug, id) => api.get(`/reservations/cafe/${slug}/status/${id}`);
export const getReservations = (params) => api.get('/reservations', { params });
export const updateReservation = (id, data) => api.patch(`/reservations/${id}`, data);
export const deleteReservation = (id) => api.delete(`/reservations/${id}`);

// ─── Notifications ────────────────────────────────────────────
export const getNotifications  = ()   => api.get('/notifications');
export const markAllRead       = ()   => api.patch('/notifications/read-all');
export const markOneRead       = (id) => api.patch(`/notifications/${id}/read`);
export const clearNotifications= ()   => api.delete('/notifications');

export default api;
