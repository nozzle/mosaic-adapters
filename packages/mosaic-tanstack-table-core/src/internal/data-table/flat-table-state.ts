import type { TableState } from '@tanstack/table-core';

export type FlatTableStateChangeSet = {
  filtersChanged: boolean;
  paginationChanged: boolean;
  sortingChanged: boolean;
  rowSelectionChanged: boolean;
  columnVisibilityChanged: boolean;
  columnOrderChanged: boolean;
  columnPinningChanged: boolean;
  rowPinningChanged: boolean;
  globalFilterChanged: boolean;
  expandedChanged: boolean;
  groupingChanged: boolean;
  columnSizingChanged: boolean;
  columnSizingInfoChanged: boolean;
  hasAnyChange: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainStructureEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) =>
      isPlainStructureEqual(value, right[index]),
    );
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) =>
      isPlainStructureEqual(left[key], right[key]),
    );
  }

  return false;
}

export function getFlatTableStateChanges(
  previousState: TableState,
  nextState: TableState,
): FlatTableStateChangeSet {
  const filtersChanged = !isPlainStructureEqual(
    previousState.columnFilters,
    nextState.columnFilters,
  );
  const paginationChanged = !isPlainStructureEqual(
    previousState.pagination,
    nextState.pagination,
  );
  const sortingChanged = !isPlainStructureEqual(
    previousState.sorting,
    nextState.sorting,
  );
  const rowSelectionChanged = !isPlainStructureEqual(
    previousState.rowSelection,
    nextState.rowSelection,
  );
  const columnVisibilityChanged = !isPlainStructureEqual(
    previousState.columnVisibility,
    nextState.columnVisibility,
  );
  const columnOrderChanged = !isPlainStructureEqual(
    previousState.columnOrder,
    nextState.columnOrder,
  );
  const columnPinningChanged = !isPlainStructureEqual(
    previousState.columnPinning,
    nextState.columnPinning,
  );
  const rowPinningChanged = !isPlainStructureEqual(
    previousState.rowPinning,
    nextState.rowPinning,
  );
  const globalFilterChanged = !isPlainStructureEqual(
    previousState.globalFilter,
    nextState.globalFilter,
  );
  const expandedChanged = !isPlainStructureEqual(
    previousState.expanded,
    nextState.expanded,
  );
  const groupingChanged = !isPlainStructureEqual(
    previousState.grouping,
    nextState.grouping,
  );
  const columnSizingChanged = !isPlainStructureEqual(
    previousState.columnSizing,
    nextState.columnSizing,
  );
  const columnSizingInfoChanged = !isPlainStructureEqual(
    previousState.columnSizingInfo,
    nextState.columnSizingInfo,
  );

  const hasAnyChange =
    filtersChanged ||
    paginationChanged ||
    sortingChanged ||
    rowSelectionChanged ||
    columnVisibilityChanged ||
    columnOrderChanged ||
    columnPinningChanged ||
    rowPinningChanged ||
    globalFilterChanged ||
    expandedChanged ||
    groupingChanged ||
    columnSizingChanged ||
    columnSizingInfoChanged;

  return {
    filtersChanged,
    paginationChanged,
    sortingChanged,
    rowSelectionChanged,
    columnVisibilityChanged,
    columnOrderChanged,
    columnPinningChanged,
    rowPinningChanged,
    globalFilterChanged,
    expandedChanged,
    groupingChanged,
    columnSizingChanged,
    columnSizingInfoChanged,
    hasAnyChange,
  };
}
