// examples/react/trimmed/src/components/views/athletes.tsx
// Updated to fix the infinite loop in DebouncedTextFilter
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { useMosaicReactTable } from '@/useMosaicReactTable';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

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

// --- Filter Component ---

function DebouncedTextFilter({ column }: { column: any }) {
  const columnFilterValue = column.getFilterValue();
  const [value, setValue] = useState(columnFilterValue ?? '');

  React.useEffect(() => {
    setValue(columnFilterValue ?? '');
  }, [columnFilterValue]);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      // Fix: Handle undefined vs empty string logic strictly
      const currentFilterValue = column.getFilterValue() ?? '';
      if (value !== currentFilterValue) {
        column.setFilterValue(value);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [value, column]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search..."
      className="mt-1 px-2 py-1 text-xs border rounded shadow-sm w-full font-normal text-gray-600 focus:border-blue-500 outline-none"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const noopFilter = () => true;

// --- Main View ---

export function AthletesView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!chartDivRef.current || hasInitialized.current) return;

    async function setup() {
      hasInitialized.current = true;
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
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="Name" view={view} />
              <DebouncedTextFilter column={column} />
            </div>
          ),
          accessorFn: (row) => row.name,
          enableColumnFilter: true,
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'name',
            },
          },
        },
        {
          id: 'nationality',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader
                column={column}
                title="Nationality"
                view={view}
              />
              <DebouncedTextFilter column={column} />
            </div>
          ),
          accessorKey: 'nationality',
          enableColumnFilter: true,
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: { sqlColumn: 'nationality' },
          },
        },
        {
          id: 'Gender',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="Gender" view={view} />
              <DebouncedTextFilter column={column} />
            </div>
          ),
          accessorKey: 'sex',
          enableColumnFilter: true,
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sex',
            },
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
          },
          enableColumnFilter: false,
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
        },
        {
          id: 'Sport',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="Sport" view={view} />
              <DebouncedTextFilter column={column} />
            </div>
          ),
          accessorKey: 'sport',
          enableColumnFilter: true,
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'sport',
            },
          },
        },
        {
          id: 'Gold(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Gold(s)" view={view} />
          ),
          accessorKey: 'gold',
        },
        {
          id: 'Silver(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Silver(s)" view={view} />
          ),
          accessorKey: 'silver',
        },
        {
          id: 'Bronze(s)',
          header: ({ column }) => (
            <RenderTableHeader column={column} title="Bronze(s)" view={view} />
          ),
          accessorKey: 'bronze',
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

  const mosaicTableOptions = useMemo(
    () => ({
      table: tableName,
      filterBy: $query,
      internalFilter: $tableFilter,
      columns,
      tableOptions: {
        enableHiding: true,
        enableMultiSort: true,
        enableSorting: true,
        enableColumnFilters: true,
      },
      onTableStateChange: 'requestUpdate' as const,
    }),
    [columns],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>(
    mosaicTableOptions,
  );

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={table.options.columns} />;
}