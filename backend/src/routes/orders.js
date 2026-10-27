const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const requireRole = require('../middleware/requireRole');
const svc = require('../controllers/serviceRequestController');
const { orderLimiter, publicLimiter } = require('../middleware/rateLimiter');
const {
  validateOrder, createOrder, getDeliveryQuote, getKitchenOrders,
  setOrderTable, customerMoveTable, getTableByToken,
  getOrders, getOrderById, updateOrderStatus,
  getDashboardStats,
  getOrderStatus, customerCancelOrder,
  createOrderPayment, verifyOrderPayment,
  getTableBill,
  setKitchenMode, updateItemStatus, setItemPrepTime,
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

// Public: customer places order
router.post('/cafe/:slug/orders', orderLimiter, validateOrder, createOrder);
router.post('/cafe/:slug/delivery-quote', publicLimiter, getDeliveryQuote);
router.post('/cafe/:slug/move-table', publicLimiter, customerMoveTable);
router.post('/cafe/:slug/orders/:id/service-request', publicLimiter, svc.createServiceRequest);
router.get('/cafe/:slug/table-qr/:token', publicLimiter, getTableByToken);
router.get('/cafe/:slug/orders/:id/status', getOrderStatus);
router.post('/cafe/:slug/orders/:id/cancel', publicLimiter, customerCancelOrder);

// Public: driver GPS ping
router.patch('/driver/:orderId/:token/location', updateDriverLocation);
router.get('/driver/:orderId/:token/info',       getDriverOrderInfo);

// Public: customer payment
router.post('/cafe/:slug/orders/:id/pay',        publicLimiter, createOrderPayment);
router.post('/cafe/:slug/orders/:id/pay/verify', publicLimiter, verifyOrderPayment);

// Public: customer ↔ owner chat
router.get('/cafe/:slug/orders/:id/messages',  getCustomerMessages);
router.post('/cafe/:slug/orders/:id/messages', publicLimiter, postCustomerMessage);

// Owner stats
router.get('/stats', authenticate, checkSubscription, requireRole('manager'), getDashboardStats);

// All features available to every café — no premium gate
router.get('/',                              authenticate, checkSubscription, getOrders);
router.get('/kitchen',                       authenticate, checkSubscription, getKitchenOrders);
// Call waiter / request bill (staff side). Must stay above '/:id'.
router.get('/service-requests',              authenticate, checkSubscription, requireRole('manager', 'cashier', 'waiter'), svc.getServiceRequests);
router.patch('/service-requests/:rid/ack',   authenticate, checkSubscription, requireRole('manager', 'cashier', 'waiter'), svc.acknowledgeServiceRequest);
router.get('/:id',                           authenticate, checkSubscription, getOrderById);
router.patch('/:id/status',                  authenticate, checkSubscription, updateOrderStatus);
router.patch('/:id/kitchen-mode',            authenticate, checkSubscription, setKitchenMode);
router.patch('/:id/items/:itemId/status',    authenticate, checkSubscription, updateItemStatus);
router.patch('/:id/items/:itemId/prep-time', authenticate, checkSubscription, setItemPrepTime);
router.post('/:id/accept',                   authenticate, checkSubscription, acceptOrder);
router.post('/:id/reject',                   authenticate, checkSubscription, rejectOrder);
router.post('/:id/items/:itemId/accept',     authenticate, checkSubscription, acceptItem);
router.post('/:id/items/:itemId/reject',     authenticate, checkSubscription, rejectItem);
router.patch('/:id/items/:itemId/cancel',    authenticate, checkSubscription, cancelItem);
router.patch('/:id/items/reorder',           authenticate, checkSubscription, reorderItems);
router.post('/:id/kot',                      authenticate, checkSubscription, generateKot);
router.get('/:id/kot/history',               authenticate, checkSubscription, getKotHistory);
router.post('/table/:tableNumber/remind',    authenticate, checkSubscription, remindBill);
router.patch('/:id/table',                   authenticate, checkSubscription, requireRole('manager', 'cashier', 'waiter'), setOrderTable);

// Owner chat inbox
router.get('/messages/conversations',        authenticate, checkSubscription, requireRole('manager', 'cashier'), getConversations);
router.get('/:id/messages',                  authenticate, checkSubscription, requireRole('manager', 'cashier'), getOwnerMessages);
router.post('/:id/messages',                 authenticate, checkSubscription, requireRole('manager', 'cashier'), postOwnerMessage);
router.delete('/:id/messages/:msgId',        authenticate, checkSubscription, requireRole('manager', 'cashier'), deleteOwnerMessage);

module.exports = router;
