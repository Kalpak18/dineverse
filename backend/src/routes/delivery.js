const express = require('express');
const router  = express.Router();
const webhook = require('../controllers/deliveryWebhookController');
const riders  = require('../controllers/ridersController');
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');

const auth = [authenticate, checkSubscription];

// ─── Public: inbound webhook from delivery partner ────────────
router.post('/webhook', webhook.verifyWebhookSignature, webhook.receiveWebhook);

// ─── Rider pool ───────────────────────────────────────────────
router.get('/riders',          ...auth, riders.getRiders);
router.post('/riders',         ...auth, riders.createRider);
router.patch('/riders/:id',    ...auth, riders.updateRider);
router.delete('/riders/:id',   ...auth, riders.deleteRider);

// ─── Assign own rider to order + manual status updates ────────
router.post('/orders/:id/assign',  ...auth, riders.assignRider);
router.patch('/orders/:id/status', ...auth, riders.updateSelfDeliveryStatus);

// ─── Third-party platform config ─────────────────────────────
router.get('/platforms',         ...auth, riders.getPlatforms);
router.post('/platforms',        ...auth, riders.savePlatform);
router.delete('/platforms/:id',  ...auth, riders.deletePlatform);

// ─── Dispatch to third-party partner ─────────────────────────
router.post('/orders/:id/dispatch', ...auth, riders.dispatchToPartform);

module.exports = router;
