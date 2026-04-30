const router = require('express').Router();
const { getCafeBySlug, getCafeMenu, exploreCafes, getAvailableTables, toggleCafeOpen, getNearbyCafes, getUpsellSuggestions } = require('../controllers/cafeController');
const { getPublicTables } = require('../controllers/tableController');
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const db = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');

// Public routes (no auth needed)
router.get('/explore', exploreCafes);         // must come before /:slug

// Sitemap build-time feed: all active café slugs + last-modified date
// Called by frontend/scripts/generate-sitemap.js during Vercel build.
router.get('/sitemap-slugs', asyncHandler(async (_req, res) => {
  const result = await db.query(
    `SELECT slug, updated_at
     FROM cafes
     WHERE is_active = true AND setup_completed = true
     ORDER BY slug`
  );
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ slugs: result.rows });
}));
router.get('/nearby', getNearbyCafes);        // must come before /:slug
router.get('/:slug', getCafeBySlug);
router.get('/:slug/menu', getCafeMenu);
router.get('/:slug/menu/suggestions', getUpsellSuggestions);
router.get('/:slug/tables', getPublicTables);
router.get('/:slug/available-tables', getAvailableTables);

// Owner: toggle open/closed
router.post('/toggle-open', authenticate, requireOwner, toggleCafeOpen);

module.exports = router;
