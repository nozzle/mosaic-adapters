import { coordinator, wasmConnector } from '@uwdata/mosaic-core';
import { tableName } from './page-context';

// The dataset is vendored in the repo under media/data and symlinked into this
// app's public/data, so it is served from the app's own origin (dev and build
// alike). No external fetch, no CORS concerns.
const ATHLETES_PARQUET_PATH = '/data/athletes.parquet';

let initPromise: Promise<void> | null = null;

/**
 * Point the global Mosaic coordinator at an in-browser DuckDB (WASM) and load
 * the athletes table from parquet. Idempotent — StrictMode's doubled effect
 * and HMR re-runs share one promise. Everything on the page (our data clients
 * and vgplot's marks alike) talks to this one coordinator.
 */
export function initAthletesTable(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async () => {
      coordinator().databaseConnector(wasmConnector());
      // DuckDB-WASM only fetches over HTTP for fully-qualified URLs; a bare
      // path would be looked up in its virtual filesystem instead.
      const parquetUrl = new URL(ATHLETES_PARQUET_PATH, window.location.origin)
        .href;
      await coordinator().exec([
        `CREATE TABLE IF NOT EXISTS ${tableName} AS SELECT * FROM '${parquetUrl}'`,
      ]);
    })();
  }
  return initPromise;
}
