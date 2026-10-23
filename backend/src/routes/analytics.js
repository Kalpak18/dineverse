const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const { getAnalytics, exportOrdersCSV } = require('../controllers/analyticsController');

router.get('/',       authenticate, requireRole('manager'), checkSubscription, getAnalytics);
router.get('/export', authenticate, requireRole('manager'), checkSubscription, exportOrdersCSV);

module.exports = router;
