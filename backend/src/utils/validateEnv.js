const logger = require('./logger');

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLIENT_URL',
  'SMTP_USER',
  'SMTP_PASS',
];

module.exports = function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error('[STARTUP] Missing required environment variables: %s', missing.join(', '));
    process.exit(1);
  }

  // JWT secret must be long enough to be cryptographically safe
  if ((process.env.JWT_SECRET || '').length < 32) {
    logger.error('[STARTUP] JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32');
    process.exit(1);
  }

  // Razorpay is optional (cafes can take cash/UPI), but warn clearly if missing
  const hasRazorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
  if (!hasRazorpay) {
    logger.warn('[STARTUP] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — online payments will fail');
  }
};
