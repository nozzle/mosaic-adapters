/**
 * Hook derived from PaaDashboardModel.
 * Encapsulates the Search & Facet topology for the PAA Dashboard.
 *
 * Implements an explicit Input/Output topology to support correct cross-filtering behavior.
 * Each summary table has its own "Output" Selection and a derived "Input" Context
 * that excludes its own output to prevent self-filtering.
 */
import { useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import {
  useMosaicSelection,
  useRegisterSelections,
  useSelectionListener,
} from '@nozzleio/react-mosaic';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

export function usePaaTopology() {
  // 1. Instantiate Inputs
  // 'input' captures the top-bar filters (Search, Date Range, etc.)
  // We use 'crossfilter' so that dropdowns can filter each other without filtering themselves.
  const input = useMosaicSelection('crossfilter');
  // 'detail' captures column filters on the main Detail Table
  const detail = useMosaicSelection('intersect');

  // 2. Instantiate Explicit Outputs for Summary Tables
  // Each table gets its own Selection to write to.
  // We use 'intersect' as the base type, though within a single table,
  // multi-selection logic is handled by the SelectionManager.
  const selDomain = useMosaicSelection('intersect');
  const selPhrase = useMosaicSelection('intersect');
  const selQuestion = useMosaicSelection('intersect');
  const selUrl = useMosaicSelection('intersect');

  // Register all selections with the global reset context
  useRegisterSelections([
    input,
    detail,
    selDomain,
    selPhrase,
    selQuestion,
    selUrl,
  ]);

  // 3. Define Derived Contexts (The "Exclusion" Logic)
  const contexts = useMemo(() => {
    // The Global Cross layer (Intersection of all table outputs)
    // Used by components that need to reflect the state of ALL summary tables.
    const globalCross = Selection.intersect({
      include: [selDomain, selPhrase, selQuestion, selUrl],
    });

    return {
      // 1. Contexts for specific Summary Tables (Exclude Self)
      // These contexts ensure a table is filtered by everything EXCEPT itself.
      domainContext: Selection.intersect({
        include: [input, detail, selPhrase, selQuestion, selUrl],
      }),
      phraseContext: Selection.intersect({
        include: [input, detail, selDomain, selQuestion, selUrl],
      }),
      questionContext: Selection.intersect({
        include: [input, detail, selDomain, selPhrase, selUrl],
      }),
      urlContext: Selection.intersect({
        include: [input, detail, selDomain, selPhrase, selQuestion],
      }),

      // 2. Detail Table Context (Listen to Inputs + All Summary Tables)
      // The detail table should reflect every active filter.
      detailContext: Selection.intersect({
        include: [input, globalCross],
      }),

      // 3. Global Context for KPIs
      // KPIs represent the absolute intersection of all constraints.
      globalContext: Selection.intersect({
        include: [input, detail, globalCross],
      }),

      // 4. External Context for Filter Dropdowns
      // Used to filter the dropdown options based on what's selected in tables,
      // preventing users from selecting options that would yield 0 results.
      externalContext: Selection.intersect({
        include: [detail, globalCross],
      }),

      // Expose the global cross selection for internal logic if needed
      globalCross,
    };
  }, [input, detail, selDomain, selPhrase, selQuestion, selUrl]);

  // 4. Logic: Clear Summary Selections when Top Bar Inputs change
  // When high-level filters change (e.g. changing the Date Range),
  // we clear the drill-down selections to prevent invalid states.
  useSelectionListener(input, () => {
    const allSummarySelections = [selDomain, selPhrase, selQuestion, selUrl];
    allSummarySelections.forEach((sel) => {
      // Only trigger an update if there is actually a value to clear
      if (sel.value !== null) {
        sel.update({
          source: {}, // Arbitrary identity for the reset
          value: null,
          predicate: null,
        });
      }
    });
  });

  // 5. Define Column Metadata Helpers
  // Maps UI IDs to SQL column names and filter types
  const getColumnMeta = (
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] => {
    const map: Record<
      string,
      MosaicDataTableColumnDefMetaOptions['mosaicDataTable']
    > = {
      domain: {
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      paa_question: {
        sqlColumn: 'related_phrase.phrase',
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      title: {
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      description: {
        sqlFilterType: 'PARTIAL_ILIKE',
      },
    };
    return map[id];
  };

  return {
    input,
    detail,
    // Expose explicit selections for wiring up the Summary Tables
    selections: {
      domain: selDomain,
      phrase: selPhrase,
      question: selQuestion,
      url: selUrl,
    },
    ...contexts,
    getColumnMeta,
  };
}
