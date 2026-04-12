const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { getAnalytics, exportOrdersCSV } = require('../controllers/analyticsController');

router.get('/',       authenticate, requireOwner, checkSubscription, getAnalytics);
router.get('/export', authenticate, requireOwner, checkSubscription, exportOrdersCSV);

module.exports = router;
