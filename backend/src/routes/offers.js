const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getOffers, createOffer, updateOffer, deleteOffer, getPublicOffers, previewOffer, validateCoupon,
} = require('../controllers/offerController');

// Public: customer sees active offers + previews/applies discount
router.get('/cafe/:slug/offers', getPublicOffers);
router.post('/cafe/:slug/preview', previewOffer);
router.post('/cafe/:slug/validate-coupon', validateCoupon);

// Owner CRUD (all require auth + subscription)
router.use(authenticate, checkSubscription, requireRole('manager'));
router.get('/',        getOffers);
router.post('/',       createOffer);
router.patch('/:id',   updateOffer);
router.delete('/:id',  deleteOffer);

module.exports = router;
