/**
 * View component for the NYC Taxi dataset.
 * Features: Geospatial Map (vgplot) + Type-Safe Aggregation Bridge.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import { useCoordinator } from '@nozzleio/mosaic-react-core';
import { mosaicSchemaHelpers } from '@nozzleio/mosaic-tanstack-table-core';
import { z } from 'zod';
import type { MosaicColumnMapping } from '@nozzleio/mosaic-tanstack-table-core';
import type { ColumnDef } from '@tanstack/react-table';
import { useNycTaxiTopology } from '@/hooks/useNycTaxiTopology';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/nyc-rides-2010.parquet';
const tableName = 'trips';

// 1. Zod Schemas
const TripSchema = z.object({
  datetime: mosaicSchemaHelpers.date,
  fare_amount: mosaicSchemaHelpers.number,
  vendor_id: z.string(),
});
type TripRowData = z.infer<typeof TripSchema>;

const SummarySchema = z.object({
  zone_x: mosaicSchemaHelpers.number,
  zone_y: mosaicSchemaHelpers.number,
  trip_count: mosaicSchemaHelpers.number,
  avg_fare: mosaicSchemaHelpers.number,
});
type SummaryRowData = z.infer<typeof SummarySchema>;

// 2. Mappings
const TripMapping: MosaicColumnMapping<TripRowData> = {
  datetime: {
    sqlColumn: 'datetime',
    type: 'TIMESTAMP',
    filterType: 'DATE_RANGE',
  },
  vendor_id: { sqlColumn: 'vendor_id', type: 'VARCHAR', filterType: 'EQUALS' },
  fare_amount: { sqlColumn: 'fare_amount', type: 'FLOAT', filterType: 'RANGE' },
};

const SummaryMapping: MosaicColumnMapping<SummaryRowData> = {
  zone_x: { sqlColumn: 'zone_x', type: 'INTEGER', filterType: 'EQUALS' },
  zone_y: { sqlColumn: 'zone_y', type: 'INTEGER', filterType: 'EQUALS' },
  trip_count: { sqlColumn: 'trip_count', type: 'INTEGER', filterType: 'RANGE' },
  avg_fare: { sqlColumn: 'avg_fare', type: 'FLOAT', filterType: 'RANGE' },
};

export function NycTaxiView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);
  const coordinator = useCoordinator();
  const topology = useNycTaxiTopology();

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
        setIsPending(true);

        await coordinator.exec([
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
          vg.raster(vg.from(tableName, { filterBy: topology.chartContext }), {
            x: 'px',
            y: 'py',
            bandwidth: 0,
          }),
          vg.intervalXY({ as: topology.brush }),
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
          vg.raster(vg.from(tableName, { filterBy: topology.chartContext }), {
            x: 'dx',
            y: 'dy',
            bandwidth: 0,
          }),
          vg.intervalXY({ as: topology.brush }),
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

        const vendorMenu = vg.menu({
          label: 'Vendor',
          as: topology.vendorFilter,
          from: tableName,
          column: 'vendor_id',
        });

        const layout = vg.vconcat(
          vendorMenu,
          vg.vspace(10),
          vg.hconcat(pickupMap, vg.hspace(10), dropoffMap),
        );

        chartDivRef.current?.replaceChildren(layout);
        setIsPending(false);
      } catch (err) {
        console.warn('NycTaxiView setup interrupted or failed:', err);
      }
    }

    setup();
  }, [coordinator, topology]);

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
              <TripsDetailTable topology={topology} />
            </div>
            <div>
              <h4 className="text-lg mb-2 font-medium">
                Zone Summary (Aggregated)
              </h4>
              <TripsSummaryTable topology={topology} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TripsDetailTable({
  topology,
}: {
  topology: ReturnType<typeof useNycTaxiTopology>;
}) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns = useMemo(
    () =>
      [
        {
          accessorKey: 'datetime',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Time" view={view} />
          ),
          cell: (props) => props.getValue()?.toLocaleString(),
          meta: {
            filterVariant: 'range',
            rangeFilterType: 'datetime',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
        {
          accessorKey: 'vendor_id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Vendor" view={view} />
          ),
          meta: {
            filterVariant: 'select',
            mosaicDataTable: { facet: 'unique' },
          },
        },
        {
          accessorKey: 'fare_amount',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Fare" view={view} />
          ),
          meta: {
            filterVariant: 'range',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
      ] satisfies Array<ColumnDef<TripRowData, any>>,
    [view],
  );

  const { tableOptions } = useMosaicReactTable({
    table: tableName,
    filterBy: topology.detailContext,
    tableFilterSelection: topology.detailFilter,
    columns,
    schema: TripSchema,
    mapping: TripMapping,
    totalRowsMode: 'window',
    tableOptions: { enableColumnFilters: true },
  });

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}

function TripsSummaryTable({
  topology,
}: {
  topology: ReturnType<typeof useNycTaxiTopology>;
}) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns = useMemo(
    () =>
      [
        {
          accessorKey: 'zone_x',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Zone X" view={view} />
          ),
          meta: { filterVariant: 'text' },
        },
        {
          accessorKey: 'zone_y',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Zone Y" view={view} />
          ),
          meta: { filterVariant: 'text' },
        },
        {
          accessorKey: 'trip_count',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Count" view={view} />
          ),
          meta: {
            filterVariant: 'range',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
        {
          accessorKey: 'avg_fare',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Avg Fare" view={view} />
          ),
          cell: (p) => p.getValue().toFixed(2),
          meta: {
            filterVariant: 'range',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
      ] satisfies Array<ColumnDef<SummaryRowData, any>>,
    [view],
  );

  const { tableOptions } = useMosaicReactTable({
    table: topology.summaryQueryFactory,
    filterBy: topology.summaryContext,
    tableFilterSelection: topology.summaryFilter,
    columns,
    schema: SummarySchema,
    mapping: SummaryMapping,
    totalRowsMode: 'window',
    tableOptions: {
      enableColumnFilters: true,
      initialState: { sorting: [{ id: 'trip_count', desc: true }] },
    },
  });

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
