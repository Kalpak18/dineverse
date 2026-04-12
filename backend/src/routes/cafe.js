const router = require('express').Router();
const { getCafeBySlug, getCafeMenu, exploreCafes, getAvailableTables, toggleCafeOpen, getNearbyCafes } = require('../controllers/cafeController');
const { getPublicTables } = require('../controllers/tableController');
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');

// Public routes (no auth needed)
router.get('/explore', exploreCafes);         // must come before /:slug
router.get('/nearby', getNearbyCafes);        // must come before /:slug
router.get('/:slug', getCafeBySlug);
router.get('/:slug/menu', getCafeMenu);
router.get('/:slug/tables', getPublicTables);
router.get('/:slug/available-tables', getAvailableTables);

// Owner: toggle open/closed
router.post('/toggle-open', authenticate, requireOwner, toggleCafeOpen);

module.exports = router;
