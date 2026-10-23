// Calendar dates in the platform's local timezone (matches the DB session
// timezone set in config/database.js). new Date().toISOString() gives the UTC
// date, which is "yesterday" between 00:00 and 05:30 IST.
const TZ = process.env.DB_TIMEZONE || 'Asia/Kolkata';

// 'YYYY-MM-DD' for the given instant in local time
exports.localDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
