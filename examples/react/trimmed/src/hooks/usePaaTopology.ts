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
  useComposedSelection,
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
  // Subquery membership input: question seen on >= N distinct domains.
  'questionDomains',
] as const;

const SUMMARY_KEYS = ['domain', 'phrase', 'question', 'url'] as const;

export function usePaaTopology() {
  // 1. Instantiate Inputs (Batch)
  const inputs = useMosaicSelections(INPUT_KEYS);

  // 2. Instantiate Detail Table Filter
  const detail = useMosaicSelection('intersect');

  // 3. Instantiate Explicit Outputs for Summary Tables (Batch)
  const summaries = useMosaicSelections(SUMMARY_KEYS);

  // 3b. SERP Appearances widget filter (PAA Questions table).
  //     One logical filter, two predicates:
  //     - `serpHaving` carries `HAVING count(*) > N` for the question table's
  //       own grouped query (via `havingBy`).
  //     - `serpMembers` carries the membership subquery
  //       `related_phrase.phrase IN (SELECT ... GROUP BY ... HAVING ...)`
  //       that cross-filters the sibling widgets to the matching subset.
  const serpHaving = useMosaicSelection('intersect');
  const serpMembers = useMosaicSelection('intersect');

  // Register all selections with the global reset context
  useRegisterSelections([
    ...Object.values(inputs),
    detail,
    ...Object.values(summaries),
    serpHaving,
    serpMembers,
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
    // (includes the SERP membership subquery so facet options match the
    // question-widget subset)
    const externalContext = Selection.intersect({
      include: [detail, globalCross, serpMembers],
    });

    // D. Global Context (KPIs)
    const globalContext = Selection.intersect({
      include: [globalInput, detail, globalCross, serpMembers],
    });

    return {
      globalInput,
      globalCross,
      externalContext,
      globalContext,
    };
  }, [inputs, summaries, detail, serpMembers]);

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

  // 6b. Layer the SERP membership subquery onto the sibling summary tables.
  //     The question table is deliberately excluded: it applies the same
  //     restriction as `HAVING count(*) > N` on its own grouped query
  //     (`serpHaving`), so the membership subquery would be redundant there.
  const phraseContext = useComposedSelection([
    summaryContexts.phrase,
    serpMembers,
  ]);
  const domainContext = useComposedSelection([
    summaryContexts.domain,
    serpMembers,
  ]);
  const urlContext = useComposedSelection([summaryContexts.url, serpMembers]);

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
          include: [topology.globalInput, topology.globalCross, serpMembers],
        }),
      [topology.globalInput, topology.globalCross, serpMembers],
    ),
    // Map Summary Selections/Contexts to semantic names expected by the view
    selections: {
      domain: summaries.domain,
      phrase: summaries.phrase,
      question: summaries.question,
      url: summaries.url,
    },
    domainContext,
    phraseContext,
    questionContext: summaryContexts.question,
    urlContext,

    // SERP Appearances widget filter selections (PAA Questions table)
    questionSerp: {
      having: serpHaving,
      members: serpMembers,
    },

    globalInput: topology.globalInput,
    globalContext: topology.globalContext,
    externalContext: topology.externalContext,
    getColumnMeta,
  };
}
