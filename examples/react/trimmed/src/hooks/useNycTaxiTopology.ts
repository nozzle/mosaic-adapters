/**
 * Hook derived from NycTaxiModel.
 * Defines the topological relationships between selections for the NYC Taxi Dashboard.
 * Demonstrates the Functional Topology Pattern.
 */
import { useEffect, useMemo } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { useMosaicSelection } from '@nozzleio/mosaic-react-core';
import { AggregationBridge } from '@nozzleio/mosaic-tanstack-react-table';

export function useNycTaxiTopology() {
  // 1. Instantiate Selections (Stable Identitites)
  const brush = useMosaicSelection('intersect');
  const detailFilter = useMosaicSelection('intersect');
  const summaryFilter = useMosaicSelection('intersect');
  const vendorFilter = useMosaicSelection('intersect');
  const zoneFilter = useMosaicSelection('intersect'); // Output of the bridge

  // 2. Define Contexts (Derived Selections)
  // We use vg.Selection.intersect({ include: [] }) pattern from vgplot
  // to compose selections hierarchically.
  const contexts = useMemo(() => {
    return {
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
  }, [brush, detailFilter, vendorFilter, zoneFilter]);

  // 3. Register the Aggregation Bridge (Effect)
  // This connects the Summary Table logic to the Detail Table logic.
  useEffect(() => {
    const bridge = new AggregationBridge({
      // Stable source identity for cross-filtering
      source: {},
      inputSelection: summaryFilter,
      contextSelection: contexts.summaryContext,
      outputSelection: zoneFilter,
      resolve: (
        summaryPred: mSql.FilterExpr | null,
        contextPred: mSql.FilterExpr | null,
      ) => {
        const ZONE_SIZE = 1000;

        // Build subquery logic
        const subquery = mSql.Query.from('trips')
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

    const disconnect = bridge.connect();
    return () => disconnect();
  }, [summaryFilter, contexts.summaryContext, zoneFilter]);

  // 4. Query Factory (for the Summary Table)
  const summaryQueryFactory = useMemo(
    () => (filter: mSql.FilterExpr | null | undefined) => {
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
    },
    [],
  );

  return {
    brush,
    detailFilter,
    summaryFilter,
    vendorFilter,
    zoneFilter,
    ...contexts,
    summaryQueryFactory,
  };
}
