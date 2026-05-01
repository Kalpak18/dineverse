const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/loyaltyController');
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');

const auth = [authenticate, checkSubscription];

// Owner
router.get('/program',          ...auth, ctrl.getProgram);
router.post('/program',         ...auth, ctrl.saveProgram);
router.get('/customers',        ...auth, ctrl.getCustomerPoints);
router.post('/customers/adjust',...auth, ctrl.adjustPoints);
router.get('/customers/:phone/transactions', ...auth, ctrl.getTransactions);

// Public (customer-facing)
router.get('/cafe/:slug/balance', ctrl.getBalance);

module.exports = router;
