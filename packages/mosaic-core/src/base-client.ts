import { Store } from '@tanstack/store';
import { makeClient, throttle } from '@uwdata/mosaic-core';
import type { MosaicClient, QueryError, Selection, SelectionClause } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import type { FilterExpr, Query as MosaicQuery, SelectQuery } from '@uwdata/mosaic-sql';

import { mirrorClientMeta } from './client-meta';
import type { DataClientMeta } from './client-meta';
import { isDevelopment as isExplicitDevelopment } from './dev';
import { freezeQuerySql } from './freeze-query';
import { isQueryCancellation } from './query-error';
import {
  assertQuerySource,
  dottedTableNameWarning,
  isDevelopment,
  isDottedTableName,
} from './query-source';
import { createSkipProjectedSelection } from './skip-projection';
import type {
  DataClient,
  DataClientOptions,
  DataClientSettled,
  DataClientState,
  QueryContext,
  QueryPreview,
  QueryPreviewOptions,
  QuerySource,
} from './types';
import { deepEqual } from './utils';

/**
 * Whether a coalesced re-query can ride upstream's animation-frame throttle.
 *
 * False outside browsers (no `requestAnimationFrame`) and while the document
 * is hidden: browsers pause animation frames in hidden tabs and occluded
 * windows, so a frame-throttled re-query would stall until the tab is shown
 * again. A `requestAnimationFrame` without a `document` (dedicated workers)
 * keeps the frame path.
 */
function canUseAnimationFrame(): boolean {
  if (typeof requestAnimationFrame !== 'function') {
    return false;
  }
  if (typeof document === 'undefined') {
    return true;
  }
  return document.visibilityState !== 'hidden';
}

/**
 * A main-query request the coordinator has marked pending: its identity plus
 * the provenance (`DataClientState.settled`) its response would carry.
 */
interface InflightRequest<TInputs extends object> {
  id: number;
  /** Built SQL, or `null` for a query this class did not build (pre-aggregation). */
  sql: string | null;
  inputs: TInputs;
  /** Whether the coordinator answers it from a pre-aggregated materialized view. */
  preaggregated: boolean;
}

/**
 * Which predicates a user query factory received while one main query was
 * built, and which of them it read (the development-only ignored-filter
 * warning; see `#warnIgnoredPredicates`).
 */
interface PredicateUse {
  whereActive: boolean;
  whereRead: boolean;
  havingActive: boolean;
  havingRead: boolean;
}

/**
 * Framework-agnostic base for every data client: wraps upstream
 * `makeClient`, projects the query lifecycle onto a reactive store, wires
 * Params and the HAVING-routed Selection to re-queries, and holds the query
 * factory by latest-ref.
 *
 * Re-query triggers are exactly: inputs change, Selection activation,
 * Param change, `refetch()`, `invalidate()`.
 *
 * Input-driven triggers (`setInputs`, Param `'value'`, `havingBy` `'value'`,
 * and `filterBy` `'value'` on a client that cannot pre-aggregate — see
 * `#wireFilterBy`) and `invalidate()` are coalesced — a burst of synchronous
 * changes in one tick collapses into a single query build instead of one
 * full query per event. In a visible
 * browser tab this rides upstream `MosaicClient.requestUpdate()`
 * (animation-frame throttle); in hidden tabs and outside browsers a
 * core-owned macrotask fallback coalesces (see `#requestCoalescedUpdate`).
 * `refetch()` (and any user-explicit re-query) stays immediate via
 * `requestQuery()`.
 *
 * Every trigger supersedes the in-flight main query: only the response to
 * the most recent request reaches the store (see `#settle`).
 */
export abstract class BaseDataClient<
  TInputs extends object,
  TState extends DataClientState<TInputs>,
