const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided', error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token', error: 'Invalid or expired token' });
  }

  // Verify the café still exists and is active (catches deleted/suspended accounts)
  try {
    const result = await db.query(
      'SELECT id FROM cafes WHERE id = $1 AND is_active = true',
      [decoded.cafeId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Account not found or deactivated', error: 'Account not found or deactivated' });
    }
  } catch {
    // DB unavailable — fail closed (deny access)
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable', error: 'Service temporarily unavailable' });
  }

  req.cafeId     = decoded.cafeId;
  req.rootCafeId = decoded.rootCafeId || decoded.cafeId;
  req.cafeSlug   = decoded.slug;
  req.role       = decoded.role || 'OWNER';
  req.staffId    = decoded.staffId || null;
  next();
};

module.exports = { authenticate };
