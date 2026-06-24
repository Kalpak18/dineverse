const { createLogger, format, transports } = require('winston');

// In production we emit structured JSON so log aggregators (Logtail, Better
// Stack, Render's built-in viewer) can filter by request_id, route, level.
// Local dev keeps the human-readable colourised format.
const isProd = process.env.NODE_ENV === 'production';

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const devFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.printf(({ timestamp, level, message, stack }) =>
    stack ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}` : `[${timestamp}] ${level.toUpperCase()}: ${message}`
  )
);

const logger = createLogger({
  level: isProd ? 'info' : 'debug',
  defaultMeta: {
    service: 'dineverse-backend',
    env: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || undefined,
  },
  format: isProd ? prodFormat : devFormat,
  transports: [
    new transports.Console(),
    ...(isProd
      ? []
      : [
          new transports.File({ filename: 'logs/error.log', level: 'error' }),
          new transports.File({ filename: 'logs/combined.log' }),
        ]),
  ],
});

module.exports = logger;
