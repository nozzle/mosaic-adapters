import type {
  FilterDefinition,
  FilterRuntime,
} from '@nozzleio/mosaic-tanstack-table-core/filter-builder';
import type { Selection } from '@uwdata/mosaic-core';

export type {
  ArrayMultiselectFilterDefinition,
  DateFilterDefinition,
  DateRangeFilterDefinition,
  FilterBindingState,
  FilterCollection,
  FilterDefinition,
  FilterRuntime,
  FilterValueKind,
  NumberFilterDefinition,
  NumberRangeFilterDefinition,
  ScalarMultiselectFilterDefinition,
  SelectFilterDefinition,
  TextFilterDefinition,
} from '@nozzleio/mosaic-tanstack-table-core/filter-builder';

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
