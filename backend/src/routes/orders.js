const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const requirePremium = require('../middleware/requirePremium');
const { orderLimiter, publicLimiter } = require('../middleware/rateLimiter');
const {
  validateOrder, createOrder,
  getOrders, getOrderById, updateOrderStatus,
  getDashboardStats,
  getOrderStatus, customerCancelOrder,
  createOrderPayment, verifyOrderPayment,
  getTableBill,
  setKitchenMode, updateItemStatus,
  acceptOrder, rejectOrder, acceptItem, rejectItem,
  cancelItem, reorderItems, generateKot, getKotHistory,
  updateDriverLocation, getDriverOrderInfo,
  remindBill,
} = require('../controllers/orderController');
const {
  getCustomerMessages, postCustomerMessage,
  getOwnerMessages, postOwnerMessage,
  getConversations, deleteOwnerMessage,
} = require('../controllers/messageController');

// Public: combined bill for a table
router.get('/cafe/:slug/table-bill/:tableNumber', getTableBill);

// Public: customer places order (rate-limited to prevent abuse)
// NOTE: customer-facing routes are NOT subscription-gated — customers can always
// view order status / cancel even if the owner's plan expired.
router.post('/cafe/:slug/orders', orderLimiter, validateOrder, createOrder);
router.get('/cafe/:slug/orders/:id/status', getOrderStatus);
router.post('/cafe/:slug/orders/:id/cancel', publicLimiter, customerCancelOrder);

// Public: driver GPS ping (authenticated by delivery_token UUID in URL)
router.patch('/driver/:orderId/:token/location', updateDriverLocation);
router.get('/driver/:orderId/:token/info',       getDriverOrderInfo);

// Public: customer pays for their food order via Razorpay
router.post('/cafe/:slug/orders/:id/pay',        publicLimiter, createOrderPayment);
router.post('/cafe/:slug/orders/:id/pay/verify', publicLimiter, verifyOrderPayment);

// Public: customer ↔ owner chat for an order
router.get('/cafe/:slug/orders/:id/messages',  getCustomerMessages);
router.post('/cafe/:slug/orders/:id/messages', publicLimiter, postCustomerMessage);

// Owner-only: stats must be before /:id so 'stats' isn't treated as an order ID
router.get('/stats', authenticate, checkSubscription, requireOwner, getDashboardStats);

// Authenticated: staff can view and update orders (subscription required)
router.get('/', authenticate, checkSubscription, getOrders);
router.get('/:id', authenticate, checkSubscription, getOrderById);
router.patch('/:id/status', authenticate, checkSubscription, updateOrderStatus);
router.patch('/:id/kitchen-mode', authenticate, checkSubscription, setKitchenMode);
router.patch('/:id/items/:itemId/status', authenticate, checkSubscription, requirePremium, updateItemStatus);
router.post('/:id/accept', authenticate, checkSubscription, acceptOrder);
router.post('/:id/reject', authenticate, checkSubscription, rejectOrder);
router.post('/:id/items/:itemId/accept',  authenticate, checkSubscription, requirePremium, acceptItem);
router.post('/:id/items/:itemId/reject',  authenticate, checkSubscription, requirePremium, rejectItem);
router.patch('/:id/items/:itemId/cancel', authenticate, checkSubscription, requirePremium, cancelItem);
router.patch('/:id/items/reorder',        authenticate, checkSubscription, requirePremium, reorderItems);
router.post('/:id/kot',                   authenticate, checkSubscription, generateKot);
router.get('/:id/kot/history',            authenticate, checkSubscription, requirePremium, getKotHistory);
router.post('/table/:tableNumber/remind', authenticate, checkSubscription, remindBill);

// Owner: all conversations inbox
router.get('/messages/conversations', authenticate, checkSubscription, getConversations);

// Owner chat per order
router.get('/:id/messages',              authenticate, checkSubscription, getOwnerMessages);
router.post('/:id/messages',             authenticate, checkSubscription, postOwnerMessage);
router.delete('/:id/messages/:msgId',    authenticate, checkSubscription, deleteOwnerMessage);

module.exports = router;
