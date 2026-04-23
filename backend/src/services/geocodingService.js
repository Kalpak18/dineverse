const logger = require('../utils/logger');

function buildAddressQuery(parts = []) {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

async function geocodeAddress(parts = []) {
  const query = buildAddressQuery(parts);
  if (!query) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'DineVerse/1.0 support@dine-verse.com',
        },
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first?.lat || !first?.lon) return null;

    return {
      latitude: parseFloat(first.lat),
      longitude: parseFloat(first.lon),
      display_name: first.display_name || query,
    };
  } catch (error) {
    logger.warn('Geocoding failed for "%s": %s', query, error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { geocodeAddress, buildAddressQuery };
