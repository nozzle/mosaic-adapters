import type {
  ClauseSource,
  Coordinator,
  MosaicClient,
  Param,
  Selection,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { Store } from '@tanstack/store';
import type { Persister } from './persistence';
import type { FilterSet } from './filter-set/types';

/**
 * A publish target that routes a widget's interaction into a page-level
 * {@link FilterSet} as a {@link FilterSpec}, rather than directly onto a raw
 * {@link Selection}. The set owns clause publication (including self-exclusion
 * clients and persistence), so a client publishing `into` a set delegates all
 * of that: it upserts/removes one spec keyed by `id` and mirrors external
 * removals back into its local widget state.
 *
 * A client discriminates this from the `{ as: Selection }` form with an
 * `'into' in publish` check (see `isFilterSetPublishTarget`).
 */
export interface FilterSetPublishTarget {
  /** The page-level set that owns the published spec + its clauses. */
  into: FilterSet;
  /** Stable spec id owned by this widget (persistence, chips, replacement). */
  id: string;
  /** Override the default kind the client would otherwise choose. */
  kind?: string;
  /** Spec label pass-through (chip label). */
  label?: string;
}

/**
 * Discriminates a {@link FilterSetPublishTarget} from the raw-Selection
 * (`{ as: Selection }`) publish form by the presence of `into`.
 */
export function isFilterSetPublishTarget(
  publish: { as: Selection } | FilterSetPublishTarget | undefined,
): publish is FilterSetPublishTarget {
  return publish !== undefined && 'into' in publish;
}

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
  /**
   * Native Selection routed to HAVING. Passing the Selection already used as
   * `filterBy` routes its predicate into both WHERE and HAVING on a single
   * re-query per activation — rarely what you want; prefer a separate
   * Selection carrying only aggregate predicates.
   */
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
  /** True once `destroy()` has run; destroyed clients never query again. */
  readonly destroyed: boolean;
  /**
   * The wrapped MosaicClient (built on upstream `makeClient`) — escape hatch
   * for coordinator/vgplot interop.
   */
  readonly mosaicClient: MosaicClient;
}

// ── Coercion ─────────────────────────────────────────────────────────────────

/** Target type for a declaratively coerced column. */
export type CoerceDescriptor = 'date' | 'number' | 'string' | 'boolean';

/**
 * Serializable per-column coercion (`{ date_of_birth: 'date' }`) — the
 * declarative form of the `coerce` closure. Unlisted columns pass through;
 * null/undefined values stay null.
 */
export type CoerceDescriptorMap = Record<string, CoerceDescriptor>;

/**
 * Per-row mapper (raw result values → TRow): a closure, or the serializable
 * descriptor map. Presentational only; held by latest-ref either way.
 */
export type CoerceOption<TRow> =
  | ((raw: Record<string, unknown>) => TRow)
  | CoerceDescriptorMap;

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
  /** Row fields whose values populate the published points. */
  columns: Array<Extract<keyof TRow, string>>;
  /**
   * SQL fields the published predicate tests, aligned index-by-index with
   * `columns`; defaults to `columns`. Dotted paths become struct access
   * (`related_phrase.phrase` → `"related_phrase"."phrase"`). Use this when a
   * row field aliases an expression — e.g. a grouped factory's `key` column
   * standing in for the underlying group-by column.
   */
  fields?: Array<string>;
  /**
   * Stable clause identity that outlives this client instance. By default a
   * client publishes under a private per-instance source and removes its
   * clauses on `destroy()`; with a caller-provided source the clause is
   * retained through `destroy()`, and the next client instance publishing
   * under the same source replaces it. This is what lets row-selection state
   * survive widget remounts (enlarge/collapse swaps, route changes) whose
   * Selections live longer than the component.
   */
  source?: ClauseSource;
}

/**
 * The `publish.select` target routed into a page-level {@link FilterSet}. Row
 * fields (`columns`) supply the selected tuple values; `fields` (defaulting to
 * `columns`) name the SQL columns the published `points` predicate tests —
 * matching the `RowsPublishTarget` `columns`/`fields` semantics. A single
 * field publishes a flat scalar-array value; multiple fields publish a
 * `{ columns, tuples }` envelope.
 */
