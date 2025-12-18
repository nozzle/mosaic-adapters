// View component for the NYC Taxi dataset demonstrating geospatial features, aggregation, and cross-filtering
// Refactored to use NycTaxiModel (MVVM) for logic separation.

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicReactTable,
  useMosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import { NycTaxiModel } from './nyc-model';
import type { ColumnDef } from '@tanstack/react-table';
import type { MosaicDataTableOptions } from '@nozzleio/mosaic-tanstack-react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/nyc-rides-2010.parquet';
const tableName = 'trips';

interface TripRowData {
  datetime: string;
  fare_amount: number;
  vendor_id: string;
}

interface SummaryRowData {
  zone_x: number;
  zone_y: number;
  trip_count: number;
  avg_fare: number;
}

export function NycTaxiView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  // --- 1. Initialize Model (Singleton per component) ---
  const model = useMosaicViewModel(
    (c) => new NycTaxiModel(c),
    vg.coordinator(),
  );

  // --- 2. Setup Data & Visualizations ---
  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
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
        // We use model.selections instead of global variables now.
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
          vg.raster(
            vg.from(tableName, { filterBy: model.selections.chartContext }),
            {
              x: 'px',
              y: 'py',
              bandwidth: 0,
            },
          ),
          vg.intervalXY({ as: model.selections.brush }),
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
          vg.raster(
            vg.from(tableName, { filterBy: model.selections.chartContext }),
            {
              x: 'dx',
              y: 'dy',
              bandwidth: 0,
            },
          ),
          vg.intervalXY({ as: model.selections.brush }),
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
          as: model.selections.vendorFilter,
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
  }, [model]); // Re-run if model instance changes (it should be stable though)

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
              <TripsDetailTable model={model} />
            </div>
            <div>
              <h4 className="text-lg mb-2 font-medium">
                Zone Summary (Aggregated)
              </h4>
              <TripsSummaryTable model={model} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Table 1: Raw Details ---
function TripsDetailTable({ model }: { model: NycTaxiModel }) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columns = useMemo(
    () =>
      [
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
            rangeFilterType: 'datetime',
            mosaicDataTable: {
              sqlColumn: 'datetime',
              sqlFilterType: 'RANGE',
              facet: 'minmax', // Auto-load bounds
            },
          },
        },
        {
          id: 'vendor_id',
          accessorKey: 'vendor_id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Vendor" view={view} />
          ),
          enableColumnFilter: true,
          meta: {
            filterVariant: 'select',
            mosaicDataTable: {
              sqlColumn: 'vendor_id',
              sqlFilterType: 'EQUALS',
              facet: 'unique', // Auto-load facets
            },
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
              facet: 'minmax', // Auto-load bounds
            },
          },
        },
      ] satisfies Array<ColumnDef<TripRowData, any>>,
    [view],
  );

  const mosaicOptions: MosaicDataTableOptions<TripRowData> = useMemo(
    () => ({
      table: tableName,
      // Use Model Selections
      filterBy: model.selections.detailContext,
      tableFilterSelection: model.selections.detailFilter,
      columns,
      tableOptions: { enableColumnFilters: true },
    }),
    [columns, model],
  );

  const { tableOptions } = useMosaicReactTable(mosaicOptions);

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}

// --- Table 2: Aggregated Summary ---
function TripsSummaryTable({ model }: { model: NycTaxiModel }) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  // Columns for the AGGREGATED data
  const columns = useMemo(
    () =>
      [
        {
          id: 'zone_x',
          accessorKey: 'zone_x',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Zone X" view={view} />
          ),
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'zone_x',
              sqlFilterType: 'EQUALS',
            },
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
            mosaicDataTable: {
              sqlColumn: 'zone_y',
              sqlFilterType: 'EQUALS',
            },
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
            mosaicDataTable: {
              sqlColumn: 'trip_count',
              sqlFilterType: 'RANGE',
              facet: 'minmax', // Auto-load bounds
            },
            filterVariant: 'range',
          },
        },
        {
          id: 'avg_fare',
          accessorKey: 'avg_fare',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Avg Fare" view={view} />
          ),
          cell: (p) => p.getValue().toFixed(2),
          meta: {
            mosaicDataTable: {
              sqlColumn: 'avg_fare',
              sqlFilterType: 'RANGE',
              facet: 'minmax', // Auto-load bounds
            },
            filterVariant: 'range',
          },
        },
      ] satisfies Array<ColumnDef<SummaryRowData, any>>,
    [view],
  );

  const mosaicOptions: MosaicDataTableOptions<SummaryRowData> = useMemo(
    () => ({
      // Use Model Factory
      table: model.summaryQueryFactory,
      // Use Model Selections
      filterBy: model.selections.summaryContext,
      tableFilterSelection: model.selections.summaryFilter,
      columns,
      tableOptions: {
        enableColumnFilters: true,
        initialState: { sorting: [{ id: 'trip_count', desc: true }] },
      },
    }),
    [columns, model],
  );

  const { tableOptions } = useMosaicReactTable(mosaicOptions);

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
