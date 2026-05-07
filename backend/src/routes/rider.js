const router = require('express').Router();
const requireRider = require('../middleware/requireRider');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');
const auth = require('../controllers/riderAuthController');
const jobs = require('../controllers/riderJobsController');

// ── Auth (public) ────────────────────────────────────────────
router.post('/auth/send-otp',   otpLimiter,  auth.sendOtp);
router.post('/auth/verify-otp', authLimiter, auth.verifyOtp);
// Phone OTP — endpoints commented in controller until SMS provider is wired.
// router.post('/auth/send-phone-otp',   otpLimiter,  auth.sendPhoneOtp);
// router.post('/auth/verify-phone-otp', authLimiter, auth.verifyPhoneOtp);

// ── Authenticated rider ──────────────────────────────────────
router.get   ('/auth/me',          requireRider, auth.getMe);
router.get   ('/jobs',             requireRider, jobs.getMyJobs);
router.get   ('/jobs/:id',         requireRider, jobs.getJob);
router.patch ('/jobs/:id/status',  requireRider, jobs.updateJobStatus);
router.patch ('/location',         requireRider, jobs.pingLocation);

module.exports = router;
