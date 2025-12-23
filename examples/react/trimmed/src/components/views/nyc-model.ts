/**
 * View Model for the NYC Taxi Dashboard.
 * Encapsulates Selection topology, Aggregation Bridge logic, and Query Generation.
 */

import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import {
  AggregationBridge,
  MosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';

export class NycTaxiModel extends MosaicViewModel {
  public selections: {
    brush: Selection;
    detailFilter: Selection;
    summaryFilter: Selection;
    vendorFilter: Selection;
    zoneFilter: Selection;
    // Contexts
    summaryContext: Selection;
    detailContext: Selection;
    chartContext: Selection;
  };

  constructor(coordinator: any) {
    super(coordinator);

    const brush = vg.Selection.intersect();
    const detailFilter = vg.Selection.intersect();
    const summaryFilter = vg.Selection.intersect();
    const vendorFilter = vg.Selection.intersect();
    const zoneFilter = vg.Selection.intersect();

    this.selections = {
      brush,
      detailFilter,
      summaryFilter,
      vendorFilter,
      zoneFilter,
      summaryContext: vg.Selection.intersect({
        include: [brush, detailFilter, vendorFilter],
      }),
      detailContext: vg.Selection.intersect({
        include: [brush, vendorFilter],
      }),
      chartContext: vg.Selection.intersect({
        include: [brush, detailFilter, zoneFilter, vendorFilter],
      }),
    };
  }

  public reset(): void {
    const source = { type: 'reset' };
    this.selections.brush.update({ source, value: null, predicate: null });
    this.selections.detailFilter.update({
      source,
      value: null,
      predicate: null,
    });
    this.selections.summaryFilter.update({
      source,
      value: null,
      predicate: null,
    });
    this.selections.vendorFilter.update({
      source,
      value: null,
      predicate: null,
    });
  }

  protected setupTopology(): void {
    const bridge = new AggregationBridge({
      source: this,
      inputSelection: this.selections.summaryFilter,
      contextSelection: this.selections.summaryContext,
      outputSelection: this.selections.zoneFilter,
      resolve: (summaryPred, contextPred) => {
        const ZONE_SIZE = 1000;
        const subquery = mSql.Query.from('trips')
          .select({
            zone_x: mSql.sql`round(dx / ${ZONE_SIZE})`,
            zone_y: mSql.sql`round(dy / ${ZONE_SIZE})`,
            trip_count: mSql.count(),
          })
          .groupby('zone_x', 'zone_y');

        if (contextPred) {
          subquery.where(contextPred);
        }

        const validZonesQuery = mSql.Query.from(subquery)
          .select('zone_x', 'zone_y')
          .where(summaryPred!);

        const rawZoneKey = mSql.sql`(round(dx / ${ZONE_SIZE}), round(dy / ${ZONE_SIZE}))`;
        return mSql.sql`${rawZoneKey} IN (${validZonesQuery})`;
      },
    });

    this.register(bridge.connect());
  }

  public summaryQueryFactory = (filter: mSql.FilterExpr | null | undefined) => {
    const ZONE_SIZE = 1000;
    const query = mSql.Query.from('trips')
      .select({
        zone_x: mSql.sql`round(dx / ${ZONE_SIZE})`,
        zone_y: mSql.sql`round(dy / ${ZONE_SIZE})`,
        trip_count: mSql.count(),
        avg_fare: mSql.avg('fare_amount'),
      })
      .groupby('zone_x', 'zone_y');

    if (filter) {
      query.where(filter);
    }
    return query;
  };

  public getColumnMeta(
    _id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    return {};
  }
}
