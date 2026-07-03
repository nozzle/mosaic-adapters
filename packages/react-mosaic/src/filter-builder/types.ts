import type { Selection } from '@uwdata/mosaic-core';
import type {
  FilterBindingState,
  FilterDefinition,
  FilterRuntime,
  Persister,
  PersisterWriteContext,
  PersisterWriteReason,
  SqlFilterClauseTarget,
} from '@nozzleio/mosaic-core';

export type FilterPersistenceWriteReason = PersisterWriteReason;

export interface FilterBindingPersistenceContext {
  scopeId: string;
  filterId: string;
  definition: FilterDefinition;
  runtime: FilterRuntime;
}

export type FilterBindingPersistenceWriteContext =
  FilterBindingPersistenceContext & PersisterWriteContext;

/**
 * Per-binding persister for one filter editor: the generic core `Persister`
 * contract specialised to filter *intent* (`FilterBindingState` — the
 * `{ operator, value, valueTo }` triple), keyed by a binding context. Reasons
 * unify to `'update' | 'clear' | 'external'`.
 */
export type FilterBindingPersister = Persister<
  FilterBindingState,
  FilterBindingPersistenceContext
>;

export interface UseFilterBindingOptions {
  persister?: FilterBindingPersister;
  filterClauseTarget?: SqlFilterClauseTarget;
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
  /** Cascading context the facet options are filtered by. */
  filterBy?: Selection;
  /** Additional Selection composed into the facet's filter context. */
  additionalContext?: Selection;
  /** Gate the option queries (e.g. only while the dropdown is open). */
  enabled?: boolean;
}
