/**
 * View component for the Athletes dataset.
 * Features: Type-Safe Table + Interactive vgplot Chart + Hover Interactions.
 * Implements a Cross-Filtering topology where histograms filter the rest of the dashboard
 * but exclude themselves to preserve context.
 */
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import * as vg from '@uwdata/vgplot';
import * as mSql from '@uwdata/mosaic-sql';
import {
  coerceDate,
  coerceNumber,
  createMosaicColumnHelper,
  createMosaicMapping,
  useMosaicReactTable,
  useServerGroupedTable,
} from '@nozzleio/mosaic-tanstack-react-table';
import { useConnectorStatus } from '@nozzleio/react-mosaic';
import type { ColumnDef, Row } from '@tanstack/react-table';
import type {
  GroupLevel,
  GroupMetric,
  GroupedRow,
  LeafColumn,
} from '@nozzleio/mosaic-tanstack-react-table';
import { RenderTable } from '@/components/render-table';
import { RenderTableHeader } from '@/components/render-table-header';
import { cn, simpleDateFormatter } from '@/lib/utils';
import { useURLSearchParam } from '@/hooks/useURLSearchParam';
import { HistogramFilter } from '@/components/histogram-filter';
import { Button } from '@/components/ui/button';
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
  const { mode } = useConnectorStatus();

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
          {isPending && (
            <div className="italic text-sm mb-2">Initializing...</div>
          )}
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
              enabled={!isPending}
            />
            <HistogramFilter
              table={tableName}
              column="height"
              step={0.05}
              selection={topology.$height}
              filterBy={topology.$ctxHeight}
              enabled={!isPending}
            />
          </div>
        )}
      </div>

      <hr />

      <div>
        <h4 className="text-lg mb-2 font-medium">Table area</h4>
        <AthletesTable
          histogramMode={histogramMode}
          topology={topology}
          enabled={!isPending}
        />
      </div>

      <hr />

      <div>
        <h4 className="text-lg mb-2 font-medium">
          Grouped Table (Country → Sport → Gender)
        </h4>
        <AthletesGroupedTable topology={topology} enabled={!isPending} />
      </div>
    </div>
  );
}

