# Data loading recipe

Loading a dashboard's tables is app policy, not library machinery — the library provisions a coordinator and stops there. This recipe is the shape that policy takes when you want it to be _data_: a serializable `Record<tableName, DataSource>` config compiles to an **ordered** list of SQL load statements, run sequentially through `coordinator.exec`, with per-table status a component can gate rendering on.

Keeping the source config serializable (plain data — no coordinator, no closures) is deliberate: it can be authored by hand, persisted, or generated, which is the same property that feeds the spec-driven-dashboard direction (issue #131). The reference implementation is [`examples/react/nozzle-paa/src/data-loader.ts`](../../examples/react/nozzle-paa/src/data-loader.ts), gated in [`src/App.tsx`](../../examples/react/nozzle-paa/src/App.tsx) alongside the [connector lifecycle](./connector-lifecycle.md).

## Source config → load statements

A `DataSource` is a discriminated union of the ways a table can be sourced. The config's **insertion order is the load order** — a later entry may reference an earlier table (a `sql` source that joins two parquet tables, say), so order is meaningful and must be preserved.

```ts
/**
 * A table's source. Only the `parquet` variant is exercised by the example;
 * the others show the config's intended shape.
 */
export type DataSource =
  | { type: 'parquet'; url: string }
  | { type: 'csv'; url: string }
  | { type: 'json'; url: string }
  /** Arbitrary SQL body — the compiled statement wraps it in CREATE TABLE. */
  | { type: 'sql'; query: string };

/** Insertion order of the record defines load order. */
export type DataLoadConfig = Record<string, DataSource>;
```

Compile each entry to a `CREATE OR REPLACE TABLE … AS <select>`. The WASM gotcha lives here (see below): relative asset paths are resolved to fully-qualified URLs before reaching `read_parquet`/`read_csv`/`read_json`.

```ts
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
```

### The WASM fully-qualified-URL gotcha

DuckDB-WASM's HTTP filesystem only fetches **fully-qualified** URLs. A relative path like `/data/questions.parquet` handed straight to `read_parquet` fails to fetch inside the WASM build. `toFetchableUrl` resolves it against `window.location.origin` first (`new URL(url, origin).href`), so a config can carry ergonomic relative paths and the loader makes them fetchable. This is the one piece of the load that is WASM-specific; a remote/server connector would not need it.

## Sequential exec with a "Cleared" retry

Run the compiled statements one at a time — **not** in parallel — because later entries may depend on earlier tables existing. Report each table's status as it transitions so the UI can gate on it.

The one race worth handling: if the connector is [recreated](./connector-lifecycle.md) mid-load, Mosaic's `QueryManager` clears its in-flight queue and rejects pending queries with `'Cleared'` (either a bare string or an `Error` carrying that message). By the time that rejection surfaces the reset has settled, so a single retry succeeds:

```ts
export type TableLoadStatus = 'pending' | 'loading' | 'ready' | 'error';

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
```

## The hook: per-table status for render gating

`useDataLoad` runs the load and tracks per-table status. It reruns whenever the **coordinator identity** changes — a recreated connection — so it pairs directly with the connector provider. The config is treated as stable for a given connection (latest-ref'd) so an inline literal does not retrigger the load every render.

```ts
export interface DataLoadState {
  tables: Record<string, TableLoadStatus>; // per-table status
  error: Error | null;
  done: boolean;
}

export function useDataLoad(
  coordinator: Coordinator,
  config: DataLoadConfig,
): DataLoadState {
  const [state, setState] = useState<DataLoadState>(() => ({
    tables: initialTables(config),
    error: null,
    done: false,
  }));

  // Stable-for-a-connection config, latest-ref'd so an inline literal does not
  // retrigger the load on every render.
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
  }, [coordinator]); // reruns on a recreated connection

  return state;
}
```

(`initialTables(config)` just seeds every table name to `'pending'`.)

### Wiring the gate

The bootstrap collapses `useDataLoad`'s state into the app's single status. `done` and `error` are all the shell needs; the per-table `tables` map is there for a granular loading indicator if you want one.

```tsx
const { coordinator, connectionId } = useConnector();
const load = useDataLoad(coordinator, dataLoadConfig);
const status: 'connecting' | 'error' | 'ready' =
  load.error !== null ? 'error' : load.done ? 'ready' : 'connecting';
```

The example renders optimistically — the page shell paints while DuckDB loads, and every client gates its own queries on `enabled={status === 'ready'}` — rather than blocking the whole tree behind the gate. Either shape works; the status is the same. See the [connector lifecycle recipe](./connector-lifecycle.md#gating-and-connection-identity-keying) for how `status` combines with connection-identity keying.

## See also

- [Connector lifecycle](./connector-lifecycle.md) — the coordinator this loads into, connection-identity keying, and the combined status gate.
- [React hooks](./hooks.md#status-semantics) — per-client `enabled`/`status` semantics for optimistic rendering.
- [Filter set](../core/filter-set.md#serializable-state) — the same serializable-data principle applied to filter intent (issue #131 lineage).
- [nozzle-paa](../../examples/react/nozzle-paa) — the wired reference (`src/data-loader.ts`).
