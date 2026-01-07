/**
 * Hook derived from PaaDashboardModel.
 * Encapsulates the Search & Facet topology for the PAA Dashboard.
 */
import { useMemo } from 'react';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicSelection,
  useSelectionListener,
} from '@nozzleio/react-mosaic';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

export function usePaaTopology() {
  // 1. Instantiate Selections
  const input = useMosaicSelection('crossfilter');
  const detail = useMosaicSelection('intersect');
  const cross = useMosaicSelection('crossfilter');

  // 2. Define Derived Contexts
  const contexts = useMemo(() => {
    return {
      // External: The "Rest of the World" from the perspective of the Input Layer.
      externalContext: vg.Selection.intersect({ include: [detail, cross] }),
      // Summary: Respect Inputs AND Detail Table Filters AND Cross clicks.
      // We include 'cross' here so that when one summary table is clicked,
      // the OTHER summary tables filter down (Drill-down behavior).
      // The source table is protected from self-filtering because 'cross' is a CrossFilterSelection.
      summaryContext: vg.Selection.intersect({
        include: [input, detail, cross],
      }),
      // Detail: Respect Inputs AND Summary Table Clicks. Generates detail filter.
      detailContext: vg.Selection.intersect({ include: [input, cross] }),
      // Global: Intersection of everything (for KPIs)
      globalContext: vg.Selection.intersect({
        include: [input, detail, cross],
      }),
    };
  }, [input, detail, cross]);

  // 3. Define Logic (Listeners)
  // When top-bar inputs change, clear specific row clicks (cross selections)
  // to prevent logical contradictions.
  useSelectionListener(input, () => {
    // Check if we actually have a cross-filter active before clearing
    // to avoid unnecessary updates/flicker.
    if (cross.value !== null) {
      cross.update({
        source: {}, // Arbitrary identity
        value: null,
        predicate: null,
      });
    }
  });

  // 4. Define Column Metadata Helpers
  // This keeps the SQL mapping logic close to the topology definition
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
    cross,
    ...contexts,
    getColumnMeta,
  };
}