function AthletesTable({
  histogramMode,
  topology,
  enabled,
}: {
  histogramMode: 'sidebar' | 'header';
  topology: ReturnType<typeof useAthletesTopology>;
  enabled: boolean;
}) {
  const [view] = useURLSearchParam('table-view', 'shadcn-1');

  const columnHelper = useMemo(
    () => createMosaicColumnHelper<AthleteRowData>(),
    [],
  );

  const columns = useMemo<Array<ColumnDef<AthleteRowData, any>>>(
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
                enabled={enabled}
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
                enabled={enabled}
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
    [view, histogramMode, columnHelper, topology, enabled],
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
    enabled,
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

// ---------------------------------------------------------------------------
// Grouped Table — Country → Sport → Gender → Individual Athletes
// ---------------------------------------------------------------------------

const GROUPED_LEVELS: Array<GroupLevel> = [
  { column: 'nationality', label: 'Country' },
  { column: 'sport', label: 'Sport' },
  { column: 'sex', label: 'Gender' },
];

const GROUPED_METRICS: Array<GroupMetric> = [
  { id: 'count', expression: mSql.count(), label: 'Athletes' },
  { id: 'total_gold', expression: mSql.sum('gold'), label: 'Gold' },
  { id: 'total_silver', expression: mSql.sum('silver'), label: 'Silver' },
  { id: 'total_bronze', expression: mSql.sum('bronze'), label: 'Bronze' },
];

const LEAF_COLUMNS: Array<LeafColumn> = [
  { column: 'name', label: 'Name' },
  { column: 'height', label: 'Height' },
  { column: 'weight', label: 'Weight' },
  { column: 'gold', label: 'Gold' },
  { column: 'silver', label: 'Silver' },
  { column: 'bronze', label: 'Bronze' },
];

// Per-column overrides for leaf row rendering.
// Any column not listed here gets a default 80px width and String(val) rendering.
const LEAF_COL_STYLES: Record<
  string,
  {
    label?: string;
    width?: number;
    className?: string;
    render?: (val: unknown) => string;
  }
> = {
  id: { label: 'ID', width: 70, className: 'text-slate-400 tabular-nums' },
  name: { label: 'Name', width: 160, className: 'font-medium text-slate-700' },
  date_of_birth: {
    label: 'Born',
    width: 90,
    className: 'text-slate-500 tabular-nums',
    render: (v) => (v != null ? String(v).slice(0, 10) : '—'),
  },
  height: {
    label: 'Height',
    width: 60,
    className: 'text-slate-500 tabular-nums',
    render: (v) => (v != null ? `${String(v)}m` : '—'),
  },
  weight: {
    label: 'Weight',
    width: 60,
    className: 'text-slate-500 tabular-nums',
    render: (v) => (v != null ? `${String(v)}kg` : '—'),
  },
  gold: { label: 'Gold', width: 50, className: 'tabular-nums text-amber-600' },
  silver: {
    label: 'Silver',
    width: 50,
    className: 'tabular-nums text-slate-400',
  },
  bronze: {
    label: 'Bronze',
    width: 50,
    className: 'tabular-nums text-amber-800',
  },
  info: { label: 'Info', width: 200, className: 'text-slate-400 italic' },
};

function AthletesGroupedTable({
  topology,
  enabled,
}: {
  topology: ReturnType<typeof useAthletesTopology>;
  enabled: boolean;
}) {
  const { data, expanded, toggleExpand, isRootLoading, totalRootRows } =
    useServerGroupedTable({
      table: tableName,
      groupBy: GROUPED_LEVELS,
      metrics: GROUPED_METRICS,
      filterBy: topology.$tableContext,
      leafColumns: LEAF_COLUMNS,
      leafSelectAll: true,
      enabled,
    });

  const table = useReactTable<GroupedRow>({
    data,
    columns: GROUPED_TABLE_COLUMNS,
    state: { expanded },
    onExpandedChange: () => {
      /* controlled via toggleExpand */
    },
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row._groupId,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  if (isRootLoading && data.length === 0) {
    return <div className="text-sm italic py-4">Loading grouped data...</div>;
  }

  return (
    <div className="border rounded overflow-auto max-h-[600px]">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Group</th>
            <th className="text-right px-3 py-2 font-medium">Athletes</th>
            <th className="text-right px-3 py-2 font-medium">Gold</th>
            <th className="text-right px-3 py-2 font-medium">Silver</th>
            <th className="text-right px-3 py-2 font-medium">Bronze</th>
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, flatIndex) => {
            const original = row.original;

            // Leaf rows: auto-loop over all columns with optional custom overrides
            if (original._isLeafRow) {
              const lv = original.leafValues ?? {};
              const indent = (original._depth + 1) * 20 + 12;
              const keys = Object.keys(lv);

              // Show a column header row before the first leaf in a sibling group
              const prevRow =
                flatIndex > 0
                  ? table.getRowModel().rows[flatIndex - 1]
                  : undefined;
              const isFirstLeaf = !prevRow || !prevRow.original._isLeafRow;

              return (
                <React.Fragment key={row.id}>
                  {isFirstLeaf && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={5} style={{ paddingLeft: `${indent}px` }}>
                        <div className="flex gap-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider py-1 px-1">
                          {keys.map((key) => (
                            <span
                              key={key}
                              className="truncate"
                              style={{
                                width: LEAF_COL_STYLES[key]?.width ?? 80,
                                flexShrink: 0,
                              }}
                            >
                              {LEAF_COL_STYLES[key]?.label ?? key}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-slate-100 text-xs hover:bg-slate-50/50">
                    <td colSpan={5} style={{ paddingLeft: `${indent}px` }}>
                      <div className="flex gap-1 py-0.5 px-1">
                        {keys.map((key) => {
                          const val = lv[key];
                          const style = LEAF_COL_STYLES[key];
                          const rendered = style?.render
                            ? style.render(val)
                            : String(val ?? '—');
                          return (
                            <span
                              key={key}
                              className={cn(
                                'truncate',
                                style?.className ?? 'text-slate-500',
                              )}
                              style={{
                                width: style?.width ?? 80,
                                flexShrink: 0,
                              }}
                            >
                              {rendered}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            // Group rows
            const isExpanded = row.getIsExpanded();
            const indent = original._depth * 20;
            const levelLabel = GROUPED_LEVELS[original._depth]?.label ?? '';

            return (
              <tr
                key={row.id}
                className={cn(
                  'border-t cursor-pointer hover:bg-slate-50 transition-colors',
                  original._depth === 0 && 'font-medium',
                )}
                onClick={() => toggleExpand(row)}
              >
                <td
                  className="px-3 py-1.5"
                  style={{ paddingLeft: `${indent + 12}px` }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-slate-400 w-4 inline-block">
                      {original._isLoading ? '...' : isExpanded ? '▼' : '▶'}
                    </span>
                    <span>{original._groupValue || '(empty)'}</span>
                    <span className="text-xs text-slate-400">
                      ({levelLabel})
                    </span>
                  </span>
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {original.metrics.count?.toLocaleString()}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {original.metrics.total_gold?.toLocaleString() ?? '—'}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {original.metrics.total_silver?.toLocaleString() ?? '—'}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums">
                  {original.metrics.total_bronze?.toLocaleString() ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-xs text-slate-400 px-3 py-2 border-t bg-slate-50">
        {totalRootRows} countries
      </div>
    </div>
  );
}

const groupedHelper = createColumnHelper<GroupedRow>();
const GROUPED_TABLE_COLUMNS = [
  groupedHelper.accessor('_groupValue', { id: 'group' }),
  groupedHelper.accessor((row) => row.metrics.count, { id: 'count' }),
  groupedHelper.accessor((row) => row.metrics.total_gold, { id: 'total_gold' }),
  groupedHelper.accessor((row) => row.metrics.total_silver, {
    id: 'total_silver',
  }),
  groupedHelper.accessor((row) => row.metrics.total_bronze, {
    id: 'total_bronze',
  }),
];
