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

  // Only café owner/staff sessions — rider and admin tokens have their own
  // middleware and must not pass here just because they carry a cafeId.
  const role = decoded.role || 'OWNER';
  if (role !== 'OWNER' && role !== 'STAFF') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token', error: 'Invalid or expired token' });
  }

  // Verify the account still exists, is active, and token version matches.
  // Owner sessions are versioned on the root (brand) café so outlet tokens
  // die with the owner's password; staff sessions on their own row.
  // Versions are incremented on password reset, forcing re-login.
  let staffRole = null;
  try {
    const result = role === 'STAFF'
      ? await db.query(
          `SELECT COALESCE(cs.token_version, 1) AS token_version, cs.role
           FROM cafe_staff cs
           JOIN cafes c ON c.id = cs.cafe_id
           WHERE cs.id = $1 AND cs.cafe_id = $2 AND cs.is_active = true AND c.is_active = true`,
          [decoded.staffId, decoded.cafeId]
        )
      : await db.query(
          `SELECT COALESCE(r.token_version, 1) AS token_version
           FROM cafes c
           JOIN cafes r ON r.id = $2 AND r.is_active = true
           WHERE c.id = $1 AND c.is_active = true`,
          [decoded.cafeId, decoded.rootCafeId || decoded.cafeId]
        );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Account not found or deactivated' });
    }
    // Role changes by the owner take effect immediately, not at token expiry
    if (role === 'STAFF') staffRole = result.rows[0].role;
    const dbVersion = result.rows[0].token_version;
    // No ?? 1 fallback — tokens without a tv field are pre-versioning and must re-login.
    // This ensures password reset actually invalidates all outstanding sessions.
    const tokenVersion = decoded.tv;
    if (tokenVersion === undefined || tokenVersion !== dbVersion) {
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }
  } catch {
    // DB unavailable — fail closed (deny access)
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  req.cafeId     = decoded.cafeId;
  req.rootCafeId = decoded.rootCafeId || decoded.cafeId;
  req.cafeSlug   = decoded.slug;
  req.role       = role;
  req.staffId    = decoded.staffId || null;
  req.staffRole  = staffRole; // cashier | kitchen | manager | waiter
  next();
};

module.exports = { authenticate };
