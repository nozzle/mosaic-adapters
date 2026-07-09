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
import { isFilterSetPublishTarget } from './types';
import { deepEqual, toResultRows } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { ExprValue, SelectQuery } from '@uwdata/mosaic-sql';
import type { FilterSpec } from './filter-set/types';
import type {
  FacetClient,
  FacetClientOptions,
  FacetClientState,
  FacetInputs,
  FacetOption,
  FilterSetPublishTarget,
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
  /** Set when writing to `publish.into`, to suppress our own store-mirror. */
  #writingToSet = false;

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
    this.#wireSetMirror();
    this.onDestroy(() => {
      // With a `publish.into` target the intent outlives the widget: the set
      // owns the spec/clauses, so destroy must NOT clear anything — the store
      // mirror is unsubscribed via its own onDestroy.
      if (this.#setTarget() !== null) {
        return;
      }
      if (this.#selected.length > 0) {
        this.#selected = [];
        // Destroy-time clause cleanup: publish, but never persist — a
        // StrictMode unmount must not wipe the consumer's storage.
        this.#publish();
      }
    });
  }

  /** The `publish.into` target when configured, else null. */
  #setTarget(): FilterSetPublishTarget | null {
    const publish = this.#options.publish;
    if (isFilterSetPublishTarget(publish)) {
      return publish;
    }
    return null;
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
    const publish = this.#options.publish;
    if (!publish) {
      return;
    }
    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#publishToSet(setTarget);
      return;
    }
    if (isFilterSetPublishTarget(publish)) {
      return;
    }
    publish.as.update(this.#buildClause());
  }

  /**
   * Route the selection into a page-level FilterSet: upsert one spec keyed by
   * `id` (non-empty selection) or remove it (empty). The set owns clause
   * publication, self-exclusion clients, and persistence. Guarded by
   * `#writingToSet` so the store mirror ignores this self-inflicted change.
   */
  #publishToSet(target: FilterSetPublishTarget): void {
    this.#writingToSet = true;
    try {
      if (this.#selected.length === 0) {
        target.into.remove(target.id);
        return;
      }
      target.into.set(this.#buildSetSpec(target), {
        clients: new Set<MosaicClient>([this.mosaicClient]),
      });
    } finally {
      this.#writingToSet = false;
    }
  }

  /**
   * Builds the {@link FilterSpec} for a `publish.into` write. The default kind
   * mirrors the raw-clause shapes: array columns use `condition` +
   * `list_has_any` (which routes to the array collection path regardless of
   * columnType), multi-select uses `points`, single-select `point`.
   * `publish.kind` overrides the kind name while keeping the same value shape.
   */
  #buildSetSpec(target: FilterSetPublishTarget): FilterSpec {
    const base = {
      id: target.id,
      column: this.#options.column,
      label: target.label,
    };
    if (this.#options.arrayColumn) {
      return {
        ...base,
        kind: target.kind ?? 'condition',
        operator: 'list_has_any',
        value: [...this.#selected],
      };
    }
    if ((this.#options.select ?? 'single') === 'multi') {
      return {
        ...base,
        kind: target.kind ?? 'points',
        value: [...this.#selected],
      };
    }
    return { ...base, kind: target.kind ?? 'point', value: this.#selected[0] };
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
    const publish = this.#options.publish;
    if (!publish || isFilterSetPublishTarget(publish)) {
      // The FilterSet form mirrors external removals through its store, not
      // through a raw-Selection `value` listener (see #wireSetMirror).
      return;
    }
    const target = publish;
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

  /**
   * Mirror the page-level FilterSet back into local state for a `publish.into`
   * target: an external removal (chip bar, `set.remove`, global reset) clears
   * the selection, and a narrowed spec value (chip removal on a multi-value
   * spec) is adopted without republishing. Our own writes are fenced by
   * `#writingToSet`, so this only reacts to changes made by others.
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
        if (this.#selected.length > 0) {
          this.#selected = [];
          this.patchState({ selected: [] });
        }
        return;
      }
      this.#adoptSpecValue(spec);
    });
    this.onDestroy(() => unsubscribe.unsubscribe());
  }

  /**
   * Adopt a spec's value into local `selected` state without republishing.
   * Reuses the same value normalization the publish path produces, so the
   * store mirror and initial-adopt paths share one code path.
   */
  #adoptSpecValue(spec: FilterSpec): void {
    const next = Array.isArray(spec.value)
      ? [...spec.value]
      : spec.value === undefined || spec.value === null
        ? []
        : [spec.value];
    if (deepEqual(next, this.#selected)) {
      return;
    }
    this.#selected = next;
    this.patchState({ selected: next });
  }

  /**
   * Hydrate persisted intent before the first query (sync reads apply now).
   * For a `publish.into` target, adopt any pre-existing spec (e.g. set-level
   * persistence) into local state and re-associate this client for
   * self-exclusion (the set republishes on a clients-set change).
   */
  #prepare(): Promise<void> {
    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#adoptFromSet(setTarget);
      return Promise.resolve();
    }
    this.#persist?.hydrate((values) => {
      this.setSelected(values);
    });
    return Promise.resolve();
  }

  #adoptFromSet(target: FilterSetPublishTarget): void {
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
    // Re-publish the existing spec with this client attached so its clause
    // excludes this facet (crossfilter self-exclusion). The set bypasses
    // publish suppression when the clients association changes.
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
   * Resolve the persister, but only for the raw-Selection publish form. Without
   * a publish target, or with a `publish.into` target (the set owns
   * persistence), warn and ignore (mirrors the `filterStable` posture).
   */
  #resolvePersist(): PersisterLifecycle<Array<unknown>> | null {
    const persist = this.#options.persist;
    if (!persist) {
      return null;
    }
    if (this.#setTarget() !== null) {
      console.warn(
        '[mosaic-core] A facet client was given both `persist` and a ' +
          '`publish.into` FilterSet target; the set owns persistence, so the ' +
          'client-level persister is ignored.',
      );
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
