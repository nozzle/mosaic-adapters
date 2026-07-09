import { clauseInterval } from '@uwdata/mosaic-core';
import {
  Query,
  asc,
  binHistogram,
  binSpec,
  column,
  count,
  isNotNull,
  max,
  min,
} from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { PersisterLifecycle } from './persistence';
import { isFilterSetPublishTarget } from './types';
import { toResultRows } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { FilterSpec } from './filter-set/types';
import type {
  FilterSetPublishTarget,
  HistogramBin,
  HistogramClient,
  HistogramClientOptions,
  HistogramClientState,
  HistogramInputs,
  QueryContext,
} from './types';

/**
 * Binned counts of a numeric column in, interval clauses out.
 *
 * Bin boundaries ride on mosaic-sql's `binHistogram` over a fixed extent —
 * given as an option or discovered once from the unfiltered base relation in
 * `prepare` — so filters (including this client's own published brush) change
 * the counts, never the bins. The published clause carries this client in its
 * `clients` set: under a crossfilter Selection, its own brush never filters
 * its own bins.
 */
export function createHistogramClient(
  options: HistogramClientOptions,
): HistogramClient {
  return new HistogramDataClient(options);
}

class HistogramDataClient
  extends BaseDataClient<HistogramInputs, HistogramClientState>
  implements HistogramClient
{
  readonly #options: HistogramClientOptions;
  readonly #source: ClauseSource = {};
  #extent: [number, number] | null;
  /** Bin spec of the last built query — pairs result rows with boundaries. */
  #spec: { min: number; max: number; steps: number } | null = null;
  #range: [number, number] | null = null;
  #persist: PersisterLifecycle<[number, number]> | null = null;
  /** Set when writing to `publish.into`, to suppress our own store-mirror. */
  #writingToSet = false;

  constructor(options: HistogramClientOptions) {
    super(
      options,
      options.from,
      {
        bins: [],
        maxCount: 0,
        extent: options.extent ?? null,
        range: null,
      },
      { prepare: () => this.#prepareAndHydrate() },
    );
    this.#options = options;
    this.#extent = options.extent ?? null;
    this.#persist = this.#resolvePersist();
    this.#wireExternalClear();
    this.#wireSetMirror();
    this.onDestroy(() => {
      // With a `publish.into` target the intent outlives the widget: the set
      // owns the spec/clauses, so destroy must NOT clear anything.
      if (this.#setTarget() !== null) {
        return;
      }
      if (this.#range !== null) {
        this.#range = null;
        // Destroy-time clause cleanup: publish, but never persist.
        this.#publishRange(null);
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

  setRange(range: [number, number] | null): void {
    if (this.destroyed) {
      return;
    }
    this.#publishRange(range);
    this.#persist?.write(
      range === null ? null : [range[0], range[1]],
      range === null ? 'clear' : 'update',
    );
  }

  protected buildQuery(ctx: QueryContext<HistogramInputs>): SelectQuery {
    const extent = this.#extent;
    if (extent === null) {
      throw new Error(
        'Histogram extent unresolved — prepare() has not completed.',
      );
    }
    const binOptions = {
      step: ctx.inputs.step,
      steps: ctx.inputs.bins ?? 25,
    };
    this.#spec = binSpec(extent[0], extent[1], binOptions);

    const field = column(this.#options.column);
    return Query.from(this.resolveBase(ctx))
      .select({
        x0: binHistogram(field, extent, binOptions),
        count: count(),
      })
      .where(isNotNull(field))
      .groupby('x0')
      .orderby(asc('x0'));
  }

  protected onResult(data: unknown): Partial<HistogramClientState> {
    const spec = this.#spec;
    if (spec === null || !Number.isFinite(spec.steps) || spec.steps <= 0) {
      return { bins: [], maxCount: 0 };
    }

    const step = (spec.max - spec.min) / spec.steps;
    const bins: Array<HistogramBin> = Array.from(
      { length: spec.steps },
      (_, index) => ({
        x0: spec.min + index * step,
        x1: spec.min + (index + 1) * step,
        count: 0,
      }),
    );

    let maxCount = 0;
    for (const row of toResultRows(data)) {
      const x0 = Number(row.x0);
      const binCount = Number(row.count);
      const index = Math.min(
        bins.length - 1,
        Math.max(0, Math.round((x0 - spec.min) / step)),
      );
      const bin = bins[index];
      if (bin === undefined) {
        continue;
      }
      bin.count += binCount;
      maxCount = Math.max(maxCount, bin.count);
    }

    return { bins, maxCount, extent: this.#extent };
  }

  /**
   * Extent discovery, then hydration — in that order, inside one prepare hook
   * and before the first main query. Extent discovery queries the *unfiltered*
   * base relation (`where: []`), so a hydrated brush clause cannot corrupt it;
   * ordering them anyway keeps the sequencing obvious and safe if that ever
   * changes. Sync reads apply here (first query already filtered); async reads
   * apply on resolve and re-query.
   */
  async #prepareAndHydrate(): Promise<void> {
    await this.#prepare();
    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#adoptFromSet(setTarget);
      return;
    }
    this.#persist?.hydrate((range) => {
      this.#publishRange([range[0], range[1]]);
    });
  }

  /**
   * Adopt any pre-existing spec (e.g. set-level persistence) into local state
   * and re-associate this client for self-exclusion (the set republishes on a
   * clients-set change).
   */
  #adoptFromSet(target: FilterSetPublishTarget): void {
    // The deferred prepare hook runs after an awaited extent-discovery query,
    // so this client can be destroyed by the time it reaches here (StrictMode /
    // fast remount discards the first client). A dead client must never re-key
    // the surviving clause to its own about-to-die MosaicClient, or
    // self-exclusion is lost for the live client.
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
   * One-time extent discovery over the unfiltered base relation, so bin
   * boundaries are independent of the page's filter state.
   */
  async #prepare(): Promise<void> {
    if (this.#extent !== null) {
      return;
    }
    const field = column(this.#options.column);
    const base = this.resolveBase({
      where: [],
      having: [],
      inputs: this.store.state.inputs,
    });
    const query = Query.from(base).select({
      min: min(field),
      max: max(field),
    });
    const rows = toResultRows(await this.#options.coordinator.query(query));
    const first = rows[0];
    if (first === undefined || first.min == null || first.max == null) {
      throw new Error(
        `Histogram extent discovery returned no data for column "${this.#options.column}".`,
      );
    }
    this.#extent = [Number(first.min), Number(first.max)];
    this.patchState({ extent: this.#extent });
  }

  #publishRange(range: [number, number] | null): void {
    this.#range = range;
    this.patchState({ range });
    const publish = this.#options.publish;
    if (!publish) {
      return;
    }
    const setTarget = this.#setTarget();
    if (setTarget !== null) {
      this.#publishToSet(setTarget, range);
      return;
    }
    if (isFilterSetPublishTarget(publish)) {
      return;
    }
    publish.as.update(
      clauseInterval(column(this.#options.column), range, {
        source: this.#source,
        clients: new Set<MosaicClient>([this.mosaicClient]),
      }),
    );
  }

  /**
   * Route the brush into a page-level FilterSet: upsert an `interval` spec
   * (non-null range) or remove it (null). Fenced by `#writingToSet` so the
   * store mirror ignores this self-inflicted change.
   */
  #publishToSet(
    target: FilterSetPublishTarget,
    range: [number, number] | null,
  ): void {
    this.#writingToSet = true;
    try {
      if (range === null) {
        target.into.remove(target.id);
        return;
      }
      target.into.set(
        {
          id: target.id,
          column: this.#options.column,
          kind: target.kind ?? 'interval',
          value: [range[0], range[1]],
          label: target.label,
        },
        { clients: new Set<MosaicClient>([this.mosaicClient]) },
      );
    } finally {
      this.#writingToSet = false;
    }
  }

  /** Mirror an external clause removal (chip bar, global reset) into `range`. */
  #wireExternalClear(): void {
    const publish = this.#options.publish;
    if (!publish || isFilterSetPublishTarget(publish)) {
      // The FilterSet form mirrors external removals through its store.
      return;
    }
    const target = publish;
    const listener = () => {
      if (this.destroyed || this.#range === null) {
        return;
      }
      const present = target.as.clauses.some(
        (clause) => clause.source === this.#source,
      );
      if (!present) {
        this.#range = null;
        this.patchState({ range: null });
        this.#persist?.write(null, 'external');
      }
    };
    target.as.addEventListener('value', listener);
    this.onDestroy(() => target.as.removeEventListener('value', listener));
  }

  /**
   * Mirror the page-level FilterSet back into local state for a `publish.into`
   * target: an external removal clears the range, and a changed interval value
   * is adopted without republishing. Fenced by `#writingToSet`.
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
        if (this.#range !== null) {
          this.#range = null;
          this.patchState({ range: null });
        }
        return;
      }
      this.#adoptSpecValue(spec);
    });
    this.onDestroy(() => unsubscribe.unsubscribe());
  }

  /** Adopt a spec's interval value into local `range` without republishing. */
  #adoptSpecValue(spec: FilterSpec): void {
    const next = this.#readIntervalRange(spec.value);
    if (
      (next === null && this.#range === null) ||
      (next !== null &&
        this.#range !== null &&
        next[0] === this.#range[0] &&
        next[1] === this.#range[1])
    ) {
      return;
    }
    this.#range = next;
    this.patchState({ range: next });
  }

  /** Reads a `[lo, hi]` numeric range from a spec value, else null. */
  #readIntervalRange(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length < 2) {
      return null;
    }
    const lo = Number(value[0]);
    const hi = Number(value[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return null;
    }
    return [lo, hi];
  }

  /**
   * Resolve the persister, but only for the raw-Selection publish form. Without
   * a publish target, or with a `publish.into` target (the set owns
   * persistence), warn and ignore (mirrors the `filterStable` posture).
   */
  #resolvePersist(): PersisterLifecycle<[number, number]> | null {
    const persist = this.#options.persist;
    if (!persist) {
      return null;
    }
    if (this.#setTarget() !== null) {
      console.warn(
        '[mosaic-core] A histogram client was given both `persist` and a ' +
          '`publish.into` FilterSet target; the set owns persistence, so the ' +
          'client-level persister is ignored.',
      );
      return null;
    }
    if (!this.#options.publish) {
      console.warn(
        '[mosaic-core] A histogram client was given `persist` without a ' +
          '`publish` target; persistence has nothing to persist and is ' +
          'ignored.',
      );
      return null;
    }
    return new PersisterLifecycle(persist, () => this.destroyed);
  }
}
