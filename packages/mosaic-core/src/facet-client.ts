import { clausePoint, clausePoints } from '@uwdata/mosaic-core';
import {
  Query,
  asc,
  column,
  count,
  desc,
  isNotNull,
  listHasAny,
  literal,
  sql,
  unnest,
} from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { createValueClause } from './clause-factory';
import { PersisterLifecycle } from './persistence';
import { deepEqual, toResultRows } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { ExprValue, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  FacetClient,
  FacetClientOptions,
  FacetClientState,
  FacetInputs,
  FacetOption,
  QueryContext,
} from './types';

/**
 * Distinct values of a column (options + counts) in, point/list clauses out.
 *
 * Under a crossfilter Selection the published clause carries this client in
 * its `clients` set, so the options cascade with every *other* filter on the
 * page while never excluding themselves — the classic facet-menu behavior,
 * from native cross-mode clause resolution.
 */
export function createFacetClient(options: FacetClientOptions): FacetClient {
  return new FacetDataClient(options);
}

class FacetDataClient
  extends BaseDataClient<FacetInputs, FacetClientState>
  implements FacetClient
{
  readonly #options: FacetClientOptions;
  readonly #source: ClauseSource = {};
  #selected: Array<unknown> = [];
  #persist: PersisterLifecycle<Array<unknown>> | null = null;

  constructor(options: FacetClientOptions) {
    // Filtering changes which option groups exist, so pre-aggregation is
    // unsafe by default (overridable for callers who know better).
    super(
      { ...options, filterStable: options.filterStable ?? false },
      options.from,
      {
        options: [],
        selected: [],
      },
      { prepare: () => this.#prepare() },
    );
    this.#options = options;
    this.#persist = this.#resolvePersist();
    this.#wireExternalClear();
    this.onDestroy(() => {
      if (this.#selected.length > 0) {
        this.#selected = [];
        // Destroy-time clause cleanup: publish, but never persist — a
        // StrictMode unmount must not wipe the consumer's storage.
        this.#publish();
      }
    });
  }

  toggle(value: unknown): void {
    if (this.destroyed) {
      return;
    }
    if (value === null) {
      this.clear();
      return;
    }
    if ((this.#options.select ?? 'single') === 'multi') {
      const kept = this.#selected.filter((v) => !deepEqual(v, value));
      this.#selected =
        kept.length === this.#selected.length ? [...kept, value] : kept;
    } else {
      const active = this.#selected[0];
      this.#selected =
        this.#selected.length > 0 && deepEqual(active, value) ? [] : [value];
    }
    this.#publishAction();
  }

  setSelected(values: Array<unknown>): void {
    if (this.destroyed) {
      return;
    }
    const copy = [...values];
    // Mirror toggle's single-select semantics: at most one value survives.
    this.#selected =
      (this.#options.select ?? 'single') === 'multi' || copy.length <= 1
        ? copy
        : [copy[0]];
    this.#publishAction();
  }

  clear(): void {
    if (this.destroyed) {
      return;
    }
    if (this.#selected.length === 0) {
      return;
    }
    this.#selected = [];
    this.#publishAction();
  }

  protected buildQuery(ctx: QueryContext<FacetInputs>): SelectQuery {
    const { search, limit } = ctx.inputs;
    const counts = this.#options.counts ?? true;
    const sort = counts ? (this.#options.sort ?? 'count') : 'alpha';

    const values = Query.from(this.resolveBase(ctx)).select({
      value: this.#options.arrayColumn
        ? unnest(column(this.#options.column))
        : column(this.#options.column),
    });

    const query = Query.from(values)
      .select(
        counts
          ? { value: column('value'), count: count() }
          : { value: column('value') },
      )
      .where(isNotNull(column('value')))
      .groupby('value');
    if (search !== undefined && search !== '') {
      query.where(
        sql`CAST(${column('value')} AS VARCHAR) ILIKE ${literal(`%${search}%`)}`,
      );
    }
    if (sort === 'count') {
      query.orderby(desc('count'), asc('value'));
    } else {
      query.orderby(asc('value'));
    }
    if (limit !== undefined) {
      query.limit(limit);
    }
    return query;
  }

  protected onResult(data: unknown): Partial<FacetClientState> {
    const options: Array<FacetOption> = toResultRows(data).map((row) => {
      if (row.count === undefined) {
        return { value: row.value };
      }
      return { value: row.value, count: Number(row.count) };
    });
    return { options };
  }

  /**
   * A local action (toggle/setSelected/clear) settled the selection: publish
   * it and persist the intent. Empty selection persists as a 'clear'.
   */
  #publishAction(): void {
    this.#publish();
    this.#persist?.write(
      this.#selected.length > 0 ? [...this.#selected] : null,
      this.#selected.length > 0 ? 'update' : 'clear',
    );
  }

  #publish(): void {
    this.patchState({ selected: this.#selected });
    const target = this.#options.publish;
    if (!target) {
      return;
    }
    target.as.update(this.#buildClause());
  }

  #buildClause() {
    const field = column(this.#options.column);
    const clients = new Set<MosaicClient>([this.mosaicClient]);
    const selected = this.#selected;

    if (this.#options.arrayColumn) {
      // Not upstream `clauseList`: that factory wraps scalar values, while a
      // multi-value match needs the selected values as a proper SQL list.
      // The predicate is not point/interval-shaped, so it carries no `meta`.
      return createValueClause({
        source: this.#source,
        clients,
        value: selected,
        predicate:
          selected.length > 0
            ? listHasAny(field, selected as Array<ExprValue>)
            : null,
      });
    }
    if ((this.#options.select ?? 'single') === 'multi') {
      return clausePoints(
        [field],
        selected.map((value) => [value]),
        { source: this.#source, clients },
      );
    }
    return clausePoint(field, selected[0], {
      source: this.#source,
      clients,
    });
  }

  /**
   * An external actor (chip bar, global reset) can drop this client's clause
   * from the published Selection; mirror that into `selected` so the UI does
   * not present a stale choice.
   */
  #wireExternalClear(): void {
    const target = this.#options.publish;
    if (!target) {
      return;
    }
    const listener = () => {
      if (this.destroyed || this.#selected.length === 0) {
        return;
      }
      const present = target.as.clauses.some(
        (clause) => clause.source === this.#source,
      );
      if (!present) {
        this.#selected = [];
        this.patchState({ selected: [] });
        this.#persist?.write(null, 'external');
      }
    };
    target.as.addEventListener('value', listener);
    this.onDestroy(() => target.as.removeEventListener('value', listener));
  }

  /** Hydrate persisted intent before the first query (sync reads apply now). */
  #prepare(): Promise<void> {
    this.#persist?.hydrate((values) => {
      this.setSelected(values);
    });
    return Promise.resolve();
  }

  /**
   * Resolve the persister, but only when there is a publish target to persist
   * *for*; without one, warn and ignore (mirrors the `filterStable` posture).
   */
  #resolvePersist(): PersisterLifecycle<Array<unknown>> | null {
    const persist = this.#options.persist;
    if (!persist) {
      return null;
    }
    if (!this.#options.publish) {
      console.warn(
        '[mosaic-core] A facet client was given `persist` without a ' +
          '`publish` target; persistence has nothing to persist and is ' +
          'ignored.',
      );
      return null;
    }
    return new PersisterLifecycle(persist, () => this.destroyed, {
      isEmpty: (values) => values.length === 0,
    });
  }
}
