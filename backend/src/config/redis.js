// Redis configuration for:
//  1. Socket.io adapter (multi-instance room sharing)
//  2. Rate limiter store (shared counters across instances)
//
// If REDIS_URL is not set the app runs fine in single-instance mode
// (local dev, Phase 1 deployment). Set REDIS_URL in production to enable
// horizontal scaling.

const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const logger = require('../utils/logger');

// Module-level references updated by createRedisAdapter so graceful shutdown can close them
const redisClients = { pub: null, sub: null };

// Attaches the Redis adapter to a Socket.io Server instance.
// Also stores clients in redisClients so app.js can close them on shutdown.
async function createRedisAdapter(io) {
  if (!process.env.REDIS_URL) return;

  const opts = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    tls: {},
    retryStrategy: (times) => (times > 20 ? null : Math.min(times * 300, 5000)),
  };

  const pub = new Redis(process.env.REDIS_URL, opts);
  const sub = pub.duplicate();

  pub.on('error', (err) => logger.error('Redis pub error: %s', err.message));
  sub.on('error', (err) => logger.error('Redis sub error: %s', err.message));

  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));

  // Store for graceful shutdown
  redisClients.pub = pub;
  redisClients.sub = sub;

  logger.info('Socket.io Redis adapter connected');
}

module.exports = { createRedisAdapter, redisClients };
