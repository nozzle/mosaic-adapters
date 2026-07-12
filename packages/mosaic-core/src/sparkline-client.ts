import {
  Query,
  asc,
  avg,
  column,
  count,
  dateBin,
  isIn,
  literal,
  max,
  min,
  sql,
  sum,
} from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { toResultRows } from './utils';
import type { ExprNode, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  QueryContext,
  SparklineClient,
  SparklineClientOptions,
  SparklineClientState,
  SparklineInputs,
  SparklinePoint,
  SparklineY,
} from './types';

/** Aliases inside the batched query; never surfaced to consumers. */
const KEY_COLUMN = '__key__';
const X_COLUMN = '__x__';
const Y_COLUMN = '__y__';

/**
 * Batched per-key series — the sidecar pattern as a plain data client. One
 * query serves every sparkline cell on a page: `WHERE key IN (…) GROUP BY
 * key, x`, with `keys` a serializable input typically derived from a rows
 * client's visible page. X is a declarative raw column, numeric bin, or date
 * bin; Y a declarative aggregate.
 */
export function createSparklineClient(
  options: SparklineClientOptions,
): SparklineClient {
  validateAggregate(options.y);
  return new SparklineDataClient(options);
}

class SparklineDataClient
  extends BaseDataClient<SparklineInputs, SparklineClientState>
  implements SparklineClient
{
  readonly #options: SparklineClientOptions;

  constructor(options: SparklineClientOptions) {
    // Filtering changes which (key, x) groups exist, so pre-aggregation is
    // unsafe by default (overridable for callers who know better).
    super(
      { ...options, filterStable: options.filterStable ?? false },
      options.from,
      { series: new Map() },
    );
    this.#options = options;
  }

  protected buildQuery(ctx: QueryContext<SparklineInputs>): SelectQuery | null {
    const keys = ctx.inputs.keys ?? [];
    if (keys.length === 0 && this.#options.filterBy === undefined) {
      // No series requested and no cross-filter wired: skip the round trip
      // entirely — the answer (no series) is already known without asking
      // the database. `#materialize` publishes `onEmpty()` and elides the
      // query. With a `filterBy` Selection this shortcut is unsafe (see the
      // `buildQuery` contract in base-client), so cross-filtered clients
      // keep the trivial `WHERE FALSE` query below.
      return null;
    }

    const query = Query.from(this.resolveBase(ctx))
      .select({
        [KEY_COLUMN]: column(this.#options.key),
        [X_COLUMN]: this.#xExpression(),
        [Y_COLUMN]: yExpression(this.#options.y),
      })
      .groupby(KEY_COLUMN, X_COLUMN)
      .orderby(asc(KEY_COLUMN), asc(X_COLUMN));

    if (keys.length === 0) {
      // Cross-filtered with no series requested: keep the contract of one
      // (trivial) query per trigger, because upstream selection updates
      // never null-guard `client.query()`.
      query.where(literal(false));
    } else {
      query.where(
        isIn(
          column(this.#options.key),
          keys.map((key) => literal(key)),
        ),
      );
    }
    return query;
  }

  protected onResult(data: unknown): Partial<SparklineClientState> {
    const series = new Map<unknown, Array<SparklinePoint>>();
    for (const row of toResultRows(data)) {
      const key = row[KEY_COLUMN];
      let points = series.get(key);
      if (points === undefined) {
        points = [];
        series.set(key, points);
      }
      points.push({
        x: normalizeX(row[X_COLUMN]),
        y: Number(row[Y_COLUMN]),
      });
    }
    return { series };
  }

  protected onEmpty(): Partial<SparklineClientState> {
    return { series: new Map() };
  }

  #xExpression(): ExprNode {
    const { column: xColumn, step, interval } = this.#options.x;
    const field = column(xColumn);
    if (interval !== undefined) {
      return dateBin(field, interval);
    }
    if (step !== undefined) {
      return sql`floor(${field} / ${literal(step)}) * ${literal(step)}`;
    }
    return field;
  }
}

function yExpression(y: SparklineY): ExprNode {
  switch (y.agg) {
    case 'count':
      return count();
    case 'sum':
      return sum(column(y.column!));
    case 'avg':
      return avg(column(y.column!));
    case 'min':
      return min(column(y.column!));
    case 'max':
      return max(column(y.column!));
  }
}

function validateAggregate(y: SparklineY): void {
  if (y.agg !== 'count' && y.column === undefined) {
    throw new Error(
      `Sparkline y aggregate '${y.agg}' requires a column (only 'count' works without one).`,
    );
  }
}

function normalizeX(value: unknown): number | Date {
  if (value instanceof Date) {
    return value;
  }
  return Number(value);
}