> implements DataClient<TInputs, TState> {
  readonly store: Store<TState>;

  protected readonly options: DataClientOptions<TInputs>;
  protected inputs: TInputs;

  #querySource: QuerySource<TInputs>;
  #client: MosaicClient;
  /**
   * The Selections the coordinator and the HAVING wiring actually observe.
   * Identical to `options.filterBy`/`options.havingBy` unless `skipSources`
   * is non-empty, in which case each is a skip-projected derivation (see
   * `skip-projection.ts`) so skipped-only changes never reach the coordinator.
   */
  readonly #filterBy: Selection | undefined;
  readonly #havingBy: Selection | undefined;
  /**
   * True when `filterBy` re-queries through this client's coalesced batch
   * (`#wireFilterBy`) rather than upstream `Coordinator.updateSelection`:
   * a `filterBy` Selection, pre-aggregation off, and `coalesceFilterBy` not
   * set to `false`.
   */
  readonly #coalesceFilterBy: boolean;
  #destroyed = false;
  /** The dotted-table-name warning fires at most once per client. */
  #warnedDottedSource = false;
  #teardown: Array<() => void> = [];
  /**
   * Whether the pending coalesced batch holds a trigger other than a
   * coalesced `filterBy` change (inputs, a Param, `havingBy`,
   * `invalidate()`). Read and reset by `#flushCoalesced`: a batch of
   * `filterBy` changes alone is issued without clearing the coordinator's
   * pre-aggregation state, any other batch through upstream `requestQuery`.
   */
  #batchHasNonSelectionTrigger = false;
  /** Pending macrotask flush for the hidden-tab / non-browser coalescing fallback. */
  #coalesceHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Request-identity bookkeeping for the current-request guarantee (see
   * `#settle`). `#inflight` is the FIFO of main-query requests the coordinator
   * has marked pending but not yet settled; `#latestRequest` is the id of the
   * request whose result the store is waiting on (or of the most recent
   * "nothing to fetch" round, which supersedes every in-flight request).
   */
  #requestSeq = 0;
  #latestRequest = 0;
  #inflight: Array<InflightRequest<TInputs>> = [];
  /**
   * SQL and inputs of the most recently built main query, attributed to the
   * next request at `queryPending` (`null` once attributed, or after an empty
   * round). Not every build is submitted: the coordinator's pre-aggregation
   * optimizer also builds the query to analyze it (see `#isPreaggregated`).
   */
  #lastBuilt: { sql: string; inputs: TInputs } | null = null;
  /**
   * Set when a pre-aggregated request fails: upstream then retries the same
   * selection update with this client's own query (`updateSelection`), which
   * the next `queryPending` must attribute to its build (see
   * `#isPreaggregated`).
   */
  #preaggFallback = false;

  /** Consumer-owned debugging metadata, held by latest-ref (`setMeta`). */
  #meta: DataClientMeta | undefined;
  /**
   * Predicate reads of the user query factory during the main-query build in
   * progress; `null` outside a build, in production, and once the
   * ignored-filter warning has fired (see `#warnIgnoredPredicates`).
   */
  #predicateUse: PredicateUse | null = null;
  #warnedIgnoredPredicates = false;
  /** True while `previewQuery` builds (see `previewing`). */
  #previewing = false;

  protected constructor(
    options: DataClientOptions<TInputs>,
    query: QuerySource<TInputs>,
    payload: Omit<TState, keyof DataClientState<TInputs>>,
    hooks?: {
      /**
       * Runs once during client initialization, before the first query
       * (upstream `MosaicClient.prepare`) — for one-time discovery queries
       * such as bin extents. Deferred while the client is disabled.
       */
      prepare?: () => Promise<void>;
    },
  ) {
    this.options = options;
    assertQuerySource(query);
    this.#querySource = query;
    this.#warnOnDottedSource(query);
    this.#meta = options.meta;
    this.inputs = options.inputs ?? ({} as TInputs);

    this.store = new Store({
      status: 'idle',
      error: null,
      inputs: this.inputs,
      lastQuery: null,
      settled: null,
      ...payload,
    } as TState);

    this.#filterBy = this.#project(options.filterBy);
    this.#havingBy =
      options.havingBy === options.filterBy ? this.#filterBy : this.#project(options.havingBy);

    // A non-empty `skipSources` forces pre-aggregation off: the optimizer
    // re-applies the active clause independent of the `query` callback
    // (upstream `PreAggregator`), so a skipped active clause would otherwise
    // leak back into the materialized-view query.
    const filterStable = this.#skipping() ? false : (options.filterStable ?? true);
    this.#coalesceFilterBy =
      this.#filterBy !== undefined && !filterStable && options.coalesceFilterBy !== false;

    const prepare = hooks?.prepare;
    this.#client = makeClient({
      coordinator: options.coordinator,
      // A coalesced `filterBy` is withheld from the coordinator so it never
      // joins a filter group (no `updateSelection` re-query); `#wireFilterBy`
      // re-queries instead.
      selection: this.#coalesceFilterBy ? undefined : this.#filterBy,
      enabled: options.enabled ?? true,
      filterStable,
      // makeClient connects (and may initialize) synchronously inside this
      // constructor; defer the hook one microtask so it runs against a fully
      // constructed subclass. The coordinator awaits the returned promise
      // before issuing the first query either way. The client can be destroyed
      // within that microtask window (a React StrictMode or fast unmount/remount
      // discards the first client before its deferred hook runs); a destroyed
      // client must not re-key adopted FilterSet clauses to its own about-to-die
      // MosaicClient, so short-circuit the hook here.
      prepare: prepare
        ? () =>
            Promise.resolve().then(() => {
              if (this.#destroyed) {
                return undefined;
              }
              return prepare();
            })
        : undefined,
      // Upstream types the filter as always-present, but `requestQuery()`
      // passes undefined when the active clause cross-filters this client.
      // On selection-driven updates the coordinator computes the predicate
      // from `#filterBy` — already skip-projected — so it is used as-is.
      query: (filter: FilterExpr | null | undefined) => this.#materialize(this.#whereFor(filter)),
      queryPending: () => {
        if (this.#destroyed) {
          return;
        }
        const id = this.#nextRequestId();
        const built = this.#lastBuilt;
        const preaggregated = this.#isPreaggregated(built !== null);
        this.#lastBuilt = null;
        this.#preaggFallback = false;
        // A request with nothing attributed — a pre-aggregated update, which
        // queries a materialized view rather than a query built here (any
        // build since the last request was the optimizer's analysis) —
        // answers the current inputs; its SQL is unknown.
        if (preaggregated || built === null) {
          this.#inflight.push({ id, sql: null, inputs: this.inputs, preaggregated });
        } else {
          this.#inflight.push({ id, sql: built.sql, inputs: built.inputs, preaggregated });
        }
        this.patchState({ status: 'pending' } as Partial<TState>);
      },
      queryResult: (data) => {
        if (this.#destroyed) {
          return;
        }
        // Successful results are fulfilled in request order (see `#settle`),
        // so the oldest in-flight request is the one that just completed.
        const request = this.#inflight.shift();
        if (!this.#settle(request)) {
          return;
        }
        this.patchState({
          status: 'success',
          error: null,
          settled: settledFrom(request, this.inputs),
          ...this.onResult(data),
        });
      },
      // Mosaic 0.30 wraps main-query failures in QueryError (a subclass of
      // Error carrying `.sql`/`.cause`) before dispatch. It lands on the store
      // intact; `state.error` stays typed `Error | null` so consumers narrow.
      queryError: (error: QueryError) => {
        if (this.#destroyed) {
          return;
        }
        // Errors reject immediately rather than in request order, so match the
        // failed request by its SQL; fall back to FIFO when nothing matches.
        const request = this.#takeInflight(error.sql);
        if (request?.preaggregated === true) {
          this.#preaggFallback = true;
        }
        if (!this.#settle(request)) {
          return;
        }
        // `coordinator.cancel()`/`clear()` reject the current request with
        // 'Canceled'/'Cleared'. Nothing failed, so the store keeps its
        // `'pending'` status (and `error`) until the next trigger rather than
        // advertising an error (see `isQueryCancellation`).
        if (isQueryCancellation(error)) {
          return;
        }
        // Widened to Error first: `as Partial<TState>` on a QueryError-typed
        // property fails the comparability check against the generic TState.
        const stateError: Error = error;
        this.patchState({
          status: 'error',
          error: stateError,
        } as Partial<TState>);
      },
    });

    // Coordinator-level observers only see the MosaicClient; the getter
    // always reads the latest `meta`, so `setMeta` needs no re-mirroring.
    mirrorClientMeta(this.#client, () => this.#meta);

    if (this.#coalesceFilterBy) {
      // Withheld from the coordinator above, but still reported as the
      // client's filter Selection to `mosaicClient` interop. Assigned after
      // `makeClient` connected, so no filter group is created for it; the
      // first query runs after `prepare`, by which time this is set. This
      // relies on upstream `Coordinator.connect` reading `client.filterBy`
      // synchronously (re-verify on upstream bumps).
      this.#client._filterBy = this.#filterBy;
      // Upstream's frame throttle flushes through `requestQuery`, which
      // clears the coordinator-wide pre-aggregation state; a batch of
      // `filterBy` changes alone must not (see `#flushCoalesced`). Same
      // throttle, same debounce, different flush.
      this.#client._requestUpdate = throttle(() => this.#flushCoalesced(), true);
    }

    this.#wireParams();
    this.#wireFilterBy();
    this.#wireHavingBy();
  }

  get mosaicClient(): MosaicClient {
    return this.#client;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get meta(): DataClientMeta | undefined {
    return this.#meta;
  }

  setMeta(meta: DataClientMeta | undefined): void {
    this.#meta = meta;
  }

  /**
   * Build the main query (and any side-channel COUNT query) for the current
   * filters and inputs, or the given overrides, without issuing anything.
   *
   * Pure with respect to the client: no store patch, no request bookkeeping,
   * no `afterQueryBuilt` (so no COUNT query is issued), and no
   * ignored-filter warning. Specializations gate any build-time state on
   * `previewing`. WHERE/HAVING default to what a client-initiated query
   * (`refetch()`) would resolve right now.
   */
  previewQuery(options?: QueryPreviewOptions<TInputs>): QueryPreview {
    const current = this.currentContext();
    const ctx: QueryContext<TInputs> = {
      where: options?.where ?? current.where,
      having: options?.having ?? current.having,
      inputs: { ...this.inputs, ...options?.inputs },
    };
    this.#previewing = true;
    try {
      const main = this.buildQuery(ctx);
      const count = this.buildCountQuery(ctx);
      return {
        main: main === null ? null : String(main),
        count: count === null ? null : String(count),
      };
    } finally {
      this.#previewing = false;
    }
  }

  setQuery(query: QuerySource<TInputs>): void {
    assertQuerySource(query);
    this.#querySource = query;
    this.#warnOnDottedSource(query);
  }

  /**
   * Development-only hint, once per client: a plain-string source with a dot
   * renders as ONE quoted table name, which is rarely what `'main.events'`
   * meant. The string is never split automatically, because a quoted table
   * name can legitimately contain dots — a `TableRefNode` says which.
   */
  #warnOnDottedSource(query: QuerySource<TInputs>): void {
    if (this.#warnedDottedSource || !isDottedTableName(query)) {
      return;
    }
    if (!isDevelopment()) {
      return;
    }
    this.#warnedDottedSource = true;
    console.warn(dottedTableNameWarning(query));
  }

  setInputs(patch: Partial<TInputs>): void {
    if (this.#destroyed) {
      return;
    }
    const next = { ...this.inputs, ...patch };
    if (deepEqual(next, this.inputs)) {
      return;
    }
    this.inputs = next;
    this.#requestCoalescedUpdate();
  }

  setEnabled(enabled: boolean): void {
    if (this.#destroyed) {
      return;
    }
    this.#client.enabled = enabled;
  }

  async refetch(): Promise<void> {
    if (this.#destroyed) {
      return;
    }
    this.onRefetch();
    // An explicit refetch queries with the latest state immediately; a
    // pending coalesced flush would only issue the same query again.
    this.#cancelCoalescedUpdate();
    const request = this.#client.requestQuery();
    if (request) {
      await request;
    }
  }

  invalidate(): void {
    if (this.#destroyed) {
      return;
    }
    // Same coalesced path as `setInputs`, so an `invalidate()` in the same
    // tick as an inputs change (the hooks' `queryKey`) issues one query. No
    // `onRefetch()`: query-derived memos key on the SQL they derive from, so
    // a recompiled query re-runs them by itself and an unchanged one need not.
    this.#requestCoalescedUpdate();
  }

  /**
   * Coalesce an input-driven re-query so a burst of synchronous triggers in
   * one tick (page-spam, dragged slider Params) collapses into a single query
   * build, rather than one full query per event as `requestQuery()` would
   * issue.
   *
   * The coordinator only calls `queryPending()` when the coalesced query
   * actually runs (a beat later, once the flush fires), so patch a local
   * `'pending'` status synchronously here to keep loading indicators
   * responsive — preserving the same-tick pending signal that the previous
   * immediate `requestQuery()` produced via `updateClient`. Skipped while the
   * client is disabled: upstream defers the request until re-enable and never
   * marks it pending, so the store must not strand itself in `'pending'`.
   *
   * In a visible browser tab this delegates to upstream
   * `MosaicClient.requestUpdate()`, whose throttle debounces on
   * `requestAnimationFrame` — Mosaic's default, kept unchanged. Upstream's
   * throttle calls `requestAnimationFrame` unconditionally with no fallback
   * (it is a browser view-layer entry point), so this class owns a macrotask
   * fallback for the two cases where no frame will arrive in time:
   *
   * - environments without `requestAnimationFrame` (Node);
   * - hidden tabs (`document.visibilityState === 'hidden'`), where browsers
   *   pause animation frames, so a frame-throttled re-query would stay
   *   `'pending'` until the tab is shown again.
   *
   * The fallback is one `setTimeout` flush per tick, with the flush reading
   * the latest state (last inputs win). Its handle is cancelled by
   * `refetch()` (an explicit refetch already queries with the latest state,
   * so the pending flush would only duplicate it) and by `destroy()`.
   *
   * Known edges, accepted as low severity (results stay correct, one extra
   * query at most): upstream's throttle exposes no cancel, so in the frame
   * path an interleaved `refetch()` plus a pending throttle flush can produce
   * one redundant query; a frame already scheduled just before the tab hides
   * still waits until the tab is visible; and a hidden-tab timer flush plus
   * that late frame can produce one duplicate query on return to the tab.
   * The reverse order is covered: while a fallback flush is pending, later
   * triggers join it rather than also requesting a frame, even if the tab
   * has become visible in between.
   */
  #requestCoalescedUpdate(trigger: 'selection' | 'other' = 'other'): void {
    if (trigger === 'other') {
      this.#batchHasNonSelectionTrigger = true;
    }
    if (this.#client.enabled) {
      // The coalesced request is now the one the store waits on; a result
      // from an older in-flight request landing before the flush fires must
      // not report success for the newer inputs (see `#settle`).
      this.#nextRequestId();
      this.patchState({ status: 'pending' } as Partial<TState>);
    }
    if (this.#coalesceHandle !== null) {
      // A fallback flush is already pending and reads the latest state when
      // it fires, so it covers this trigger too — even if the tab became
      // visible meanwhile (avoids a second, frame-throttled query).
      return;
    }
    if (canUseAnimationFrame()) {
      this.#client.requestUpdate();
      return;
    }
    this.#coalesceHandle = setTimeout(() => {
      this.#coalesceHandle = null;
      void this.#flushCoalesced();
    });
  }

  /**
   * Issue the coalesced query (the frame throttle and the macrotask fallback
   * both land here). Reads the latest state.
   *
   * A batch holding only coalesced `filterBy` changes is issued the way
   * upstream `Coordinator.updateSelection` issues a standard selection
   * update — `coordinator.updateClient(client, query)` — rather than through
   * `MosaicClient.requestQuery` → `Coordinator.requestQuery`, which clears
   * the coordinator-wide pre-aggregation state. Clearing would wipe every
   * eligible sibling's materialized table on each brush move and rebuild it
   * on the next; this client never holds an entry of its own (pre-aggregation
   * is off for it, and it is in no filter group), so it has nothing to clear.
   *
   * Every other batch (inputs, Params, `havingBy`, `invalidate()`, alone or
   * mixed with a `filterBy` change), a client on the upstream `filterBy`
   * path, and a disabled client (upstream records the request and runs it on
   * re-enable, as `updateSelection` does) go through upstream `requestQuery`,
   * as before.
   */
  #flushCoalesced(): Promise<unknown> | null {
    const nonSelection = this.#batchHasNonSelectionTrigger;
    this.#batchHasNonSelectionTrigger = false;
    if (this.#destroyed) {
      return null;
    }
    if (nonSelection || !this.#coalesceFilterBy || !this.#client.enabled) {
      return this.#client.requestQuery();
    }
    const coordinator = this.#client.coordinator;
    if (!coordinator) {
      // Mirrors `requestQuery`: a concurrent teardown disconnected it.
      return null;
    }
    const query = this.#client.query();
    if (!query) {
      return Promise.resolve(this.#client.update());
    }
    return coordinator.updateClient(this.#client, query);
  }

  /** Cancel a pending fallback (hidden-tab / non-browser) coalescing flush, if any. */
  #cancelCoalescedUpdate(): void {
    if (this.#coalesceHandle === null) {
      return;
    }
    clearTimeout(this.#coalesceHandle);
    this.#coalesceHandle = null;
    this.#batchHasNonSelectionTrigger = false;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#cancelCoalescedUpdate();
    const teardown = this.#teardown;
    this.#teardown = [];
    for (const dispose of teardown) {
      dispose();
    }
    this.#client.destroy();
  }

  /**
   * Build the full main query for the given context (specializations append
   * their input-derived SQL here). Returning `null` signals "nothing to
   * fetch" — `#materialize` publishes the specialization's `onEmpty()`
   * payload and skips the round trip instead of issuing a query.
   *
   * CONTRACT: returning `null` is only safe for clients WITHOUT a `filterBy`
   * Selection. Every trigger this base class owns (initialize, `setInputs`,
   * `refetch`, Params, `havingBy`, a coalesced `filterBy`) flows through
   * upstream `MosaicClient.requestQuery()` or `#flushCoalesced`, both of
   * which null-guard the query — but
   * upstream `Coordinator.updateSelection` (the `filterBy` 'value' listener
   * for clients that can pre-aggregate or set `coalesceFilterBy: false`)
   * calls `client.query(filter)` and submits the result to the connector
   * with NO null guard, so a `null` query would reach the database as the
   * SQL string "null" and fail to parse. Cross-filtered clients must always
   * return a real (if trivial) query.
   */
  protected abstract buildQuery(ctx: QueryContext<TInputs>): MosaicQuery | string | null;

  /** Map a query result to the specialization's store payload. */
  protected abstract onResult(data: unknown): Partial<TState>;

  /**
   * Payload published when `buildQuery` returns `null` instead of a query
   * (e.g. a batched client with nothing selected). Defaults to no extra
   * fields — specializations whose `buildQuery` never returns `null` never
   * need to override this.
   */
  protected onEmpty(): Partial<TState> {
    return {};
  }

  /**
   * Hook invoked after the main query is materialized (rows clients issue
   * their side-channel count query here).
   */
  protected afterQueryBuilt(_ctx: QueryContext<TInputs>): void {}

  /**
   * The side-channel COUNT query for the given context, if this client issues
   * one (rows clients with `rowCount: 'query'`); `null` by default. Used by
   * `previewQuery`; specializations that issue it reuse it from
   * `afterQueryBuilt`.
   */
  protected buildCountQuery(_ctx: QueryContext<TInputs>): MosaicQuery | null {
    return null;
  }

  /**
   * True while `previewQuery` is building. `buildQuery` must not record
   * build-time state its result handling depends on (the histogram's bin
   * spec) or emit one-time diagnostics while previewing.
   */
  protected get previewing(): boolean {
    return this.#previewing;
  }

  /**
   * Hook invoked at the start of `refetch()`, before the forced re-query.
   * Lets a specialization invalidate any query-derived memo so an explicit
   * refetch re-runs work it would otherwise skip when the predicate is
   * unchanged (the underlying data may have changed). Default no-op.
   */
  protected onRefetch(): void {}

  /** Register cleanup that runs once on `destroy()`. */
  protected onDestroy(dispose: () => void): void {
    this.#teardown.push(dispose);
  }

  /**
   * True once the clause sourced by `specId` is present in the `filterBy`
   * selection AND keyed (via its `clients` set) to this client's MosaicClient —
   * i.e. the crossfilter context is self-excluding this client's own selection,
   * so the client is not filtered by it. False while a surviving clause is still
   * keyed to a prior, now-unmounted client (the state right after an
   * unmount/remount adopt, before the re-key lands on the composed value).
   */
  #isClauseSelfExcluded(specId: string): boolean {
    const filterBy = this.options.filterBy;
    if (!filterBy) {
      return false;
    }
    for (const clause of filterBy.clauses) {
      const source = clause.source as { id?: unknown };
      if (source.id === specId) {
        return clause.clients?.has(this.#client) ?? false;
      }
    }
    return false;
  }

  /**
   * Re-query this client exactly once, the moment its own FilterSet clause is
   * confirmed self-excluded for this client in the `filterBy` selection.
   *
   * A freshly-mounted client that adopts a surviving spec re-keys that spec's
   * clause to itself for crossfilter self-exclusion, but the re-keyed `clients`
   * set only reaches the composed `filterBy` selection's published value one
   * event-dispatch later — after this client has already issued its first query
   * against the stale clause (still keyed to the prior, now-destroyed client).
   * Because a client is never re-queried for a change to its OWN clause, that
   * stale first query would otherwise stay on screen: self-exclusion matches no
   * live client, so the client filters itself down to just its own selection.
   *
   * Checking the actual self-exclusion condition (rather than refetching on the
   * first event or after a fixed delay) is what makes this robust across the
   * differing dispatch orderings of different composed contexts. The listener
   * is one-shot and idempotent, uses no timers, detaches the moment it fires,
   * and is torn down on destroy; a synchronous check first handles the case
   * where the re-key already landed before the listener was attached. A no-op
   * without a `filterBy` selection or on an already-destroyed client.
   */
  protected requeryOnSelfExclusion(specId: string): void {
    const filterBy = this.options.filterBy;
    if (!filterBy || this.#destroyed) {
      return;
    }
    let done = false;
    const settle = (): void => {
      if (done || this.#destroyed) {
        return;
      }
      if (!this.#isClauseSelfExcluded(specId)) {
        return;
      }
      done = true;
      filterBy.removeEventListener('value', settle);
      void this.refetch();
    };
    filterBy.addEventListener('value', settle);
    this.onDestroy(() => {
      done = true;
      filterBy.removeEventListener('value', settle);
    });
    // Catch the case where the re-key already landed before this listener.
    settle();
  }

  protected patchState(partial: Partial<TState>): void {
    this.store.setState((prev) => ({ ...prev, ...partial }));
  }

  /**
   * Resolve the query source to its base query. Table-name and
   * table-reference sources become `SELECT * FROM <table>` with WHERE/HAVING
   * applied by the client (a `TableRefNode` renders its qualified name,
   * `"main"."events"`); factory sources receive the context and own
   * predicate placement.
   */
  protected resolveBase(ctx: QueryContext<TInputs>): SelectQuery {
    const source = this.#querySource;
    if (typeof source === 'function') {
      const use = this.#predicateUse;
      if (use === null) {
        return source(ctx);
      }
      return source(trackPredicateReads(ctx, use));
    }
    const query = Query.from(source).select('*');
    query.where(ctx.where);
    query.having(ctx.having);
    return query;
  }

  protected createContext(where: FilterExpr): QueryContext<TInputs> {
    return {
      where,
      having: this.#resolveHaving(),
      inputs: this.inputs,
    };
  }

  /** Context for the current filter state, outside a coordinator callback. */
  protected currentContext(): QueryContext<TInputs> {
    return this.createContext(this.#currentWhere());
  }

  /** True when a non-empty `skipSources` set is in effect. */
  #skipping(): boolean {
    const skip = this.options.skipSources;
    return skip !== undefined && skip.size > 0;
  }

  /**
   * The Selection this client observes for `selection`: the Selection itself,
   * or — when `skipSources` is non-empty — a derived Selection that never
   * carries a skipped clause. The derivation is detached on `destroy()`.
   */
  #project(selection: Selection | undefined): Selection | undefined {
    if (!selection || !this.#skipping()) {
      return selection;
    }
    const projected = createSkipProjectedSelection(selection, this.options.skipSources!);
    this.#teardown.push(projected.destroy);
    return projected.selection;
  }

  /**
   * The WHERE predicate for a query the coordinator asked this client to
   * build. Upstream passes the predicate it resolved (`undefined` when the
   * active clause cross-filters this client); a coalesced `filterBy` ignores
   * it and resolves the latest clause list itself (see `#currentWhere`).
   * Upstream's `MosaicClient.query` also admits `null`; it is treated like
   * `undefined`.
   */
  #whereFor(filter: FilterExpr | null | undefined): FilterExpr {
    if (this.#coalesceFilterBy || filter === undefined || filter === null) {
      return this.#currentWhere();
    }
    return filter;
  }

  /**
   * Resolve the WHERE predicate for a client-initiated query. `noSkip`
   * bypasses the active-clause short-circuit (which exists to elide
   * redundant selection updates) while still excluding this client's own
   * clauses in cross-filtering contexts.
   *
   * A coalesced `filterBy` resolves the Selection's resolved clause list
   * (`_resolved`) instead of `.clauses`: the coalesced flush runs a beat
   * after the change, and `.clauses` is the last *dispatched* value, which
   * lags while a newer update is queued behind a still-pending dispatch
   * (another client's in-flight `updateSelection`). The upstream path keeps
   * upstream's `.clauses` reading. A `havingBy` that is this same Selection
   * reads `_resolved` too (see `#resolveHaving`).
   */
  #currentWhere(): FilterExpr {
    const filterBy = this.#filterBy;
    if (!filterBy) {
      return [];
    }
    if (!this.#coalesceFilterBy) {
      return filterBy.predicate(this.#client, true) ?? [];
    }
    return resolvedPredicate(filterBy, this.#client, true) ?? [];
  }

  #materialize(where: FilterExpr): MosaicQuery | string | null {
    const ctx = this.createContext(where);
    const query = this.#buildTracked(ctx);
    if (query === null) {
      // No query issued this round: `lastQuery` is explicitly `null` rather
      // than left as whatever the prior query was, since a stale SQL string
      // would misrepresent the current (empty, unqueried) state. The empty
      // payload is the current state, so any still in-flight request is now
      // superseded and its late result must not replace it.
      this.#nextRequestId();
      this.#lastBuilt = null;
      this.patchState({
        inputs: this.inputs,
        lastQuery: null,
        status: 'success',
        error: null,
        settled: { inputs: this.inputs, query: null },
        ...this.onEmpty(),
      });
      this.afterQueryBuilt(ctx);
      return null;
    }
    const sql = String(query);
    this.#lastBuilt = { sql, inputs: this.inputs };
    this.patchState({
      inputs: this.inputs,
      lastQuery: sql,
    } as Partial<TState>);
    this.afterQueryBuilt(ctx);
    if (typeof query === 'string') {
      return query;
    }
    // Hand the coordinator a query frozen at `sql`, so the request it sends
    // (alone or consolidated), the result it caches and the `QueryError.sql`
    // it reports all match the in-flight entry recorded at `queryPending`
    // even if a live Param the query interpolates changes meanwhile (see
    // `freezeQuerySql`).
    return freezeQuerySql(query, sql);
  }

  /**
   * `buildQuery` for a main query the coordinator asked for, recording — in
   * development, until the warning has fired once — whether the user query
   * factory read the predicates it was handed (see `#warnIgnoredPredicates`).
   *
   * Tracking wraps only the context handed to the user factory (in
   * `resolveBase`), not the one handed to `buildQuery`: specializations
   * spread and re-derive the context, which would count as reads and hide a
   * factory that drops them. A table-name or table-reference source never
   * warns — the client applies both predicates itself.
   */
  #buildTracked(ctx: QueryContext<TInputs>): MosaicQuery | string | null {
    if (this.#warnedIgnoredPredicates || !isExplicitDevelopment()) {
      return this.buildQuery(ctx);
    }
    const use: PredicateUse = {
      whereActive: false,
      whereRead: false,
      havingActive: false,
      havingRead: false,
    };
    this.#predicateUse = use;
    let query: MosaicQuery | string | null;
    try {
      query = this.buildQuery(ctx);
    } finally {
      this.#predicateUse = null;
    }
    this.#warnIgnoredPredicates(use);
    return query;
  }

  /**
   * Development-only, once per client: warn when the user query factory was
   * handed an active WHERE or HAVING predicate and never read it, so the
   * query it built silently drops a filter. Reads are recorded by property
   * access, so destructuring or spreading the context counts as a read
   * (never a false positive, at the cost of missing a factory that
   * destructures and then drops a predicate). Empty predicates (`[]`, the
   * unfiltered and self-excluded cases) never warn.
   */
  #warnIgnoredPredicates(use: PredicateUse): void {
    const ignored: Array<string> = [];
    if (use.whereActive && !use.whereRead) {
      ignored.push('`ctx.where` (filterBy)');
    }
    if (use.havingActive && !use.havingRead) {
      ignored.push('`ctx.having` (havingBy)');
    }
    if (ignored.length === 0) {
      return;
    }
    this.#warnedIgnoredPredicates = true;
    const message =
      `[mosaic-core] A data client's query factory never read ${ignored.join(' or ')} ` +
      'while it carried an active predicate, so the query ignores that filter. ' +
      'Pass it to `.where(...)` / `.having(...)` — or read it (`void ctx.where`) ' +
      'if dropping it is intentional. Development-only; warned once per client.';
    if (this.#meta === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, { meta: this.#meta });
  }

  /**
   * Whether the request the coordinator is marking pending right now is a
   * pre-aggregated update, answered from a materialized view rather than a
   * query built here.
   *
   * Upstream's pre-aggregation optimizer (`PreAggregator.request`, run on
   * Selection activation and on selection updates) calls this client's
   * `query()` to analyze it and to build the view — without submitting it —
   * so the last build is not necessarily the submitted query. Upstream
   * submits a pre-aggregated update exactly when the coordinator holds a
   * view for this client (`preaggregator.entries` with a `result`) and the
   * selection update carries an active clause with a source to answer from
   * it; every client-initiated request goes through
   * `Coordinator.requestQuery`, which clears those entries before
   * submitting (a coalesced `filterBy` flush skips the clear — see
   * `#flushCoalesced` — but such a client is in no filter group, so it never
   * holds an entry). Two standard queries are issued while a view is still held:
   * upstream's retry after a failed pre-aggregated update, recognized by
   * `#preaggFallback` plus a fresh build; and an update without an active
   * clause (a `Selection.reset()` removes it but leaves the cached entry), for
   * which `PreAggregator.request` declines before consulting the cache.
   */
  #isPreaggregated(builtSinceLastRequest: boolean): boolean {
    if (this.#preaggFallback && builtSinceLastRequest) {
      return false;
    }
    const preaggregator = this.#client.coordinator?.preaggregator;
    if (!preaggregator || !preaggregator.enabled) {
      return false;
    }
    // Upstream types `active` as always present, but it is undefined once
    // the clause that set it has been removed (`Selection.reset`).
    const active = this.#client.filterBy?.active as SelectionClause | undefined;
    if (!active?.source) {
      return false;
    }
    const entry = preaggregator.entries.get(this.#client);
    if (!entry || !('result' in entry)) {
      return false;
    }
    return entry.result !== null;
  }

  /**
   * Mint the next request id and make it the one the store waits on. Every
   * request issued earlier is superseded from this point.
   */
  #nextRequestId(): number {
    this.#requestSeq += 1;
    this.#latestRequest = this.#requestSeq;
    return this.#requestSeq;
  }

  /**
   * Remove and return the in-flight request whose SQL matches `sql`, falling
   * back to the oldest in-flight request when none matches (a request issued
   * by the coordinator's pre-aggregation path carries a query this class did
   * not build).
   */
  #takeInflight(sql: string): InflightRequest<TInputs> | undefined {
    const index = this.#inflight.findIndex((request) => request.sql === sql);
    if (index === -1) {
      return this.#inflight.shift();
    }
    const [request] = this.#inflight.splice(index, 1);
    return request;
  }

  /**
   * Current-request guarantee: a completed main-query request may only write
   * `status`/data (and its provenance, `settled`) to the store when it is the
   * request the store is waiting on.
   * A response for a request that has since been superseded — by a newer
   * `filterBy`/`havingBy`/Param-driven query, `setInputs`, `refetch()`, or an
   * empty round — is dropped, so the store never advertises `'success'` (or
   * `'error'`) against inputs that a still-pending request will answer.
   *
   * The upstream hooks (`queryPending`/`queryResult`/`queryError`) carry no
   * request identity, so attribution relies on two coordinator properties:
   * `QueryManager` fulfills successful results in submission order, which
   * makes the oldest in-flight request the completed one; and failures are
   * wrapped in a `QueryError` carrying the failed SQL, which identifies the
   * request directly (errors reject out of order). Two concurrent requests
   * with identical SQL are indistinguishable but also interchangeable.
   *
   * Returns true when the settled request is the current one. Also returns
   * true when no in-flight request is known (nothing to compare against), so
   * an unexpected completion is surfaced rather than swallowed.
   */
  #settle(request: { id: number } | undefined): boolean {
    if (!request) {
      return true;
    }
    return request.id === this.#latestRequest;
  }

  /**
   * The HAVING predicate, read like upstream `selection.predicate(client)`
   * (active-clause short-circuit and cross-filter self-exclusion kept).
   *
   * When `havingBy` is the coalesced `filterBy` Selection itself, it reads
   * the same resolved clause list (`_resolved`) as `#currentWhere`, so one
   * query never pairs a WHERE from a queued update with a HAVING from the
   * last dispatched one. A distinct `havingBy` keeps reading `.clauses`: it
   * re-queries from its own `'value'` dispatch, so `.clauses` is current.
   */
  #resolveHaving(): FilterExpr {
    const havingBy = this.#havingBy;
    if (!havingBy) {
      return [];
    }
    if (this.#coalesceFilterBy && havingBy === this.#filterBy) {
      return resolvedPredicate(havingBy, this.#client, false) ?? [];
    }
    return havingBy.predicate(this.#client) ?? [];
  }

  #wireParams(): void {
    const params = this.options.params;
    if (!params) {
      return;
    }
    for (const param of Object.values(params)) {
      const listener = () => {
        if (this.#destroyed) {
          return;
        }
        this.#requestCoalescedUpdate();
      };
      param.addEventListener('value', listener);
      this.onDestroy(() => param.removeEventListener('value', listener));
    }
  }

  /**
   * Re-query a coalesced `filterBy` (see `#coalesceFilterBy`) through the
   * same batch as Params, `havingBy` and `setInputs`, so a clause change and
   * a Param change made in the same tick — in either order — build one query
   * with both, where upstream `Coordinator.updateSelection` would query at
   * once for the clause and again a beat later for the Param.
   *
   * Only wired for clients whose pre-aggregation is off, so leaving the
   * upstream path forgoes no optimization; a client that can pre-aggregate
   * keeps `updateSelection`, which is what feeds the optimizer. A batch of
   * these changes alone is issued like `updateSelection` issues a standard
   * update (`#flushCoalesced`), leaving eligible siblings' pre-aggregated
   * tables in place.
   *
   * - cross-mode self-skip: no re-query when the clause that changed is this
   *   client's own (`predicate(client)` is `undefined`). This mirrors
   *   `#wireHavingBy` and upstream's pre-aggregation path (the `Skip`
   *   branch of `PreAggregator.request`), not what upstream does for this
   *   client class: with pre-aggregation off, `updateSelection` re-queries
   *   on an own-clause change too. Skipping is safe because an own clause
   *   never participates in this client's own predicate, and clause
   *   re-keying only happens in `prepare`, which the initialization skip
   *   below and the first query cover;
   * - a disabled client records the request and runs it once re-enabled
   *   (via `#requestCoalescedUpdate` → upstream `requestQuery`), as
   *   `updateSelection` does.
   *
   * One deliberate difference: while the client is still initializing
   * (`prepare` pending), the change is not re-queried. Upstream waits for the
   * initial query and then queries again; here the initial query has not
   * been built yet and reads the latest clause list when it is, so the
   * second query would repeat it.
   */
  #wireFilterBy(): void {
    const filterBy = this.#filterBy;
    if (!filterBy || !this.#coalesceFilterBy) {
      return;
    }
    const listener = () => {
      if (this.#destroyed) {
        return;
      }
      if (filterBy.predicate(this.#client) === undefined) {
        return;
      }
      // A disabled client deliberately falls through even when uninitialized:
      // upstream `requestQuery` records the deferred request (`_request`) and
      // runs it once the client is enabled.
      if (this.#client.enabled && !this.#client.initialized) {
        return;
      }
      this.#requestCoalescedUpdate('selection');
    };
    filterBy.addEventListener('value', listener);
    this.onDestroy(() => filterBy.removeEventListener('value', listener));
  }

  /**
   * Upstream coordinators only react to the `filterBy` selection; the
   * HAVING-routed selection is our extension, so its re-query wiring lives
   * here. Cross-mode self-skip mirrors `Coordinator.updateSelection`.
   *
   * When the same Selection is passed as both `filterBy` and `havingBy`,
   * the `filterBy` wiring (the coordinator's, or `#wireFilterBy`) already
   * re-queries on its activation and `#materialize` resolves the HAVING
   * predicate fresh on every query, so wiring a second listener would
   * double-query. Skip it.
   */
  #wireHavingBy(): void {
    const havingBy = this.#havingBy;
    if (!havingBy || havingBy === this.#filterBy) {
      return;
    }
    const listener = () => {
      if (this.#destroyed) {
        return;
      }
      if (havingBy.predicate(this.#client) === undefined) {
        return;
      }
      this.#requestCoalescedUpdate();
    };
    havingBy.addEventListener('value', listener);
    this.onDestroy(() => havingBy.removeEventListener('value', listener));
  }
}

