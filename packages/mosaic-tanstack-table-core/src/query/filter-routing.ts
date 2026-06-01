import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';

/** SQL clause target for adapter-emitted filter predicates. */
export type SqlFilterClauseTarget = 'where';

export type RoutedFilterExpr = {
  target: SqlFilterClauseTarget;
  predicate: FilterExpr;
};

export function routeFilter(
  predicate: FilterExpr | null | undefined,
  target: SqlFilterClauseTarget = 'where',
): RoutedFilterExpr | null {
  if (!predicate) {
    return null;
  }

  return {
    target,
    predicate,
  };
}

/**
 * Applies adapter-emitted filter predicates to their explicit SQL clause target.
 *
 * Placement is an adapter concern. Mosaic Selections are placement-agnostic;
 * routing happens at the SQL edge here, not inside `Selection`.
 *
 * Caller is responsible for predicate validity in its target clause position.
 * This matters once non-WHERE targets are added.
 *
 * Call after `groupBy` is applied to the statement, so future HAVING predicates
 * can reference grouped columns.
 *
 * The target switch is intentionally exhaustive. Adding a target should prompt
 * every routing edge to make an explicit placement choice.
 */
export function applyRoutedFilters(
  statement: SelectQuery,
  filters: Array<RoutedFilterExpr | null | undefined>,
): void {
  const grouped = new Map<SqlFilterClauseTarget, Array<FilterExpr>>();

  for (const filter of filters) {
    if (!filter) {
      continue;
    }

    const existing = grouped.get(filter.target) ?? [];
    existing.push(filter.predicate);
    grouped.set(filter.target, existing);
  }

  for (const [target, predicates] of grouped) {
    if (predicates.length === 0) {
      continue;
    }

    switch (target) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      case 'where':
        statement.where(...predicates);
        break;
      default: {
        const exhaustive: never = target;
        return exhaustive;
      }
    }
  }
}
