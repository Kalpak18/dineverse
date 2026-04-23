// Backward-compatible response helpers.
// Spreads `data` so existing response keys (cafe, order, items, etc.) remain accessible.

exports.ok = (res, data = {}, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, ...data });

// error mirrors `message` so legacy `err.response.data.error` checks still work.
// errorCode is a machine-readable constant for the frontend (e.g. 'OTP_EXPIRED').
exports.fail = (res, message, status = 400, errorCode = null) =>
  res.status(status).json({
    success: false,
    message,
    error: message,
    ...(errorCode ? { errorCode } : {}),
  });

exports.validationFail = (res, errors) =>
  res.status(400).json({ success: false, message: 'Validation failed', errors });
