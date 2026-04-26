/**
 * PM2 Ecosystem Config — DineVerse Backend
 *
 * Deploy:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup    ← follow the printed command to auto-start on reboot
 *
 * Useful commands:
 *   pm2 list                  — view all processes + CPU/mem
 *   pm2 logs dineverse        — tail logs
 *   pm2 reload dineverse      — zero-downtime rolling restart
 *   pm2 monit                 — live dashboard
 */
module.exports = {
  apps: [
    {
      name: 'dineverse',
      script: 'src/app.js',

      // Cluster mode: one worker per CPU core — uses all available CPU
      instances: 'max',
      exec_mode: 'cluster',

      // Never auto-restart more than 10 times in 30 s (crash loop guard)
      max_restarts: 10,
      min_uptime: '10s',

      // Rolling restart waits for each worker to be ready before killing the old one
      wait_ready: true,
      listen_timeout: 10000,

      watch: false,
      ignore_watch: ['node_modules', 'logs'],

      // Rotate logs so disk doesn't fill up — install pm2-logrotate if needed
      error_file: './logs/err.log',
      out_file:   './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        // Only worker index 0 runs the daily report scheduler.
        // Other workers set INSTANCE_ROLE=worker in their own env — PM2 doesn't
        // support per-instance env natively, so we guard in app.js via cluster.worker.id.
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 5000,
        instances: 1,       // single process in dev — easier debugging
        exec_mode: 'fork',
      },
    },
  ],
};
