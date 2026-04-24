const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const { authLimiter } = require('../middleware/rateLimiter');
const { getPlans, createOrder, verifyPayment, getHistory, webhookHandler,
        getRouteStatus, connectRoute, enableRoute } = require('../controllers/paymentController');

// Razorpay webhook — no auth, raw body already parsed by express.raw() in app.js
router.post('/webhook', webhookHandler);

// All other payment routes require authenticated owner
router.get('/plans',        authenticate, requireOwner, getPlans);
router.get('/history',      authenticate, requireOwner, getHistory);
router.post('/create-order', authenticate, requireOwner, authLimiter, createOrder);
router.post('/verify',       authenticate, requireOwner, authLimiter, verifyPayment);

// Razorpay Route — café payout account management
router.get ('/route/status',  authenticate, requireOwner, getRouteStatus);
router.post('/route/connect', authenticate, requireOwner, authLimiter, connectRoute);
router.post('/route/enable',  authenticate, requireOwner, enableRoute);

module.exports = router;
