const logger = require('./logger');

/**
 * Wraps an async route handler so unhandled promise rejections are
 * forwarded to Express's global error middleware instead of crashing
 * the process or hanging the request.
 *
 * Usage:
 *   exports.getX = asyncHandler(async (req, res) => { ... });
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error('%s error: %s', fn.name || 'Handler', err.message);
    next(err);
  });
};

module.exports = asyncHandler;
