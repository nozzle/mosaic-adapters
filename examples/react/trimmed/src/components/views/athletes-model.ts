/**
 * View Model for the Athletes Dashboard.
 * Encapsulates selection state and SQL metadata mapping to ensure
 * consistency across dashboard reset cycles.
 */

import * as vg from '@uwdata/vgplot';
import { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

export class AthletesModel extends MosaicViewModel {
  public selections: {
    query: Selection;
    tableFilter: Selection;
    combined: Selection;
  };

  constructor(coordinator: any) {
    super(coordinator);

    // 1. Initialize Selections
    const query = vg.Selection.intersect();
    const tableFilter = vg.Selection.intersect();

    // The regression plot filters by the combined state of inputs and table filters
    const combined = vg.Selection.intersect({ include: [query, tableFilter] });

    this.selections = {
      query,
      tableFilter,
      combined,
    };
  }

  /**
   * Clears all logical selections.
   * Used in conjunction with the high-level React 'key' reset.
   */
  public reset(): void {
    const source = { type: 'reset-trigger' };
    this.selections.query.update({ source, value: null, predicate: null });
    this.selections.tableFilter.update({
      source,
      value: null,
      predicate: null,
    });
  }

  /**
   * Provides the SQL-layer mapping for the Athletes table.
   * This keeps DuckDB-specific logic (like column names and filter types)
   * out of the React rendering code.
   */
  public getColumnMeta(
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    const map: Record<
      string,
      MosaicDataTableColumnDefMetaOptions['mosaicDataTable']
    > = {
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
    };

    return map[id];
  }
}
