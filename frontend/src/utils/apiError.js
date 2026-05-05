/**
 * Extracts a user-friendly error message from an axios error.
 * Handles: validation errors array, `error` field, `message` field, network errors.
 */
export function getApiError(err) {
  if (!err.response) return 'Network error — please check your connection';
  const d = err.response.data;
  if (!d) return 'Server error — please try again';
  if (Array.isArray(d.errors) && d.errors.length > 0) return d.errors[0].msg;
  return d.message || d.error || `Error ${err.response.status}`;
}
