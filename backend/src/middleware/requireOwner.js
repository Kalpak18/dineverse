// Must run after `authenticate` middleware.
// Blocks staff accounts from owner-only operations (menu, settings, uploads).

module.exports = function requireOwner(req, res, next) {
  if (req.role !== 'OWNER') {
    return res.status(403).json({ success: false, message: 'Owner access required', error: 'Owner access required' });
  }
  next();
};
