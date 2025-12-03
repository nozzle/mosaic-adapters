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
import { DebouncedInput } from '@/components/ui/debounced-input';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';

const $query = vg.Selection.intersect();
const $tableFilter = vg.Selection.intersect();
// Combined filter for the main visualizations
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

// --- Filter Components ---

function DebouncedTextFilter({ column }: { column: any }) {
  const columnFilterValue = column.getFilterValue();
  return (
    <DebouncedInput
      type="text"
      value={columnFilterValue ?? ''}
      onChange={(value) => column.setFilterValue(value)}
      placeholder="Search..."
      className="mt-1 px-2 py-1 text-xs border rounded shadow-sm w-full font-normal text-gray-600 focus:border-blue-500 outline-none"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function SelectFilter({ column }: { column: any }) {
  const columnFilterValue = column.getFilterValue();
  const uniqueValues = column.getFacetedUniqueValues();

  // Debug Log
  React.useEffect(() => {
    console.log(
      `SelectFilter (${column.id}) Options Updated:`,
      uniqueValues.size,
    );
  }, [uniqueValues, column.id]);

  const sortedUniqueValues = React.useMemo(
    () => Array.from(uniqueValues.keys()).sort().slice(0, 5000),
    [uniqueValues],
  );

  return (
    <div className="mt-1 w-full">
      <select
        onChange={(e) => column.setFilterValue(e.target.value)}
        value={columnFilterValue?.toString() || ''}
        className="px-2 py-1 text-xs border rounded shadow-sm w-full font-normal text-gray-600 focus:border-blue-500 outline-none bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">All</option>
        {sortedUniqueValues.map((value: any) => (
          <option value={value} key={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}

function DebouncedRangeFilter({
  column,
  type = 'number',
  placeholderPrefix = '',
}: {
  column: any;
  type?: 'number' | 'date';
  placeholderPrefix?: string;
}) {
  const columnFilterValue = column.getFilterValue();
  const minMax = column.getFacetedMinMaxValues();

  return (
    <div className="flex gap-1 mt-1">
      <DebouncedInput
        type={type}
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        value={(columnFilterValue as [any, any])?.[0] ?? ''}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [value, old?.[1]])
        }
        placeholder={`Min ${
          minMax?.[0] !== undefined ? `(${minMax[0]})` : placeholderPrefix
        }`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-10"
        onClick={(e) => e.stopPropagation()}
      />
      <DebouncedInput
        type={type}
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        value={(columnFilterValue as [any, any])?.[1] ?? ''}
        onChange={(value) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          column.setFilterValue((old: [any, any]) => [old?.[0], value])
        }
        placeholder={`Max ${
          minMax?.[1] !== undefined ? `(${minMax[1]})` : placeholderPrefix
        }`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-10"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

const noopFilter = () => true;

export function AthletesView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) return;

    async function setup() {
      setIsPending(true);

      // Setup the Athletes Linear Regression Plot from https://idl.uw.edu/mosaic/examples/linear-regression.html
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
              sqlFilterType: 'PARTIAL_ILIKE',
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
              <SelectFilter column={column} />
            </div>
          ),
          accessorKey: 'nationality',
          enableColumnFilter: true,
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'nationality',
              sqlFilterType: 'EQUALS',
            },
            filterVariant: 'select',
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
              sqlFilterType: 'EQUALS',
            },
            filterVariant: 'select',
          },
        },
        {
          id: 'dob',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="DOB" view={view} />
              <DebouncedRangeFilter column={column} type="date" />
            </div>
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
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'date_of_birth',
              sqlFilterType: 'RANGE',
            },
          },
        },
        {
          id: 'Height',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="Height" view={view} />
              <DebouncedRangeFilter column={column} type="number" />
            </div>
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
            mosaicDataTable: {
              sqlColumn: 'height',
              sqlFilterType: 'RANGE',
            },
          },
          enableColumnFilter: true,
          filterFn: noopFilter,
        },
        {
          id: 'Weight',
          header: ({ column }) => (
            <div className="flex flex-col items-start gap-1">
              <RenderTableHeader column={column} title="Weight" view={view} />
              <DebouncedRangeFilter column={column} type="number" />
            </div>
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
          filterFn: noopFilter,
          meta: {
            mosaicDataTable: {
              sqlColumn: 'weight',
              sqlFilterType: 'RANGE',
            },
          },
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
              sqlFilterType: 'EQUALS',
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

  const { tableOptions, client } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    tableFilterSelection: $tableFilter,
    columns,
    tableOptions: {
      enableHiding: true,
      enableMultiSort: true,
      enableSorting: true,
      enableColumnFilters: true,
    },
    onTableStateChange: 'requestUpdate',
  });

  // Trigger Server-Side Facet Loading
  useEffect(() => {
    // Load range bounds for Height and Weight
    client.loadColumnMinMax('Height');
    client.loadColumnMinMax('Weight');

    // Load unique values for Sport and Gender
    client.loadColumnFacet('Sport');
    client.loadColumnFacet('Gender');
    // NEW: Load unique values for Nationality
    client.loadColumnFacet('nationality');
  }, [client]);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={table.options.columns} />;
}
