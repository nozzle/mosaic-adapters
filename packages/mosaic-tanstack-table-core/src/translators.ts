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
