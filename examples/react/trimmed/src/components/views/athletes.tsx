/**
 * View component for the Athletes dataset.
 * Features: Type-Safe Table + Interactive vgplot Chart + Hover Interactions.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import {
  coerceDate,
  coerceNumber,
  createMosaicColumnHelper,
  createMosaicMapping,
  useMosaicReactTable,
} from '@nozzleio/mosaic-tanstack-react-table';
import { useRegisterSelections } from '@nozzleio/react-mosaic';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import type { Row } from '@tanstack/react-table';

const fileURL =
  'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet';
const tableName = 'athletes';

// Constants for Hover Logic
const HOVER_SOURCE = { id: 'hover' };
// Predicate to ensure queries return 0 rows when no selection is active
const NO_SELECTION_PREDICATE = mSql.sql`1 = 0`;

const $query = vg.Selection.intersect();
const $tableFilter = vg.Selection.intersect();
const $combined = vg.Selection.intersect({ include: [$query, $tableFilter] });

// Transient selection for high-frequency hover interactions (Last-writer wins)
// We initialize it with the "No Selection" predicate so the overlay layer starts empty.
const $hover = vg.Selection.single();
$hover.update({
  source: HOVER_SOURCE,
  value: null,
  predicate: NO_SELECTION_PREDICATE,
});

// 1. Typescript Interface
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

// 2. Strict SQL Mapping
// We pass the generic type to ensure keys match AthleteRowData
const AthleteMapping = createMosaicMapping<AthleteRowData>({
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
});

export function AthletesView() {
  const [isPending, setIsPending] = useState(true);
  const chartDivRef = useRef<HTMLDivElement | null>(null);

  // Register active selections for global reset
  useRegisterSelections([$query, $tableFilter, $combined, $hover]);

  // Ensure hover state is reset to "empty" on mount/unmount
  useEffect(() => {
    $hover.update({
      source: HOVER_SOURCE,
      value: null,
      predicate: NO_SELECTION_PREDICATE,
    });
    return () => {
      $hover.update({
        source: HOVER_SOURCE,
        value: null,
        predicate: NO_SELECTION_PREDICATE,
      });
    };
  }, []);

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
          // Hover Overlay: Shows a specific dot when hovering the table row
          // Starts empty due to NO_SELECTION_PREDICATE
          vg.dot(vg.from(tableName, { filterBy: $hover }), {
            x: 'weight',
            y: 'height',
            fill: 'none',
            stroke: 'firebrick',
            strokeWidth: 2,
            r: 6,
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

  const columnHelper = useMemo(
    () => createMosaicColumnHelper<AthleteRowData>(),
    [],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor('id', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="ID" view={view} />
        ),
      }),
      columnHelper.accessor('name', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Name" view={view} />
        ),
        meta: { filterVariant: 'text' },
      }),
      columnHelper.accessor('nationality', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Nationality" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          mosaicDataTable: { facet: 'unique' },
        },
      }),
      columnHelper.accessor('sex', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Gender" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          mosaicDataTable: { facet: 'unique' },
        },
      }),
      columnHelper.accessor('date_of_birth', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="DOB" view={view} />
        ),
        cell: (props) => {
          const value = props.getValue();
          return value instanceof Date
            ? simpleDateFormatter.format(value)
            : value;
        },
        meta: { filterVariant: 'range', rangeFilterType: 'date' },
      }),
      columnHelper.accessor('height', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Height" view={view} />
        ),
        cell: (props) => `${props.getValue()}m`,
        meta: {
          filterVariant: 'range',
          rangeFilterType: 'number',
          mosaicDataTable: { facet: 'minmax' },
        },
      }),
      columnHelper.accessor('weight', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Weight" view={view} />
        ),
        cell: (props) => `${props.getValue()}kg`,
        meta: {
          filterVariant: 'range',
          rangeFilterType: 'number',
          mosaicDataTable: { facet: 'minmax' },
        },
      }),
      columnHelper.accessor('sport', {
        header: ({ column }) => (
          <RenderTableHeader column={column} title="Sport" view={view} />
        ),
        meta: {
          filterVariant: 'select',
          mosaicDataTable: { facet: 'unique' },
        },
      }),
      columnHelper.accessor('gold', {}),
      columnHelper.accessor('silver', {}),
      columnHelper.accessor('bronze', {}),
      columnHelper.accessor('info', {}),
    ],
    [view, columnHelper],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: $query,
    tableFilterSelection: $tableFilter,
    columns,
    mapping: AthleteMapping,
    // Optional converter to ensure data types (esp. Dates)
    converter: (row) =>
      ({
        ...row,
        // Coerce fields that might come as strings/numbers from raw SQL
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
    __debugName: 'AthletesTable',
  });

  const table = useReactTable(tableOptions);

  const handleRowHover = (row: Row<AthleteRowData> | null) => {
    if (row) {
      $hover.update({
        source: HOVER_SOURCE,
        value: row.original.id,
        predicate: mSql.eq(mSql.column('id'), mSql.literal(row.original.id)),
      });
    } else {
      $hover.update({
        source: HOVER_SOURCE,
        value: null,
        predicate: NO_SELECTION_PREDICATE,
      });
    }
  };

  return (
    <div className="space-y-4">
      <RenderTable
        table={table}
        columns={table.options.columns}
        onRowHover={handleRowHover}
      />
    </div>
  );
}