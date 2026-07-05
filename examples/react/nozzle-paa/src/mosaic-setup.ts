import { coordinator, wasmConnector } from '@uwdata/mosaic-core';
import { tableName } from './page-context';

/**
 * The parquet is fetched through the Vite proxy (`/data-proxy` →
 * fastopendata.org) because the origin sends no CORS headers and DuckDB-WASM
 * fetches from the browser. The remote file name is external and not ours to
 * rename, so the proxy path is kept verbatim.
 */
const PROXY_PATH = '/data-proxy/nozzle_test.parquet';

let initPromise: Promise<void> | null = null;

/**
 * Point the global Mosaic coordinator at an in-browser DuckDB (WASM) and
 * load the questions table. Idempotent — StrictMode's doubled effect and HMR
 * re-runs share one promise.
 */
export function initQuestionsTable(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async () => {
      coordinator().databaseConnector(wasmConnector());
      const parquetUrl = new URL(PROXY_PATH, window.location.origin).href;
      await coordinator().exec([
        `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${parquetUrl}')`,
      ]);
    })();
  }
  return initPromise;
}