export type RowsFilterSetPublishTarget<TRow> = FilterSetPublishTarget & {
  /** Row fields whose values populate the published tuples. */
  columns: Array<Extract<keyof TRow, string>>;
  /**
   * SQL fields the predicate tests, aligned index-by-index with `columns`;
   * defaults to `columns`. Dotted paths become struct access.
   */
  fields?: Array<string>;
};

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
   * Optional per-row mapper (raw result values → TRow): a closure or a
   * serializable descriptor map. Presentational only. Held by latest-ref,
   * like the query factory.
   */
  coerce?: CoerceOption<TRow>;
  /** Opt-in row-interaction publishing. */
  publish?: {
    /**
     * selectRows() publishes either directly onto a Selection
     * (`RowsPublishTarget`, `clausePoints(columns, ...)`) or into a page-level
     * {@link FilterSet} (`RowsFilterSetPublishTarget`, as a `points` spec).
     */
    select?: RowsPublishTarget<TRow> | RowsFilterSetPublishTarget<TRow>;
    /**
     * hoverRow() → transient single-point clause (throttled by default).
     * Selection-only: hover is transient by definition, so it is never routed
     * into a FilterSet (nothing to persist, no chip to derive).
     */
    hover?: RowsHoverPublishTarget<TRow>;
  };
  /**
   * Consumer-owned storage for the selected tuples (value arrays aligned to
   * `publish.select.columns`). Hydrated before the first query (sync reads) or
   * on resolve (async reads) via `setSelectedValues`; written on every select
   * publish. Requires the `RowsPublishTarget` (`as`) select form — with
   * `publish.select.into` the set owns persistence, so a client-level
   * persister is warned about and ignored. Hover is never persisted.
   */
  persist?: Persister<Array<Array<unknown>>>;
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
  /**
   * Publish the given tuples (value arrays aligned to `publish.select.columns`)
   * as a point clause; `[]` clears. The tuple-level equivalent of
   * `selectRows` — use it to replay stored intent, where the original row
   * objects no longer exist (e.g. after a reload).
   */
  setSelectedValues: (tuples: Array<Array<unknown>>) => void;
  /** Publish a transient hover clause; `null` clears it. */
  hoverRow: (row: TRow | null) => void;
  /** Swap the coerce mapper (latest-ref semantics; never re-queries). */
  setCoerce: (coerce: CoerceOption<TRow> | undefined) => void;
  /** Warm the coordinator cache (e.g. the next page). */
  prefetch: (inputs: Partial<RowsInputs>) => void;
}

// ── Facet client ─────────────────────────────────────────────────────────────

export interface FacetInputs {
  /** Substring match applied to option values (case-insensitive). */
  search?: string;
  /** Maximum number of options fetched. */
  limit?: number;
}

/** How options are ordered: by descending count, or alphabetically. */
export type FacetSortMode = 'count' | 'alpha';

export interface FacetClientOptions extends DataClientOptions<FacetInputs> {
  /** Base relation the options are read from (typically shared with a rows client). */
  from: QuerySource<FacetInputs>;
  /** Column whose distinct values become the options. */
  column: string;
  /**
   * The column is a DuckDB list/array (e.g. `VARCHAR[]`): options explode
   * the values via `unnest()`, and published clauses match rows whose list
   * contains any selected value (`list_has_any`).
   */
  arrayColumn?: boolean;
  /** COUNT(*) per value. @default true */
  counts?: boolean;
  /**
   * @default 'count' — falls back to 'alpha' when `counts` is false.
   */
  sort?: FacetSortMode;
  /**
   * 'single' (default): `toggle(value)` replaces the active value, toggling
   * the active value clears. 'multi': `toggle(value)` adds/removes it from
   * the selected set, published as one list clause.
   */
  select?: 'single' | 'multi';
  /**
   * toggle()/clear() publish either directly onto a Selection (`{ as }`) or
   * into a page-level {@link FilterSet} (`FilterSetPublishTarget`). The set
   * form defaults to `point` (single) / `points` (multi) / `condition` with
   * `list_has_any` (array column); `publish.kind` overrides the choice.
   */
  publish?: { as: Selection } | FilterSetPublishTarget;
  /**
   * Consumer-owned storage for the selected values. Hydrated before the first
   * query (sync reads) or on resolve (async reads); written on every publish.
   * Requires the `{ as }` publish form — with `publish.into` the set owns
   * persistence, so a client-level persister is warned about and ignored.
   */
  persist?: Persister<Array<unknown>>;
}

