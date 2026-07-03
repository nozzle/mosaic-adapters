import { clausePoints } from '@uwdata/mosaic-core';
import { Query, asc, count, desc, sql } from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { SqlIdentifier, createStructAccess } from './filter-builder/sql-access';
import { PersisterLifecycle } from './persistence';
import { resolveCoerce, toResultRows, trailingThrottle } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type {
  CoerceOption,
  OrderByItem,
  QueryContext,
  RowsClient,
  RowsClientOptions,
  RowsClientState,
  RowsInputs,
  RowsPublishTarget,
} from './types';
import type { TrailingThrottle } from './utils';

/** Alias for the injected window/count expression; stripped from row data. */
const ROW_COUNT_COLUMN = '__total_rows__';

const DEFAULT_HOVER_THROTTLE_MS = 50;

export function createRowsClient<TRow>(
  options: RowsClientOptions<TRow>,
): RowsClient<TRow> {
  return new RowsDataClient(options);
}

class RowsDataClient<TRow>
  extends BaseDataClient<RowsInputs, RowsClientState<TRow>>
  implements RowsClient<TRow>
{
  readonly #options: RowsClientOptions<TRow>;
  readonly #rowCount: RowsClientOptions<TRow>['rowCount'];
  readonly #inputMode: 'append' | 'manual';
  #coerce: ((raw: Record<string, unknown>) => TRow) | undefined;

  /**
   * Stable clause identities: one per publish channel so select and hover
   * clauses never displace each other, even inside one Selection. Callers
   * may supply their own source so the identity survives client remounts.
   */
  readonly #selectSource: ClauseSource;
  readonly #hoverSource: ClauseSource;
  #hasSelectClause = false;
  #hasHoverClause = false;
  /**
   * The currently selected tuples (value arrays aligned to
   * `publish.select.columns`). Tracked here — not on the public state — for
   * persistence writes and external-clear detection.
   */
  #selectedTuples: Array<Array<unknown>> = [];
  #publishHover: TrailingThrottle<[TRow | null]> | null = null;
  #persist: PersisterLifecycle<Array<Array<unknown>>> | null = null;

  #countGeneration = 0;
  #warnedGroupedFilterStable = false;

  constructor(options: RowsClientOptions<TRow>) {
    const rowCount = options.rowCount ?? 'none';
    const inputMode = options.inputMode ?? 'append';
    if (rowCount === 'window' && inputMode === 'manual') {
      throw new Error(
        "rowCount: 'window' requires the client to own the LIMIT wrapper and " +
          "cannot be combined with inputMode: 'manual'. Use rowCount: 'query' " +
          'instead.',
      );
    }
    assertPublishFields(options.publish?.select);
    assertPublishFields(options.publish?.hover);

    super(
      options,
      options.query,
      {
        rows: [],
        totalRows: undefined,
      },
      { prepare: () => this.#hydrate() },
    );

    this.#options = options;
    this.#rowCount = rowCount;
    this.#inputMode = inputMode;
    this.#coerce = resolveCoerce(options.coerce);
    this.#selectSource = options.publish?.select?.source ?? {};
    this.#hoverSource = options.publish?.hover?.source ?? {};
    this.#persist = this.#resolvePersist();

    this.#wirePublishing();
    this.#wireExternalClear();
  }

  setCoerce(coerce: CoerceOption<TRow> | undefined): void {
    this.#coerce = resolveCoerce(coerce);
  }

  selectRows(rows: Array<TRow>): void {
    if (this.destroyed) {
      return;
    }
    const target = this.#options.publish?.select;
    if (!target) {
      return;
    }
    const tuples = rows.map((row) =>
      target.columns.map((column) => (row as Record<string, unknown>)[column]),
    );
    this.#publishSelectTuples(target, tuples);
  }

  setSelectedValues(tuples: Array<Array<unknown>>): void {
    if (this.destroyed) {
      return;
    }
    const target = this.#options.publish?.select;
    if (!target) {
      return;
    }
    assertTupleArity(tuples, target.columns.length);
    this.#publishSelectTuples(
      target,
      tuples.map((tuple) => [...tuple]),
    );
  }

  hoverRow(row: TRow | null): void {
    if (this.destroyed) {
      return;
    }
    this.#publishHover?.(row);
  }

  prefetch(inputs: Partial<RowsInputs>): void {
    if (this.destroyed) {
      return;
    }
    const ctx = this.currentContext();
    const query = this.buildQuery({
      ...ctx,
      inputs: { ...ctx.inputs, ...inputs },
    });
    this.#options.coordinator.prefetch(query);
  }

  protected buildQuery(ctx: QueryContext<RowsInputs>): SelectQuery {
    const base = this.resolveBase(ctx);
    this.#warnGroupedFilterStable(base);
    if (this.#inputMode === 'manual') {
      return base;
    }

    const query = base.clone();
    if (this.#rowCount === 'window') {
      query.select({ [ROW_COUNT_COLUMN]: sql`count(*) OVER ()` });
    }
    const { orderBy, limit, offset } = ctx.inputs;
    if (orderBy !== undefined && orderBy.length > 0) {
      query.orderby(orderBy.map(toOrderByNode));
    }
    if (limit !== undefined) {
      query.limit(limit);
    }
    if (offset !== undefined) {
      query.offset(offset);
    }
    return query;
  }

  protected afterQueryBuilt(ctx: QueryContext<RowsInputs>): void {
    if (this.#rowCount !== 'query') {
      return;
    }
    // Re-resolve the base with the sort/window inputs stripped so 'manual'
    // factories omit them; 'append' factories ignore inputs anyway.
    const base = this.resolveBase({
      ...ctx,
      inputs: {
        ...ctx.inputs,
        orderBy: undefined,
        limit: undefined,
        offset: undefined,
      },
    });
    const countQuery = Query.from(base).select({
      [ROW_COUNT_COLUMN]: count(),
    });

    this.#countGeneration += 1;
    const generation = this.#countGeneration;
    this.#options.coordinator
      .query(countQuery)
      .then((result: unknown) => {
        if (this.destroyed || generation !== this.#countGeneration) {
          return;
        }
        const rows = toResultRows(result);
        const first = rows[0];
        this.patchState({
          totalRows: first ? Number(first[ROW_COUNT_COLUMN]) : 0,
        });
      })
      .catch(() => {
        // The main query surfaces errors on the store; a failed count query
        // leaves totalRows untouched.
      });
  }

  protected onResult(data: unknown): Partial<RowsClientState<TRow>> {
    const raw = toResultRows(data);
    const payload: Partial<RowsClientState<TRow>> = {};

    if (this.#rowCount === 'window') {
      const first = raw[0];
      payload.totalRows = first ? Number(first[ROW_COUNT_COLUMN]) : 0;
    }

    payload.rows = raw.map((record) => {
      let row = record;
      if (this.#rowCount === 'window') {
        const { [ROW_COUNT_COLUMN]: _ignored, ...rest } = record;
        row = rest;
      }
      if (this.#coerce) {
        return this.#coerce(row);
      }
      return row as TRow;
    });

    return payload;
  }

  #wirePublishing(): void {
    const publish = this.#options.publish;
    if (!publish) {
      return;
    }

    const hover = publish.hover;
    if (hover) {
      this.#publishHover = trailingThrottle((row: TRow | null) => {
        if (this.destroyed) {
          return;
        }
        const tuples =
          row === null
            ? []
            : [
                hover.columns.map(
                  (column) => (row as Record<string, unknown>)[column],
                ),
              ];
        this.#publishPoints(hover, this.#hoverSource, tuples);
        this.#hasHoverClause = row !== null;
      }, hover.throttleMs ?? DEFAULT_HOVER_THROTTLE_MS);
    }

    this.onDestroy(() => {
      this.#publishHover?.cancel();
      // Caller-provided sources signal that the Selection outlives this
      // client instance: leave the clause in place for the next instance.
      // Destroy-time clause cleanup never persists — a StrictMode unmount must
      // not wipe the consumer's storage.
      const select = publish.select;
      if (select && !select.source && this.#hasSelectClause) {
        this.#publishPoints(select, this.#selectSource, []);
        this.#hasSelectClause = false;
        this.#selectedTuples = [];
      }
      if (hover && !hover.source && this.#hasHoverClause) {
        this.#publishPoints(hover, this.#hoverSource, []);
        this.#hasHoverClause = false;
      }
    });
  }

  /**
   * The value-level select publish core shared by `selectRows` and
   * `setSelectedValues`: track the tuples, publish the clause, persist intent.
   */
  #publishSelectTuples(
    target: RowsPublishTarget<TRow>,
    tuples: Array<Array<unknown>>,
  ): void {
    this.#selectedTuples = tuples;
    this.#hasSelectClause = tuples.length > 0;
    this.#publishPoints(target, this.#selectSource, tuples);
    this.#persist?.write(
      tuples.length > 0 ? tuples.map((tuple) => [...tuple]) : null,
      tuples.length > 0 ? 'update' : 'clear',
    );
  }

  #publishPoints(
    target: RowsPublishTarget<TRow>,
    source: ClauseSource,
    tuples: Array<Array<unknown>>,
  ): void {
    const fields = (target.fields ?? target.columns).map((field) =>
      createStructAccess(SqlIdentifier.from(field)),
    );
    const clause = clausePoints(fields, tuples, {
      source,
      clients: new Set<MosaicClient>([this.mosaicClient]),
    });
    target.as.update(clause);
  }

  /**
   * A grouped main query whose group domain changes under filtering breaks
   * Mosaic's pre-aggregation assumptions, and `filterStable` defaults to
   * upstream's `true` — the resulting optimizer path can hang on wrong
   * pre-aggregated tables with no error. Surface the hazard once instead of
   * failing silently.
   */
  #warnGroupedFilterStable(base: SelectQuery): void {
    if (this.#warnedGroupedFilterStable) {
      return;
    }
    this.#warnedGroupedFilterStable = true;
    if (this.#options.filterStable !== undefined) {
      return;
    }
    if (base._groupby.length === 0) {
      return;
    }
    console.warn(
      '[mosaic-core] A rows client query uses GROUP BY while filterStable ' +
        'was left at its default (true). Filtering usually changes a ' +
        'grouped query’s group domain, which invalidates pre-aggregation ' +
        '— pass filterStable: false (or an explicit true if the group ' +
        'domain really is filter-stable).',
    );
  }

  /**
   * Hydrate persisted select tuples before the first query (sync reads apply
   * now, so the first query is already filtered; async reads apply on resolve
   * and re-query).
   */
  #hydrate(): Promise<void> {
    this.#persist?.hydrate((tuples) => {
      this.setSelectedValues(tuples);
    });
    return Promise.resolve();
  }

  /**
   * An external actor (chip bar, global reset) can drop this client's select
   * clause from the published Selection; mirror that into the tracked tuples
   * and persist the removal. Select only — hover is transient. The select
   * source may be caller-provided and shared, so detection is by source
   * identity: a legitimately surviving clause under a stable source is left
   * alone.
   */
  #wireExternalClear(): void {
    const target = this.#options.publish?.select;
    if (!target) {
      return;
    }
    const listener = () => {
      if (this.destroyed || this.#selectedTuples.length === 0) {
        return;
      }
      const present = target.as.clauses.some(
        (clause) => clause.source === this.#selectSource,
      );
      if (!present) {
        this.#selectedTuples = [];
        this.#hasSelectClause = false;
        this.#persist?.write(null, 'external');
      }
    };
    target.as.addEventListener('value', listener);
    this.onDestroy(() => target.as.removeEventListener('value', listener));
  }

  /**
   * Resolve the persister, but only when there is a select publish target to
   * persist *for*; without one, warn and ignore (mirrors the `filterStable`
   * posture).
   */
  #resolvePersist(): PersisterLifecycle<Array<Array<unknown>>> | null {
    const persist = this.#options.persist;
    if (!persist) {
      return null;
    }
    if (!this.#options.publish?.select) {
      console.warn(
        '[mosaic-core] A rows client was given `persist` without a ' +
          '`publish.select` target; persistence has nothing to persist and ' +
          'is ignored.',
      );
      return null;
    }
    return new PersisterLifecycle(persist, () => this.destroyed, {
      isEmpty: (tuples) => tuples.length === 0,
    });
  }
}

function assertPublishFields<TRow>(
  target: RowsPublishTarget<TRow> | undefined,
): void {
  if (!target?.fields) {
    return;
  }
  if (target.fields.length !== target.columns.length) {
    throw new Error(
      'publish fields must align with columns ' +
        `(got ${target.fields.length} fields for ${target.columns.length} columns).`,
    );
  }
}

function assertTupleArity(tuples: Array<Array<unknown>>, arity: number): void {
  for (const tuple of tuples) {
    if (tuple.length !== arity) {
      throw new Error(
        'setSelectedValues tuples must align with publish.select.columns ' +
          `(got a tuple of ${tuple.length} values for ${arity} columns).`,
      );
    }
  }
}

function toOrderByNode(item: OrderByItem) {
  if (item.desc === true) {
    return desc(item.column, item.nullsFirst);
  }
  return asc(item.column, item.nullsFirst);
}
