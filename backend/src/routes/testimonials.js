const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const requireAdmin = require('../middleware/requireAdmin');
const {
  submitTestimonial,
  getMyTestimonial,
  getPublicTestimonials,
  adminGetTestimonials,
  adminToggleApproval,
} = require('../controllers/testimonialController');

// Public
router.get('/public', getPublicTestimonials);

// Owner-authenticated
router.post('/',     authenticate, requireOwner, submitTestimonial);
router.get('/mine',  authenticate, requireOwner, getMyTestimonial);

// Admin
router.get('/admin/all',        requireAdmin, adminGetTestimonials);
router.patch('/admin/:id/toggle', requireAdmin, adminToggleApproval);

module.exports = router;
