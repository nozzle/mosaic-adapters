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
      // before issuing the first query either way.
      prepare: prepare
        ? () => Promise.resolve().then(() => prepare())
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
   * their input-derived SQL here).
   */
  protected abstract buildQuery(
    ctx: QueryContext<TInputs>,
  ): MosaicQuery | string;

  /** Map a query result to the specialization's store payload. */
  protected abstract onResult(data: unknown): Partial<TState>;

  /**
   * Hook invoked after the main query is materialized (rows clients issue
   * their side-channel count query here).
   */
  protected afterQueryBuilt(_ctx: QueryContext<TInputs>): void {}

  /** Register cleanup that runs once on `destroy()`. */
  protected onDestroy(dispose: () => void): void {
    this.#teardown.push(dispose);
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

  #materialize(where: FilterExpr): MosaicQuery | string {
    const ctx = this.createContext(where);
    const query = this.buildQuery(ctx);
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
