/**
 * View Model for the Nozzle PAA Dashboard.
 * Encapsulates Selection topology and business logic with explicit metadata mapping.
 */

import * as vg from '@uwdata/vgplot';
import { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

interface PaaSelections extends Record<string, Selection> {
  input: Selection;
  detail: Selection;
  cross: Selection;
  externalContext: Selection;
  summaryContext: Selection;
  detailContext: Selection;
  globalContext: Selection;
}

export class PaaDashboardModel extends MosaicViewModel {
  public selections: PaaSelections;
  private readonly TOPOLOGY_SOURCE = { type: 'paa-topology' };

  constructor(coordinator: any) {
    super(coordinator);

    const input = vg.Selection.crossfilter();
    const detail = vg.Selection.intersect();
    const cross = vg.Selection.crossfilter();

    this.selections = {
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
  }

  public reset() {
    const source = { type: 'reset-action' };
    this.selections.input.update({ source, value: null, predicate: null });
    this.selections.detail.update({ source, value: null, predicate: null });
    this.selections.cross.update({ source, value: null, predicate: null });
  }

  protected setupTopology(): void {
    this.listen(this.selections.input, 'value', () => {
      if (this.selections.cross.value !== null) {
        this.selections.cross.update({
          source: this.TOPOLOGY_SOURCE,
          value: null,
          predicate: null,
        });
      }
    });
  }

  public getColumnMeta(
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    const map: Record<string, any> = {
      domain: { sqlColumn: 'domain', sqlFilterType: 'PARTIAL_ILIKE' },
      paa_question: {
        sqlColumn: 'related_phrase.phrase',
        sqlFilterType: 'PARTIAL_ILIKE',
      },
      title: { sqlColumn: 'title', sqlFilterType: 'PARTIAL_ILIKE' },
      description: { sqlColumn: 'description', sqlFilterType: 'PARTIAL_ILIKE' },
    };
    return map[id];
  }
}
