const router = require('express').Router();
const {
  urbanPiperOrder, urbanPiperMenuAck, urbanPiperMenuPull,
  ondcSearch, ondcConfirm, ondcStatus, ondcCancel,
} = require('../controllers/aggregatorController');

// UrbanPiper webhooks (Zomato / Swiggy)
router.post('/urbanpiper/order',     urbanPiperOrder);
router.post('/urbanpiper/menu-ack',  urbanPiperMenuAck);
router.get('/urbanpiper/menu/:slug', urbanPiperMenuPull);

// ONDC beckn protocol endpoints
router.post('/ondc/search',  ondcSearch);
router.post('/ondc/confirm', ondcConfirm);
router.post('/ondc/status',  ondcStatus);
router.post('/ondc/cancel',  ondcCancel);

module.exports = router;
