const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const { authLimiter } = require('../middleware/rateLimiter');
const { getPlans, createOrder, verifyPayment, getHistory } = require('../controllers/paymentController');

// All payment routes require authenticated owner
router.get('/plans',        authenticate, requireOwner, getPlans);
router.get('/history',      authenticate, requireOwner, getHistory);
router.post('/create-order', authenticate, requireOwner, authLimiter, createOrder);
router.post('/verify',       authenticate, requireOwner, authLimiter, verifyPayment);

module.exports = router;
