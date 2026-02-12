import { createServer } from 'node:http';
import 'dotenv/config';

const PORT = 3001;

const REMOTE_DB_URL =
  process.env.REMOTE_DB_URL || 'https://trueprod.theopendatastack.com';
const TENANT_ID = process.env.TENANT_ID;
const CF_CLIENT_ID = process.env.CF_CLIENT_ID;
const CF_CLIENT_SECRET = process.env.CF_CLIENT_SECRET;

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

let requestCounter = 0;

/** Collect the request body into a parsed JSON object. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed = ALLOWED_ORIGINS.includes(origin);

  // CORS headers (only for allowed origins)
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/query') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const reqId = ++requestCounter;
  const body = await readBody(req);

  const sql = body?.sql;
  const summary =
    typeof sql === 'string'
      ? sql.substring(0, 50) + (sql.length > 50 ? '...' : '')
      : 'No SQL';

  console.log(`[Proxy #${reqId}] Forwarding: "${summary}" to ${REMOTE_DB_URL}`);

  try {
    const start = Date.now();
    const upstream = await fetch(REMOTE_DB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TENANT_ID ? { 'X-Tenant-Id': TENANT_ID } : {}),
        ...(CF_CLIENT_ID ? { 'CF-Access-Client-Id': CF_CLIENT_ID } : {}),
        ...(CF_CLIENT_SECRET
          ? { 'CF-Access-Client-Secret': CF_CLIENT_SECRET }
          : {}),
      },
      body: JSON.stringify(body),
    });

    console.log(
      `[Proxy #${reqId}] Upstream: ${upstream.status} (${Date.now() - start}ms)`,
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`[Proxy #${reqId}] Upstream Error:`, text);
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
      res.end(`Database Error: ${text}`);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType =
      upstream.headers.get('content-type') || 'application/json';

    console.log(
      `[Proxy #${reqId}] Sending ${buffer.byteLength} bytes (${contentType})`,
    );

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(buffer);
  } catch (err) {
    console.error(`[Proxy #${reqId}] Connection Crash:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`\nLocal Proxy running at http://localhost:${PORT}`);
  console.log(`   Targeting Remote: ${REMOTE_DB_URL}`);
});
