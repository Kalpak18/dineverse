const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const { getVapidKey, subscribe, unsubscribe } = require('../controllers/pushController');

// Public: clients need the public key before they can subscribe
router.get('/vapid-key', getVapidKey);

// Authenticated: manage subscriptions
router.post('/subscribe',   authenticate, checkSubscription, subscribe);
router.post('/unsubscribe', authenticate, checkSubscription, unsubscribe);

module.exports = router;
