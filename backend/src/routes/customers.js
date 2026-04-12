const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { getCustomers, getCustomerOrders } = require('../controllers/customerController');

router.use(authenticate, requireOwner, checkSubscription);

router.get('/',        getCustomers);
router.get('/orders',  getCustomerOrders);

module.exports = router;
