/**
 * View component for the Athletes dataset implemented from "First Principles".
 *
 * This component demonstrates how to use the Mosaic Core Adapter without the
 * `createMosaicMapping` or `createMosaicColumnHelper` utilities.
 *
 * Instead of a centralized mapping object, SQL configuration (column names, filter types,
 * facet modes) is injected directly into the standard TanStack `column.meta.mosaic` property.
 *
 * This approach is more verbose and less type-safe but provides maximum flexibility
 * and reduces dependencies on helper utilities.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactTable } from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import { useMosaicReactTable } from '@nozzleio/mosaic-tanstack-react-table';
import {
  useMosaicSelectInput,
  useMosaicTextInput,
} from '@nozzleio/mosaic-tanstack-react-table/inputs';
import {
  coerceDate,
  coerceNumber,
} from '@nozzleio/mosaic-tanstack-react-table/helpers';
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

const sportInputOptions = {
  as: $query,
  from: tableName,
  column: 'sport',
  field: 'sport',
};
const genderInputOptions = {
  as: $query,
  from: tableName,
  column: 'sex',
  field: 'sex',
};
const nameInputOptions = {
  as: $query,
  from: tableName,
  column: 'name',
  field: 'name',
  match: 'contains' as const,
};

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

        // 2. Define the Plot (Chart) filtered by $combined
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

        chartDivRef.current?.replaceChildren(plot);

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
      {!isPending && <AthletesInputs />}
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

function AthletesInputs() {
  const sportInput = useMosaicSelectInput<string>(sportInputOptions);
  const genderInput = useMosaicSelectInput<string>(genderInputOptions);
  const nameInput = useMosaicTextInput(nameInputOptions);
  const inputClassName =
    'border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <label className="grid gap-1.5 text-sm font-medium">
        <span>Sport</span>
        <AthletesSelectControl input={sportInput} className={inputClassName} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        <span>Gender</span>
        <AthletesSelectControl input={genderInput} className={inputClassName} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        <span>Name</span>
        <input
          value={nameInput.value}
          onChange={(event) => nameInput.setValue(event.currentTarget.value)}
          onFocus={(event) => nameInput.activate(event.currentTarget.value)}
          onPointerEnter={(event) =>
            nameInput.activate(event.currentTarget.value)
          }
          className={inputClassName}
          placeholder="Search names"
        />
      </label>
    </div>
  );
}

type AthletesSelectInput = ReturnType<typeof useMosaicSelectInput<string>>;

function findOptionIndex(
  options: AthletesSelectInput['options'],
  value: string | '' | null | undefined,
): number {
  return options.findIndex((option) => Object.is(option.value, value));
}

function selectedOptionIndex(input: AthletesSelectInput): string {
  const value = Array.isArray(input.value)
    ? (input.value[0] ?? null)
    : input.value;
  const index = findOptionIndex(input.options, value);

  if (index < 0) {
    return '';
  }

  return String(index);
}

function readSelectValue(input: AthletesSelectInput, index: string) {
  const option = input.options[Number(index)];

  return option?.value ?? null;
}

function AthletesSelectControl({
  input,
  className,
}: {
  input: AthletesSelectInput;
  className: string;
}) {
  const selectedIndex = selectedOptionIndex(input);

  return (
    <select
      value={selectedIndex}
      onChange={(event) => {
        input.setValue(readSelectValue(input, event.currentTarget.value));
      }}
      onFocus={(event) => {
        input.activate(readSelectValue(input, event.currentTarget.value));
      }}
      onPointerEnter={(event) => {
        input.activate(readSelectValue(input, event.currentTarget.value));
      }}
      className={className}
    >
      {input.options.map((option, index) => (
        <option key={index} value={String(index)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function AthletesTable() {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  // Manual Column Definitions
  // We use standard TanStack ColumnDef objects.
  // We manually populate `meta.mosaic` to tell the adapter how to generate SQL.
  const columns = useMemo<Array<ColumnDef<AthleteRowData, any>>>(
    () => [
      {
        accessorKey: 'id',
        header: ({ column }) => (
          <RenderTableHeader column={column} title="ID" view={view} />
        ),
        meta: {
          // SQL Config: Explicitly map to 'id' column and use EQUALS for filtering
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
          mosaic: {
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
