/**
 * View component for the Athletes dataset implemented from "First Principles".
 *
 * This component demonstrates how to use the Mosaic Core Adapter without the
 * `createMosaicMapping` or `createMosaicColumnHelper` utilities.
 *
 * Instead of a centralized mapping object, SQL configuration (column names, filter types,
 * facet modes) is injected directly into the standard TanStack `column.meta` property.
 *
 * This approach is more verbose and less type-safe but provides maximum flexibility
 * and reduces dependencies on helper utilities.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import {
  coerceDate,
  coerceNumber,
  useMosaicReactTable,
} from '@nozzleio/mosaic-tanstack-react-table';
import { useRegisterSelections } from '@nozzleio/react-mosaic';
import type { ColumnDef } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes_simple';

// Initialize Mosaic Selections
// $query: Driven by global inputs (Sports menu, Gender menu, Search)
// $tableFilter: Driven by the table headers
// $combined: Intersection of both, used to filter the Chart points
const $query = vg.Selection.intersect();
const $tableFilter = vg.Selection.intersect();
const $combined = vg.Selection.intersect({ include: [$query, $tableFilter] });

interface AthleteRowData {
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
}

export function AthletesViewSimple() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  // Register selections so Global Reset works on this view
  useRegisterSelections([$query, $tableFilter, $combined]);

  // Data Loading & Chart Setup Effect
  useEffect(() => {
    if (!chartDivRef.current || chartDivRef.current.hasChildNodes()) {
      return;
    }

    async function setup() {
      try {
        setIsPending(true);

        // 1. Create the table in DuckDB
        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
          ]);

        // 2. Define the Inputs (Menus & Search) linked to $query
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

        // 3. Define the Plot (Chart) filtered by $combined
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
          // Brush updates $query
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
        console.error('Failed to load athletes table:', err);
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

  // Manual Column Definitions
  // We use standard TanStack ColumnDef objects.
  // We manually populate `meta.mosaicDataTable` to tell the adapter how to generate SQL.
  const columns = useMemo<Array<ColumnDef<AthleteRowData, any>>>(
    () => [
      {
        accessorKey: 'id',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="ID" view={view} />
        ),
        meta: {
          // SQL Config: Explicitly map to 'id' column and use EQUALS for filtering
          mosaicDataTable: {
            sqlColumn: 'id',
            sqlFilterType: 'EQUALS',
          },
        },
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Name" view={view} />
        ),
        meta: {
          filterVariant: 'text',
          // SQL Config: Use ILIKE for case-insensitive partial matching
          mosaicDataTable: {
            sqlColumn: 'name',
            sqlFilterType: 'PARTIAL_ILIKE',
          },
        },
      },
      {
        accessorKey: 'nationality',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Nationality" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          // SQL Config: Use EQUALS filter and trigger 'unique' facet strategy for dropdowns
          mosaicDataTable: {
            sqlColumn: 'nationality',
            sqlFilterType: 'EQUALS',
            facet: 'unique',
          },
        },
      },
      {
        accessorKey: 'sex',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Gender" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          mosaicDataTable: {
            sqlColumn: 'sex',
            sqlFilterType: 'EQUALS',
            facet: 'unique',
          },
        },
      },
      {
        accessorKey: 'date_of_birth',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="DOB" view={view} />
        ),
        cell: (props) => {
          const val = props.getValue();
          return val instanceof Date ? simpleDateFormatter.format(val) : val;
        },
        meta: {
          filterVariant: 'range',
          rangeFilterType: 'date',
          // SQL Config: Explicitly specify DATE_RANGE to handle date string comparisons correctly
          mosaicDataTable: {
            sqlColumn: 'date_of_birth',
            sqlFilterType: 'DATE_RANGE',
          },
        },
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
          // SQL Config: RANGE filter and 'minmax' facet for slider bounds
          mosaicDataTable: {
            sqlColumn: 'height',
            sqlFilterType: 'RANGE',
            facet: 'minmax',
          },
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
          mosaicDataTable: {
            sqlColumn: 'weight',
            sqlFilterType: 'RANGE',
            facet: 'minmax',
          },
        },
      },
      {
        accessorKey: 'sport',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Sport" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          mosaicDataTable: {
            sqlColumn: 'sport',
            sqlFilterType: 'PARTIAL_ILIKE',
            facet: 'unique',
          },
        },
      },
      {
        accessorKey: 'gold',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Gold" view={view} />
        ),
        meta: {
          mosaicDataTable: {
            sqlColumn: 'gold',
            sqlFilterType: 'RANGE',
          },
        },
      },
      {
        accessorKey: 'silver',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Silver" view={view} />
        ),
        meta: {
          mosaicDataTable: {
            sqlColumn: 'silver',
            sqlFilterType: 'RANGE',
          },
        },
      },
      {
        accessorKey: 'bronze',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Bronze" view={view} />
        ),
        meta: {
          mosaicDataTable: {
            sqlColumn: 'bronze',
            sqlFilterType: 'RANGE',
          },
        },
      },
    ],
    [view],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    tableFilterSelection: $tableFilter,
    columns,
    converter: (row) =>
      ({
        ...row,
        date_of_birth: coerceDate(row.date_of_birth),
        height: coerceNumber(row.height),
        weight: coerceNumber(row.weight),
        gold: coerceNumber(row.gold),
        silver: coerceNumber(row.silver),
        bronze: coerceNumber(row.bronze),
      }) as AthleteRowData,
    totalRowsMode: 'window',
    tableOptions: {
      enableHiding: true,
      enableMultiSort: true,
      enableSorting: true,
      enableColumnFilters: true,
    },
    __debugName: 'AthletesTableSimple',
  });

  const table = useReactTable(tableOptions);

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 border border-slate-200 rounded text-sm text-slate-600 mb-4">
        <strong>Mode: First Principles (No Helper)</strong>
        <p>
          This table is identical in behavior to the main Athletes Dashboard,
          but it is implemented without <code>createMosaicMapping</code> or{' '}
          <code>createMosaicColumnHelper</code>. Instead, SQL behaviors are
          defined directly in the column metadata.
        </p>
      </div>
      <RenderTable table={table} columns={columns} />
    </div>
  );
}
