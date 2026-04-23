const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  sendOtp, preVerifyEmail,
  validateCreateAccount, createAccount,
  validateCompleteSetup, completeSetup,
  validateRegister, register,
  validateLogin, login,
  checkSlug, getMe, updateProfile, deleteCafe,
  forgotPassword,
  validateResetPassword, resetPassword,
  createOutlet, getOutlets, switchOutlet,
} = require('../controllers/authController');

router.post('/send-otp', otpLimiter, sendOtp);
router.post('/pre-verify-email', authLimiter, preVerifyEmail);
router.post('/create-account', authLimiter, validateCreateAccount, createAccount);
router.post('/complete-setup', authenticate, requireOwner, authLimiter, validateCompleteSetup, completeSetup);
router.get('/check-slug', checkSlug);
router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, validateLogin, login);
router.post('/forgot-password', otpLimiter, forgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, resetPassword);
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, requireOwner, updateProfile); // staff cannot change café settings
router.delete('/me', authenticate, requireOwner, deleteCafe);   // deactivate or hard-delete café

// Outlet management
router.get('/outlets',             authenticate, requireOwner, getOutlets);
router.post('/outlets',            authenticate, requireOwner, createOutlet);
router.post('/outlets/switch/:id', authenticate, requireOwner, switchOutlet);

module.exports = router;
