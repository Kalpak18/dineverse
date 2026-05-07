const jwt = require('jsonwebtoken');
const db  = require('../config/database');

/**
 * Validates a rider JWT and attaches { riderId, cafeId } to req.
 * Rejects if the rider is deactivated or the JWT was invalidated
 * (token_version mismatch).
 */
module.exports = async function requireRider(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  if (decoded.role !== 'RIDER' || !decoded.riderId) {
    return res.status(403).json({ success: false, message: 'Rider token required' });
  }

  try {
    const r = await db.query(
      `SELECT cr.id, cr.cafe_id, COALESCE(cr.token_version, 1) AS token_version,
              c.delivery_enabled
       FROM cafe_riders cr
       JOIN cafes c ON c.id = cr.cafe_id
       WHERE cr.id = $1 AND cr.is_active = true`,
      [decoded.riderId]
    );
    if (!r.rows.length) {
      return res.status(401).json({ success: false, message: 'Rider account not found or deactivated' });
    }
    const dbVer = r.rows[0].token_version;
    if ((decoded.tv ?? 1) !== dbVer) {
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }
    if (!r.rows[0].delivery_enabled) {
      return res.status(403).json({ success: false, message: 'Café delivery is disabled' });
    }

    req.riderId = decoded.riderId;
    req.cafeId  = r.rows[0].cafe_id;
    next();
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }
};
