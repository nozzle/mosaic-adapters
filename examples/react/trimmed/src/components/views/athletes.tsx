// View component for the Athletes dataset demonstrating basic table features, filtering, and regression plots
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

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
              sqlFilterType: 'EQUALS', // 'equals' for drop-down exact match
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
              // Using PARTIAL_ILIKE so 'gym' finds 'Gymnastics'
              sqlFilterType: 'PARTIAL_ILIKE',
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
    // TODO: Explore having these auto-load based config used in the column meta.

    // Load range bounds for Height and Weight
    client.loadColumnMinMax('Height');
    client.loadColumnMinMax('Weight');

    // Load unique values for Gender and Nationality
    // Removed Sport facet loading as it's now a text search
    client.loadColumnFacet('Gender');
    client.loadColumnFacet('nationality');
    client.loadColumnFacet('Sport');
  }, [client]);

  const table = useReactTable(tableOptions);

  return <RenderTable table={table} columns={table.options.columns} />;
}
