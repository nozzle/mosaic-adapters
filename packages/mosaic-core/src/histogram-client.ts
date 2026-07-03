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
import { toResultRows } from './utils';
import type { ClauseSource, MosaicClient } from '@uwdata/mosaic-core';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type {
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
    this.onDestroy(() => {
      if (this.#range !== null) {
        this.#range = null;
        // Destroy-time clause cleanup: publish, but never persist.
        this.#publishRange(null);
      }
    });
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
    this.#persist?.hydrate((range) => {
      this.#publishRange([range[0], range[1]]);
    });
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
    const target = this.#options.publish;
    if (!target) {
      return;
    }
    target.as.update(
      clauseInterval(column(this.#options.column), range, {
        source: this.#source,
        clients: new Set<MosaicClient>([this.mosaicClient]),
      }),
    );
  }

  /** Mirror an external clause removal (chip bar, global reset) into `range`. */
  #wireExternalClear(): void {
    const target = this.#options.publish;
    if (!target) {
      return;
    }
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
   * Resolve the persister, but only when there is a publish target to persist
   * *for*; without one, warn and ignore (mirrors the `filterStable` posture).
   */
  #resolvePersist(): PersisterLifecycle<[number, number]> | null {
    const persist = this.#options.persist;
    if (!persist) {
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
