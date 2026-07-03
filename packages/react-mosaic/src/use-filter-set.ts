import { useStore } from '@tanstack/react-store';
import type {
  FilterSet,
  FilterSetChip,
  FilterSetState,
} from '@nozzleio/mosaic-core';

/**
 * Subscribe to a filter set's whole reactive state (specs + chips). The set
 * itself is a long-lived page-scope object (created at module scope or in a
 * route context with `createFilterSet()`, alongside the page's Selections, not
 * per-component); this hook is only the store subscription.
 */
export function useFilterSetState(filterSet: FilterSet): FilterSetState {
  return useStore(filterSet.store, (state) => state);
}

/**
 * Subscribe to a filter set's derived chip list for an active-filter bar. The
 * set is a long-lived page-scope object (module scope / route context, like the
 * page's Selections); this hook is only the store subscription.
 */
export function useFilterSetChips(filterSet: FilterSet): Array<FilterSetChip> {
  return useStore(filterSet.store, (state) => state.chips);
}
