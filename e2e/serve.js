// Serves frontend/dist like Vercel does: security headers from vercel.json
// (CSP included — so tests run under the real policy), the /api rewrite to
// the API server, and SPA fallback.
// The CSP's connect-src gets the local test API origin added, nothing else.
// usage: node serve.js <port> <apiOrigin>
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const [,, port, apiOrigin] = process.argv;
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'vercel.json'), 'utf8'));
const headers = {};
for (const block of vercel.headers || []) {
  if (block.source !== '/(.*)' && block.source !== '/:path*') continue;
  for (const h of block.headers) headers[h.key] = h.value;
}
const wsOrigin = apiOrigin.replace(/^http/, 'ws');
if (headers['Content-Security-Policy']) {
  headers['Content-Security-Policy'] = headers['Content-Security-Policy']
    .replace('connect-src', `connect-src ${apiOrigin} ${wsOrigin}`);
}
delete headers['Strict-Transport-Security']; // http://localhost

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml' };

const api = new URL(apiOrigin);

http.createServer((req, res) => {
  // Like vercel.json's rewrite: /api/* → the API server (same origin for the browser)
  if (req.url.startsWith('/api/')) {
    const upstream = http.request(
      { host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); }
    );
    upstream.on('error', () => { res.writeHead(502); res.end('upstream down'); });
    req.pipe(upstream);
    return;
  }
  // Vercel Analytics / Speed Insights only exist on Vercel's edge
  if (req.url.startsWith('/_vercel/')) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/javascript' });
    res.end('');
    return;
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(Number(port), () => console.log(`static on ${port}`));