/**
 * `selection.predicate(client, noSkip)` evaluated over the Selection's
 * resolved clause list (and its active clause) rather than its last
 * dispatched one. Delegates to the Selection's own resolver, so union /
 * intersect / `empty` / `cross` semantics, the active-clause short-circuit
 * (unless `noSkip`) and cross-filter self-exclusion are unchanged.
 */
function resolvedPredicate(
  selection: Selection,
  client: MosaicClient,
  noSkip: boolean,
): ReturnType<Selection['predicate']> {
  const clauses = selection._resolved;
  const active = noSkip ? null : clauses.active;
  // Upstream's `predicate` passes a null (`noSkip`) or possibly missing
  // active clause the same way (typed as always present); the resolver
  // null-guards it.
  return selection.resolver.predicate(clauses, active!, client);
}

/**
 * A copy of `ctx` whose `where`/`having` getters record reads into `use`,
 * after recording which of the two carry an active predicate.
 */
function trackPredicateReads<TInputs extends object>(
  ctx: QueryContext<TInputs>,
  use: PredicateUse,
): QueryContext<TInputs> {
  const { where, having, inputs } = ctx;
  if (isActivePredicate(where)) {
    use.whereActive = true;
  }
  if (isActivePredicate(having)) {
    use.havingActive = true;
  }
  return {
    get where() {
      use.whereRead = true;
      return where;
    },
    get having() {
      use.havingRead = true;
      return having;
    },
    inputs,
  };
}

/**
 * Whether a resolved predicate filters anything: an empty list, a nullish
 * entry, a literal `true` and blank SQL do not. A literal `false` does (an
 * `empty: true` Selection with no clauses resolves to `[FALSE]`).
 */
function isActivePredicate(expr: unknown): boolean {
  if (expr === null || expr === undefined || expr === true) {
    return false;
  }
  if (Array.isArray(expr)) {
    return expr.some(isActivePredicate);
  }
  if (expr === false) {
    return true;
  }
  return String(expr).trim() !== '';
}

/**
 * Provenance for a successful response: the settled request's own build
 * inputs and SQL. A completion with no known in-flight request (surfaced
 * rather than swallowed, see `#settle`) is attributed to the current inputs
 * with unknown SQL.
 */
function settledFrom<TInputs extends object>(
  request: InflightRequest<TInputs> | undefined,
  inputs: TInputs,
): DataClientSettled<TInputs> {
  if (!request) {
    return { inputs, query: null };
  }
  return { inputs: request.inputs, query: request.sql };
}
