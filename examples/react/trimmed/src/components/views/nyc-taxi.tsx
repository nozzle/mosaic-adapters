import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/nyc-rides-2010.parquet';
const tableName = 'trips';

// --- Reactive Topology ---
const $brush = vg.Selection.intersect(); // Brush on Maps
const $detailFilter = vg.Selection.intersect(); // Filter Detail Table
const $summaryFilter = vg.Selection.intersect(); // Filter Summary Table

// Combined filters:
// Summary table needs to react to Map Brush AND Detail Table Filters
const $summaryContext = vg.Selection.intersect({
  include: [$brush, $detailFilter],
});
// Detail table needs to react to Map Brush
const $detailContext = vg.Selection.intersect({ include: [$brush] });
// Charts need to react to everything
const $chartContext = vg.Selection.intersect({
  include: [$brush, $detailFilter, $summaryFilter],
});

export function NycTaxiView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) return;

    async function setup() {
      setIsPending(true);

      // 1. Data Init
      await vg.coordinator().exec([
        vg.loadExtension('spatial'),
        vg.loadParquet('rides', fileURL, {
          select: [
            'pickup_datetime::TIMESTAMP AS datetime',
            "ST_Transform(ST_Point(pickup_latitude, pickup_longitude), 'EPSG:4326', 'ESRI:102718') AS pick",
            "ST_Transform(ST_Point(dropoff_latitude, dropoff_longitude), 'EPSG:4326', 'ESRI:102718') AS drop",
            'trip_distance',
            'fare_amount',
            'tip_amount',
            'total_amount',
            'vendor_id',
          ],
        }),
        `CREATE OR REPLACE TABLE ${tableName} AS SELECT
          (HOUR(datetime) + MINUTE(datetime)/60) AS time,
          MONTH(datetime) AS month,
          datetime,
          ST_X(pick) AS px, ST_Y(pick) AS py,
          ST_X(drop) AS dx, ST_Y(drop) AS dy,
          trip_distance, fare_amount, tip_amount, total_amount, vendor_id
        FROM rides
        WHERE fare_amount > 0 AND trip_distance > 0`,
      ]);

      // 2. Visualizations
      const mapAttributes = [
        vg.width(350),
        vg.height(550),
        vg.margin(0),
        vg.xAxis(null),
        vg.yAxis(null),
        vg.xDomain([975000, 1005000]),
        vg.yDomain([190000, 240000]),
        vg.colorScale('symlog'),
      ];

      const pickupMap = vg.plot(
        vg.raster(vg.from(tableName, { filterBy: $chartContext }), {
          x: 'px',
          y: 'py',
          bandwidth: 0,
        }),
        vg.intervalXY({ as: $brush }),
        vg.text([{ label: 'Pickups' }], {
          dx: 10,
          dy: 10,
          text: 'label',
          fill: 'black',
          fontSize: '1.2em',
          frameAnchor: 'top-left',
        }),
        vg.colorScheme('blues'),
        ...mapAttributes,
      );

      const dropoffMap = vg.plot(
        vg.raster(vg.from(tableName, { filterBy: $chartContext }), {
          x: 'dx',
          y: 'dy',
          bandwidth: 0,
        }),
        vg.intervalXY({ as: $brush }),
        vg.text([{ label: 'Dropoffs' }], {
          dx: 10,
          dy: 10,
          text: 'label',
          fill: 'black',
          fontSize: '1.2em',
          frameAnchor: 'top-left',
        }),
        vg.colorScheme('oranges'),
        ...mapAttributes,
      );

      const layout = vg.hconcat(pickupMap, vg.hspace(10), dropoffMap);
      chartDivRef.current?.replaceChildren(layout);
      setIsPending(false);
    }

    setup();
  }, []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[auto_1fr] gap-6">
      <div>
        <h4 className="text-lg mb-2 font-medium">NYC Taxi Map</h4>
        <div ref={chartDivRef} />
      </div>

      <div className="flex flex-col gap-8 overflow-hidden">
        {isPending ? (
          <div className="italic">Initializing...</div>
        ) : (
          <>
            <div>
              <h4 className="text-lg mb-2 font-medium">Trip Details (Raw)</h4>
              <TripsDetailTable />
            </div>
            <div>
              <h4 className="text-lg mb-2 font-medium">
                Zone Summary (Aggregated)
              </h4>
              <TripsSummaryTable />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Table 1: Raw Details ---
function TripsDetailTable() {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns = useMemo(
    () => [
      {
        id: 'datetime',
        accessorKey: 'datetime',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Time" view={view} />
        ),
        cell: (props) => props.getValue()?.toLocaleString(),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'range',
          rangeFilterType: 'date',
          mosaicDataTable: { sqlColumn: 'datetime', sqlFilterType: 'RANGE' },
        },
      },
      {
        id: 'fare_amount',
        accessorKey: 'fare_amount',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Fare" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'range',
          mosaicDataTable: {
            sqlColumn: 'fare_amount',
            sqlFilterType: 'RANGE',
          },
        },
      },
    ],
    [view],
  );

  const { tableOptions, client } = useMosaicReactTable({
    table: tableName,
    filterBy: $detailContext,
    tableFilterSelection: $detailFilter,
    columns,
    tableOptions: { enableColumnFilters: true },
  });

  // Load facets
  useEffect(() => {
    client.loadColumnMinMax('fare_amount');
  }, [client]);

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}

