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

    // 1. Instantiate Selections (Scoped to this instance, safe for multi-view)
    const brush = vg.Selection.intersect();
    const detailFilter = vg.Selection.intersect();
    const summaryFilter = vg.Selection.intersect();
    const vendorFilter = vg.Selection.intersect();
    const zoneFilter = vg.Selection.intersect(); // Output of the bridge

    // 2. Define Contexts
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

  protected setupTopology(): void {
    // 3. Register the Aggregation Bridge
    // This translates Summary Table filters (Count > N) into Detail Table filters (Zone IN (...))
    const bridge = new AggregationBridge({
      source: this, // Using 'this' as the stable identity
      inputSelection: this.selections.summaryFilter,
      contextSelection: this.selections.summaryContext,
      outputSelection: this.selections.zoneFilter,
      resolve: (summaryPred, contextPred) => {
        const ZONE_SIZE = 1000;

        // Build subquery logic (Identical to previous React implementation)
        const subquery = mSql.Query.from('trips') // Hardcoded table name for now
          .select({
            zone_x: mSql.sql`round(dx / ${ZONE_SIZE})`,
            zone_y: mSql.sql`round(dy / ${ZONE_SIZE})`,
            trip_count: mSql.count(),
            avg_fare: mSql.avg('fare_amount'),
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

    // Register the disconnect function so it cleans up when the component unmounts
    this.register(bridge.connect());
  }

  /**
   * Factory for the Summary Table Aggregation Query.
   * Defined as an arrow property to ensure stable reference identity across renders.
   */
  public summaryQueryFactory = (filter: mSql.FilterExpr | null | undefined) => {
    const ZONE_SIZE = 1000;
    // Note: We use the passed `filter` argument from MosaicDataTable
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
    id: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    // Implement if we need specific SQL mappings (e.g. for Structs)
    return {};
  }
}
