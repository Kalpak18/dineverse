// Must run after `authenticate` middleware.
// Owners always pass; staff pass only if their role is listed, e.g.
// requireRole('manager', 'cashier'). Mirrors the frontend's per-role nav.

module.exports = function requireRole(...staffRoles) {
  return function (req, res, next) {
    if (req.role === 'OWNER') return next();
    if (req.role === 'STAFF' && staffRoles.includes(req.staffRole)) return next();
    return res.status(403).json({ success: false, message: 'Not allowed for your role', error: 'Not allowed for your role' });
  };
};
