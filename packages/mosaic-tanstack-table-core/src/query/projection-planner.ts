import type { TableState } from '@tanstack/table-core';

export type ProjectionColumn = {
  id: string;
  visibleSelects: Array<string>;
  declaredSelects: Array<string>;
  sortingSelects: Array<string>;
  filteringSelects: Array<string>;
  globalFilteringSelects: Array<string>;
};

export interface ProjectionPlanOptions {
  columns: Array<ProjectionColumn>;
  tableState: TableState;
  rowIdentityFields?: Array<string>;
  requiredFields?: Array<string>;
}

function addFields(target: Set<string>, fields: Array<string>) {
  fields.forEach((field) => {
    if (field.trim().length === 0) {
      return;
    }
    target.add(field);
  });
}

export function planProjection(options: ProjectionPlanOptions): Array<string> {
  const projected = new Set<string>();
  const activeSortIds = new Set(
    options.tableState.sorting.map((sort) => sort.id),
  );
  const activeFilterIds = new Set(
    options.tableState.columnFilters.map((filter) => filter.id),
  );
  const hasGlobalFilter =
    options.tableState.globalFilter !== undefined &&
    options.tableState.globalFilter !== null &&
    String(options.tableState.globalFilter).trim().length > 0;

  options.columns.forEach((column) => {
    if (options.tableState.columnVisibility[column.id] !== false) {
      addFields(projected, column.visibleSelects);
      addFields(projected, column.declaredSelects);
    }

    if (activeSortIds.has(column.id)) {
      addFields(projected, column.sortingSelects);
    }

    if (activeFilterIds.has(column.id)) {
      addFields(projected, column.filteringSelects);
    }

    if (hasGlobalFilter) {
      addFields(projected, column.globalFilteringSelects);
    }
  });

  if (options.rowIdentityFields) {
    addFields(projected, options.rowIdentityFields);
  }

  if (options.requiredFields) {
    addFields(projected, options.requiredFields);
  }

  return Array.from(projected);
}
