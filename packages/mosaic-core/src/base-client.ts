import { makeClient } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { deepEqual } from './utils';
import type { MosaicClient } from '@uwdata/mosaic-core';
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
      filterStable: options.filterStable ?? true,
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
      query: (filter: FilterExpr | undefined) =>
        this.#materialize(filter ?? this.#currentWhere()),
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
    this.#client.requestQuery();
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
    const request = this.#client.requestQuery();
    if (request) {
      await request;
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
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
    return filterBy.predicate(this.#client, true) ?? [];
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
        this.#client.requestQuery();
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
      this.#client.requestQuery();
    };
    havingBy.addEventListener('value', listener);
    this.onDestroy(() => havingBy.removeEventListener('value', listener));
  }
}
