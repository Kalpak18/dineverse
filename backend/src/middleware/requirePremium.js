module.exports = function requirePremium(req, res, next) {
  if (req.subscription?.plan_tier !== 'premium') {
    return res.status(403).json({
      success: false,
      message: 'This feature requires the Kitchen Pro plan. Upgrade to unlock it.',
      error: 'premium_required',
    });
  }
  next();
};
