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

let pubClient = null;
let subClient = null;

function createRedisClients() {
  if (!process.env.REDIS_URL) return { pubClient: null, subClient: null };

  const opts = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  };

  pubClient = new Redis(process.env.REDIS_URL, opts);
  subClient = pubClient.duplicate();

  pubClient.on('error', (err) => logger.error('Redis pub error: %s', err.message));
  subClient.on('error', (err) => logger.error('Redis sub error: %s', err.message));

  return { pubClient, subClient };
}

// Attaches the Redis adapter to a Socket.io Server instance.
async function createRedisAdapter(io) {
  const { pubClient, subClient } = createRedisClients();
  if (!pubClient) return;

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('Socket.io Redis adapter connected');
}

module.exports = { createRedisAdapter, pubClient, subClient };
