import { useStore } from '@tanstack/react-store';
import type { FilterChip, FilterRegistry } from '@nozzleio/mosaic-core';

/**
 * Subscribe to a filter registry's chip list. The registry itself is a plain
 * page-level object (created next to the Selection topology with
 * `createFilterRegistry()`); this hook is only the store subscription.
 */
export function useFilterChips(registry: FilterRegistry): Array<FilterChip> {
  return useStore(registry.store, (state) => state.chips);
}
