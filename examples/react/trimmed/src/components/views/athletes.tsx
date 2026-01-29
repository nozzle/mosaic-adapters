/**
 * View component for the Athletes dataset.
 * Features: Type-Safe Table + Interactive vgplot Chart + Hover Interactions.
 * Implements a Cross-Filtering topology where histograms filter the rest of the dashboard
 * but exclude themselves to preserve context.
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
import type { Row } from '@tanstack/react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { cn, simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { HistogramFilter } from '@/components/histogram-filter';
import { Button } from '@/components/ui/button';
import { useConnector } from '@/context/ConnectorContext';
import { useAthletesTopology } from '@/hooks/useAthletesTopology';

const tableName = 'athletes';

// Data sources: WASM downloads from URL, Remote uses local server file
const DATA_SOURCES = {
  wasm: 'https://pub-1da360b43ceb401c809f68ca37c7f8a4.r2.dev/data/athletes.parquet',
  remote: '/data/athletes.parquet',
} as const;

// Constants for Hover Logic
const HOVER_SOURCE = { id: 'hover' };
// Predicate to ensure queries return 0 rows when no selection is active
const NO_SELECTION_PREDICATE = mSql.sql`1 = 0`;

// Transient selection for high-frequency hover interactions (Last-writer wins)
// This is module-level but gets reset on mount/unmount and is NOT registered
// with the global reset (intentionally stays empty when reset is clicked)
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
const AthleteMapping = createMosaicMapping<AthleteRowData>({
  id: { sqlColumn: 'id', type: 'INTEGER', filterType: 'EQUALS' },
  name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  nationality: {
    sqlColumn: 'nationality',
    type: 'VARCHAR',
    filterType: 'EQUALS',
  },
  sex: { sqlColumn: 'sex', type: 'VARCHAR', filterType: 'EQUALS' },
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
  const [histogramMode, setHistogramMode] = useState<'sidebar' | 'header'>(
    'sidebar',
  );
  const chartDivRef = useRef<HTMLDivElement | null>(null);
  const loadedModeRef = useRef<string | null>(null);
  const { mode } = useConnector();

  // Use topology hook - selections are created fresh on remount (mode switch)
  const topology = useAthletesTopology();

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
    if (!chartDivRef.current) {
      return;
    }

    // Only re-run full setup if mode actually changed
    const modeChanged = loadedModeRef.current !== mode;
    if (!modeChanged && chartDivRef.current.hasChildNodes()) {
      return;
    }

    // Clear existing content when mode changes
    chartDivRef.current.innerHTML = '';

    async function setup() {
      try {
        setIsPending(true);

        // Use local file path in remote mode, URL in WASM mode
        const fileURL = DATA_SOURCES[mode];

        await vg
          .coordinator()
          .exec([
            `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM '${fileURL}'`,
          ]);

        const inputs = vg.hconcat(
          vg.menu({
            label: 'Sport',
            as: topology.$query,
            from: tableName,
            column: 'sport',
          }),
          vg.menu({
            label: 'Gender',
            as: topology.$query,
            from: tableName,
            column: 'sex',
          }),
          vg.search({
            label: 'Name',
            as: topology.$query,
            from: tableName,
            column: 'name',
            type: 'contains',
          }),
        );

        const plot = vg.plot(
          vg.dot(vg.from(tableName, { filterBy: topology.$combined }), {
            x: 'weight',
            y: 'height',
            fill: 'sex',
            r: 2,
            opacity: 0.05,
          }),
          // Hover Overlay
          vg.dot(vg.from(tableName, { filterBy: $hover }), {
            x: 'weight',
            y: 'height',
            fill: 'none',
            stroke: 'firebrick',
            strokeWidth: 2,
            r: 6,
          }),
          vg.regressionY(vg.from(tableName, { filterBy: topology.$combined }), {
            x: 'weight',
            y: 'height',
            stroke: 'sex',
          }),
          vg.intervalXY({
            as: topology.$query,
            brush: { fillOpacity: 0, stroke: 'currentColor' },
          }),
          vg.xyDomain(vg.Fixed),
          vg.colorDomain(vg.Fixed),
        );

        const layout = vg.vconcat(inputs, vg.vspace(10), plot);
        chartDivRef.current?.replaceChildren(layout);

        loadedModeRef.current = mode;
        setIsPending(false);
      } catch (err) {
        console.warn('AthletesView setup interrupted or failed:', err);
      }
    }

    setup();
  }, [mode, topology]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          Histogram Mode:
        </span>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
          <Button
            variant={histogramMode === 'sidebar' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setHistogramMode('sidebar')}
            className="h-6 text-xs px-2"
          >
            Sidebar
          </Button>
          <Button
            variant={histogramMode === 'header' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setHistogramMode('header')}
            className="h-6 text-xs px-2"
          >
            In-Column
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-6',
          histogramMode === 'sidebar'
            ? 'grid-cols-1 lg:grid-cols-[1fr_300px]'
            : 'grid-cols-1',
        )}
      >
        <div>
          <h4 className="text-lg mb-2 font-medium">Chart & Controls</h4>
          {isPending && <div className="italic">Loading data...</div>}
          <div ref={chartDivRef} />
        </div>

        {histogramMode === 'sidebar' && (
          <div className="flex flex-col gap-4 border-l pl-4">
            <h4 className="text-lg font-medium">Filters</h4>
            <HistogramFilter
              table={tableName}
              column="weight"
              step={5}
              selection={topology.$weight}
              filterBy={topology.$ctxWeight}
            />
            <HistogramFilter
              table={tableName}
              column="height"
              step={0.05}
              selection={topology.$height}
              filterBy={topology.$ctxHeight}
            />
          </div>
        )}
      </div>

      <hr />

      <div>
        <h4 className="text-lg mb-2 font-medium">Table area</h4>
        {isPending ? (
          <div className="italic">Loading data...</div>
        ) : (
          <AthletesTable histogramMode={histogramMode} topology={topology} />
        )}
      </div>
    </div>
  );
}

function AthletesTable({
  histogramMode,
  topology,
}: {
  histogramMode: 'sidebar' | 'header';
  topology: ReturnType<typeof useAthletesTopology>;
}) {
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
          <div
            className={
              histogramMode === 'header'
                ? 'min-w-[180px] flex flex-col gap-1 pb-1'
                : ''
            }
          >
            <RenderTableHeader column={column} title="Height" view={view} />
            {histogramMode === 'header' && (
              <HistogramFilter
                table={tableName}
                column="height"
                step={0.05}
                selection={topology.$height}
                filterBy={topology.$ctxHeight}
                height={40}
              />
            )}
          </div>
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
          <div
            className={
              histogramMode === 'header'
                ? 'min-w-[180px] flex flex-col gap-1 pb-1'
                : ''
            }
          >
            <RenderTableHeader column={column} title="Weight" view={view} />
            {histogramMode === 'header' && (
              <HistogramFilter
                table={tableName}
                column="weight"
                step={5}
                selection={topology.$weight}
                filterBy={topology.$ctxWeight}
                height={40}
              />
            )}
          </div>
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
    [view, histogramMode, columnHelper, topology],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: tableName,
    filterBy: topology.$tableContext,
    tableFilterSelection: topology.$tableFilter,
    columns,
    mapping: AthleteMapping,
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
