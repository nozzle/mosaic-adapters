import {
  PivotQuery,
  asc,
  avg,
  column,
  count,
  desc,
  max,
  min,
  sum,
} from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { resolveCoerce, toResultRows } from './utils';
import type { ExprNode, ExprValue } from '@uwdata/mosaic-sql';
import type {
  CoerceOption,
  OrderByItem,
  PivotAggregate,
  PivotClient,
  PivotClientOptions,
  PivotClientState,
  QueryContext,
  RowsInputs,
} from './types';

/**
 * True crosstabs via DuckDB `PIVOT` (mosaic-sql's `PivotQuery`). The pivot
 * output columns are dynamic — DuckDB derives one per distinct `on` value
 * (unless pinned with `in`) — so the client discovers them from each result's
 * schema and surfaces them as `pivotColumns` for column-def generation.
 */
export function createPivotClient<TRow>(
  options: PivotClientOptions<TRow>,
): PivotClient<TRow> {
  if (options.using.length === 0) {
    throw new Error('Pivot clients require at least one `using` aggregate.');
  }
  for (const aggregate of options.using) {
    if (aggregate.agg !== 'count' && aggregate.column === undefined) {
      throw new Error(
        `Pivot aggregate '${aggregate.agg}' requires a column (only 'count' works without one).`,
      );
    }
  }
  return new PivotDataClient(options);
}

class PivotDataClient<TRow>
  extends BaseDataClient<RowsInputs, PivotClientState<TRow>>
  implements PivotClient<TRow>
{
  readonly #options: PivotClientOptions<TRow>;
  #coerce: ((raw: Record<string, unknown>) => TRow) | undefined;

  constructor(options: PivotClientOptions<TRow>) {
    // PIVOT output columns change under filtering, so Mosaic's
    // pre-aggregation assumptions never hold for this query shape.
    super({ ...options, filterStable: false }, options.from, {
      rows: [],
      pivotColumns: [],
    });
    this.#options = options;
    this.#coerce = resolveCoerce(options.coerce);
  }

  setCoerce(coerce: CoerceOption<TRow> | undefined): void {
    this.#coerce = resolveCoerce(coerce);
  }

  protected buildQuery(ctx: QueryContext<RowsInputs>): PivotQuery {
    const query = new PivotQuery(this.resolveBase(ctx))
      .on(column(this.#options.on))
      .using(this.#options.using.map((aggregate) => usingEntry(aggregate)))
      .groupby(...this.#options.groupBy);

    const pinned = this.#options.in;
    if (pinned !== undefined && pinned.length > 0) {
      // Values are serializable literals; PivotQuery.in wraps them via asLiteral.
      query.in(...(pinned as [ExprValue, ...Array<ExprValue>]));
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

  protected onResult(data: unknown): Partial<PivotClientState<TRow>> {
    const raw = toResultRows(data);
    const names = resultColumnNames(data, raw);
    const groupColumns = new Set(this.#options.groupBy);

    return {
      rows: raw.map((record) =>
        this.#coerce ? this.#coerce(record) : (record as TRow),
      ),
      pivotColumns: names.filter((name) => !groupColumns.has(name)),
    };
  }
}

/**
 * DuckDB suffixes pivot output columns with the aggregate alias when one is
 * given (`Q1_total`); an unaliased single aggregate keeps bare value names
 * (`Q1`). Only alias when the caller asked for it.
 */
function usingEntry(
  aggregate: PivotAggregate,
): ExprNode | Record<string, ExprNode> {
  const expr = aggregateExpression(aggregate);
  if (aggregate.as === undefined) {
    return expr;
  }
  return { [aggregate.as]: expr };
}

function aggregateExpression(aggregate: PivotAggregate): ExprNode {
  switch (aggregate.agg) {
    case 'count':
      return count();
    case 'sum':
      return sum(column(aggregate.column!));
    case 'avg':
      return avg(column(aggregate.column!));
    case 'min':
      return min(column(aggregate.column!));
    case 'max':
      return max(column(aggregate.column!));
  }
}

/**
 * Column names come from the Arrow result schema when available (flechette
 * tables expose `names`); JSON-typed connectors fall back to the first row's
 * keys.
 */
function resultColumnNames(
  data: unknown,
  rows: Array<Record<string, unknown>>,
): Array<string> {
  if (
    data !== null &&
    typeof data === 'object' &&
    'names' in data &&
    Array.isArray(data.names)
  ) {
    return (data as { names: Array<string> }).names.map(String);
  }
  const first = rows[0];
  if (first === undefined) {
    return [];
  }
  return Object.keys(first);
}

function toOrderByNode(item: OrderByItem) {
  if (item.desc === true) {
    return desc(item.column, item.nullsFirst);
  }
  return asc(item.column, item.nullsFirst);
}
