/**
 * scheduleUtils.js — helpers for café opening-hours logic (client-side).
 *
 * opening_hours shape (JSONB from backend):
 *   {
 *     mon: { open: "09:00", close: "22:00", closed: false },
 *     tue: { open: "09:00", close: "22:00", closed: false },
 *     …
 *     sun: { open: "10:00", close: "20:00", closed: true  },
 *   }
 *
 * timezone: IANA string, e.g. "Asia/Kolkata"
 *
 * All functions are pure (no side-effects) so they are easy to test and reuse.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** Convert "HH:MM" to minutes-since-midnight integer. */
function toMins(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Format minutes-since-midnight as "9:00 AM" style. */
export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Get local "now" in a given IANA timezone as { dayKey, nowMins }.
 * Falls back to device timezone if tz is falsy.
 */
function localNow(tz) {
  const now = new Date();
  // Build a Date-like string in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday').toLowerCase().slice(0, 3); // 'mon', 'tue'…
  const hour    = parseInt(get('hour'),   10);
  const minute  = parseInt(get('minute'), 10);
  const nowMins = hour * 60 + (isNaN(minute) ? 0 : minute);

  return { dayKey: weekday, nowMins };
}

/**
 * Returns the current open/closed status.
 *
 * @returns {{
 *   isOpen:        boolean,
 *   reason:        string,   // human-readable sentence
 *   closingSoon:   boolean,  // true if closing within 30 min
 *   minsUntilClose: number,  // only valid when isOpen && closingSoon
 * }}
 */
export function getScheduleStatus(opening_hours, timezone, is_open_flag) {
  // No schedule configured — fall back to manual toggle
  if (!opening_hours || Object.keys(opening_hours).length === 0) {
    return {
      isOpen: is_open_flag !== false,
      reason: is_open_flag === false ? 'Closed' : 'Open',
      closingSoon: false,
      minsUntilClose: null,
    };
  }

  const { dayKey, nowMins } = localNow(timezone);
  const day = opening_hours[dayKey];

  // Day not configured in schedule
  if (!day) {
    return {
      isOpen: is_open_flag !== false,
      reason: is_open_flag === false ? 'Closed' : 'Open',
      closingSoon: false,
      minsUntilClose: null,
    };
  }

  if (day.closed) {
    return { isOpen: false, reason: 'Closed today', closingSoon: false, minsUntilClose: null };
  }

  const openMins  = toMins(day.open  || '00:00');
  const closeMins = toMins(day.close || '23:59');

  if (nowMins < openMins) {
    return {
      isOpen: false,
      reason: `Opens at ${formatTime(day.open)}`,
      closingSoon: false,
      minsUntilClose: null,
    };
  }

  if (nowMins >= closeMins) {
    return {
      isOpen: false,
      reason: `Closed — opened until ${formatTime(day.close)}`,
      closingSoon: false,
      minsUntilClose: null,
    };
  }

  // Currently open
  const minsUntilClose = closeMins - nowMins;
  const closingSoon = minsUntilClose <= 30;

  return {
    isOpen: true,
    reason: closingSoon
      ? `Closes in ${minsUntilClose} min (at ${formatTime(day.close)})`
      : `Open until ${formatTime(day.close)}`,
    closingSoon,
    minsUntilClose,
  };
}

/**
 * Returns today's hours string, e.g. "9:00 AM – 10:00 PM" or "Closed today".
 */
export function getTodayHours(opening_hours, timezone) {
  if (!opening_hours) return null;
  const { dayKey } = localNow(timezone);
  const day = opening_hours[dayKey];
  if (!day) return null;
  if (day.closed) return 'Closed today';
  return `${formatTime(day.open)} – ${formatTime(day.close)}`;
}

/**
 * Returns a full week schedule array sorted Mon→Sun for display.
 * Each item: { key, label, open, close, closed }
 */
export function getWeekSchedule(opening_hours) {
  const ordered = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return ordered.map((key) => ({
    key,
    label: DAY_LABELS[key],
    ...(opening_hours?.[key] || { open: '09:00', close: '22:00', closed: false }),
  }));
}

/**
 * Default schedule: Mon–Sat 9 AM–10 PM, Sunday 10 AM–9 PM.
 */
export function defaultSchedule() {
  return {
    mon: { open: '09:00', close: '22:00', closed: false },
    tue: { open: '09:00', close: '22:00', closed: false },
    wed: { open: '09:00', close: '22:00', closed: false },
    thu: { open: '09:00', close: '22:00', closed: false },
    fri: { open: '09:00', close: '22:00', closed: false },
    sat: { open: '09:00', close: '23:00', closed: false },
    sun: { open: '10:00', close: '21:00', closed: false },
  };
}
