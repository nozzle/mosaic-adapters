/**
 * Hook derived from PaaDashboardModel.
 * Encapsulates the Search & Facet topology for the PAA Dashboard.
 *
 * REFACTORED: Now uses `useTopologyHelpers` to implement the Explicit Topology
 * with significantly less boilerplate.
 */
import { useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import {
  useCascadingContexts,
  useMosaicSelection,
  useMosaicSelections,
  useRegisterSelections,
} from '@nozzleio/react-mosaic';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

// Define keys statically to ensure type safety and stable references.
// CRITICAL: These must be module-level constants so that useMosaicSelections
// receives a stable array reference, preventing Selection recreation on re-render.
const INPUT_KEYS = [
  'domain',
  'phrase',
  'keywordGroup',
  'desc',
  'date',
  'device',
  'question',
] as const;

const SUMMARY_KEYS = ['domain', 'phrase', 'question', 'url'] as const;

export function usePaaTopology() {
  // 1. Instantiate Inputs (Batch)
  const inputs = useMosaicSelections(INPUT_KEYS);

  // 2. Instantiate Detail Table Filter
  const detail = useMosaicSelection('intersect');

  // 3. Instantiate Explicit Outputs for Summary Tables (Batch)
  const summaries = useMosaicSelections(SUMMARY_KEYS);

  // Register all selections with the global reset context
  useRegisterSelections([
    ...Object.values(inputs),
    detail,
    ...Object.values(summaries),
  ]);

  // 4. Compute Derived Topology
  //    Using helper hooks to automate the "N^2" wiring logic
  const topology = useMemo(() => {
    const allInputs = Object.values(inputs);

    // A. Global Input Composite (Union of all Top Bar Inputs)
    const globalInput = Selection.intersect({
      include: allInputs,
    });

    // B. Global Cross (Summary Tables Intersection)
    const globalCross = Selection.intersect({
      include: Object.values(summaries),
    });

    // C. External Context
    // What the Input Dropdowns should see from the "Outside World"
    const externalContext = Selection.intersect({
      include: [detail, globalCross],
    });

    // D. Global Context (KPIs)
    const globalContext = Selection.intersect({
      include: [globalInput, detail, globalCross],
    });

    return {
      globalInput,
      globalCross,
      externalContext,
      globalContext,
    };
  }, [inputs, summaries, detail]);

  // 5. Wire Cascading Contexts
  //    Each input gets a context containing: [All Other Inputs] + [External Context]
  //    Memoize the externals arrays to keep stable references across renders.
  const inputExternals = useMemo(
    () => [topology.externalContext],
    [topology.externalContext],
  );
  const inputContexts = useCascadingContexts(inputs, inputExternals);

  // 6. Wire Summary Contexts
  //    Summary tables see: [Global Inputs] + [Detail] + [All Other Summaries]
  const summaryExternals = useMemo(
    () => [topology.globalInput, detail],
    [topology.globalInput, detail],
  );
  const summaryContexts = useCascadingContexts(summaries, summaryExternals);

  // 7. Define Column Metadata Helpers
  const getColumnMeta = (
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] => {
    const map: Record<
      string,
      MosaicDataTableColumnDefMetaOptions['mosaicDataTable']
    > = {
      domain: { sqlFilterType: 'PARTIAL_ILIKE' },
      paa_question: {
        sqlColumn: 'related_phrase.phrase',
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      title: { sqlFilterType: 'PARTIAL_ILIKE' },
      description: { sqlFilterType: 'PARTIAL_ILIKE' },
    };
    return map[id];
  };

  return {
    inputs,
    inputContexts,
    detail,
    detailContext: useMemo(
      () =>
        Selection.intersect({
          include: [topology.globalInput, topology.globalCross],
        }),
      [topology.globalInput, topology.globalCross],
    ),
    // Map Summary Selections/Contexts to semantic names expected by the view
    selections: {
      domain: summaries.domain,
      phrase: summaries.phrase,
      question: summaries.question,
      url: summaries.url,
    },
    domainContext: summaryContexts.domain,
    phraseContext: summaryContexts.phrase,
    questionContext: summaryContexts.question,
    urlContext: summaryContexts.url,

    globalInput: topology.globalInput,
    globalContext: topology.globalContext,
    externalContext: topology.externalContext,
    getColumnMeta,
  };
}
