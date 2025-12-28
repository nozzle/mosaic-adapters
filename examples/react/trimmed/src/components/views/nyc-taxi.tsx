/**
 * View component for the NYC Taxi dataset.
 * Updated to use the factory-created NycTaxiViewModel.
 */

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  useMosaicReactTable,
  useMosaicViewModel,
} from '@nozzleio/mosaic-tanstack-react-table';
import { createNycTaxiModel } from './nyc-model';
import type { Table } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { ResetDashboardButton } from '@/components/reset-button';

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

export function NycTaxiView({
  onResetRequest,
}: {
  onResetRequest: () => void;
}) {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  const [_, setDetailTable] = useState<Table<TripRowData> | null>(null);
  const [__, setSummaryTable] = useState<Table<SummaryRowData> | null>(null);

  const model = useMosaicViewModel(
    (c) => createNycTaxiModel(c),
    vg.coordinator(),
  );

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
        setIsPending(true);

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
          datetime,
          ST_X(pick) AS px, ST_Y(pick) AS py,
          ST_X(drop) AS dx, ST_Y(drop) AS dy,
          trip_distance, fare_amount, vendor_id
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
          vg.raster(
            vg.from(tableName, { filterBy: model.selections.chartContext }),
            { x: 'px', y: 'py', bandwidth: 0 },
          ),
          vg.intervalXY({ as: model.selections.brush }),
          vg.colorScheme('blues'),
          ...mapAttributes,
        );

        const dropoffMap = vg.plot(
          vg.raster(
            vg.from(tableName, { filterBy: model.selections.chartContext }),
            { x: 'dx', y: 'dy', bandwidth: 0 },
          ),
          vg.intervalXY({ as: model.selections.brush }),
          vg.colorScheme('oranges'),
          ...mapAttributes,
        );

        const layout = vg.hconcat(pickupMap, vg.hspace(10), dropoffMap);
        chartDivRef.current?.replaceChildren(layout);
        setIsPending(false);
      } catch (err) {
        console.warn('NycTaxiView setup failed:', err);
      }
    }

    setup();
  }, [model]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ResetDashboardButton onReset={onResetRequest} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[auto_1fr] gap-6">
        <div>
          <h4 className="text-lg mb-2 font-medium">NYC Taxi Map</h4>
          <div ref={chartDivRef} />
        </div>

        <div className="flex flex-col gap-8">
          {isPending ? (
            <div className="italic">Initializing...</div>
          ) : (
            <>
              <TripsDetailTable model={model} onTableReady={setDetailTable} />
              <TripsSummaryTable model={model} onTableReady={setSummaryTable} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TripsDetailTable({ model, onTableReady }: any) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');
  const columns = useMemo(
    () => [
      {
        id: 'datetime',
        accessorKey: 'datetime',
        header: ({ column }: any) => (
          <RenderTableHeader column={column} title="Time" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'range' as const,
          rangeFilterType: 'datetime' as const,
          mosaicDataTable: {
            sqlColumn: 'datetime',
            sqlFilterType: 'RANGE' as const,
          },
        },
      },
      {
        id: 'vendor_id',
        accessorKey: 'vendor_id',
        header: ({ column }: any) => (
          <RenderTableHeader column={column} title="Vendor" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'select' as const,
          mosaicDataTable: {
            sqlColumn: 'vendor_id',
            sqlFilterType: 'EQUALS' as const,
            facet: 'unique' as const,
          },
        },
      },
    ],
    [view],
  );

  const { tableOptions } = useMosaicReactTable({
    table: tableName,
    filterBy: model.selections.detailContext,
    tableFilterSelection: model.selections.detailFilter,
    columns,
    totalRowsMode: 'window',
  });

  const table = useReactTable(tableOptions);
  useEffect(() => onTableReady(table), [table, onTableReady]);
  return (
    <div className="max-h-[300px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}

function TripsSummaryTable({ model, onTableReady }: any) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');
  const columns = useMemo(
    () => [
      {
        id: 'zone_x',
        accessorKey: 'zone_x',
        header: ({ column }: any) => (
          <RenderTableHeader column={column} title="Zone X" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'text' as const,
          mosaicDataTable: {
            sqlColumn: 'zone_x',
            sqlFilterType: 'EQUALS' as const,
          },
        },
      },
      {
        id: 'trip_count',
        accessorKey: 'trip_count',
        header: ({ column }: any) => (
          <RenderTableHeader column={column} title="Count" view={view} />
        ),
        enableColumnFilter: true,
        meta: {
          filterVariant: 'range' as const,
          mosaicDataTable: {
            sqlColumn: 'trip_count',
            sqlFilterType: 'RANGE' as const,
            facet: 'minmax' as const,
          },
        },
      },
    ],
    [view],
  );

  const { tableOptions } = useMosaicReactTable({
    table: model.summaryQueryFactory,
    filterBy: model.selections.summaryContext,
    tableFilterSelection: model.selections.summaryFilter,
    columns,
    totalRowsMode: 'window',
  });

  const table = useReactTable(tableOptions);
  useEffect(() => onTableReady(table), [table, onTableReady]);
  return (
    <div className="max-h-[300px] overflow-auto border rounded">
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
