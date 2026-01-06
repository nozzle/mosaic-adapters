/**
 * View component for the Athletes dataset.
 * Features: Type-Safe Table + Interactive vgplot Chart + Sidecar Histogram.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import { mosaicSchemaHelpers } from '@nozzleio/mosaic-tanstack-table-core';
import { z } from 'zod';
import type { MosaicColumnMapping } from '@nozzleio/mosaic-tanstack-table-core';
import type { ColumnDef } from '@tanstack/react-table';
import type { HistogramBin } from '@/lib/strategies';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { HistogramStrategy } from '@/lib/strategies';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';

const $query = vg.Selection.intersect();
const $tableFilter = vg.Selection.intersect();
const $combined = vg.Selection.intersect({ include: [$query, $tableFilter] });

// 1. Zod Schema
const AthleteSchema = z.object({
  id: mosaicSchemaHelpers.number,
  name: z.string(),
  nationality: z.string(),
  sex: z.string(),
  date_of_birth: mosaicSchemaHelpers.date.nullable(),
  height: mosaicSchemaHelpers.number.nullable(),
  weight: mosaicSchemaHelpers.number.nullable(),
  sport: z.string().nullable(),
  gold: mosaicSchemaHelpers.number.nullable(),
  silver: mosaicSchemaHelpers.number.nullable(),
  bronze: mosaicSchemaHelpers.number.nullable(),
  info: z.string().nullable(),
});

type AthleteRowData = z.infer<typeof AthleteSchema>;

// 2. Strict SQL Mapping
const AthleteMapping: MosaicColumnMapping<AthleteRowData> = {
  id: { sqlColumn: 'id', type: 'INTEGER', filterType: 'EQUALS' },
  name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  nationality: {
    sqlColumn: 'nationality',
    type: 'VARCHAR',
    filterType: 'EQUALS',
  },
  sex: { sqlColumn: 'sex', type: 'VARCHAR', filterType: 'EQUALS' },
  // Map date_of_birth to 'DATE_RANGE' to correctly handle string-based date filtering
  date_of_birth: {
    sqlColumn: 'date_of_birth',
    type: 'DATE',
    filterType: 'DATE_RANGE',
  },
  height: { sqlColumn: 'height', type: 'FLOAT', filterType: 'RANGE' },
  weight: { sqlColumn: 'weight', type: 'FLOAT', filterType: 'RANGE' },
  sport: { sqlColumn: 'sport', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  gold: { sqlColumn: 'gold', type: 'INTEGER', filterType: 'RANGE' },
  silver: { sqlColumn: 'silver', type: 'INTEGER', filterType: 'RANGE' },
  bronze: { sqlColumn: 'bronze', type: 'INTEGER', filterType: 'RANGE' },
  info: { sqlColumn: 'info', type: 'VARCHAR', filterType: 'ILIKE' },
};

export function AthletesView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
        setIsPending(true);

        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
          ]);

        const inputs = vg.hconcat(
          vg.menu({
            label: 'Sport',
            as: $query,
            from: tableName,
            column: 'sport',
          }),
          vg.menu({
            label: 'Gender',
            as: $query,
            from: tableName,
            column: 'sex',
          }),
          vg.search({
            label: 'Name',
            as: $query,
            from: tableName,
            column: 'name',
            type: 'contains',
          }),
        );

        const plot = vg.plot(
          vg.dot(vg.from(tableName, { filterBy: $combined }), {
            x: 'weight',
            y: 'height',
            fill: 'sex',
            r: 2,
            opacity: 0.05,
          }),
          vg.regressionY(vg.from(tableName, { filterBy: $combined }), {
            x: 'weight',
            y: 'height',
            stroke: 'sex',
          }),
          vg.intervalXY({
            as: $query,
            brush: { fillOpacity: 0, stroke: 'currentColor' },
          }),
          vg.xyDomain(vg.Fixed),
          vg.colorDomain(vg.Fixed),
        );

        const layout = vg.vconcat(inputs, vg.vspace(10), plot);
        chartDivRef.current?.replaceChildren(layout);

        setIsPending(false);
      } catch (err) {
        console.warn('AthletesView setup interrupted or failed:', err);
      }
    }

    setup();
  }, []);

  return (
    <>
      <h4 className="text-lg mb-2 font-medium">Chart & Controls</h4>
      {isPending && <div className="italic">Loading data...</div>}
      <div ref={chartDivRef} />
      <hr className="my-4" />
      <h4 className="text-lg mb-2 font-medium">Table area</h4>
      {isPending ? (
        <div className="italic">Loading data...</div>
      ) : (
        <AthletesTable />
      )}
    </>
  );
}

function AthletesTable() {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');
  const [histData, setHistData] = useState<Array<HistogramBin>>([]);

  const columns = useMemo(
    () =>
      [
        {
          accessorKey: 'id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="ID" view={view} />
          ),
        },
        {
          accessorKey: 'name',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Name" view={view} />
          ),
          meta: { filterVariant: 'text' },
        },
        {
          accessorKey: 'nationality',
          header: ({ column }) => (
            <RenderTableHeader
              column={column}
              title="Nationality"
              view={view}
            />
          ),
          meta: {
            filterVariant: 'select',
            mosaicDataTable: { facet: 'unique' },
          },
        },
        {
          accessorKey: 'sex',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gender" view={view} />
          ),
          meta: {
            filterVariant: 'select',
            mosaicDataTable: { facet: 'unique' },
          },
        },
        {
          accessorKey: 'date_of_birth',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="DOB" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            return value instanceof Date
              ? simpleDateFormatter.format(value)
              : value;
          },
          // Enable date range filtering in the UI
          meta: { filterVariant: 'range', rangeFilterType: 'date' },
        },
        {
          accessorKey: 'height',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Height" view={view} />
          ),
          cell: (props) => `${props.getValue()}m`,
          meta: {
            filterVariant: 'range',
            rangeFilterType: 'number',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
        {
          accessorKey: 'weight',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Weight" view={view} />
          ),
          cell: (props) => `${props.getValue()}kg`,
          meta: {
            filterVariant: 'range',
            rangeFilterType: 'number',
            mosaicDataTable: { facet: 'minmax' },
          },
        },
        {
          accessorKey: 'sport',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Sport" view={view} />
          ),
          meta: {
            filterVariant: 'select',
            mosaicDataTable: { facet: 'unique' },
          },
        },
        { accessorKey: 'gold' },
        { accessorKey: 'silver' },
        { accessorKey: 'bronze' },
        { accessorKey: 'info' },
      ] satisfies Array<ColumnDef<AthleteRowData, any>>,
    [view],
  );

  const { tableOptions, client } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    tableFilterSelection: $tableFilter,
    columns,
    schema: AthleteSchema,
    mapping: AthleteMapping,
    validationMode: 'first',
    totalRowsMode: 'window',
    tableOptions: {
      enableHiding: true,
      enableMultiSort: true,
      enableSorting: true,
      enableColumnFilters: true,
    },
    facetStrategies: {
      histogram: HistogramStrategy,
    },
    __debugName: 'AthletesTable',
  });

  useEffect(() => {
    client.requestAuxiliary({
      id: 'weight_hist',
      type: 'histogram',
      column: 'weight',
      excludeColumnId: 'weight',
      options: { binSize: 5 },
      onResult: (data) => setHistData(data),
    });
  }, [client]);

  const table = useReactTable(tableOptions);

  return (
    <div className="space-y-4">
      <div className="p-4 border rounded bg-slate-50">
        <h5 className="text-sm font-semibold mb-2 text-slate-600">
          Weight Distribution (Linked Sidecar)
        </h5>
        <div className="text-xs text-slate-500 mb-2">
          This chart is driven by the Table Client via{' '}
          <code>requestAuxiliary</code>.
        </div>
        <SimpleBarChart data={histData} />
      </div>
      <RenderTable table={table} columns={table.options.columns} />
    </div>
  );
}

function SimpleBarChart({ data }: { data: Array<HistogramBin> }) {
  if (!data.length) {
    return (
      <div className="h-24 flex items-center justify-center text-slate-400">
        No Data
      </div>
    );
  }
  const maxCount = Math.max(...data.map((d) => d.count));
  const height = 100;
  const width = 400;
  const barWidth = width / data.length;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {data.map((d, i) => {
        const barHeight = (d.count / maxCount) * height;
        return (
          <g key={d.bin0} transform={`translate(${i * barWidth}, 0)`}>
            <rect
              y={height - barHeight}
              width={barWidth - 1}
              height={barHeight}
              className="fill-blue-500 hover:fill-blue-600 transition-all"
            />
            <title>
              {d.bin0}-{d.bin0 + 5}kg: {d.count}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
