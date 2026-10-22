const crypto = require('crypto');

// Secret handed to the customer who placed an order. Customer-facing order
// endpoints require it in the X-Order-Token header (X-Order-Tokens for the
// table bill, comma-separated).
exports.generateOrderToken = () => crypto.randomBytes(24).toString('hex');

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

// True when the request carries this order's token.
exports.hasOrderToken = (req, storedToken) => {
  const sent = req.get('x-order-token');
  return !!(storedToken && sent && safeEqual(sent, storedToken));
};

// Tokens sent for the table bill (customer may hold several orders).
exports.sentOrderTokens = (req) =>
  (req.get('x-order-tokens') || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);

exports.safeEqual = safeEqual;
