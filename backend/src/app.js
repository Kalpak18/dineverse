require('dotenv').config();
const validateEnv = require('./utils/validateEnv');
validateEnv(); // crash early if config is incomplete

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger');
const db = require('./config/database');
const { apiLimiter } = require('./middleware/rateLimiter');
const { createRedisAdapter, redisClients } = require('./config/redis');

const authRoutes = require('./routes/auth');
const cafeRoutes = require('./routes/cafe');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const uploadRoutes = require('./routes/uploads');
const staffRoutes = require('./routes/staff');
const expenseRoutes = require('./routes/expenses');
const analyticsRoutes = require('./routes/analytics');
const paymentRoutes = require('./routes/payments');
const supportRoutes = require('./routes/support');
const adminRoutes = require('./routes/admin');
const tableRoutes = require('./routes/tables');
const ratingRoutes = require('./routes/ratings');
const offerRoutes = require('./routes/offers');
const reservationRoutes = require('./routes/reservations');
const waitlistRoutes    = require('./routes/waitlist');
const customerRoutes    = require('./routes/customers');
const initReportScheduler = require('./services/reportScheduler');

const app = express();
// 🔥 REQUIRED for Render / Vercel / proxies
app.set('trust proxy', 1);
const server = http.createServer(app);

// ─── CORS ─────────────────────────────────────────────────────
// Supports comma-separated CLIENT_URL for multiple origins
// Allows localhost for development, Vercel for staging, and custom domains for production
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:3000';
const allowedOrigins = clientUrl
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean); // Remove empty strings

const corsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return cb(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return cb(null, true);

    // Allow all Vercel preview deployments (*.vercel.app)
    if (origin.endsWith('.vercel.app')) return cb(null, true);

    // Block everything else
    cb(new Error(`CORS blocked for origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Security headers: XSS protection, clickjacking, MIME sniffing, etc.
// contentSecurityPolicy disabled — the print-bill popup writes inline HTML
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, {
   cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.endsWith('.vercel.app')) return cb(null, true);
      cb(new Error(`Socket CORS blocked: ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// Redis adapter: shares socket rooms across multiple backend instances.
// If REDIS_URL is not set (local dev / Phase 1), falls back to in-memory.
if (process.env.REDIS_URL) {
  createRedisAdapter(io).catch((err) =>
    logger.warn('Redis adapter failed — falling back to in-memory socket: %s', err.message)
  );
}

io.on('connection', (socket) => {
  logger.debug('Socket connected: %s', socket.id);

  socket.on('join_cafe', (cafeId) => {
    socket.join(`cafe:${cafeId}`);
    logger.debug('Socket %s joined cafe:%s', socket.id, cafeId);
  });

  // Customers join this room to receive live café status (open/closed) updates
  socket.on('join_menu', (slug) => {
    socket.join(`menu:${slug}`);
  });

  // Customer tracks their own waitlist position
  socket.on('track_waitlist', (entryId) => {
    socket.join(`waitlist:${entryId}`);
  });

  socket.on('leave_cafe', (cafeId) => {
    socket.leave(`cafe:${cafeId}`);
  });

  socket.on('track_order', (orderId) => {
    socket.join(`order:${orderId}`);
  });

  socket.on('track_reservation', (reservationId) => {
    socket.join(`reservation:${reservationId}`);
  });

  // Admin joins a dedicated room to receive real-time ticket notifications
  socket.on('join_admin', () => {
    socket.join('admin_room');
    logger.debug('Socket %s joined admin_room', socket.id);
  });

  socket.on('disconnect', () => {
    logger.debug('Socket disconnected: %s', socket.id);
  });
});

// ─── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // limit body size

// HTTP request logging (skip in test env)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('[:date[clf]] :method :url :status :response-time ms'));
}

// Attach io to every request so controllers can emit events
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// Global rate limiter (per-route overrides for auth are in routes/auth.js)
app.use('/api', apiLimiter);

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/cafes', cafeRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/waitlist',    waitlistRoutes);
app.use('/api/customers',   customerRoutes);

// Root + health check — Render/load balancers hit both
app.get('/', (_req, res) => res.json({ status: 'ok' }));
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

// 404 handler for unknown API routes
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler — catches anything forwarded via next(err)
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error: %s', err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  // Don't leak internal error messages to clients for 5xx
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ success: false, message });
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// Start listening immediately so Render's health check passes fast.
// DB is verified async after bind — requests that need the DB will
// naturally fail with a 503 during the brief warm-up window.
server.listen(PORT, () => {
  logger.info('DineVerse backend running on port %d [%s]', PORT, process.env.NODE_ENV || 'development');

  // Verify DB reachability after server is already accepting connections
  db.query('SELECT 1')
    .then(() => {
      logger.info('Database connected successfully');
      if (process.env.INSTANCE_ROLE !== 'worker') {
        initReportScheduler();
      }
    })
    .catch((err) => {
      logger.error('Database connection failed: %s', err.message);
      // Don't exit — Neon reconnects on next query; log and keep serving
    });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error('Port %d is already in use. Kill the existing process and restart.', PORT);
    process.exit(1);
  } else {
    throw err;
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────
const gracefulShutdown = (signal) => {
  logger.info('%s received — shutting down gracefully', signal);
  server.close(async () => {
    try {
      await db.pool.end();

     // 🔥 Close Redis connections if exist
     if (redisClients.pub) await redisClients.pub.quit();
     if (redisClients.sub) await redisClients.sub.quit();
      logger.info('Database pool closed. Goodbye.');
    } catch (e) {
      logger.error('Error closing DB pool: %s', e.message);
    }
    process.exit(0);
  });
  // Force-kill if shutdown takes more than 30 s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─── Safety nets ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection: %s', reason?.stack || reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception: %s', err.stack || err.message);
  process.exit(1);
});

module.exports = { app, server, io };
