const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  joinWaitlist, getWaitlistPosition, getWaitlist, updateWaitlist, deleteWaitlist,
} = require('../controllers/waitlistController');

// Public: customer joins or checks their position in a waitlist
router.post('/cafe/:slug/waitlist', joinWaitlist);
router.get('/cafe/:slug/waitlist/:entryId/position', getWaitlistPosition);

// Owner: manage waitlist
router.get('/',        authenticate, requireRole('manager', 'cashier'), getWaitlist);
router.patch('/:id',   authenticate, requireRole('manager', 'cashier'), updateWaitlist);
router.delete('/:id',  authenticate, requireRole('manager', 'cashier'), deleteWaitlist);

module.exports = router;
