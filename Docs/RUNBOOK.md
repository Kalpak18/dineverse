# DineVerse Operations Runbook

What to do when things break. Keep this file short and current — if a section is wrong, fix it the same day.

---

## Quick reference

| Layer | Where | URL |
|---|---|---|
| Frontend | Vercel | https://dine-verse.com, https://dineverse.onrender.com (legacy) |
| Backend | Render | https://dineverse.onrender.com |
| Database | Neon (current) | console.neon.tech |
| Object storage | AWS S3 | bucket: `cafestation2026`, region `ap-south-1` |
| Error tracking | Sentry | sentry.io → projects: `dineverse-backend`, `dineverse-frontend` |
| Uptime | UptimeRobot | uptimerobot.com → monitor: `dineverse-backend /health` |
| Backups | GitHub Actions | `.github/workflows/db-backup.yml`, runs 03:00 IST nightly |

---

## One-time setup (do these once)

### 1. Sentry

1. Sign up at sentry.io (free tier: 5K errors/month, plenty).
2. Create two projects: **Node.js** for backend, **React** for frontend.
3. Copy each project's DSN.
4. Set env vars:
   - Render → Backend service → Environment: `SENTRY_DSN=<backend-dsn>`
   - Vercel → Frontend project → Environment Variables: `VITE_SENTRY_DSN=<frontend-dsn>`
5. Redeploy both. First test by visiting `/api/_does_not_exist` — should appear as a 404 noise (not an error) and `/api/test-error` (if you add one) as a captured exception.

### 2. UptimeRobot

1. Sign up at uptimerobot.com (free: 50 monitors, 5-min intervals).
2. Add monitor:
   - **Type:** HTTPS
   - **URL:** `https://dineverse.onrender.com/health`
   - **Interval:** 5 minutes
   - **Keyword (optional):** `"status":"ok"` — alerts if degraded even if 200
3. Alert contacts: add your email + WhatsApp/SMS (free tier allows 2).
4. Optional: enable status page (public.uptimerobot.com) for transparency.

### 3. GitHub Actions backup secrets

In repo → Settings → Secrets and variables → Actions, add:
- `DATABASE_URL` — production Neon URL
- `S3_BUCKET_NAME` — `cafestation2026`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

Then enable the workflow under Actions tab → "Nightly DB Backup" → run once manually to verify.

### 4. S3 lifecycle rule (retention)

In AWS console → S3 → bucket `cafestation2026` → Management → Lifecycle rules:
- Rule scope: prefix `dineverse-backups/`
- Action: Expire current versions of objects after **7 days**

Without this rule, backups accumulate forever and cost grows linearly.

---

## Incident response

### Symptom: API is returning 500s / app is down

1. **Check `/health`** — `curl https://dineverse.onrender.com/health | jq`
   - `checks.db: error` → DB is down. See "DB down" below.
   - `checks.migrations: failed` → A migration failed. See "Migration failed" below.
   - `checks.redis: error` → Real-time degraded but app should still serve. See "Redis down".
2. **Check Sentry** → recent issues, filter by environment=production, last 1 hour.
3. **Check Render logs** → service → Logs tab. Search by `request_id` if a user gave you one.

### Symptom: DB down (`checks.db: error: ...`)

- **If error is "compute time quota exceeded"** (Neon free tier):
  - Either upgrade Neon (paid plan removes quota) or wait until 1st of next month for reset.
- **If error is "connection timeout"**:
  - Neon free tier auto-pauses after inactivity. Visit Neon dashboard → project → resume.
  - Or hit `/health` a few times — first request wakes it.
- **If error is something else**:
  - Check Neon dashboard for incidents.
  - Restore from latest S3 backup if data corruption is suspected (see "Restore from backup" below).

### Symptom: Migration failed (`checks.migrations: failed`)

1. App is **still serving** — don't panic. Old code still works for everything that doesn't need the new schema.
2. Pull Render logs → look for `✗ <filename>.sql: <error>`.
3. Fix the migration SQL locally → push → Render redeploys → startup re-runs the failed migration.
4. If migration is poisoned and you must skip:
   ```sql
   -- in Neon SQL console
   INSERT INTO _migrations (filename) VALUES ('072_offer_per_customer_limit.sql');
   ```
   Then write a new migration (073_…) that fixes whatever was meant to happen.

### Symptom: Redis down

- Real-time (live order updates, customer notifications) stops working.
- Rate limiting falls back to in-memory (still works, just per-instance).
- App keeps serving HTTP requests normally — **safe to ignore** unless prolonged.
- Check Upstash/Render Redis dashboard for service status.

### Symptom: DB pool saturated (Sentry warning "DB pool saturated")

- Means concurrent requests exceed `DB_POOL_MAX` (default 10) per instance.
- **Short-term fix:** bump `DB_POOL_MAX=20` in Render env. Restart.
- **Real fix:** add PgBouncer in front of Neon (Pass B scope).

### Symptom: Render service is suspended / sleeping

- Render free tier spins down after 15 min idle. First request takes ~30s.
- **Fix:** UptimeRobot pinging every 5 min keeps it warm.

### Symptom: Frontend is showing old/stale content

- Vercel deploys cached. Hard-refresh (Ctrl+Shift+R) usually fixes it.
- If the service worker is the culprit, in DevTools → Application → Service Workers → Unregister.

---

## Restore from backup

```bash
# 1. Download the most recent backup from S3
aws s3 cp s3://cafestation2026/dineverse-backups/db-2026-06-24T21-30-12-345Z.sql.gz .

# 2. Decompress
gunzip db-2026-06-24T21-30-12-345Z.sql.gz

# 3. Restore to a fresh DB (NEVER restore over production directly — use a new Neon branch or DB)
psql "<new-database-url>" -f db-2026-06-24T21-30-12-345Z.sql

# 4. Verify counts match expectations (cafes, orders, menu_items)
psql "<new-database-url>" -c "SELECT COUNT(*) FROM cafes;"

# 5. Cut traffic over by updating DATABASE_URL in Render env and redeploying
```

---

## Deploy checklist

Before pushing to main:

- [ ] Migrations are idempotent (`IF NOT EXISTS`, `IF EXISTS`, etc).
- [ ] Migration tested against a Neon branch first when DDL is non-trivial.
- [ ] No `console.log(req.body)` or similar — secrets must not hit logs.
- [ ] Sentry will catch new error paths — no swallowed catch blocks.
- [ ] If frontend code: `npm run build` succeeds locally.
- [ ] If backend code: `npm start` boots without errors locally.

---

## Contacts

- Engineering: Kalpak (bhoirkalpak916@gmail.com)
- On-call rotation: TBD
