const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { getPresignedUrl } = require('../controllers/uploadController');

// Only owners can upload images — subscription required
router.post('/presign', authenticate, checkSubscription, requireOwner, getPresignedUrl);

module.exports = router;
