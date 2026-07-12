import { asc, column, desc, sql } from '@uwdata/mosaic-sql';
import { BaseDataClient } from './base-client';
import { resolveCoerce, toResultRows } from './utils';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type {
  CoerceOption,
  QueryContext,
  RollupClient,
  RollupClientOptions,
  RollupClientState,
  RollupInputs,
  RollupRow,
  RollupTreeNode,
} from './types';

/** Alias for the injected GROUPING() bitmask; stripped from row data. */
const GROUPING_COLUMN = '__rollup_grouping__';

/**
 * Hierarchical grouping as one SQL query: `GROUP BY ROLLUP(...)` fetches the
 * whole tree — every level's subtotals plus the grand total — tagged by
 * `GROUPING()` and pre-ordered parents-before-children. Expansion is UI
 * visibility over the flat rows (`level` / `groupPath` / `isLeaf`), not a
 * data operation; `rollupRowsToTree` derives a nested view when needed.
 */
export function createRollupClient<TRow>(
  options: RollupClientOptions<TRow>,
): RollupClient<TRow> {
  if (typeof options.query === 'string') {
    throw new Error(
      'Rollup clients require a query factory producing an aggregate select ' +
        '(a bare table name would ROLLUP over un-aggregated columns).',
    );
  }
  if (options.groupBy.length === 0) {
    throw new Error('Rollup clients require at least one groupBy column.');
  }
  return new RollupDataClient(options);
}

class RollupDataClient<TRow>
  extends BaseDataClient<RollupInputs, RollupClientState<TRow>>
  implements RollupClient<TRow>
{
  readonly #groupBy: Array<string>;
  #coerce: ((raw: Record<string, unknown>) => TRow) | undefined;

  constructor(options: RollupClientOptions<TRow>) {
    // ROLLUP output (which subtotal rows exist) changes under filtering, so
    // Mosaic's pre-aggregation assumptions never hold for this query shape.
    super({ ...options, filterStable: false }, options.query, { rows: [] });
    this.#groupBy = options.groupBy;
    this.#coerce = resolveCoerce(options.coerce);
  }

  setCoerce(coerce: CoerceOption<TRow> | undefined): void {
    this.#coerce = resolveCoerce(coerce);
  }

  protected buildQuery(ctx: QueryContext<RollupInputs>): SelectQuery {
    const refs = this.#groupBy.map((name) => String(column(name)));
    const list = refs.join(', ');
    const groupCount = this.#groupBy.length;
    const mask = column(GROUPING_COLUMN);

    const query = this.resolveBase(ctx).clone();
    query.select(...this.#groupBy);
    query.select({ [GROUPING_COLUMN]: sql`GROUPING(${list})` });
    query.groupby(sql`ROLLUP(${list})`);
    // Pre-order the tree: each level's subtotal (GROUPING = 1) precedes its
    // children, real NULL group values sort with the children — the tag
    // disambiguates them from rolled-up NULLs. GROUPING(a, b, ...) already
    // packs one bit per column into __rollup_grouping__ (the first column is
    // the highest bit), so each column's own flag is read back off that mask
    // instead of issuing a redundant per-column GROUPING() call.
    query.orderby(
      this.#groupBy.flatMap((name, index) => [
        desc(sql`(${mask} >> ${groupCount - 1 - index}) & 1`),
        asc(column(name)),
      ]),
    );
    return query;
  }

  protected onResult(data: unknown): Partial<RollupClientState<TRow>> {
    const depth = this.#groupBy.length;
    const rows = toResultRows(data).map((record): RollupRow<TRow> => {
      const { [GROUPING_COLUMN]: mask, ...rest } = record;
      const level = depth - popcount(Number(mask));
      return {
        data: (this.#coerce ? this.#coerce(rest) : rest) as TRow,
        level,
        groupPath: this.#groupBy
          .slice(0, level)
          .map((name) => String(rest[name])),
        isLeaf: level === depth,
      };
    });
    return { rows };
  }
}

function popcount(mask: number): number {
  let bits = mask;
  let total = 0;
  while (bits !== 0) {
    total += bits & 1;
    bits >>>= 1;
  }
  return total;
}

/**
 * Pure nested view over the flat pre-ordered rollup rows. Returns the roots
 * (normally the single grand-total row) with children attached per level.
 */
export function rollupRowsToTree<TRow>(
  rows: Array<RollupRow<TRow>>,
): Array<RollupTreeNode<TRow>> {
  const roots: Array<RollupTreeNode<TRow>> = [];
  const stack: Array<RollupTreeNode<TRow>> = [];

  for (const row of rows) {
    const node: RollupTreeNode<TRow> = { row, children: [] };
    while (stack.length > row.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    stack.push(node);
  }

  return roots;
}
