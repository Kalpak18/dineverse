const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const { submitRating, getRatings } = require('../controllers/ratingController');

// Public: customer submits rating after paid order
router.post('/cafe/:slug/orders/:id/rate', submitRating);

// Owner: view all ratings
router.get('/', authenticate, checkSubscription, getRatings);

module.exports = router;
