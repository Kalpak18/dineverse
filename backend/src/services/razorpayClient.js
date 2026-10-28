// One Razorpay client for the whole API. Razorpay is optional: without keys
// (counter-only payments) the API must still start, so calls fail with a
// clear error instead of the SDK throwing at require time.
const Razorpay = require('razorpay');

const keyId     = process.env.RAZORPAY_KEY_ID     || process.env.RAZORPAY_TEST_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;

const isConfigured = () => !!(keyId && keySecret);

// razorpay.<api>.<method>() — every call the API makes is two levels deep
const notConfiguredCall = async () => {
  throw Object.assign(new Error('Razorpay is not configured'), { statusCode: 503 });
};
const notConfigured = new Proxy({}, { get: () => new Proxy({}, { get: () => notConfiguredCall }) });

const razorpay = isConfigured() ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : notConfigured;

module.exports = { razorpay, isConfigured };
