const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const {
  joinWaitlist, getWaitlist, updateWaitlist, deleteWaitlist,
} = require('../controllers/waitlistController');

// Public: customer joins waitlist for a café
router.post('/cafe/:slug/waitlist', joinWaitlist);

// Owner: manage waitlist
router.get('/',        authenticate, requireOwner, getWaitlist);
router.patch('/:id',   authenticate, requireOwner, updateWaitlist);
router.delete('/:id',  authenticate, requireOwner, deleteWaitlist);

module.exports = router;
