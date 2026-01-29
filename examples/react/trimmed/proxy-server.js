import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import 'dotenv/config';
import { tableFromIPC } from 'apache-arrow';

const app = express();
const PORT = 3001;

const REMOTE_DB_URL = process.env.REMOTE_DB_URL || "https://datadb.theopendatastack.com";
const TENANT_ID = process.env.TENANT_ID; 
const CF_CLIENT_ID = process.env.CF_CLIENT_ID;
const CF_CLIENT_SECRET = process.env.CF_CLIENT_SECRET;

// 1. GLOBAL REQUEST LOGGER (Place this first)
app.use((req, res, next) => {
  console.log(`\n[Inbound] ${req.method} ${req.originalUrl}`);
  console.log(`[Inbound] Headers: content-type=${req.headers['content-type']}`);
  next();
});

// 2. VERBOSE CORS (Helpful to see if Preflight fails)
app.use(cors({
  origin: true, // Reflect request origin
  credentials: true
}));

app.use(express.json());

let requestCounter = 0;

app.post('/query', async (req, res) => {
  const reqId = ++requestCounter;
  // SAFELY extract SQL summary to prevent crashing on non-string inputs
  let querySummary = "No SQL";
  if (req.body && req.body.sql) {
      const sqlParam = req.body.sql;
      if (typeof sqlParam === 'string') {
          querySummary = sqlParam.substring(0, 50) + (sqlParam.length > 50 ? "..." : "");
      } else {
          // If it's not a string (e.g. object/array), stringify it for logs
          try {
              querySummary = JSON.stringify(sqlParam).substring(0, 50) + "... (Type: " + typeof sqlParam + ")";
          } catch (e) {
              querySummary = `[Unstringifiable ${typeof sqlParam}]`;
          }
      }
  }
  
  // Debug log the full body if it looks weird or sql is missing
  if (!req.body || typeof req.body.sql !== 'string') {
     console.log("[Proxy] ⚠️ Received potentially malformed body:", JSON.stringify(req.body));
  }

  console.log(`[Proxy #${reqId}] ➡️ Forwarding: "${querySummary}" to ${REMOTE_DB_URL}`);
  console.log(`[Proxy #${reqId}] 🔒 Auth Headers: X-Tenant-Id=${TENANT_ID ? 'Set' : 'MISSING'}`);

  try {
    const start = Date.now();
    const backendResponse = await fetch(REMOTE_DB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
        "CF-Access-Client-Id": CF_CLIENT_ID,
        "CF-Access-Client-Secret": CF_CLIENT_SECRET,
      },
      body: JSON.stringify(req.body),
    });

    console.log(`[Proxy #${reqId}] ⬅️ Upstream Response: ${backendResponse.status} (${Date.now() - start}ms)`);

    if (!backendResponse.ok) {
        const text = await backendResponse.text();
        console.error(`[Proxy #${reqId}] ❌ Upstream Error Body:`, text);
        return res.status(backendResponse.status).send(`Database Error: ${text}`);
    }

    const buffer = await backendResponse.arrayBuffer();
    const contentType = backendResponse.headers.get("content-type") || "application/json";

    console.log(`[Proxy #${reqId}] ✅ Sending ${buffer.byteLength} bytes to client (${contentType})`);

    // Debug: Decode ALL Arrow responses to inspect structure
    // Store the original SQL at request time to avoid async issues
    const originalSql = req.body.sql;
    const isDescQuery = originalSql && typeof originalSql === 'string' && originalSql.trim().toUpperCase().startsWith('DESC');
    if (contentType.includes('arrow')) {
      const queryPrefix = originalSql ? originalSql.substring(0, 60) : 'unknown';
      console.log(`[Proxy #${reqId}] 🔍 Arrow (${buffer.byteLength} bytes): ${queryPrefix}...`);
      try {
        const table = tableFromIPC(new Uint8Array(buffer));
        console.log(`[Proxy #${reqId}]   numRows: ${table.numRows}, cols: [${table.schema.fields.map(f => f.name).join(', ')}]`);
        if (isDescQuery) {
          if (table.numRows > 0) {
            const firstRow = table.get(0);
            console.log(`[Proxy #${reqId}]   DESC row:`, JSON.stringify(firstRow));
          } else {
            console.error(`[Proxy #${reqId}]   ❌ DESC EMPTY! Will cause 'column_type' undefined error!`);
          }
        }
      } catch (arrowErr) {
        console.error(`[Proxy #${reqId}]   ❌ Arrow decode FAILED:`, arrowErr);
      }
    }

    res.set("Content-Type", contentType);
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error(`[Proxy #${reqId}] 💥 Connection Crash:`, err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Local Proxy running at http://localhost:${PORT}`);
  console.log(`   Targeting Remote: ${REMOTE_DB_URL}`);
});