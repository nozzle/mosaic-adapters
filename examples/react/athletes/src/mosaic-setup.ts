import { coordinator, wasmConnector } from '@uwdata/mosaic-core';
import { tableName } from './page-context';

const ATHLETES_PARQUET_URL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';

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
      await coordinator().exec([
        `CREATE TABLE IF NOT EXISTS ${tableName} AS SELECT * FROM '${ATHLETES_PARQUET_URL}'`,
      ]);
    })();
  }
  return initPromise;
}
