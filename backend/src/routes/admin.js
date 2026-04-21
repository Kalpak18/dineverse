const router = require('express').Router();
const requireAdmin = require('../middleware/requireAdmin');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  setup, validateLogin, login, getMe,
  getDashboard, getCafes, updateCafe, getCafeStats, notifyCafe,
  getRevenue, getTickets, replyTicket, getAnalytics,
  forgotPassword, validateResetPassword, resetPassword,
  getSettings, updateSetting, getPublicSetting,
  broadcastEmail,
} = require('../controllers/adminController');

// Public (one-time setup + login + password reset)
router.post('/setup',           authLimiter, setup);
router.post('/login',           authLimiter, validateLogin, login);
router.post('/forgot-password', otpLimiter,  forgotPassword);
router.post('/reset-password',  authLimiter, validateResetPassword, resetPassword);

// Public settings — consumed by customer-facing pages (no auth needed)
router.get('/public-settings/:key', getPublicSetting);

// Protected admin routes
router.get('/me',              requireAdmin, getMe);
router.get('/dashboard',       requireAdmin, getDashboard);
router.get('/cafes',           requireAdmin, getCafes);
router.patch('/cafes/:id',     requireAdmin, updateCafe);
router.get('/cafes/:id/stats',  requireAdmin, getCafeStats);
router.post('/cafes/:id/notify', requireAdmin, notifyCafe);
router.get('/revenue',         requireAdmin, getRevenue);
router.get('/tickets',         requireAdmin, getTickets);
router.patch('/tickets/:id',   requireAdmin, replyTicket);
router.get('/analytics',       requireAdmin, getAnalytics);
router.get('/settings',        requireAdmin, getSettings);
router.put('/settings/:key',   requireAdmin, updateSetting);
router.post('/broadcast',      requireAdmin, broadcastEmail);

module.exports = router;
