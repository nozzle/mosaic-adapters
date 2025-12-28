/**
 * Factory for the NYC Taxi Dashboard View Model.
 * Implements Selection topology and Aggregation Bridge logic via callbacks.
 */

import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import {
  AggregationBridge,
  createMosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { MosaicViewModel } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';

export interface NycTaxiViewModel extends MosaicViewModel {
  selections: {
    brush: Selection;
    detailFilter: Selection;
    summaryFilter: Selection;
    vendorFilter: Selection;
    zoneFilter: Selection;
    summaryContext: Selection;
    detailContext: Selection;
    chartContext: Selection;
  };
  summaryQueryFactory: (
    filter: mSql.FilterExpr | null | undefined,
  ) => mSql.SelectQuery;
}

export function createNycTaxiModel(coordinator: any): NycTaxiViewModel {
  const brush = vg.Selection.intersect();
  const detailFilter = vg.Selection.intersect();
  const summaryFilter = vg.Selection.intersect();
  const vendorFilter = vg.Selection.intersect();
  const zoneFilter = vg.Selection.intersect();

  const selections = {
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

  const model = createMosaicViewModel<NycTaxiViewModel>(coordinator, {
    reset: (m) => {
      const source = { type: 'reset' };
      m.selections.brush.update({ source, value: null, predicate: null });
      m.selections.detailFilter.update({
        source,
        value: null,
        predicate: null,
      });
      m.selections.summaryFilter.update({
        source,
        value: null,
        predicate: null,
      });
      m.selections.vendorFilter.update({
        source,
        value: null,
        predicate: null,
      });
    },

    setupTopology: (m) => {
      const bridge = new AggregationBridge({
        source: m,
        inputSelection: m.selections.summaryFilter,
        contextSelection: m.selections.summaryContext,
        outputSelection: m.selections.zoneFilter,
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

      m.register(bridge.connect());
    },
  });

  model.selections = selections;

  model.summaryQueryFactory = (filter: mSql.FilterExpr | null | undefined) => {
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

  return model;
}
