const router = require('express').Router();
const requireAdmin = require('../middleware/requireAdmin');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  setup, validateLogin, login, getMe,
  getDashboard, getCafes, updateCafe,
  getRevenue, getTickets, replyTicket, getAnalytics,
  forgotPassword, validateResetPassword, resetPassword,
} = require('../controllers/adminController');

// Public (one-time setup + login + password reset)
router.post('/setup',           authLimiter, setup);
router.post('/login',           authLimiter, validateLogin, login);
router.post('/forgot-password', otpLimiter,  forgotPassword);
router.post('/reset-password',  authLimiter, validateResetPassword, resetPassword);

// Protected admin routes
router.get('/me',                  requireAdmin, getMe);
router.get('/dashboard',           requireAdmin, getDashboard);
router.get('/cafes',               requireAdmin, getCafes);
router.patch('/cafes/:id',         requireAdmin, updateCafe);
router.get('/revenue',             requireAdmin, getRevenue);
router.get('/tickets',             requireAdmin, getTickets);
router.patch('/tickets/:id',       requireAdmin, replyTicket);
router.get('/analytics',           requireAdmin, getAnalytics);

module.exports = router;
