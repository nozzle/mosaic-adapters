/**
 * Recipe 2 — declarative, serializable data loading.
 *
 * A `Record<tableName, DataSource>` config compiles to an ORDERED list of SQL
 * `CREATE TABLE` statements, run sequentially through `coordinator.exec` (later
 * entries may reference earlier tables). The config is plain data — no
 * coordinator, no closures — so it can be authored, serialized, or generated.
 *
 * DuckDB-WASM gotcha (preserved from the original setup): the WASM build only
 * fetches FULLY-QUALIFIED URLs, so relative paths are resolved against
 * `window.location.origin` before reaching `read_parquet`/`read_csv`/etc.
 */
import { useEffect, useRef, useState } from 'react';
import type { Coordinator } from '@uwdata/mosaic-core';

/**
 * A table's source. Only the `parquet` variant is exercised by this example;
 * the others are included to show the config's intended shape.
 */
export type DataSource =
  | { type: 'parquet'; url: string }
  | { type: 'csv'; url: string }
  | { type: 'json'; url: string }
  /** Arbitrary SQL body — the compiled statement wraps it in CREATE TABLE. */
  | { type: 'sql'; query: string };

/** Insertion order of the record defines load order. */
export type DataLoadConfig = Record<string, DataSource>;

/** Resolve a possibly-relative asset path to a fully-qualified URL for WASM. */
function toFetchableUrl(url: string): string {
  return new URL(url, window.location.origin).href;
}

/** Compile one source to the SELECT that feeds its CREATE TABLE. */
function sourceToSelect(source: DataSource): string {
  switch (source.type) {
    case 'parquet':
      return `SELECT * FROM read_parquet('${toFetchableUrl(source.url)}')`;
    case 'csv':
      return `SELECT * FROM read_csv('${toFetchableUrl(source.url)}')`;
    case 'json':
      return `SELECT * FROM read_json('${toFetchableUrl(source.url)}')`;
    case 'sql':
      return source.query;
  }
}

/** Ordered `CREATE OR REPLACE TABLE` statements, one per config entry. */
export function buildDataLoadStatements(config: DataLoadConfig): Array<string> {
  return Object.entries(config).map(
    ([table, source]) =>
      `CREATE OR REPLACE TABLE ${table} AS ${sourceToSelect(source)}`,
  );
}

export type TableLoadStatus = 'pending' | 'loading' | 'ready' | 'error';

export interface DataLoadState {
  /** Per-table status, keyed by table name. */
  tables: Record<string, TableLoadStatus>;
  error: Error | null;
  done: boolean;
}

/**
 * `'Cleared'` is how Mosaic's QueryManager rejects in-flight queries when the
 * coordinator is cleared mid-load (a connector reset). It surfaces as either a
 * bare string reject or an Error carrying that message.
 */
function isClearedError(reason: unknown): boolean {
  if (reason === 'Cleared') {
    return true;
  }
  return reason instanceof Error && reason.message === 'Cleared';
}

/**
 * Run the compiled statements sequentially against `coordinator`, one retry on
 * a `'Cleared'` rejection (a connector reset racing the load).
 */
export async function runDataLoad(
  coordinator: Coordinator,
  config: DataLoadConfig,
  onTableStatus?: (table: string, status: TableLoadStatus) => void,
): Promise<void> {
  const entries = Object.keys(config);
  const statements = buildDataLoadStatements(config);

  for (let index = 0; index < entries.length; index += 1) {
    const table = entries[index]!;
    const statement = statements[index]!;
    onTableStatus?.(table, 'loading');
    try {
      await coordinator.exec([statement]);
    } catch (reason) {
      if (isClearedError(reason)) {
        // One retry: the reset that cleared the queue has settled by now.
        await coordinator.exec([statement]);
      } else {
        onTableStatus?.(table, 'error');
        throw reason instanceof Error ? reason : new Error(String(reason));
      }
    }
    onTableStatus?.(table, 'ready');
  }
}

/** A `'pending'` status for every table in `config`. */
function initialTables(
  config: DataLoadConfig,
): Record<string, TableLoadStatus> {
  const tables: Record<string, TableLoadStatus> = {};
  for (const table of Object.keys(config)) {
    tables[table] = 'pending';
  }
  return tables;
}

/**
 * Load `config` into `coordinator`, tracking per-table status. Reruns whenever
 * the coordinator identity changes (a recreated connection).
 */
export function useDataLoad(
  coordinator: Coordinator,
  config: DataLoadConfig,
): DataLoadState {
  const [state, setState] = useState<DataLoadState>(() => ({
    tables: initialTables(config),
    error: null,
    done: false,
  }));

  // The config is treated as stable for a given connection; latest-ref it so an
  // inline literal does not retrigger the load on every render. The load reruns
  // only on a new coordinator identity (a recreated connection).
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    let cancelled = false;
    const activeConfig = configRef.current;
    setState({ tables: initialTables(activeConfig), error: null, done: false });

    runDataLoad(coordinator, activeConfig, (table, status) => {
      if (!cancelled) {
        setState((prev) => ({
          ...prev,
          tables: { ...prev.tables, [table]: status },
        }));
      }
    })
      .then(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, done: true }));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err : new Error(String(err)),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coordinator]);

  return state;
}
