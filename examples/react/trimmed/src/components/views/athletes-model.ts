/**
 * Factory for the Athletes Dashboard View Model.
 * Uses the composition-based MosaicViewModel to manage selections and metadata.
 */

import * as vg from '@uwdata/vgplot';
import { createMosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';

export interface AthletesViewModel extends MosaicViewModel {
  selections: {
    query: Selection;
    tableFilter: Selection;
    combined: Selection;
  };
}

export function createAthletesModel(coordinator: any): AthletesViewModel {
  const query = vg.Selection.intersect();
  const tableFilter = vg.Selection.intersect();
  const combined = vg.Selection.intersect({ include: [query, tableFilter] });

  const model = createMosaicViewModel<AthletesViewModel>(coordinator, {
    columnMeta: {
      name: {
        sqlColumn: 'name',
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      nationality: {
        sqlColumn: 'nationality',
        sqlFilterType: 'EQUALS',
        facet: 'unique',
      },
      sex: {
        sqlColumn: 'sex',
        sqlFilterType: 'EQUALS',
        facet: 'unique',
      },
      date_of_birth: {
        sqlColumn: 'date_of_birth',
        sqlFilterType: 'RANGE',
      },
      height: {
        sqlColumn: 'height',
        sqlFilterType: 'RANGE',
        facet: 'minmax',
      },
      weight: {
        sqlColumn: 'weight',
        sqlFilterType: 'RANGE',
        facet: 'minmax',
      },
      sport: {
        sqlColumn: 'sport',
        sqlFilterType: 'PARTIAL_ILIKE',
        facet: 'unique',
      },
    },

    reset: () => {
      const source = { type: 'reset-trigger' };
      query.update({ source, value: null, predicate: null });
      tableFilter.update({ source, value: null, predicate: null });
    },
  });

  // Attach state to the instance
  model.selections = { query, tableFilter, combined };

  return model;
}
