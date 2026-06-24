// Frontend Sentry init. No-op when VITE_SENTRY_DSN is unset so dev/preview
// builds don't ship telemetry. Loaded from main.jsx before React renders.
import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_COMMIT || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,    // No baseline session replay — too costly
    replaysOnErrorSampleRate: 1.0,    // But always capture replay if an error fires
    // Filter noisy browser errors we cannot act on (extensions, ad blockers).
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
    beforeSend(event) {
      // Drop events from local dev that slipped through
      if (window.location.hostname === 'localhost') return null;
      return event;
    },
  });
}

export { Sentry };
