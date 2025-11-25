// apps/react-app/src/db.ts
// This file manages the singleton DuckDB-WASM instance for the entire application.
// It provides a way to initialize the database and get a direct connection to it,
// which is necessary for advanced operations like the CORS-bypassing file registration.
import * as duckdb from '@duckdb/duckdb-wasm';

// --- MODERN DUCKDB-WASM BUNDLING ---
// We import the URLs for the worker and WASM module directly.
// This is the recommended approach for modern build tools like Vite.
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

let db: duckdb.AsyncDuckDB | null = null;

export async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (db) {
    return db;
  }

  const logger = new duckdb.ConsoleLogger();
  const worker = new Worker(duckdb_worker);

  // Instantiate the async DB, pointing it to the correct worker and WASM files.
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(duckdb_wasm, duckdb_worker);
  return db;
}