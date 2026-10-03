/**
 * Pure histogram building blocks: the binning logic behind
 * {@link createHistogramClient}, exported so an application that renders
 * histograms through its own query path (a rows client, a chart library's
 * data loader, a raw `coordinator.query()`) bins exactly like the client.
 *
 * Nothing here talks to a coordinator. The consumer runs
 * {@link histogramExtentQuery} itself (once, unfiltered), builds a
 * {@link histogramBinning} from the result, selects
 * {@link histogramSelect} under {@link histogramFilter}, and folds the result
 * rows back into contiguous bins with {@link histogramBinsFromRows}.
 */
import {
  Query,
  and,
  binHistogram,
  binSpec,
  count,
  gt,
  isNotNull,
  max,
  min,
  scaleTransform,
} from '@uwdata/mosaic-sql';
import type { ExprNode, Scale, SelectQuery, TableRefNode } from '@uwdata/mosaic-sql';

import { columnAccess } from './sql-access';
import type { ColumnPathOptions, HistogramBin } from './types';

/** Scale transform used to space histogram bin boundaries. */
export type HistogramScale = 'linear' | 'log';

/** Default desired bin count when neither `step` nor `bins` is given. */
const DEFAULT_BIN_STEPS = 25;

export interface HistogramBinningOptions {
  /**
   * Fixed `[min, max]` domain for the bin boundaries — typically discovered
   * once with {@link histogramExtentQuery} over the unfiltered relation, so
   * filters change the counts, never the boundaries.
   */
  extent: [number, number];
  /**
   * `log` bins uniformly in log space (and requires a positive extent).
   * Defaults to `linear`.
   */
  scale?: HistogramScale;
  /** Exact bin width (in transformed space for log scales). */
  step?: number;
  /** Desired number of bins — a hint; linear steps snap to nice numbers. Defaults to 25. */
  bins?: number;
}

/** Options mosaic-sql's `binHistogram` / `binSpec` receive for a binning. */
export interface HistogramBinOptions {
  step?: number;
  steps: number;
  nice?: boolean;
}

/**
 * A resolved binning: everything needed to build the bin query and to map
 * its result rows back to boundaries. Treat it as an opaque, immutable value
 * produced by {@link histogramBinning}.
 */
export interface HistogramBinning {
  /** The fixed domain the boundaries are derived from. */
  readonly extent: [number, number];
  readonly scale: HistogramScale;
  /**
   * Options passed to mosaic-sql's `binHistogram`. Mirrors mosaic-sql
   * internals: its shape may change with a mosaic-sql upgrade.
   */
  readonly options: HistogramBinOptions;
  /**
   * The mosaic-sql scale transform for `scale`. Mirrors mosaic-sql
   * internals: its shape may change with a mosaic-sql upgrade.
   */
  readonly transform: Scale<number>;
  /**
   * Bin boundaries in transformed space, as mosaic-sql's `binSpec` computes
   * them for this extent and options (the same computation `binHistogram`
   * runs inside the SQL expression). Mirrors mosaic-sql internals: its shape
   * may change with a mosaic-sql upgrade.
   */
  readonly spec: { min: number; max: number; steps: number };
}

/** Accepted by the column-taking helpers: a column name or a SQL expression. */
export type HistogramColumn = string | ExprNode;

/** Relation the extent query reads: a table name, a table ref, or a subquery. */
export type HistogramBase = string | TableRefNode | SelectQuery;

export interface HistogramExtentQueryOptions extends ColumnPathOptions {
  /** `log` ignores non-positive values. Defaults to `linear`. */
  scale?: HistogramScale;
}

/** Contiguous bins with zero-filled gaps, plus the largest count. */
export interface HistogramBinsResult {
  bins: Array<HistogramBin>;
  maxCount: number;
}

/**
 * Resolve a binning over a fixed extent. Throws for a log scale over a
 * non-positive extent, like {@link createHistogramClient}.
 */
