const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { orderLimiter } = require('../middleware/rateLimiter');
const {
  validateOrder, createOrder,
  getOrders, getOrderById, updateOrderStatus,
  getDashboardStats,
  getOrderStatus, customerCancelOrder,
  createOrderPayment, verifyOrderPayment,
  getTableBill,
} = require('../controllers/orderController');
const {
  getCustomerMessages, postCustomerMessage,
  getOwnerMessages, postOwnerMessage,
  getConversations,
} = require('../controllers/messageController');

// Public: combined bill for a table
router.get('/cafe/:slug/table-bill/:tableNumber', getTableBill);

// Public: customer places order (rate-limited to prevent abuse)
// NOTE: customer-facing routes are NOT subscription-gated — customers can always
// view order status / cancel even if the owner's plan expired.
router.post('/cafe/:slug/orders', orderLimiter, validateOrder, createOrder);
router.get('/cafe/:slug/orders/:id/status', getOrderStatus);
router.post('/cafe/:slug/orders/:id/cancel', customerCancelOrder);

// Public: customer pays for their food order via Razorpay
router.post('/cafe/:slug/orders/:id/pay', createOrderPayment);
router.post('/cafe/:slug/orders/:id/pay/verify', verifyOrderPayment);

// Public: customer ↔ owner chat for an order
router.get('/cafe/:slug/orders/:id/messages',  getCustomerMessages);
router.post('/cafe/:slug/orders/:id/messages', postCustomerMessage);

// Owner-only: stats must be before /:id so 'stats' isn't treated as an order ID
router.get('/stats', authenticate, checkSubscription, requireOwner, getDashboardStats);

// Authenticated: staff can view and update orders (subscription required)
router.get('/', authenticate, checkSubscription, getOrders);
router.get('/:id', authenticate, checkSubscription, getOrderById);
router.patch('/:id/status', authenticate, checkSubscription, updateOrderStatus);

// Owner: all conversations inbox
router.get('/messages/conversations', authenticate, checkSubscription, getConversations);

// Owner chat per order
router.get('/:id/messages',  authenticate, checkSubscription, getOwnerMessages);
router.post('/:id/messages', authenticate, checkSubscription, postOwnerMessage);

module.exports = router;
