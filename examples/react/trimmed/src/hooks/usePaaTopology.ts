/**
 * Hook derived from PaaDashboardModel.
 * Encapsulates the Search & Facet topology for the PAA Dashboard.
 *
 * Implements an Explicit Functional Topology for inputs to ensure robust cross-filtering.
 * Instead of a single "Crossfilter" selection which can be fragile with complex dependencies,
 * we explicitly define:
 * 1. Individual Selections for each Input (Domain, Phrase, etc.)
 * 2. Explicit Contexts for each Input (Context = All Other Inputs)
 * 3. A Global Input Composite (The Union of all Inputs) for downstream tables.
 */
import { useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';
import {
  useMosaicSelection,
  useRegisterSelections,
} from '@nozzleio/react-mosaic';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

export function usePaaTopology() {
  // 1. Instantiate Granular Inputs
  // Each input gets its own independent selection.
  const inputDomain = useMosaicSelection('intersect');
  const inputPhrase = useMosaicSelection('intersect');
  const inputKeywordGroup = useMosaicSelection('intersect');
  const inputDesc = useMosaicSelection('intersect');
  const inputDate = useMosaicSelection('intersect');
  const inputDevice = useMosaicSelection('intersect');
  const inputQuestion = useMosaicSelection('intersect');

  // 2. Instantiate Detail Table Filter
  const detail = useMosaicSelection('intersect');

  // 3. Instantiate Explicit Outputs for Summary Tables
  const selDomain = useMosaicSelection('intersect');
  const selPhrase = useMosaicSelection('intersect');
  const selQuestion = useMosaicSelection('intersect');
  const selUrl = useMosaicSelection('intersect');

  // Register all selections with the global reset context
  useRegisterSelections([
    inputDomain,
    inputPhrase,
    inputKeywordGroup,
    inputDesc,
    inputDate,
    inputDevice,
    inputQuestion,
    detail,
    selDomain,
    selPhrase,
    selQuestion,
    selUrl,
  ]);

  // 4. Define Derived Contexts
  const contexts = useMemo(() => {
    // A. Global Input Composite
    // Represents the intersection of ALL Top Bar Inputs.
    // Used by Summary Tables and KPIs.
    const globalInput = Selection.intersect({
      include: [
        inputDomain,
        inputPhrase,
        inputKeywordGroup,
        inputDesc,
        inputDate,
        inputDevice,
        inputQuestion,
      ],
    });

    // B. Global Cross (Summary Tables Intersection)
    const globalCross = Selection.intersect({
      include: [selDomain, selPhrase, selQuestion, selUrl],
    });

    // C. External Context (Downstream Table State)
    // Used by Input Dropdowns to limit options based on what is visible in the Detail/Summary tables.
    const externalContext = Selection.intersect({
      include: [detail, globalCross],
    });

    // D. Input Contexts (Explicit Cascading Logic)
    // Each dropdown needs to see: "All Other Inputs" + "External Context".
    // We explicitly exclude the input's own selection to allow selecting from the full set.

    const ctxInputDomain = Selection.intersect({
      include: [
        inputPhrase,
        inputKeywordGroup,
        inputDesc,
        inputDate,
        inputDevice,
        inputQuestion,
      ],
    });

    const ctxInputKeywordGroup = Selection.intersect({
      include: [
        inputDomain,
        inputPhrase,
        inputDesc,
        inputDate,
        inputDevice,
        inputQuestion,
      ],
    });

    const ctxInputDevice = Selection.intersect({
      include: [
        inputDomain,
        inputPhrase,
        inputKeywordGroup,
        inputDesc,
        inputDate,
        inputQuestion,
      ],
    });

    return {
      // Expose granular inputs for writing
      inputs: {
        domain: inputDomain,
        phrase: inputPhrase,
        keywordGroup: inputKeywordGroup,
        desc: inputDesc,
        date: inputDate,
        device: inputDevice,
        question: inputQuestion,
      },

      // Expose explicit contexts for reading (Dropdowns)
      inputContexts: {
        domain: ctxInputDomain,
        keywordGroup: ctxInputKeywordGroup,
        device: ctxInputDevice,
      },

      // E. Summary Table Contexts
      // Summary tables are filtered by Global Inputs + Detail Filter + All Other Summary Tables
      domainContext: Selection.intersect({
        include: [globalInput, detail, selPhrase, selQuestion, selUrl],
      }),
      phraseContext: Selection.intersect({
        include: [globalInput, detail, selDomain, selQuestion, selUrl],
      }),
      questionContext: Selection.intersect({
        include: [globalInput, detail, selDomain, selPhrase, selUrl],
      }),
      urlContext: Selection.intersect({
        include: [globalInput, detail, selDomain, selPhrase, selQuestion],
      }),

      // F. Detail Table Context
      // Filtered by everything (Inputs + Summaries)
      detailContext: Selection.intersect({
        include: [globalInput, globalCross],
      }),

      // G. Global Context (KPIs)
      // Filtered by absolutely everything
      globalContext: Selection.intersect({
        include: [globalInput, detail, globalCross],
      }),

      externalContext,
      globalInput,
    };
  }, [
    inputDomain,
    inputPhrase,
    inputKeywordGroup,
    inputDesc,
    inputDate,
    inputDevice,
    inputQuestion,
    detail,
    selDomain,
    selPhrase,
    selQuestion,
    selUrl,
  ]);

  // 5. Define Column Metadata Helpers
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
