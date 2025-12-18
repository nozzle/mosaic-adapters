/**
 * View Model for the Nozzle PAA Dashboard.
 * Encapsulates Selection topology, schema mapping, and business logic.
 */

import * as vg from '@uwdata/vgplot';
// Change: Import from the react-table adapter to ensure symbol identity matches the hook
// and to avoid needing a direct dependency on table-core in the example app.
import { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

// Define the shape of our selections for type safety
interface PaaSelections extends Record<string, Selection> {
  input: Selection;
  detail: Selection;
  cross: Selection;
  // Contexts
  externalContext: Selection;
  summaryContext: Selection;
  detailContext: Selection;
  globalContext: Selection;
}

export class PaaDashboardModel extends MosaicViewModel {
  public selections: PaaSelections;
  private readonly TOPOLOGY_SOURCE = {}; // Stable identity

  constructor(coordinator: any) {
    super(coordinator);

    // 1. Instantiate Selections (Moved from React Global/Component scope)
    const input = vg.Selection.crossfilter();
    const detail = vg.Selection.intersect();
    const cross = vg.Selection.crossfilter();

    // 2. Define Derived Contexts
    this.selections = {
      input,
      detail,
      cross,
      // External: The "Rest of the World" from the perspective of the Input Layer.
      externalContext: vg.Selection.intersect({
        include: [detail, cross],
      }),
      // Summary: Respect Inputs AND Detail Table Filters. Use cross for highlighting.
      summaryContext: vg.Selection.intersect({
        include: [input, detail],
      }),
      // Detail: Respect Inputs AND Summary Table Clicks. Generates detail filter.
      detailContext: vg.Selection.intersect({
        include: [input, cross],
      }),
      // Global: Intersection of everything (for KPIs)
      globalContext: vg.Selection.intersect({
        include: [input, detail, cross],
      }),
    };
  }

  // 3. Define the Logic
  protected setupTopology(): void {
    // Logic: When top-bar inputs change, clear specific row clicks
    // to prevent logical contradictions (e.g. Input="YouTube" AND Table="Reddit" => 0 Results).
    this.listen(this.selections.input, 'value', () => {
      // Check if we actually have a cross-filter active before clearing
      // to avoid unnecessary updates/flicker.
      if (this.selections.cross.value !== null) {
        this.selections.cross.update({
          source: this.TOPOLOGY_SOURCE,
          value: null,
          predicate: null,
        });
      }
    });
  }

  // 4. Define Schema Mapping
  public getColumnMeta(
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
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
  }
}
