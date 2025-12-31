// examples/react/trimmed/src/components/views/athletes.tsx
/**
 * View component for the Athletes dataset.
 * Uses 'window' pagination mode to sync perfectly with the interactive regression plot.
 * DEMO: Uses the new 'requestAuxiliary' API to drive a custom Histogram from the table client.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
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

type AthleteRowData = {
  id: number;
  name: string;
  nationality: string;
  sex: string;
  date_of_birth: Date | null;
  height: number | null;
  weight: number | null;
  sport: string | null;
  gold: number | null;
  silver: number | null;
  bronze: number | null;
  info: string | null;
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

  // State for our custom auxiliary query
  const [histData, setHistData] = useState<Array<HistogramBin>>([]);

  const columns = useMemo(
    () =>
      [
        {
          id: 'id',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="ID" view={view} />
          ),
          accessorKey: 'id',
          enableHiding: false,
          enableSorting: false,
          enableMultiSort: false,
          enableColumnFilter: false,
        },
        {
          id: 'Name',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Name" view={view} />
          ),
          accessorFn: (row) => row.name,
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'name',
              sqlFilterType: 'PARTIAL_ILIKE',
            },
            filterVariant: 'text',
          },
        },
        {
          id: 'nationality',
          header: ({ column }) => (
            <RenderTableHeader
              column={column}
              title="Nationality"
              view={view}
            />
          ),
          accessorKey: 'nationality',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'nationality',
              sqlFilterType: 'EQUALS',
              facet: 'unique',
            },
            filterVariant: 'select',
          },
        },
        {
          id: 'Gender',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gender" view={view} />
          ),
          accessorKey: 'sex',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sex',
              sqlFilterType: 'EQUALS',
              facet: 'unique',
            },
            filterVariant: 'select',
          },
        },
        {
          id: 'dob',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="DOB" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (value instanceof Date) {
              return simpleDateFormatter.format(value);
            }
            return value;
          },
          accessorKey: 'date_of_birth',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'date_of_birth',
              sqlFilterType: 'RANGE',
            },
            filterVariant: 'range',
            rangeFilterType: 'date',
          },
        },
        {
          id: 'Height',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Height" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}m`;
            }
            return value;
          },
          accessorKey: 'height',
          meta: {
            filterVariant: 'range',
            rangeFilterType: 'number',
            mosaicDataTable: {
              sqlColumn: 'height',
              sqlFilterType: 'RANGE',
              facet: 'minmax',
            },
          },
          enableColumnFilter: true,
        },
        {
          id: 'Weight',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Weight" view={view} />
          ),
          cell: (props) => {
            const value = props.getValue();
            if (typeof value === 'number') {
              return `${value}kg`;
            }
            return value;
          },
          accessorKey: 'weight',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'weight',
              sqlFilterType: 'RANGE',
              facet: 'minmax',
            },
            filterVariant: 'range',
          },
        },
        {
          id: 'Sport',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Sport" view={view} />
          ),
          accessorKey: 'sport',
          enableColumnFilter: true,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sport',
              sqlFilterType: 'PARTIAL_ILIKE',
              facet: 'unique',
            },
            filterVariant: 'select',
          },
        },
        {
          id: 'Gold(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gold(s)" view={view} />
          ),
          accessorKey: 'gold',
          enableColumnFilter: false,
        },
        {
          id: 'Silver(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Silver(s)" view={view} />
          ),
          accessorKey: 'silver',
          enableColumnFilter: false,
        },
        {
          id: 'Bronze(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Bronze(s)" view={view} />
          ),
          accessorKey: 'bronze',
          enableColumnFilter: false,
        },
        {
          id: 'Info',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Info" view={view} />
          ),
          accessorKey: 'info',
          enableSorting: false,
          enableColumnFilter: false,
        },
        {
          id: 'actions',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Actions" view={view} />
          ),
          cell: ({ row }) => {
            return (
              <div>
                <button
                  className="px-1 py-0.5 border rounded text-sm opacity-80 hover:opacity-100"
                  onClick={() => {
                    console.info('Row:', row.id, row.original);
                  }}
                >
                  console.info(row)
                </button>
              </div>
            );
          },
          enableHiding: false,
          enableSorting: false,
          enableColumnFilter: false,
        },
      ] satisfies Array<ColumnDef<AthleteRowData, any>>,
    [view],
  );

  const { tableOptions, client } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    tableFilterSelection: $tableFilter,
    columns,
    // Use 'window' mode for Athletes to prevent snapping during map interactions.
    totalRowsMode: 'window',
    tableOptions: {
      enableHiding: true,
      enableMultiSort: true,
      enableSorting: true,
      enableColumnFilters: true,
    },
    // REGISTER CUSTOM STRATEGIES HERE
    facetStrategies: {
      histogram: HistogramStrategy,
    },
    onTableStateChange: 'requestUpdate',
    __debugName: 'AthletesTable',
  });

  // Request the histogram data.
  // We exclude 'Weight' so the histogram shows the full distribution even if you filter weights in the table.
  useEffect(() => {
    client.requestAuxiliary({
      id: 'weight_hist',
      type: 'histogram',
      column: 'weight',
      excludeColumnId: 'Weight',
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
          <code>requestAuxiliary</code>. Filter by "Sport" or "Gender" in the
          table below to see it update!
        </div>
        <SimpleBarChart data={histData} />
      </div>
      <RenderTable table={table} columns={table.options.columns} />
    </div>
  );
}

/**
 * A tiny SVG bar chart to visualize the auxiliary data.
 */
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