export interface FacetOption {
  value: unknown;
  /** Present when `counts` is enabled. */
  count?: number;
}

export interface FacetClientState extends DataClientState<FacetInputs> {
  options: Array<FacetOption>;
  /** Values active in this client's published clause. */
  selected: Array<unknown>;
}

export interface FacetClient extends DataClient<FacetInputs, FacetClientState> {
  /** Toggle a value in/out of the published clause; `null` clears. */
  toggle: (value: unknown) => void;
  /**
   * Replace the selection wholesale and publish. In `select: 'single'` mode
   * keeps at most the first value. `[]` clears. Use this to replay stored
   * intent (persistence, router search params).
   */
  setSelected: (values: Array<unknown>) => void;
  clear: () => void;
}

// ── Histogram client ─────────────────────────────────────────────────────────

export interface HistogramInputs {
  /** Exact bin width. */
  step?: number;
  /** Desired number of bins (a hint — steps snap to nice numbers). */
  bins?: number;
}

export interface HistogramClientOptions extends DataClientOptions<HistogramInputs> {
  /** Base relation the bins are computed over. */
  from: QuerySource<HistogramInputs>;
  /** Numeric column to bin. */
  column: string;
  /**
   * Scale transform used to space bin boundaries. `log` bins uniformly in log
   * space and ignores non-positive values during extent discovery/querying.
   * Defaults to `linear`.
   */
  scale?: 'linear' | 'log';
  /**
   * Fixed [min, max] domain for bin boundaries. When omitted, the client
   * discovers it once from the unfiltered base relation during `prepare`,
   * so bin boundaries stay stable while filters change the counts.
   */
  extent?: [number, number];
  /**
   * setRange() publishes either directly onto a Selection (`{ as }`) or into a
   * page-level {@link FilterSet} (`FilterSetPublishTarget`, as an `interval`
   * spec by default; `publish.kind` overrides the choice).
   */
  publish?: { as: Selection } | FilterSetPublishTarget;
  /**
   * Consumer-owned storage for the brush range. Hydrated after extent
   * discovery but before the first main query (sync reads) or on resolve
   * (async reads); written on every publish. Requires the `{ as }` publish
   * form — with `publish.into` the set owns persistence, so a client-level
   * persister is warned about and ignored.
   */
  persist?: Persister<[number, number]>;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface HistogramClientState extends DataClientState<HistogramInputs> {
  /** Contiguous bins across the extent; empty bins carry count 0. */
  bins: Array<HistogramBin>;
  maxCount: number;
  /** Bin domain in effect (fixed or discovered). */
  extent: [number, number] | null;
  /** Currently published brush range. */
  range: [number, number] | null;
}

export interface HistogramClient extends DataClient<
  HistogramInputs,
  HistogramClientState
> {
  /** Publish [lo, hi] as an interval clause; `null` clears. */
  setRange: (range: [number, number] | null) => void;
}

// ── Sparkline client ─────────────────────────────────────────────────────────

export interface SparklineInputs {
  /**
   * Series to fetch, typically derived from a rows client's visible page.
   * One batched query serves every key: `WHERE key IN (…) GROUP BY key, x`.
   */
  keys?: Array<unknown>;
}

/** X dimension — declarative: raw column, numeric bin, or date bin. */
export interface SparklineX {
  column: string;
  /** Numeric bin width: x collapses to `floor(x / step) * step`. */
  step?: number;
  /** Date bin unit (DuckDB `time_bucket`). Takes precedence over `step`. */
  interval?: 'hour' | 'day' | 'week' | 'month' | 'year';
}

/** Y measure — declarative aggregate (serializability constraint). */
export interface SparklineY {
  agg: 'count' | 'sum' | 'avg' | 'min' | 'max';
  /** Aggregated column; required for every agg except 'count'. */
  column?: string;
}

export interface SparklineClientOptions extends DataClientOptions<SparklineInputs> {
  from: QuerySource<SparklineInputs>;
  /** Column whose values key each series. */
  key: string;
  x: SparklineX;
  y: SparklineY;
}

export interface SparklinePoint {
  x: number | Date;
  y: number;
}

export interface SparklineClientState extends DataClientState<SparklineInputs> {
  series: Map<unknown, Array<SparklinePoint>>;
}

export type SparklineClient = DataClient<SparklineInputs, SparklineClientState>;

// ── Rollup client ────────────────────────────────────────────────────────────

/** The rollup client fetches the whole tree; it carries no serializable inputs. */
export type RollupInputs = Record<string, never>;

export interface RollupClientOptions<
  TRow,
> extends DataClientOptions<RollupInputs> {
  /**
   * Aggregate select over the base relation — no groupby: the client owns
   * `GROUP BY ROLLUP(...)`, the `GROUPING()` level tag, and the tree order.
   */
  query: QuerySource<RollupInputs>;
  /** Hierarchy levels, outermost first. */
  groupBy: Array<string>;
  /** Optional per-row mapper (closure or descriptor map). Latest-ref. */
  coerce?: CoerceOption<TRow>;
}

export interface RollupRow<TRow> {
  data: TRow;
  /** 0 = grand total; groupBy.length = leaf. */
  level: number;
  /** Group values down to this row's level — a stable expansion key. */
  groupPath: Array<string>;
  isLeaf: boolean;
}

export interface RollupClientState<TRow> extends DataClientState<RollupInputs> {
  /** Flat, pre-ordered (parents before children); see `rollupRowsToTree`. */
  rows: Array<RollupRow<TRow>>;
}

export interface RollupClient<TRow> extends DataClient<
  RollupInputs,
  RollupClientState<TRow>
> {
  /** Swap the coerce mapper (latest-ref semantics; never re-queries). */
  setCoerce: (coerce: CoerceOption<TRow> | undefined) => void;
}

/** Pure tree view over the flat pre-ordered rollup rows. */
export interface RollupTreeNode<TRow> {
  row: RollupRow<TRow>;
  children: Array<RollupTreeNode<TRow>>;
}

// ── Pivot client ─────────────────────────────────────────────────────────────

/** Declarative aggregate populating pivot cells (serializability constraint). */
export interface PivotAggregate {
  agg: 'count' | 'sum' | 'avg' | 'min' | 'max';
  /** Aggregated column; required for every agg except 'count'. */
  column?: string;
  /** Output alias — with multiple aggregates, DuckDB suffixes pivot columns with it. */
  as?: string;
}

export interface PivotClientOptions<
  TRow,
> extends DataClientOptions<RowsInputs> {
  /** Base relation to pivot (filtered via the query context). */
  from: QuerySource<RowsInputs>;
  /** Column whose distinct values become the pivot output columns. */
  on: string;
  /** Aggregates populating the cells. */
  using: Array<PivotAggregate>;
  /** Row-group columns. */
  groupBy: Array<string>;
  /**
   * Fixed pivot values (`PIVOT ... IN (...)`). When omitted, DuckDB
   * discovers the columns from the data and the client surfaces them as
   * `pivotColumns` from the result schema.
   */
  in?: Array<unknown>;
  /** Optional per-row mapper (closure or descriptor map). Latest-ref. */
  coerce?: CoerceOption<TRow>;
}

export interface PivotClientState<TRow> extends DataClientState<RowsInputs> {
  rows: Array<TRow>;
  /** Result columns that are not `groupBy` columns — discovered per query. */
  pivotColumns: Array<string>;
}

export interface PivotClient<TRow> extends DataClient<
  RowsInputs,
  PivotClientState<TRow>
> {
  /** Swap the coerce mapper (latest-ref semantics; never re-queries). */
  setCoerce: (coerce: CoerceOption<TRow> | undefined) => void;
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
