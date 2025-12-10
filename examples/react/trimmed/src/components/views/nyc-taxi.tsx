import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import type {
  MosaicDataTableOptions,
  MosaicDataTableSqlFilterType,
} from '@nozzleio/mosaic-tanstack-react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/nyc-rides-2010.parquet';
const tableName = 'trips';

// --- Reactive Topology ---
const $brush = vg.Selection.intersect(); // Brush on Maps
const $detailFilter = vg.Selection.intersect(); // Filter Detail Table
const $vendorFilter = vg.Selection.intersect(); // Dropdown Filter for Vendor

// Detail table needs to react to Map Brush AND Vendor
const $detailContext = vg.Selection.intersect({
  include: [$brush, $vendorFilter],
});

interface TripRowData {
  datetime: string;
  fare_amount: number;
  vendor_id: string;
}

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

      // 2. Visualizations (Placeholder for now)
      // We will add the maps in a later commit.
      const vendorMenu = vg.menu({
        label: 'Vendor',
        as: $vendorFilter,
        from: tableName,
        column: 'vendor_id',
      });

      const layout = vg.vconcat(vendorMenu, vg.vspace(10));

      chartDivRef.current?.replaceChildren(layout);
      setIsPending(false);
    }

    setup();
  }, []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[auto_1fr] gap-6">
      <div>
        <h4 className="text-lg mb-2 font-medium">NYC Taxi Controls</h4>
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
            {/* Summary Table will be added here later */}
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
          rangeFilterType: 'datetime', // Uses the new datetime support
          mosaicDataTable: {
            sqlColumn: 'datetime',
            sqlFilterType: 'RANGE' as MosaicDataTableSqlFilterType,
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
            sqlFilterType: 'EQUALS' as MosaicDataTableSqlFilterType,
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
            sqlFilterType: 'RANGE' as MosaicDataTableSqlFilterType,
          },
        },
      },
    ],
    [view],
  );

  const mosaicOptions: MosaicDataTableOptions<TripRowData> = useMemo(
    () => ({
      table: tableName,
      filterBy: $detailContext,
      tableFilterSelection: $detailFilter,
      columns,
      tableOptions: { enableColumnFilters: true },
    }),
    [columns],
  );

  const { tableOptions, client } = useMosaicReactTable(mosaicOptions);

  // Load facets
  useEffect(() => {
    client.loadColumnMinMax('fare_amount');
    client.loadColumnMinMax('datetime');
    client.loadColumnFacet('vendor_id');
  }, [client]);

  const table = useReactTable(tableOptions);
  return (
    <div className="max-h-[400px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}