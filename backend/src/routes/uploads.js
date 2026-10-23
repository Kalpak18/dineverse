const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const { getPresignedUrl } = require('../controllers/uploadController');

// Only owners can upload images — subscription required
router.post('/presign', authenticate, checkSubscription, requireRole('manager'), getPresignedUrl);

module.exports = router;
