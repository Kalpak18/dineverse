/**
 * Nightly DB backup → S3.
 *
 * Runs pg_dump against DATABASE_URL, gzips the dump, uploads to the S3 bucket
 * already used for menu images. Retention is enforced lifecycle-side via an
 * S3 lifecycle rule (set bucket policy: expire dineverse-backups/* after 7d).
 *
 * Run locally:  DATABASE_URL=... S3_BUCKET_NAME=... AWS_*=... node scripts/backup-db.js
 * Run in CI:    invoked from .github/workflows/db-backup.yml on cron
 *
 * Requires pg_dump installed (apt: postgresql-client). The GH Action workflow
 * installs it before running this script.
 */
require('dotenv').config();
const { spawn } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const zlib = require('zlib');
const { PassThrough } = require('stream');

function fail(msg) {
  console.error('[backup-db]', msg);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
const bucket = process.env.S3_BUCKET_NAME;
const region = process.env.AWS_REGION || 'ap-south-1';

if (!dbUrl) fail('DATABASE_URL is required');
if (!bucket) fail('S3_BUCKET_NAME is required');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const key = `dineverse-backups/db-${ts}.sql.gz`;

const s3 = new S3Client({ region });

// Stream: pg_dump → gzip → S3 PutObject (no intermediate disk file).
const dump = spawn('pg_dump', ['--no-owner', '--no-acl', '--format=plain', dbUrl], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderrBuf = '';
dump.stderr.on('data', (d) => { stderrBuf += d.toString(); });

const gzip = zlib.createGzip({ level: 6 });
const passthrough = new PassThrough();
dump.stdout.pipe(gzip).pipe(passthrough);

(async () => {
  try {
    console.log('[backup-db] uploading to s3://%s/%s', bucket, key);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: passthrough,
      ContentType: 'application/gzip',
      ContentDisposition: `attachment; filename="${key.split('/').pop()}"`,
      Metadata: {
        'created-at': new Date().toISOString(),
        'source': 'dineverse-nightly-backup',
      },
    }));
    console.log('[backup-db] upload complete:', key);
  } catch (err) {
    console.error('[backup-db] upload FAILED:', err.message);
    console.error('[backup-db] pg_dump stderr:', stderrBuf);
    process.exit(1);
  }
})();

dump.on('close', (code) => {
  if (code !== 0) {
    console.error('[backup-db] pg_dump exited with code', code);
    console.error('[backup-db] pg_dump stderr:', stderrBuf);
    process.exit(code);
  }
});
