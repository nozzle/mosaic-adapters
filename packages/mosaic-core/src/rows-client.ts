import { clausePoints } from '@uwdata/mosaic-core';
import { Query, asc, count, desc, sql } from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { SqlIdentifier, createStructAccess } from './sql-access';
import { PersisterLifecycle } from './persistence';
import { isFilterSetPublishTarget } from './types';
import { resolveCoerce, toResultRows, trailingThrottle } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { FilterSpec } from './filter-set/types';
import type {
  CoerceOption,
  OrderByItem,
  QueryContext,
  RowsClient,
  RowsClientOptions,
  RowsClientState,
  RowsFilterSetPublishTarget,
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
  /** Set when writing to `publish.select.into`, to suppress our store-mirror. */
  #writingToSet = false;

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
    const select = options.publish?.select;
    this.#selectSource =
      select !== undefined && !isFilterSetPublishTarget(select)
        ? (select.source ?? {})
        : {};
    this.#hoverSource = options.publish?.hover?.source ?? {};
    this.#persist = this.#resolvePersist();

    this.#wirePublishing();
    this.#wireExternalClear();
    this.#wireSetMirror();
  }

  /** The `publish.select.into` target when configured, else null. */
  #setTarget(): RowsFilterSetPublishTarget<TRow> | null {
    const select = this.#options.publish?.select;
    if (select !== undefined && isFilterSetPublishTarget(select)) {
      return select;
    }
    return null;
  }

  /** The raw-Selection `publish.select` target when configured, else null. */
  #selectionTarget(): RowsPublishTarget<TRow> | null {
    const select = this.#options.publish?.select;
    if (select !== undefined && !isFilterSetPublishTarget(select)) {
      return select;
    }
    return null;
  }

  setCoerce(coerce: CoerceOption<TRow> | undefined): void {
    this.#coerce = resolveCoerce(coerce);
  }

  selectRows(rows: Array<TRow>): void {
    if (this.destroyed) {
      return;
    }
    const columns = this.#selectColumns();
    if (columns === null) {
      return;
    }
    const tuples = rows.map((row) =>
      columns.map((column) => (row as Record<string, unknown>)[column]),
    );
    this.#publishSelectTuples(tuples);
  }

  setSelectedValues(tuples: Array<Array<unknown>>): void {
    if (this.destroyed) {
      return;
    }
    const columns = this.#selectColumns();
    if (columns === null) {
      return;
    }
    assertTupleArity(tuples, columns.length);
    this.#publishSelectTuples(tuples.map((tuple) => [...tuple]));
  }

  /** Row-field names of the configured select target (either form), else null. */
  #selectColumns(): Array<string> | null {
    const select = this.#options.publish?.select;
    if (select === undefined) {
      return null;
    }
    return select.columns;
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
      // not wipe the consumer's storage. With a `publish.select.into` target
      // the set owns the spec (intent outlives the widget), so nothing is
      // cleared here.
      const select = this.#selectionTarget();
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
   * `setSelectedValues`: track the tuples, publish the clause (raw Selection or
   * page-level FilterSet), persist intent (Selection form only — the set owns
   * its own persistence).
   */
  #publishSelectTuples(tuples: Array<Array<unknown>>): void {
    this.#selectedTuples = tuples;
    this.#hasSelectClause = tuples.length > 0;

    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#publishToSet(setTarget, tuples);
      return;
    }
    const selectionTarget = this.#selectionTarget();
    if (selectionTarget !== null) {
      this.#publishPoints(selectionTarget, this.#selectSource, tuples);
    }
    this.#persist?.write(
      tuples.length > 0 ? tuples.map((tuple) => [...tuple]) : null,
      tuples.length > 0 ? 'update' : 'clear',
    );
  }

  /**
   * Route the selected tuples into a page-level FilterSet as a `points` spec:
   * a single field publishes a flat scalar array, multiple fields a
   * `{ columns, tuples }` envelope. Empty selection removes the spec. Fenced by
   * `#writingToSet` so the store mirror ignores this self-inflicted change.
   */
  #publishToSet(
    target: RowsFilterSetPublishTarget<TRow>,
    tuples: Array<Array<unknown>>,
  ): void {
    const fields = target.fields ?? target.columns;
    this.#writingToSet = true;
    try {
      if (tuples.length === 0) {
        target.into.remove(target.id);
        return;
      }
      const firstField = fields[0] ?? target.columns[0] ?? '';
      const value =
        fields.length === 1
          ? tuples.map((tuple) => tuple[0])
          : { columns: [...fields], tuples: tuples.map((tuple) => [...tuple]) };
      target.into.set(
        {
          id: target.id,
          column: firstField,
          kind: 'points',
          value,
          label: target.label,
        },
        { clients: new Set<MosaicClient>([this.mosaicClient]) },
      );
    } finally {
      this.#writingToSet = false;
    }
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
    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#adoptFromSet(setTarget);
      return Promise.resolve();
    }
    this.#persist?.hydrate((tuples) => {
      this.setSelectedValues(tuples);
    });
    return Promise.resolve();
  }

  /**
   * Adopt any pre-existing spec (e.g. set-level persistence) into the tracked
   * tuples and re-associate this client for self-exclusion (the set
   * republishes on a clients-set change).
   */
  #adoptFromSet(target: RowsFilterSetPublishTarget<TRow>): void {
    // The deferred prepare hook can run in the microtask window after this
    // client was destroyed (StrictMode / fast remount discards the first
    // client). A dead client must never re-key the surviving clause to its own
    // about-to-die MosaicClient, or self-exclusion is lost for the live client.
    if (this.destroyed) {
      return;
    }
    const spec = target.into.store.state.specs.find(
      (candidate) => candidate.id === target.id,
    );
    if (spec === undefined) {
      return;
    }
    this.#adoptSpecValue(spec);
    this.#writingToSet = true;
    try {
      target.into.set(spec, {
        clients: new Set<MosaicClient>([this.mosaicClient]),
      });
    } finally {
      this.#writingToSet = false;
    }
    // The re-key above only reaches the composed filterBy selection's published
    // value one dispatch later; re-query once it is confirmed self-excluded for
    // this client, so the stale first query (keyed to the prior client) is not
    // left on screen.
    this.requeryOnSelfExclusion(target.id);
  }

  /**
   * An external actor (chip bar, global reset) can drop this client's select
   * clause from the published Selection; mirror that into the tracked tuples
   * and persist the removal. Select only — hover is transient. The select
   * source may be caller-provided and shared, so detection is by source
   * identity: a legitimately surviving clause under a stable source is left
   * alone. Skipped for the `publish.select.into` form (see #wireSetMirror).
   */
  #wireExternalClear(): void {
    const target = this.#selectionTarget();
    if (target === null) {
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
   * Mirror the page-level FilterSet back into the tracked tuples for a
   * `publish.select.into` target: an external removal clears the selection and
   * a changed points value is adopted, both without republishing. Fenced by
   * `#writingToSet` so only others' changes are reflected.
   */
  #wireSetMirror(): void {
    const target = this.#setTarget();
    if (target === null) {
      return;
    }
    const unsubscribe = target.into.store.subscribe(() => {
      if (this.destroyed || this.#writingToSet) {
        return;
      }
      const spec = target.into.store.state.specs.find(
        (candidate) => candidate.id === target.id,
      );
      if (spec === undefined) {
        if (this.#selectedTuples.length > 0) {
          this.#selectedTuples = [];
          this.#hasSelectClause = false;
        }
        return;
      }
      this.#adoptSpecValue(spec);
    });
    this.onDestroy(() => unsubscribe.unsubscribe());
  }

  /**
   * Adopt a `points` spec's value into the tracked tuples without
   * republishing. Handles both the flat scalar-array (single-field) and the
   * `{ columns, tuples }` envelope (multi-field) shapes the publish path emits.
   */
  #adoptSpecValue(spec: FilterSpec): void {
    this.#selectedTuples = tuplesFromPointsValue(spec.value);
    this.#hasSelectClause = this.#selectedTuples.length > 0;
  }

  /**
   * Resolve the persister, but only for the raw-Selection select form. Without
   * a select target, or with a `publish.select.into` target (the set owns
   * persistence), warn and ignore (mirrors the `filterStable` posture).
   */
  #resolvePersist(): PersisterLifecycle<Array<Array<unknown>>> | null {
    const persist = this.#options.persist;
    if (!persist) {
      return null;
    }
    if (this.#setTarget() !== null) {
      console.warn(
        '[mosaic-core] A rows client was given both `persist` and a ' +
          '`publish.select.into` FilterSet target; the set owns persistence, ' +
          'so the client-level persister is ignored.',
      );
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

/** A multi-column points envelope: parallel `columns` and `tuples`. */
interface PointsTupleEnvelope {
  columns: Array<string>;
  tuples: Array<Array<unknown>>;
}

function isPointsTupleEnvelope(value: unknown): value is PointsTupleEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PointsTupleEnvelope).columns) &&
    Array.isArray((value as PointsTupleEnvelope).tuples)
  );
}

/**
 * Converts a `points` spec value back into tracked tuples: the multi-field
 * `{ columns, tuples }` envelope round-trips as-is; a flat scalar array becomes
 * one single-value tuple per element.
 */
function tuplesFromPointsValue(value: unknown): Array<Array<unknown>> {
  if (isPointsTupleEnvelope(value)) {
    return value.tuples.map((tuple) => [...tuple]);
  }
  if (Array.isArray(value)) {
    return value.map((scalar) => [scalar]);
  }
  return [];
}

function assertPublishFields(
  target: { columns: Array<unknown>; fields?: Array<unknown> } | undefined,
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
