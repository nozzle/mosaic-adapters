import type { FilterSet, FilterSetChip, FilterSetState } from '@nozzleio/mosaic-core';
import { useSelector } from '@tanstack/react-store';

import { createStaticSource } from './static-source';

const EMPTY_FILTER_SET_STATE: FilterSetState = { specs: [], chips: [] };
Object.freeze(EMPTY_FILTER_SET_STATE.specs);
Object.freeze(EMPTY_FILTER_SET_STATE.chips);
Object.freeze(EMPTY_FILTER_SET_STATE);

const EMPTY_FILTER_SET_SOURCE = createStaticSource(EMPTY_FILTER_SET_STATE);

/**
 * Subscribe to a filter set's whole reactive state (specs + chips). The set
 * itself is a long-lived page-scope object (created at module scope or in a
 * route context with `createFilterSet()`, alongside the page's Selections, not
 * per-component); this hook is only the store subscription.
 *
 * Pass `null` / `undefined` while the set is not available yet: the hook then
 * returns a stable, frozen empty state (`{ specs: [], chips: [] }`) and
 * subscribes to nothing.
 */
export function useFilterSetState(filterSet: FilterSet | null | undefined): FilterSetState {
  const source = filterSet?.store ?? EMPTY_FILTER_SET_SOURCE;
  return useSelector(source, (state) => state);
}

/**
 * Subscribe to a filter set's derived chip list for an active-filter bar. The
 * set is a long-lived page-scope object (module scope / route context, like the
 * page's Selections); this hook is only the store subscription.
 *
 * Pass `null` / `undefined` while the set is not available yet: the hook then
 * returns a stable, frozen empty array and subscribes to nothing.
 */
export function useFilterSetChips(filterSet: FilterSet | null | undefined): Array<FilterSetChip> {
  const source = filterSet?.store ?? EMPTY_FILTER_SET_SOURCE;
  return useSelector(source, (state) => state.chips);
}
