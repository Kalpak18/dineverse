const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { getAnalytics } = require('../controllers/analyticsController');

router.get('/', authenticate, requireOwner, checkSubscription, getAnalytics);

module.exports = router;
