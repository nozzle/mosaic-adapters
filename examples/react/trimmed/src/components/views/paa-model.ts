/**
 * Factory for the Nozzle PAA Dashboard View Model.
 * Encapsulates selection cross-filtering logic and column mapping.
 */

import * as vg from '@uwdata/vgplot';
import { createMosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';

export interface PaaDashboardViewModel extends MosaicViewModel {
  selections: {
    input: Selection;
    detail: Selection;
    cross: Selection;
    externalContext: Selection;
    summaryContext: Selection;
    detailContext: Selection;
    globalContext: Selection;
  };
}

export function createPaaDashboardModel(
  coordinator: any,
): PaaDashboardViewModel {
  const input = vg.Selection.crossfilter();
  const detail = vg.Selection.intersect();
  const cross = vg.Selection.crossfilter();
  const TOPOLOGY_SOURCE = { type: 'paa-topology' };

  const model = createMosaicViewModel<PaaDashboardViewModel>(coordinator, {
    columnMeta: {
      domain: { sqlColumn: 'domain', sqlFilterType: 'PARTIAL_ILIKE' },
      paa_question: {
        sqlColumn: 'related_phrase.phrase',
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      title: { sqlColumn: 'title', sqlFilterType: 'PARTIAL_ILIKE' },
      description: { sqlColumn: 'description', sqlFilterType: 'PARTIAL_ILIKE' },
    },

    reset: (m) => {
      const source = { type: 'reset-action' };
      m.selections.input.update({ source, value: null, predicate: null });
      m.selections.detail.update({ source, value: null, predicate: null });
      m.selections.cross.update({ source, value: null, predicate: null });
    },

    setupTopology: (m) => {
      m.listen(m.selections.input, 'value', () => {
        if (m.selections.cross.value !== null) {
          m.selections.cross.update({
            source: TOPOLOGY_SOURCE,
            value: null,
            predicate: null,
          });
        }
      });
    },
  });

  model.selections = {
    input,
    detail,
    cross,
    externalContext: vg.Selection.intersect({ include: [detail, cross] }),
    summaryContext: vg.Selection.intersect({ include: [input, detail] }),
    detailContext: vg.Selection.intersect({ include: [input, cross] }),
    globalContext: vg.Selection.intersect({
      include: [input, detail, cross],
    }),
  };

  return model;
}
