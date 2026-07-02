import type {
  Coordinator,
  MosaicClient,
  Param,
  Selection,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { Store } from '@tanstack/store';

/**
 * Where a client's data comes from: a table name, or a query factory that
 * receives resolved filter predicates plus the current inputs.
 *
 * The factory is held by latest-ref: swapping it (via `setQuery`) never
 * triggers a re-query on its own; the next query — whatever triggers it —
 * is built from the latest factory.
 */
export type QuerySource<TInputs extends object> =
  | string
  | ((ctx: QueryContext<TInputs>) => SelectQuery);

export interface QueryContext<TInputs extends object> {
  /**
   * `filterBy.predicate(client)` — self-excluded; `[]` when unfiltered, so
   * factories can pass it to `.where(...)` unconditionally.
   */
  where: FilterExpr;
  /** `havingBy.predicate(client)` — the WHERE/HAVING routing extension; `[]` when empty. */
  having: FilterExpr;
  /** Current serializable inputs. Only consume these with `inputMode: 'manual'`. */
  inputs: TInputs;
}

export type DataClientStatus = 'idle' | 'pending' | 'success' | 'error';

/** Base store shape; every specialization extends it. */
export interface DataClientState<TInputs extends object> {
  status: DataClientStatus;
  error: Error | null;
  /** Echo of what the last executed query was built from — never a source of truth. */
  inputs: TInputs;
  /** SQL of the last executed main query (observability). */
  lastQuery: string | null;
}

export interface DataClientOptions<TInputs extends object> {
  coordinator: Coordinator;
  /** Native Selection routed to WHERE. */
  filterBy?: Selection;
  /** Native Selection routed to HAVING. */
  havingBy?: Selection;
  /**
   * Params the query factory reads. A 'value' event on any of them triggers
   * exactly one re-query (upstream never does this automatically — it is
   * first-class here).
   */

  params?: Record<string, Param<any>>;
  inputs?: TInputs;
  /**
   * How inputs become SQL:
   * - 'append' (default): the client appends the SQL derived from inputs
   *   (rows: ORDER BY / LIMIT / OFFSET) after the factory's base query.
   * - 'manual': the factory consumes `ctx.inputs` itself; the client appends
   *   nothing.
   */
  inputMode?: 'append' | 'manual';
  /** Passed through to MosaicClient; gates pre-aggregation. Default true. */
  filterStable?: boolean;
  enabled?: boolean;
}

export interface DataClient<
  TInputs extends object,
  TState extends DataClientState<TInputs>,
> {
  /** Read `store.state`, subscribe via `store.subscribe` (@tanstack/store). */
  readonly store: Store<TState>;
  /**
   * Swap the query factory (latest-ref semantics). Never re-queries by
   * itself; the next trigger uses the new factory.
   */
  setQuery: (query: QuerySource<TInputs>) => void;
  /** Merge-patch; triggers exactly one re-query iff something changed (value-diffed). */
  setInputs: (patch: Partial<TInputs>) => void;
  setEnabled: (enabled: boolean) => void;
  /** Force a re-query with current inputs/filters. */
  refetch: () => Promise<void>;
  destroy: () => void;
  /**
   * The wrapped MosaicClient (built on upstream `makeClient`) — escape hatch
   * for coordinator/vgplot interop.
   */
  readonly mosaicClient: MosaicClient;
}

// ── Rows client ──────────────────────────────────────────────────────────────

export interface OrderByItem {
  column: string;
  desc?: boolean;
  nullsFirst?: boolean;
}

export interface RowsInputs {
  orderBy?: Array<OrderByItem>;
  limit?: number;
  offset?: number;
}

/**
 * How totalRows is produced:
 * - 'window': COUNT(*) OVER () appended to the main query (one round trip).
 *   Requires inputMode 'append' (the client must own the LIMIT wrapper).
 * - 'query': separate COUNT(*) query sharing the same WHERE/HAVING.
 * - 'none': totalRows stays undefined.
 */
export type RowCountMode = 'window' | 'query' | 'none';

export interface RowsPublishTarget<TRow> {
  /** Selection that receives the published clause. */
  as: Selection;
  /** Row fields (SQL columns) that identify a row inside the clause predicate. */
  columns: Array<Extract<keyof TRow, string>>;
}

export interface RowsHoverPublishTarget<TRow> extends RowsPublishTarget<TRow> {
  /**
   * Trailing throttle for hover clause churn at mouse speed, in
   * milliseconds. `0` disables throttling. Default 50.
   */
  throttleMs?: number;
}

export interface RowsClientOptions<TRow> extends DataClientOptions<RowsInputs> {
  query: QuerySource<RowsInputs>;
  /** @default 'none' */
  rowCount?: RowCountMode;
  /**
   * Optional per-row mapper (raw result values → TRow). Presentational only.
   * Held by latest-ref, like the query factory.
   */
  coerce?: (raw: Record<string, unknown>) => TRow;
  /** Opt-in row-interaction publishing. */
  publish?: {
    /** selectRows() → clausePoints(columns, ...) into this Selection. */
    select?: RowsPublishTarget<TRow>;
    /** hoverRow() → transient single-point clause (throttled by default). */
    hover?: RowsHoverPublishTarget<TRow>;
  };
}

export interface RowsClientState<TRow> extends DataClientState<RowsInputs> {
  rows: Array<TRow>;
  totalRows: number | undefined;
}

export interface RowsClient<TRow> extends DataClient<
  RowsInputs,
  RowsClientState<TRow>
> {
  /** Publish the given rows as a point clause; `[]` clears the clause. */
  selectRows: (rows: Array<TRow>) => void;
  /** Publish a transient hover clause; `null` clears it. */
  hoverRow: (row: TRow | null) => void;
  /** Swap the coerce mapper (latest-ref semantics; never re-queries). */
  setCoerce: (
    coerce: ((raw: Record<string, unknown>) => TRow) | undefined,
  ) => void;
  /** Warm the coordinator cache (e.g. the next page). */
  prefetch: (inputs: Partial<RowsInputs>) => void;
}

// ── Values client ─────────────────────────────────────────────────────────────

/** The values client carries no serializable inputs. */
export type ValuesInputs = Record<string, never>;

export interface ValuesClientOptions extends DataClientOptions<ValuesInputs> {
  /** Must resolve to a single-row query; every selected column becomes a field. */
  query: QuerySource<ValuesInputs>;
}

export interface ValuesClientState<
  TValues extends Record<string, unknown>,
> extends DataClientState<ValuesInputs> {
  values: TValues | undefined;
}

export type ValuesClient<TValues extends Record<string, unknown>> = DataClient<
  ValuesInputs,
  ValuesClientState<TValues>
>;
