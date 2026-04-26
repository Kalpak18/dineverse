const logger = require('./logger');

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLIENT_URL',
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

  // Razorpay: support both RAZORPAY_KEY_ID (prod) and RAZORPAY_TEST_KEY_ID (legacy/dev)
  const hasRazorpay = (process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID) &&
                      (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET);
  if (!hasRazorpay) {
    logger.warn('[STARTUP] Razorpay keys not set — online payments will fail');
  }

  // Razorpay webhook secret — needed to verify webhook payloads from Razorpay servers
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    logger.warn('[STARTUP] RAZORPAY_WEBHOOK_SECRET not set — webhooks will be ignored (subscription may not activate on payment failure/retry)');
  }

  // Email: uses Brevo HTTP API (BREVO_API_KEY), not SMTP
  if (!process.env.BREVO_API_KEY) {
    logger.warn('[STARTUP] BREVO_API_KEY not set — email OTP verification will fail');
  }

  // S3: required for menu image uploads and logo/cover uploads
  const hasS3 = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET_NAME;
  if (!hasS3) {
    logger.warn('[STARTUP] AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET_NAME not set — image uploads will fail');
  }

  // CLIENT_URL sanity check — must not contain a trailing slash or be localhost in production
  const clientUrl = process.env.CLIENT_URL || '';
  if (process.env.NODE_ENV === 'production') {
    if (clientUrl.includes('localhost')) {
      logger.warn('[STARTUP] CLIENT_URL contains "localhost" in production — CORS and email links will be wrong');
    }
    if (clientUrl.endsWith('/')) {
      logger.warn('[STARTUP] CLIENT_URL has a trailing slash — email links may break. Remove the trailing slash.');
    }
  }
};
