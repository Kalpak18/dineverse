// Prep time ETA helpers — used on KDS, owner Orders page, and customer tracking.
//
// Logic:
//   Each item has prep_started_at + prep_duration_mins once cooking begins.
//   Items cook in PARALLEL, so order ETA = max(remaining mins across active items).
//   "Active" = item_status is 'preparing' and prep_started_at is set.
//   Already-ready/served items don't block the ETA.

/**
 * Returns remaining minutes for one item, or null if prep time not set / already done.
 * Negative means overdue (return 0 for display).
 */
export function itemRemainingMins(item, nowMs = Date.now()) {
  if (!item.prep_started_at || !item.prep_duration_mins) return null;
  if (['ready', 'served', 'cancelled'].includes(item.item_status)) return null;
  const startedMs = new Date(item.prep_started_at).getTime();
  const durationMs = item.prep_duration_mins * 60 * 1000;
  const remaining = Math.ceil((startedMs + durationMs - nowMs) / 60000);
  return Math.max(0, remaining);
}

/**
 * Returns the order-level ETA in minutes = max remaining across all cooking items.
 * Returns null if no item has prep time set.
 */
export function orderEtaMins(items, nowMs = Date.now()) {
  if (!items?.length) return null;
  let max = null;
  for (const item of items) {
    const r = itemRemainingMins(item, nowMs);
    if (r !== null && (max === null || r > max)) max = r;
  }
  return max;
}

/**
 * Returns true if any item in the order has prep time set (i.e. ETA is meaningful).
 */
export function orderHasPrepTime(items) {
  return (items || []).some((i) => i.prep_started_at && i.prep_duration_mins);
}

/** Format: "5m", "1h 3m", "Ready" */
export function fmtMins(mins) {
  if (mins === null || mins === undefined) return null;
  if (mins <= 0) return 'Ready';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
