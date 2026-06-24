/**
 * Sentry init — MUST be required at the top of app.js BEFORE express is
 * imported, otherwise the Express integration cannot auto-instrument routes.
 *
 * If SENTRY_DSN is not set, this becomes a no-op: app runs normally without
 * error reporting. Lets local dev / fresh deploys run before the DSN is wired.
 */
const Sentry = require('@sentry/node');

let initialized = false;

function initSentry() {
  if (initialized) return Sentry;
  if (!process.env.SENTRY_DSN) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return Sentry;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Release tag = git SHA injected at build time. Lets Sentry tie an error
    // to the exact deploy that introduced it.
    release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || undefined,
    // Sampling: 10% baseline traces. Sentry auto-captures unhandled errors
    // at 100% regardless of this rate.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    // Strip auth tokens and customer phone numbers from event payloads.
    // Sentry would otherwise capture full request bodies on 500s.
    beforeSend(event) {
      if (event.request) {
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        if (event.request.data && typeof event.request.data === 'object') {
          const scrubKeys = ['password', 'otp', 'token', 'refreshToken', 'customer_phone', 'phone'];
          for (const key of scrubKeys) {
            if (event.request.data[key]) event.request.data[key] = '[redacted]';
          }
        }
      }
      return event;
    },
  });

  initialized = true;
  console.log('[sentry] Initialized for env:', process.env.NODE_ENV);
  return Sentry;
}

module.exports = { initSentry, Sentry };
