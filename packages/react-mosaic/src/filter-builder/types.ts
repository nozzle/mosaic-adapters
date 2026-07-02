import type { Selection } from '@uwdata/mosaic-core';
import type {
  FilterBindingState,
  FilterDefinition,
  FilterRuntime,
  SqlFilterClauseTarget,
} from '@nozzleio/mosaic-core';

export type FilterPersistenceWriteReason = 'apply' | 'clear' | 'external';

export interface FilterBindingPersistenceContext {
  scopeId: string;
  filterId: string;
  definition: FilterDefinition;
  runtime: FilterRuntime;
}

export interface FilterBindingPersistenceWriteContext extends FilterBindingPersistenceContext {
  reason: FilterPersistenceWriteReason;
}

export interface FilterScopePersistenceContext {
  scopeId: string;
  filters: Record<string, FilterRuntime>;
}

export interface FilterScopePersistenceWriteContext extends FilterScopePersistenceContext {
  filterId: string;
  definition: FilterDefinition;
  runtime: FilterRuntime;
  reason: FilterPersistenceWriteReason;
}

export interface FilterBindingPersister {
  read: (
    context: FilterBindingPersistenceContext,
  ) => FilterBindingState | null | undefined;
  write: (
    state: FilterBindingState | null,
    context: FilterBindingPersistenceWriteContext,
  ) => void;
}

export interface FilterScopePersister {
  read: (
    context: FilterScopePersistenceContext,
  ) => Partial<Record<string, FilterBindingState>> | null | undefined;
  write: (
    snapshot: Partial<Record<string, FilterBindingState>>,
    context: FilterScopePersistenceWriteContext,
  ) => void;
}

export interface UseFilterBindingOptions {
  persister?: FilterBindingPersister;
  filterClauseTarget?: SqlFilterClauseTarget;
}

export interface UseMosaicFiltersOptions {
  definitions: Array<FilterDefinition>;
  scopeId: string;
  persister?: FilterScopePersister;
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
  /** Cascading context the facet options are filtered by. */
  filterBy?: Selection;
  /** Additional Selection composed into the facet's filter context. */
  additionalContext?: Selection;
  /** Gate the option queries (e.g. only while the dropdown is open). */
  enabled?: boolean;
}