export function histogramBinning(options: HistogramBinningOptions): HistogramBinning {
  const scale: HistogramScale = options.scale ?? 'linear';
  const [lo, hi] = options.extent;
  if (scale === 'log' && (lo <= 0 || hi <= 0)) {
    throw new Error('Histogram log scale requires a positive extent.');
  }
  const transform = scaleTransform<number>({ type: scale });
  const binOptions: HistogramBinOptions = {
    step: options.step,
    steps: options.bins ?? DEFAULT_BIN_STEPS,
    // Nice log boundaries can extend below a positive extent and produce an
    // off-domain partial bar. Keep log bins pinned to the exact fixed extent;
    // preserve mosaic-sql's nice linear behavior.
    nice: scale === 'log' ? false : undefined,
  };
  const extent: [number, number] = [lo, hi];
  return {
    extent,
    scale,
    options: binOptions,
    transform,
    spec: binSpec(transform.apply(lo), transform.apply(hi), binOptions),
  };
}

/**
 * The extent-discovery query: `min`/`max` of `column` over `base`, ignoring
 * non-positive values for a log scale. Run it yourself — over the
 * *unfiltered* relation, so bin boundaries stay stable while filters change
 * the counts — and read `min`/`max` from the first row
 * (see `firstResultRow`).
 */
export function histogramExtentQuery(
  base: HistogramBase,
  column: HistogramColumn,
  options: HistogramExtentQueryOptions = {},
): SelectQuery {
  const field = resolveField(column, options);
  return Query.from(base)
    .select({ min: min(field), max: max(field) })
    .where(options.scale === 'log' ? gt(field, 0) : []);
}

/**
 * Select-list entries for the bin query: `x0` (the bin's lower edge, via
 * mosaic-sql's `binHistogram`) and `count`. Group by `x0` and pair with
 * {@link histogramFilter}:
 *
 * ```ts
 * Query.from(base)
 *   .select(histogramSelect('weight', binning))
 *   .where(where, histogramFilter('weight', binning))
 *   .groupby('x0');
 * ```
 */
export function histogramSelect(
  column: HistogramColumn,
  binning: HistogramBinning,
  options: ColumnPathOptions = {},
): { x0: ExprNode; count: ExprNode } {
  const field = resolveField(column, options);
  return {
    x0: binHistogram(field, binning.extent, binning.options, binning.transform),
    count: count(),
  };
}

/**
 * Row filter the bin query needs: `column IS NOT NULL` (a NULL would form its
 * own group), and `column > 0` for a log scale.
 */
export function histogramFilter(
  column: HistogramColumn,
  binning: HistogramBinning,
  options: ColumnPathOptions = {},
): ExprNode {
  const field = resolveField(column, options);
  return and(isNotNull(field), binning.scale === 'log' ? gt(field, 0) : []);
}

/**
 * Fold bin query rows (`{ x0, count }`) into contiguous bins across the whole
 * binning domain. Empty bins carry `count: 0`, so bar charts render gaps; a
 * degenerate binning (zero-width extent) yields no bins.
 */
export function histogramBinsFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  binning: HistogramBinning,
): HistogramBinsResult {
  const { spec, transform } = binning;
  if (!Number.isFinite(spec.steps) || spec.steps <= 0) {
    return { bins: [], maxCount: 0 };
  }

  const step = (spec.max - spec.min) / spec.steps;
  const bins: Array<HistogramBin> = Array.from({ length: spec.steps }, (_, index) => ({
    x0: transform.invert(spec.min + index * step),
    x1: transform.invert(spec.min + (index + 1) * step),
    count: 0,
  }));

  let maxCount = 0;
  for (const row of rows) {
    const transformedX0 = transform.apply(Number(row.x0));
    const index = Math.min(
      bins.length - 1,
      Math.max(0, Math.round((transformedX0 - spec.min) / step)),
    );
    const bin = bins[index];
    if (bin === undefined) {
      continue;
    }
    bin.count += Number(row.count);
    maxCount = Math.max(maxCount, bin.count);
  }

  return { bins, maxCount };
}

function resolveField(column: HistogramColumn, options: ColumnPathOptions): ExprNode {
  if (typeof column === 'string') {
    return columnAccess(column, options.columnPaths);
  }
  return column;
}
