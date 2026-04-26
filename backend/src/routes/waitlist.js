const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const {
  joinWaitlist, getWaitlistPosition, getWaitlist, updateWaitlist, deleteWaitlist,
} = require('../controllers/waitlistController');

// Public: customer joins or checks their position in a waitlist
router.post('/cafe/:slug/waitlist', joinWaitlist);
router.get('/cafe/:slug/waitlist/:entryId/position', getWaitlistPosition);

// Owner: manage waitlist
router.get('/',        authenticate, requireOwner, getWaitlist);
router.patch('/:id',   authenticate, requireOwner, updateWaitlist);
router.delete('/:id',  authenticate, requireOwner, deleteWaitlist);

module.exports = router;
