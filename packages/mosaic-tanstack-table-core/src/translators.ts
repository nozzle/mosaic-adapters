import type { OrderByItem } from '@nozzleio/mosaic-core';
import type { PaginationState, SortingState } from '@tanstack/table-core';

/**
 * Translate TanStack sorting state into serializable `orderBy` inputs for a
 * rows client. Column ids are used as SQL column names unless remapped via
 * `columnMap` (TanStack column id → SQL column).
 */
export function sortingToOrderBy(
  sorting: SortingState,
  columnMap?: Record<string, string>,
): Array<OrderByItem> {
  return sorting.map((item) => ({
    column: columnMap?.[item.id] ?? item.id,
    desc: item.desc,
  }));
}

/**
 * Translate TanStack pagination state into serializable `{ limit, offset }`
 * window inputs for a rows client.
 */
export function paginationToWindow(pagination: PaginationState): {
  limit: number;
  offset: number;
} {
  return {
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  };
}

/**
 * Clamp a TanStack `pageIndex` into the valid range implied by a rows client's
 * `totalRows`, preserving `pageSize`.
 *
 * This is *the* sharp edge of the manual-pagination model. TanStack does not
 * know how many rows the backend holds, so it will happily keep a `pageIndex`
 * that no longer has any rows behind it. The classic trap: the user is on a
 * later page, applies a filter that shrinks the result below the current
 * offset, and the table renders empty with a stuck, broken pager. Feed the
 * incoming pagination through this helper against the latest `totalRows` before
 * building the next window so the offset always lands on a page that exists.
 *
 * ### `rowCount` caveat
 * How well past-the-end recovery works depends on the rows client's `rowCount`
 * mode:
 * - `'window'`: an offset past the end returns zero rows *and* `totalRows: 0`,
 *   which is indistinguishable from a genuinely empty result. With no true
 *   total to aim at, this helper can only recover to page `0`, not the real
 *   last page.
 * - `'query'`: returns an accurate total regardless of the requested window, so
 *   `pageIndex` clamps to the true last page. Consumers that need exact
 *   last-page recovery should use `'query'`.
 *
 * `totalRows` of `0` or `undefined` (no total yet, or an empty result) clamps to
 * page `0`. A defensively invalid `pageSize` (`<= 0`) also clamps to page `0`
 * rather than dividing by zero. When the incoming `pageIndex` is already in
 * range the input object is returned unchanged, avoiding needless re-renders.
 *
 * @example
 * ```ts
 * const result = rowsClient.getResult();
 * const safe = clampPagination(pagination, result.totalRows);
 * const window = paginationToWindow(safe);
 * ```
 */
export function clampPagination(
  pagination: PaginationState,
  totalRows: number | undefined,
): PaginationState {
  const hasRows =
    typeof totalRows === 'number' && totalRows > 0 && pagination.pageSize > 0;
  const lastPageIndex = hasRows
    ? Math.ceil(totalRows / pagination.pageSize) - 1
    : 0;
  const clampedIndex = Math.min(
    Math.max(pagination.pageIndex, 0),
    lastPageIndex,
  );

  if (clampedIndex === pagination.pageIndex) {
    return pagination;
  }

  return { ...pagination, pageIndex: clampedIndex };
}
