const router = require('express').Router();
const { getCafeBySlug, getCafeMenu, exploreCafes, getAvailableTables } = require('../controllers/cafeController');
const { getPublicTables } = require('../controllers/tableController');

// Public routes (no auth needed)
router.get('/explore', exploreCafes);         // must come before /:slug
router.get('/:slug', getCafeBySlug);
router.get('/:slug/menu', getCafeMenu);
router.get('/:slug/tables', getPublicTables);
router.get('/:slug/available-tables', getAvailableTables);

module.exports = router;
