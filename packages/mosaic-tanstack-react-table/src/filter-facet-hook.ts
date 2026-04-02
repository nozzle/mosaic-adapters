import * as React from 'react';
import { useMosaicSelectionValue } from '@nozzleio/react-mosaic';

import {
  applyFilterSelection,
  getFacetSelectedValues,
  normalizeFilterBindingState,
} from './filter-builder-helpers';
import { useMosaicTableFacetMenu } from './facet-hook';

import type { UseFilterFacetOptions } from './filter-builder-types';

function mergeFacetOptions(
  databaseOptions: Array<unknown>,
  selectedValues: Array<unknown>,
): Array<unknown> {
  const merged = [...databaseOptions];

  selectedValues.forEach((selectedValue) => {
    if (!merged.some((option) => Object.is(option, selectedValue))) {
      merged.push(selectedValue);
    }
  });

  return merged;
}

export function useFilterFacet(options: UseFilterFacetOptions) {
  const { filter } = options;
  const selectionValue = useMosaicSelectionValue<unknown>(filter.selection);
  const bindingState = React.useMemo(
    () => normalizeFilterBindingState(filter.definition, selectionValue),
    [filter.definition, selectionValue],
  );
  const selectedValues = React.useMemo(
    () => getFacetSelectedValues(filter.definition, bindingState),
    [bindingState, filter.definition],
  );
  const facetConfig = filter.definition.facet;
  const enabled = options.enabled ?? true;
  const facetMenu = useMosaicTableFacetMenu({
    table: facetConfig?.table ?? '',
    column: filter.definition.column,
    selection: filter.selection,
    filterBy: options.filterBy,
    additionalContext: options.additionalContext,
    sortMode: facetConfig?.sortMode,
    columnType: facetConfig?.columnType,
    limit: facetConfig?.limit,
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

  const mergedOptions = React.useMemo(
    () => mergeFacetOptions(facetMenu.options, selectedValues),
    [facetMenu.options, selectedValues],
  );

  return {
    options: mergedOptions,
    selectedValues,
    loading: facetMenu.loading,
    hasMore: facetMenu.hasMore,
    setSearchTerm: facetMenu.setSearchTerm,
    select,
    toggle,
    clear,
    loadMore: facetMenu.loadMore,
  };
}
