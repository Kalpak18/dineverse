const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/deliveryWebhookController');
const { authenticate } = require('../middleware/auth');

// Public: inbound webhook from delivery partner (HMAC-verified)
router.post('/webhook', ctrl.verifyWebhookSignature, ctrl.receiveWebhook);

// Owner: manually trigger delivery dispatch for an order
router.post('/partner/request', authenticate, ctrl.requestDelivery);

module.exports = router;