// --- Table 2: Aggregated Summary ---
function TripsSummaryTable() {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  // Columns for the AGGREGATED data
  const columns = useMemo(
    () => [
      {
        id: 'zone_x',
        accessorKey: 'zone_x',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Zone X" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          mosaicDataTable: { sqlColumn: 'zone_x', sqlFilterType: 'EQUALS' },
          filterVariant: 'text',
        },
      },
      {
        id: 'zone_y',
        accessorKey: 'zone_y',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Zone Y" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          mosaicDataTable: { sqlColumn: 'zone_y', sqlFilterType: 'EQUALS' },
          filterVariant: 'text',
        },
      },
      {
        id: 'trip_count',
        accessorKey: 'trip_count',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Count" view={view} />
        ),
        meta: {
          mosaicDataTable: { sqlColumn: 'trip_count', sqlFilterType: 'RANGE' },
          filterVariant: 'range',
        },
      },
      {
        id: 'avg_fare',
        accessorKey: 'avg_fare',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Avg Fare" view={view} />
        ),
        cell: (p) => (p.getValue() as number)?.toFixed(2),
        meta: {
          mosaicDataTable: { sqlColumn: 'avg_fare', sqlFilterType: 'RANGE' },
          filterVariant: 'range',
        },
      },
    ],
    [view],
  );

  // Define the Aggregation Query Factory
  const queryFactory = useMemo(() => {
    return () => {
      const ZONE_SIZE = 1000;

      const predicate = $summaryContext.predicate(null);

      return mSql.Query.from(tableName)
        .where(predicate) // Apply Map Brushes + Detail Table Filters
        .select({
          zone_x: mSql.sql`round(dx / ${ZONE_SIZE})`,
          zone_y: mSql.sql`round(dy / ${ZONE_SIZE})`,
          trip_count: mSql.count(),
          avg_fare: mSql.avg('total_amount'),
        })
        .groupby('zone_x', 'zone_y');
    };
  }, []);

  const { tableOptions, client } = useMosaicReactTable({
    table: queryFactory,
    filterBy: $summaryContext,
    tableFilterSelection: $summaryFilter,
    columns,
    tableOptions: {
      enableColumnFilters: true,
      initialState: { sorting: [{ id: 'trip_count', desc: true }] },
    },
  });

  // Sidecar facets for aggregated columns
  useEffect(() => {
    client.loadColumnMinMax('trip_count');
    client.loadColumnMinMax('avg_fare');
  }, [client]);

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}