const jwt = require('jsonwebtoken');

module.exports = function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Admin token required' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admin access only' });
    }
    req.adminId = payload.adminId;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token' });
  }
};
