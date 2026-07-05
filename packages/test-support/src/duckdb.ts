/**
 * Test harness backed by a real in-process DuckDB (duckdb-wasm's Node
 * blocking build). Queries execute for real, so tests assert observable
 * behavior (filtered totals, published clause predicates) instead of SQL
 * string shapes.
 */
import { createRequire } from 'node:module';
import { Coordinator, decodeIPC } from '@uwdata/mosaic-core';
import type {
  ArrowQueryRequest,
  Connector,
  ExecQueryRequest,
  JSONQueryRequest,
  MosaicClient,
} from '@uwdata/mosaic-core';
import type { Table } from '@uwdata/flechette';
import type * as DuckDBBlocking from '@duckdb/duckdb-wasm/blocking';

const require = createRequire(import.meta.url);

export interface TestDb {
  coordinator: Coordinator;
  /** SQL of every query the coordinator executed for a client. */
  clientQueries: Array<string>;
  /** SQL of every query that reached the database connector. */
  connectorQueries: Array<string>;
  exec: (sql: string) => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  // The blocking build is CJS-only; load it through require for stable interop.

  const duckdb =
    require('@duckdb/duckdb-wasm/blocking') as typeof DuckDBBlocking;
  // The blocking runtime never spawns the worker, but the bundle type
  // requires the path.
  const bundles = {
    mvp: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
      mainWorker:
        require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
      mainWorker:
        require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs'),
    },
  };
  const db = await duckdb.createDuckDB(
    bundles,
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate(() => {});
  db.open({ path: ':memory:' });
  const conn = db.connect();

  const connectorQueries: Array<string> = [];

  const connector = {
    query(request: ArrowQueryRequest | ExecQueryRequest | JSONQueryRequest) {
      const { type, sql } = request;
      connectorQueries.push(sql);
      const buffer = conn.useUnsafe((bindings, connId) =>
        bindings.runQuery(connId, sql),
      );
      if (type === 'exec') {
        return Promise.resolve(undefined);
      }
      if (type === 'json') {
        return Promise.resolve(decodeIPC(buffer).toArray());
      }
      return Promise.resolve(decodeIPC(buffer));
    },
  } as Connector;

  const coordinator = new Coordinator(connector, {
    logger: null,
    // Consolidation batches compatible client queries, which would make
    // "exactly one query" assertions racy. Correctness is unaffected.
    consolidate: false,
  });

  const clientQueries: Array<string> = [];
  const originalUpdateClient = coordinator.updateClient.bind(coordinator);
  coordinator.updateClient = (
    client: MosaicClient,
    query: Parameters<Coordinator['updateClient']>[1],
    priority?: number,
  ) => {
    clientQueries.push(String(query));
    return originalUpdateClient(client, query, priority);
  };

  return {
    coordinator,
    clientQueries,
    connectorQueries,
    exec: async (sql: string) => {
      await coordinator.exec(sql);
    },
  };
}

export async function createAthletesDb(): Promise<TestDb> {
  const db = await createTestDb();
  await db.exec(`
    CREATE TABLE athletes(id INTEGER, name TEXT, sport TEXT, weight INTEGER);
    INSERT INTO athletes VALUES
      (1, 'Ada', 'swim', 60),
      (2, 'Bo', 'swim', 70),
      (3, 'Cy', 'swim', 80),
      (4, 'Di', 'swim', 90),
      (5, 'Ed', 'run', 55),
      (6, 'Fi', 'run', 65);
  `);
  return db;
}

/** Poll until the assertion stops throwing (real queries are async). */
export async function waitFor(
  assertion: () => void,
  timeoutMs = 5_000,
): Promise<void> {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError;
}

/** Let any synchronously-triggered async work settle without asserting. */
export async function settle(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function arrowRows(table: Table): Array<Record<string, unknown>> {
  return table.toArray();
}
