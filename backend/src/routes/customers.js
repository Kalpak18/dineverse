const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const { getCustomers, getCustomerOrders } = require('../controllers/customerController');

router.use(authenticate, requireRole('manager'), checkSubscription);

router.get('/',        getCustomers);
router.get('/orders',  getCustomerOrders);

module.exports = router;
