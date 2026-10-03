import {
  PivotQuery,
  Query,
  asc,
  avg,
  column,
  count,
  desc,
  max,
  min,
  sum,
} from '@uwdata/mosaic-sql';
import type { ExprNode, ExprValue, SelectQuery } from '@uwdata/mosaic-sql';

import { BaseDataClient } from './base-client';
import { columnAccess } from './sql-access';
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
import { resolveCoerce, toResultRows } from './utils';

/**
 * True crosstabs via DuckDB `PIVOT` (mosaic-sql's `PivotQuery`). The pivot
 * output columns are dynamic — DuckDB derives one per distinct `on` value
 * (unless pinned with `in`) — so the client discovers them from each result's
 * schema and surfaces them as `pivotColumns` for column-def generation.
 */
export function createPivotClient<TRow>(options: PivotClientOptions<TRow>): PivotClient<TRow> {
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
    const query = new PivotQuery(projectStructPaths(this.resolveBase(ctx), this.#structPaths()))
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

  /**
   * Dotted (struct-path) names among `on`, `groupBy`, and the `using`
   * aggregate columns, deduplicated in first-seen order. Empty under
   * `columnPaths: 'literal'`, where every name is one identifier.
   */
  #structPaths(): Array<string> {
    if (this.#options.columnPaths === 'literal') {
      return [];
    }
    const names = [
      this.#options.on,
      ...this.#options.groupBy,
      ...this.#options.using.flatMap((aggregate) =>
        aggregate.column === undefined ? [] : [aggregate.column],
      ),
    ];
    return [...new Set(names.filter((name) => name.includes('.')))];
  }

  protected onResult(data: unknown): Partial<PivotClientState<TRow>> {
    const raw = toResultRows(data);
    const names = resultColumnNames(data, raw);
    const groupColumns = new Set(this.#options.groupBy);

    return {
      rows: raw.map((record) => (this.#coerce ? this.#coerce(record) : (record as TRow))),
      pivotColumns: names.filter((name) => !groupColumns.has(name)),
    };
  }
}

/**
 * DuckDB rejects qualified column references anywhere inside a PIVOT
 * (`ON`, `USING`, `GROUP BY`), so struct paths are projected onto the source
 * relation under their own dotted name first: `meta.country` becomes
 * `SELECT *, "meta"."country" AS "meta.country" FROM (...)`, and the PIVOT
 * then references the single identifier `"meta.country"`. A `groupBy` path
 * therefore keeps its option name as the output column. Without dotted names
 * the base query is returned untouched, so the SQL is unchanged.
 */
function projectStructPaths(base: SelectQuery, paths: Array<string>): SelectQuery {
  if (paths.length === 0) {
    return base;
  }
  const projections: Record<string, ExprNode> = {};
  for (const path of paths) {
    projections[path] = columnAccess(path);
  }
  return Query.from(base).select('*', projections);
}

/**
 * DuckDB suffixes pivot output columns with the aggregate alias when one is
 * given (`Q1_total`); an unaliased single aggregate keeps bare value names
 * (`Q1`). Only alias when the caller asked for it.
 */
function usingEntry(aggregate: PivotAggregate): ExprNode | Record<string, ExprNode> {
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
function resultColumnNames(data: unknown, rows: Array<Record<string, unknown>>): Array<string> {
  if (data !== null && typeof data === 'object' && 'names' in data && Array.isArray(data.names)) {
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
