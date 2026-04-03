const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  sendOtp,
  validateRegister, register,
  validateLogin, login,
  checkSlug, getMe, updateProfile,
  forgotPassword,
  validateResetPassword, resetPassword,
  createOutlet, getOutlets, switchOutlet,
} = require('../controllers/authController');

router.post('/send-otp', otpLimiter, sendOtp);
router.get('/check-slug', checkSlug);
router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, validateLogin, login);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, resetPassword);
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, requireOwner, updateProfile); // staff cannot change café settings

// Outlet management
router.get('/outlets',             authenticate, requireOwner, getOutlets);
router.post('/outlets',            authenticate, requireOwner, createOutlet);
router.post('/outlets/switch/:id', authenticate, requireOwner, switchOutlet);

module.exports = router;
