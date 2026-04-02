import type {
  ColumnType,
  FacetSortMode,
  MosaicTableSource,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { Selection } from '@uwdata/mosaic-core';

export type FilterValueKind =
  | 'text'
  | 'facet-single'
  | 'facet-multi'
  | 'date'
  | 'date-range'
  | 'number'
  | 'number-range';

export type FilterOperatorId = string;

export interface FilterDefinition {
  id: string;
  label: string;
  column: string;
  valueKind: FilterValueKind;
  operators: Array<FilterOperatorId>;
  defaultOperator?: FilterOperatorId;
  facet?: {
    table: MosaicTableSource;
    sortMode?: FacetSortMode;
    columnType?: ColumnType;
    limit?: number;
  };
  dataType?: 'string' | 'number' | 'date' | 'boolean';
  groupId?: string;
  description?: string;
}

export interface FilterCollection {
  id: string;
  filters: Array<FilterDefinition>;
}

export interface FilterRuntime {
  definition: FilterDefinition;
  selection: Selection;
  scopeId: string;
}

export interface UseMosaicFiltersOptions {
  definitions: Array<FilterDefinition>;
  scopeId: string;
}

export interface FilterScope {
  id: string;
  definitions: Array<FilterDefinition>;
  selections: Record<string, Selection>;
  context: Selection;
}

export interface FilterBinding {
  operator: string | null;
  value: unknown;
  valueTo: unknown;
  setOperator: (next: string) => void;
  setValue: (next: unknown) => void;
  setValueTo: (next: unknown) => void;
  clear: () => void;
  apply: () => void;
}

export interface UseFilterFacetOptions {
  filter: FilterRuntime;
  filterBy?: Selection;
  additionalContext?: Selection;
  enabled?: boolean;
}
