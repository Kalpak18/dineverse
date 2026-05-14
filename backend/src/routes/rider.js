const router = require('express').Router();
const requireRider = require('../middleware/requireRider');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');
const auth = require('../controllers/riderAuthController');
const jobs = require('../controllers/riderJobsController');
const self = require('../controllers/riderSelfController');

// ── Existing auth (invite-based, owner-added riders) ────────────────────────
router.post('/auth/send-otp',   otpLimiter,  auth.sendOtp);
router.post('/auth/verify-otp', authLimiter, auth.verifyOtp);
router.get ('/auth/me',         requireRider, auth.getMe);

// ── Self-registration (independent riders) ──────────────────────────────────
router.post('/register/send-otp', otpLimiter,  self.registerSendOtp);
router.post('/register/verify',   authLimiter, self.registerVerify);

// ── Profile ──────────────────────────────────────────────────────────────────
router.get   ('/profile',          requireRider, self.getProfile);
router.patch ('/profile',          requireRider, self.updateProfile);
router.patch ('/profile/location', requireRider, self.updateBaseLocation);
router.patch ('/availability',     requireRider, self.toggleAvailability);

// ── Nearby orders (self-registered rider discovery) ──────────────────────────
router.get  ('/nearby-orders',          requireRider, self.getNearbyOrders);
router.post ('/nearby-orders/:id/accept', requireRider, self.acceptNearbyOrder);

// ── Earnings + history ───────────────────────────────────────────────────────
router.get ('/earnings', requireRider, self.getEarnings);
router.get ('/history',  requireRider, self.getHistory);

// ── Active jobs (works for both cafe-assigned and self-accepted orders) ──────
router.get   ('/jobs',             requireRider, jobs.getMyJobs);
router.get   ('/jobs/:id',         requireRider, jobs.getJob);
router.patch ('/jobs/:id/status',  requireRider, jobs.updateJobStatus);
router.patch ('/location',         requireRider, jobs.pingLocation);

module.exports = router;
