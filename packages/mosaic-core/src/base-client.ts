import { makeClient } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { deepEqual } from './utils';
import type {
  MosaicClient,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type {
  FilterExpr,
  Query as MosaicQuery,
  SelectQuery,
} from '@uwdata/mosaic-sql';
import type {
  DataClient,
  DataClientOptions,
  DataClientState,
  QueryContext,
  QuerySource,
} from './types';

/**
 * Framework-agnostic base for every data client: wraps upstream
 * `makeClient`, projects the query lifecycle onto a reactive store, wires
 * Params and the HAVING-routed Selection to re-queries, and holds the query
 * factory by latest-ref.
 *
 * Re-query triggers are exactly: inputs change, Selection activation,
 * Param change, `refetch()`.
 *
 * Input-driven triggers (`setInputs`, Param `'value'`, `havingBy` `'value'`)
 * are coalesced — a burst of synchronous changes in one tick collapses into a
 * single query build instead of one full query per event. In browsers this
 * rides upstream `MosaicClient.requestUpdate()` (animation-frame throttle);
 * elsewhere a core-owned macrotask fallback coalesces (see
 * `#requestCoalescedUpdate`). `refetch()` (and any user-explicit re-query)
 * stays immediate via `requestQuery()`.
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
  #destroyed = false;
  #teardown: Array<() => void> = [];
  /** Pending macrotask flush for the non-browser coalescing fallback. */
  #coalesceHandle: ReturnType<typeof setTimeout> | null = null;

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
    this.#querySource = query;
    this.inputs = options.inputs ?? ({} as TInputs);

    this.store = new Store({
      status: 'idle',
      error: null,
      inputs: this.inputs,
      lastQuery: null,
      ...payload,
    } as TState);

    const prepare = hooks?.prepare;
    this.#client = makeClient({
      coordinator: options.coordinator,
      selection: options.filterBy,
      enabled: options.enabled ?? true,
      // A non-empty `skipSources` forces pre-aggregation off: the optimizer
      // re-applies the active clause independent of the `query` callback
      // (upstream `PreAggregator`), so a skipped active clause would otherwise
      // leak back into the materialized-view query. See `#resolveSkipping`.
      filterStable: this.#skipping() ? false : (options.filterStable ?? true),
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
      //
      // On selection-driven updates the coordinator computes the predicate
      // itself (`Selection.predicate(client)`) and passes it in WITHOUT
      // `skipSources` applied, so when skipping is active the passed filter is
      // ignored and `#currentWhere()` re-resolves with the skip.
      query: (filter: FilterExpr | undefined) =>
        this.#materialize(
          this.#skipping()
            ? this.#currentWhere()
            : (filter ?? this.#currentWhere()),
        ),
      queryPending: () => {
        if (this.#destroyed) {
          return;
        }
        this.patchState({ status: 'pending' } as Partial<TState>);
      },
      queryResult: (data) => {
        if (this.#destroyed) {
          return;
        }
        this.patchState({
          status: 'success',
          error: null,
          ...this.onResult(data),
        });
      },
      queryError: (error) => {
        if (this.#destroyed) {
          return;
        }
        this.patchState({ status: 'error', error } as Partial<TState>);
      },
    });

    this.#wireParams();
    this.#wireHavingBy();
  }

  get mosaicClient(): MosaicClient {
    return this.#client;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  setQuery(query: QuerySource<TInputs>): void {
    this.#querySource = query;
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
   * In browsers this delegates to upstream `MosaicClient.requestUpdate()`,
   * whose throttle debounces on `requestAnimationFrame`. Upstream's throttle
   * calls `requestAnimationFrame` unconditionally with no fallback (it is a
   * browser view-layer entry point), so in non-browser environments this
   * class owns a macrotask fallback instead: one `setTimeout` flush per tick,
   * with the flush reading the latest state (last inputs win). The fallback
   * handle is cancelled by `refetch()` (an explicit refetch already queries
   * with the latest state, so the pending flush would only duplicate it) and
   * by `destroy()`. In the browser path an interleaved `refetch()` plus a
   * pending throttle flush can still produce one redundant query — upstream's
   * throttle exposes no cancel — which is accepted as low severity: results
   * stay correct, one extra query at most.
   */
  #requestCoalescedUpdate(): void {
    if (this.#client.enabled) {
      this.patchState({ status: 'pending' } as Partial<TState>);
    }
    if (typeof requestAnimationFrame === 'function') {
      this.#client.requestUpdate();
      return;
    }
    if (this.#coalesceHandle !== null) {
      return;
    }
    this.#coalesceHandle = setTimeout(() => {
      this.#coalesceHandle = null;
      if (this.#destroyed) {
        return;
      }
      this.#client.requestQuery();
    });
  }

  /** Cancel a pending non-browser coalescing flush, if any. */
  #cancelCoalescedUpdate(): void {
    if (this.#coalesceHandle === null) {
      return;
    }
    clearTimeout(this.#coalesceHandle);
    this.#coalesceHandle = null;
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
   * `refetch`, Params, `havingBy`) flows through upstream
   * `MosaicClient.requestQuery()`, which null-guards the query — but
   * upstream `Coordinator.updateSelection` (the `filterBy` 'value' listener)
   * calls `client.query(filter)` and submits the result to the connector
   * with NO null guard, so a `null` query would reach the database as the
   * SQL string "null" and fail to parse. Cross-filtered clients must always
   * return a real (if trivial) query.
   */
  protected abstract buildQuery(
    ctx: QueryContext<TInputs>,
  ): MosaicQuery | string | null;

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
   * Resolve the query source to its base query. String sources become
   * `SELECT * FROM <name>` with WHERE/HAVING applied by the client; factory
   * sources receive the context and own predicate placement.
   */
  protected resolveBase(ctx: QueryContext<TInputs>): SelectQuery {
    const source = this.#querySource;
    if (typeof source !== 'string') {
      return source(ctx);
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
   * Resolve a Selection's predicate with `skipSources` applied: drop every
   * clause whose `source.id` is in the skip set, then delegate to the
   * Selection's own resolver so union/intersect/empty/crossfilter semantics
   * (including this client's own crossfilter self-exclusion) are preserved
   * exactly rather than hand-rolled.
   *
   * `.clauses` (last-emitted state, not `_resolved`) and `.resolver` are read
   * to match today's resolution timing and behavior. `active` mirrors
   * upstream `Selection.predicate`'s `noSkip` handling: `null` for the WHERE
   * path (noSkip=true), the active clause for the HAVING path (noSkip=false).
   * Only called when `#skipping()` is true. The clause guard is defensive:
   * sources without a string `id` (upstream `ClauseSource` is `object`) are
   * never skipped.
   */
  #resolveSkipping(
    selection: Selection,
    active: SelectionClause | null,
  ): FilterExpr {
    const skip = this.options.skipSources!;
    const clauses = selection.clauses.filter((clause) => {
      const source = clause.source as { id?: unknown } | null | undefined;
      const skipped =
        typeof source === 'object' &&
        source !== null &&
        typeof source.id === 'string' &&
        skip.has(source.id);
      return !skipped;
    });
    return (
      selection.resolver.predicate(
        clauses,
        active as SelectionClause,
        this.#client,
      ) ?? []
    );
  }

  /**
   * Resolve the WHERE predicate for a client-initiated query. `noSkip`
   * bypasses the active-clause short-circuit (which exists to elide
   * redundant selection updates) while still excluding this client's own
   * clauses in cross-filtering contexts.
   */
  #currentWhere(): FilterExpr {
    const filterBy = this.options.filterBy;
    if (!filterBy) {
      return [];
    }
    if (!this.#skipping()) {
      return filterBy.predicate(this.#client, true) ?? [];
    }
    // noSkip=true → upstream passes `active = null` to the resolver.
    return this.#resolveSkipping(filterBy, null);
  }

  #materialize(where: FilterExpr): MosaicQuery | string | null {
    const ctx = this.createContext(where);
    const query = this.buildQuery(ctx);
    if (query === null) {
      // No query issued this round: `lastQuery` is explicitly `null` rather
      // than left as whatever the prior query was, since a stale SQL string
      // would misrepresent the current (empty, unqueried) state.
      this.patchState({
        inputs: this.inputs,
        lastQuery: null,
        status: 'success',
        error: null,
        ...this.onEmpty(),
      });
      this.afterQueryBuilt(ctx);
      return null;
    }
    this.patchState({
      inputs: this.inputs,
      lastQuery: String(query),
    } as Partial<TState>);
    this.afterQueryBuilt(ctx);
    return query;
  }

  #resolveHaving(): FilterExpr {
    const havingBy = this.options.havingBy;
    if (!havingBy) {
      return [];
    }
    if (!this.#skipping()) {
      return havingBy.predicate(this.#client) ?? [];
    }
    // noSkip=false → upstream passes `active = clauses.active` to the resolver.
    return this.#resolveSkipping(havingBy, havingBy.clauses.active ?? null);
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
   * Upstream coordinators only react to the `filterBy` selection; the
   * HAVING-routed selection is our extension, so its re-query wiring lives
   * here. Cross-mode self-skip mirrors `Coordinator.updateSelection`.
   *
   * When the same Selection is passed as both `filterBy` and `havingBy`,
   * the coordinator's native wiring already re-queries on its activation and
   * `#materialize` resolves the HAVING predicate fresh on every query, so
   * wiring a second listener would double-query. Skip it.
   */
  #wireHavingBy(): void {
    const havingBy = this.options.havingBy;
    if (!havingBy || havingBy === this.options.filterBy) {
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
