import { coordinator, wasmConnector } from '@uwdata/mosaic-core';
import { tableName } from './page-context';

// The dataset is vendored in the repo under media/data and symlinked into this
// app's public/data, so it is served from the app's own origin (dev and build
// alike). No network fetch, no CORS concerns.
const QUESTIONS_PARQUET_PATH = '/data/questions.parquet';

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
      const parquetUrl = new URL(QUESTIONS_PARQUET_PATH, window.location.origin)
        .href;
      await coordinator().exec([
        `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${parquetUrl}')`,
      ]);
    })();
  }
  return initPromise;
}
