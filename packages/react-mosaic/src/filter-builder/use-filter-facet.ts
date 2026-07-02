import * as React from 'react';
import {
  applyFilterSelection,
  getFacetSelectedValues,
} from '@nozzleio/mosaic-core';

import { useMosaicFacet } from '../use-mosaic-facet';
import { useComposedSelection } from '../use-topology-helpers';
import { useFilterBindingControllerState } from './use-filter-binding-controller';

import type { Selection } from '@uwdata/mosaic-core';
import type { FacetOption } from '@nozzleio/mosaic-core';
import type { UseFilterFacetOptions } from './types';

const DEFAULT_FACET_LIMIT = 50;

export interface FilterFacetResult {
  /** Facet options (value + count), with committed selections merged in. */
  options: Array<FacetOption>;
  selectedValues: Array<unknown>;
  loading: boolean;
  /** True when the option list is cut off at the current limit. */
  hasMore: boolean;
  searchTerm: string;
  setSearchTerm: (next: string) => void;
  /** Replace the selection with a single value; empty values clear. */
  select: (value: unknown) => void;
  /** Toggle a value in/out of the selection. */
  toggle: (value: unknown) => void;
  clear: () => void;
  loadMore: () => void;
}

/**
 * Merge committed selections that fell outside the fetched option window
 * (or were filtered away by the cascading context) so the UI can always
 * render what is selected.
 */
function mergeFacetOptions(
  databaseOptions: Array<FacetOption>,
  selectedValues: Array<unknown>,
): Array<FacetOption> {
  const merged = [...databaseOptions];

  selectedValues.forEach((selectedValue) => {
    if (!merged.some((option) => Object.is(option.value, selectedValue))) {
      merged.push({ value: selectedValue });
    }
  });

  return merged;
}

/**
 * Facet options for a `facet-single` / `facet-multi` filter definition,
 * served by the facet data client, with select/toggle/clear that publish
 * through the filter-builder clause path (stored values, operator aliases,
 * persistence — not the facet client's own publishing).
 */
export function useFilterFacet(
  options: UseFilterFacetOptions,
): FilterFacetResult {
  const { filter } = options;
  const { state: bindingState } = useFilterBindingControllerState(filter);
  const selectedValues = React.useMemo(
    () => getFacetSelectedValues(filter.definition, bindingState),
    [bindingState, filter.definition],
  );

  const facetConfig = filter.definition.facet;
  const enabled = options.enabled ?? true;
  const pageSize = facetConfig?.limit ?? DEFAULT_FACET_LIMIT;

  const [searchTerm, setSearchTerm] = React.useState('');
  const [limit, setLimit] = React.useState(pageSize);

  const contextSelections = React.useMemo(() => {
    const list: Array<Selection> = [];
    if (options.filterBy) {
      list.push(options.filterBy);
    }
    if (options.additionalContext) {
      list.push(options.additionalContext);
    }
    return list;
  }, [options.additionalContext, options.filterBy]);
  const composedContext = useComposedSelection(contextSelections);

  const facet = useMosaicFacet({
    from: facetConfig?.from ?? '',
    column: filter.definition.column,
    arrayColumn: filter.definition.columnType === 'array',
    sort: facetConfig?.sortMode,
    filterBy: contextSelections.length > 0 ? composedContext : undefined,
    inputs: {
      search: searchTerm === '' ? undefined : searchTerm,
      limit,
    },
    enabled: enabled && Boolean(facetConfig),
  });

  const applyFacetValue = React.useCallback(
    (nextValue: unknown) => {
      applyFilterSelection(filter, {
        operator: bindingState.operator,
        value: nextValue,
        valueTo: null,
      });
    },
    [bindingState.operator, filter],
  );

  const clear = React.useCallback(() => {
    applyFilterSelection(filter, {
      operator: bindingState.operator,
      value: filter.definition.valueKind === 'facet-multi' ? [] : null,
      valueTo: null,
    });
  }, [bindingState.operator, filter]);

  const select = React.useCallback(
    (value: unknown) => {
      if (value === null || value === undefined || value === '') {
        clear();
        return;
      }

      if (filter.definition.valueKind === 'facet-multi') {
        applyFacetValue([value]);
        return;
      }

      applyFacetValue(value);
    },
    [applyFacetValue, clear, filter.definition.valueKind],
  );

  const toggle = React.useCallback(
    (value: unknown) => {
      if (filter.definition.valueKind === 'facet-multi') {
        const exists = selectedValues.some((selectedValue) =>
          Object.is(selectedValue, value),
        );
        const nextValues = exists
          ? selectedValues.filter(
              (selectedValue) => !Object.is(selectedValue, value),
            )
          : [...selectedValues, value];

        applyFacetValue(nextValues);
        return;
      }

      if (
        selectedValues.some((selectedValue) => Object.is(selectedValue, value))
      ) {
        clear();
        return;
      }

      applyFacetValue(value);
    },
    [applyFacetValue, clear, filter.definition.valueKind, selectedValues],
  );

  const loadMore = React.useCallback(() => {
    setLimit((current) => current + pageSize);
  }, [pageSize]);

  const mergedOptions = React.useMemo(
    () => mergeFacetOptions(facet.options, selectedValues),
    [facet.options, selectedValues],
  );

  return {
    options: mergedOptions,
    selectedValues,
    loading: facet.status === 'pending',
    hasMore: facet.options.length >= limit,
    searchTerm,
    setSearchTerm,
    select,
    toggle,
    clear,
    loadMore,
  };
}
