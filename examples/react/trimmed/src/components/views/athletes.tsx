// examples/react/trimmed/src/components/views/athletes.tsx
// Updated visual style for the highlight dot to be yellow and larger.
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
// Highlight selection: defaults to empty (select none), updates on hover
const $hover = vg.Selection.intersect({ empty: true });

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

// --- Filter Components (Debounced) ---

function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  debounce?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce]);

  return (
    <input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

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
        value={(columnFilterValue as [any, any])?.[0] ?? ''}
        onChange={(value) =>
          column.setFilterValue((old: [any, any]) => [value, old?.[1]])
        }
        placeholder={`Min ${
          minMax?.[0] !== undefined ? `(${minMax[0]})` : placeholderPrefix
        }`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-[40px]"
        onClick={(e) => e.stopPropagation()}
      />
      <DebouncedInput
        type={type}
        value={(columnFilterValue as [any, any])?.[1] ?? ''}
        onChange={(value) =>
          column.setFilterValue((old: [any, any]) => [old?.[0], value])
        }
        placeholder={`Max ${
          minMax?.[1] !== undefined ? `(${minMax[1]})` : placeholderPrefix
        }`}
        className="w-full px-2 py-1 text-xs border rounded shadow-sm font-normal text-gray-600 focus:border-blue-500 outline-none min-w-[40px]"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
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
        // Base Layer
        vg.dot(vg.from(tableName, { filterBy: $combined }), {
          x: 'weight',
          y: 'height',
          fill: 'sex',
          r: 2,
          opacity: 0.05,
        }),
        // Regression Layer
        vg.regressionY(vg.from(tableName, { filterBy: $combined }), {
          x: 'weight',
          y: 'height',
          stroke: 'sex',
        }),
        // Highlight Layer - Listens to $hover selection
        vg.dot(vg.from(tableName, { filterBy: $hover }), {
          x: 'weight',
          y: 'height',
          fill: 'yellow',
          stroke: 'black',
          strokeWidth: 2,
          r: 6,
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
              sqlFilterType: 'ilike',
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
            mosaicDataTable: {
              sqlColumn: 'nationality',
              sqlFilterType: 'ilike',
            },
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
              sqlFilterType: 'ilike',
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
              sqlFilterType: 'range',
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
              sqlFilterType: 'range',
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
              sqlFilterType: 'range',
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
              sqlFilterType: 'ilike',
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

  const mosaicTableOptions = useMemo(
    () => ({
      table: tableName,
      filterBy: $query,
      internalFilter: $tableFilter,
      hoverAs: $hover, // Pass the hover selection here
      columns,
      primaryKey: ['id'], // Critical for hover predicates
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

  const { tableOptions, client } = useMosaicReactTable<AthleteRowData>(
    mosaicTableOptions,
  );

  // Trigger Server-Side Facet Loading
  // This ensures that when the user opens the filter menu, the data is ready.
  useEffect(() => {
    // Load range bounds for Height and Weight
    client.loadColumnMinMax('Height');
    client.loadColumnMinMax('Weight');

    // Load unique values for Sport and Gender
    client.loadColumnFacet('Sport');
    client.loadColumnFacet('Gender');
  }, [client]);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={table.options.columns} />;
}